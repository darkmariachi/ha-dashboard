// Web push for the dashboard PWA.
//
// Phones subscribe through the dashboard (nginx proxies /api/push/* here,
// minus /send). Home Assistant sends through POST /send on the LAN port with
// a shared secret, via rest_command.dashboard_push.
//
//   GET  /vapid          -> { publicKey }
//   POST /subscribe      { subscription, token, person, label }
//   POST /unsubscribe    { endpoint, token }
//   POST /test           { endpoint, token }
//   POST /send           (x-push-secret) { title, message, url?, tag?, people?, image? (JPEG data URL) }
//   GET  /img/<id>.jpg   a sent notification's picture (unguessable id, kept 48 h)
//   POST /pair/complete  { id, token, blob }
//   POST /pair/poll      { id } -> { blob | null }
//   POST /visitors/list  { token } -> visit log (visits.mjs)
//   POST /visitors/person { token, person: { id?, name, devices, notify } }
//   POST /visitors/delete { token, id }
//   POST /visitors/hide   { token, entityId, hidden }
//   GET  /health
//
// With HA_TOKEN set it also pushes alerts on its own: doors left open
// (doors.mjs) and lights that dropped off the network (reachability.mjs).
//
// A subscription is only accepted from someone holding a valid Home
// Assistant token (checked against HA's API), since the dashboard is public.
//
// /pair/* relays a QR sign-in (src/lib/pair.ts): a signed-in phone leaves an
// encrypted login under the id a new device is showing, and that device
// picks it up once. The key never comes here, so the blob is opaque.

import { createServer } from "node:http";
import { readFile, writeFile, rename } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import webpush from "web-push";
import { parseDoors, startDoorWatcher } from "./doors.mjs";
import { parseGroups, startReachabilityWatcher } from "./reachability.mjs";
import { startVisitLog } from "./visits.mjs";

const {
  PORT = "8082",
  HA_URL = "http://192.168.1.54:8123",
  PUSH_SECRET,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT = "mailto:admin@localhost",
  DATA_FILE = "/data/subscriptions.json",
  // Visitors tab (visits.mjs). Uses HA_TOKEN too.
  VISITS_FILE = "/data/visitors.json",
  // Who gets "new device on the Wi-Fi" alerts (subscription `person`).
  NEW_DEVICE_PEOPLE = "rodolfo",
  // Door-open alerts (doors.mjs). Needs a long-lived HA access token.
  HA_TOKEN,
  DOOR_SENSORS = "binary_sensor.front_door_sensor=Front Door,binary_sensor.garage_door_sensor=Garage Door,binary_sensor.print_room_garage_door=Print Room Garage Door",
  DOOR_ALERT_MINUTES = "2",
  DOOR_REPEAT_MINUTES = "10",
  // A sensor silent this long gets a "sensor is offline" alert; 0 = never.
  DOOR_OFFLINE_MINUTES = "10",
  // "Lights are unreachable" alerts (reachability.mjs), e.g. smart bulbs
  // behind a wall switch. "Label:entity,entity;Label2:entity"; empty = off.
  UNREACHABLE_GROUPS = "Driveway lights:light.hue_color_lamp_1,light.hue_color_lamp_2,light.hue_color_lamp_3,light.hue_color_lamp_4,light.hue_color_lamp_5",
  UNREACHABLE_MINUTES = "2",
  // Who gets them (subscription `person`); empty = everyone.
  UNREACHABLE_PEOPLE = "rodolfo,priscilla",
} = process.env;

if (!PUSH_SECRET || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error("Missing PUSH_SECRET / VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY");
  process.exit(1);
}
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

/** endpoint -> { subscription, person, label, createdAt } */
let subs = {};
try {
  subs = JSON.parse(await readFile(DATA_FILE, "utf8"));
} catch {
  subs = {};
}

async function save() {
  const tmp = `${DATA_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(subs, null, 2));
  await rename(tmp, DATA_FILE);
}

/** id -> { blob, expires }. Memory only: a pairing is over in seconds. */
const pairings = new Map();
const PAIR_TTL_MS = 2 * 60_000;
const PAIR_MAX = 100;
const PAIR_ID = /^[A-Za-z0-9_-]{22}$/;

function prunePairings() {
  const now = Date.now();
  for (const [id, p] of pairings) if (p.expires <= now) pairings.delete(id);
}

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

/** True if the token is a working HA access token. */
async function validHaToken(token) {
  if (typeof token !== "string" || token.length < 20) return false;
  try {
    const res = await fetch(`${HA_URL}/api/`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function secretOk(given) {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(PUSH_SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function body(req, limit = 16 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("too large");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function reply(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

/** Push one payload to some subscriptions; drops ones the browser has
 * revoked (404/410). Returns how many were delivered. */
async function deliver(endpoints, payload) {
  let sent = 0;
  let dirty = false;
  await Promise.all(
    endpoints.map(async (endpoint) => {
      const entry = subs[endpoint];
      if (!entry) return;
      try {
        await webpush.sendNotification(entry.subscription, JSON.stringify(payload), { TTL: 3600, urgency: "high" });
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          log("removing expired subscription", entry.label, new URL(endpoint).host, err.statusCode, err.body?.slice(0, 200));
          delete subs[endpoint];
          dirty = true;
        } else {
          log("push failed", entry.label, err.statusCode ?? err.message, err.body?.slice(0, 200));
        }
      }
    }),
  );
  if (dirty) await save();
  return sent;
}

/** Subscriptions belonging to any of `people` (case-insensitive); all of
 * them when the list is empty. */
function targetsFor(people) {
  const wanted = Array.isArray(people) && people.length ? people.map((p) => String(p).toLowerCase()) : null;
  return Object.keys(subs).filter((e) => !wanted || wanted.includes((subs[e].person || "").toLowerCase()));
}

// --- Notification pictures --------------------------------------------------
// /send can carry an `image` (JPEG data URL, e.g. the doorbell frame from the
// faces service). It's kept under an unguessable name and served at
// /api/push/img/<id>.jpg so the phone can fetch it for the notification
// (a push payload is too small to hold it); deleted after IMG_KEEP_MS.
const IMG_DIR = "/data/notify-img";
const IMG_KEEP_MS = 48 * 3600_000;

async function saveImage(dataUrl) {
  const m = /^data:image\/jpeg;base64,(.+)$/.exec(dataUrl ?? "");
  if (!m) return undefined;
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > 600_000) return undefined;
  await mkdir(IMG_DIR, { recursive: true });
  const id = randomBytes(16).toString("hex");
  await writeFile(`${IMG_DIR}/${id}.jpg`, buf);
  return `/api/push/img/${id}.jpg`;
}

async function pruneImages() {
  try {
    for (const f of await readdir(IMG_DIR)) {
      const st = await stat(`${IMG_DIR}/${f}`);
      if (Date.now() - st.mtimeMs > IMG_KEEP_MS) await unlink(`${IMG_DIR}/${f}`);
    }
  } catch {
    /* no pictures yet */
  }
}
setInterval(pruneImages, 3600_000);

const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  try {
    if (req.method === "GET" && path === "/health") return reply(res, 200, { ok: true, subscriptions: Object.keys(subs).length });
    if (req.method === "GET" && path === "/vapid") return reply(res, 200, { publicKey: VAPID_PUBLIC_KEY });
    const img = /^\/img\/([0-9a-f]{32})\.jpg$/.exec(path);
    if (req.method === "GET" && img) {
      try {
        const buf = await readFile(`${IMG_DIR}/${img[1]}.jpg`);
        res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=172800" });
        return res.end(buf);
      } catch {
        return reply(res, 404, { error: "gone" });
      }
    }

    if (req.method === "POST" && path === "/subscribe") {
      const { subscription, token, person, label } = await body(req);
      if (!subscription?.endpoint || !subscription?.keys) return reply(res, 400, { error: "bad subscription" });
      if (!(await validHaToken(token))) return reply(res, 401, { error: "invalid Home Assistant token" });
      subs[subscription.endpoint] = {
        subscription,
        person: typeof person === "string" ? person.slice(0, 40) : "",
        label: typeof label === "string" ? label.slice(0, 60) : "",
        createdAt: new Date().toISOString(),
      };
      await save();
      log("subscribed", person, label);
      return reply(res, 200, { ok: true });
    }

    if (req.method === "POST" && path === "/unsubscribe") {
      const { endpoint, token } = await body(req);
      if (!(await validHaToken(token))) return reply(res, 401, { error: "invalid Home Assistant token" });
      if (subs[endpoint]) {
        log("unsubscribed", subs[endpoint].label);
        delete subs[endpoint];
        await save();
      }
      return reply(res, 200, { ok: true });
    }

    if (req.method === "POST" && path === "/test") {
      const { endpoint, token } = await body(req);
      if (!(await validHaToken(token))) return reply(res, 401, { error: "invalid Home Assistant token" });
      if (!subs[endpoint]) return reply(res, 404, { error: "not subscribed" });
      const sent = await deliver([endpoint], {
        title: "Notifications are on",
        message: "This is how alerts from the home dashboard will look.",
        url: "/phone",
        tag: "test",
      });
      return reply(res, 200, { sent });
    }

    if (req.method === "POST" && path === "/pair/complete") {
      const { id, token, blob } = await body(req);
      if (typeof id !== "string" || !PAIR_ID.test(id)) return reply(res, 400, { error: "bad id" });
      if (typeof blob !== "string" || !blob || blob.length > 4096) return reply(res, 400, { error: "bad blob" });
      if (!(await validHaToken(token))) return reply(res, 401, { error: "invalid Home Assistant token" });
      prunePairings();
      if (pairings.size >= PAIR_MAX) return reply(res, 429, { error: "too many pending sign-ins" });
      pairings.set(id, { blob, expires: Date.now() + PAIR_TTL_MS });
      log("pairing ready");
      return reply(res, 200, { ok: true });
    }

    if (req.method === "POST" && path === "/pair/poll") {
      const { id } = await body(req);
      if (typeof id !== "string" || !PAIR_ID.test(id)) return reply(res, 400, { error: "bad id" });
      prunePairings();
      const pairing = pairings.get(id);
      if (!pairing) return reply(res, 200, { blob: null });
      pairings.delete(id);
      log("pairing collected");
      return reply(res, 200, { blob: pairing.blob });
    }

    if (req.method === "POST" && path === "/send") {
      if (!secretOk(req.headers["x-push-secret"])) return reply(res, 401, { error: "bad secret" });
      // LAN-only (refused by nginx), so it may carry a picture.
      const { title, message, url, tag, people, image } = await body(req, 1024 * 1024);
      if (!title && !message) return reply(res, 400, { error: "title or message required" });
      const targets = targetsFor(people);
      const picture = await saveImage(image).catch(() => undefined);
      const sent = await deliver(targets, { title: title ?? "", message: message ?? "", url: url || "/phone", tag: tag || undefined, image: picture });
      log("sent", JSON.stringify(title), "to", sent, "of", targets.length);
      return reply(res, 200, { sent, targets: targets.length });
    }

    if (req.method === "POST" && path.startsWith("/visitors/")) {
      if (!visits) return reply(res, 503, { error: "visit log needs HA_TOKEN" });
      const { token, person, id, entityId, hidden } = await body(req);
      if (!(await validHaToken(token))) return reply(res, 401, { error: "invalid Home Assistant token" });
      if (path === "/visitors/list") return reply(res, 200, visits.list());
      if (path === "/visitors/person") return reply(res, 200, visits.savePerson(person ?? {}));
      if (path === "/visitors/delete") return reply(res, 200, { ok: true, deleted: visits.deletePerson(id) });
      if (path === "/visitors/hide") return reply(res, 200, { ok: true, hidden: visits.setHidden(entityId, hidden === true) });
    }

    reply(res, 404, { error: "not found" });
  } catch (err) {
    log("error", err.message);
    reply(res, 400, { error: "bad request" });
  }
});

/** The Visitors tab's log (visits.mjs); null without HA_TOKEN. */
const visits = HA_TOKEN
  ? await startVisitLog({
      haUrl: HA_URL,
      token: HA_TOKEN,
      file: VISITS_FILE,
      notify: (payload) => deliver(Object.keys(subs), payload),
      notifyNewDevice: (payload) => deliver(targetsFor(NEW_DEVICE_PEOPLE.split(",").map((p) => p.trim()).filter(Boolean)), payload),
      log,
    })
  : null;

server.listen(Number(PORT), () => log(`push service on :${PORT}, ${Object.keys(subs).length} subscriptions`));

if (HA_TOKEN) {
  startDoorWatcher({
    haUrl: HA_URL,
    token: HA_TOKEN,
    doors: parseDoors(DOOR_SENSORS),
    thresholdMs: Number(DOOR_ALERT_MINUTES) * 60_000,
    repeatMs: Number(DOOR_REPEAT_MINUTES) * 60_000,
    offlineMs: Number(DOOR_OFFLINE_MINUTES) * 60_000,
    notify: (payload) => deliver(Object.keys(subs), payload),
    log,
  });
} else {
  log("HA_TOKEN not set — door-open alerts disabled");
}

const unreachableGroups = parseGroups(UNREACHABLE_GROUPS);
if (HA_TOKEN && unreachableGroups.length) {
  const people = UNREACHABLE_PEOPLE.split(",").map((p) => p.trim()).filter(Boolean);
  startReachabilityWatcher({
    haUrl: HA_URL,
    token: HA_TOKEN,
    groups: unreachableGroups,
    thresholdMs: Number(UNREACHABLE_MINUTES) * 60_000,
    notify: (payload) => deliver(targetsFor(people), payload),
    log,
  });
}
