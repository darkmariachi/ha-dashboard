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
//   POST /send           (x-push-secret) { title, message, url?, tag?, people? }
//   GET  /health
//
// A subscription is only accepted from someone holding a valid Home
// Assistant token (checked against HA's API), since the dashboard is public.

import { createServer } from "node:http";
import { readFile, writeFile, rename } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import webpush from "web-push";
import { parseDoors, startDoorWatcher } from "./doors.mjs";

const {
  PORT = "8082",
  HA_URL = "http://192.168.1.54:8123",
  PUSH_SECRET,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT = "mailto:admin@localhost",
  DATA_FILE = "/data/subscriptions.json",
  // Door-open alerts (doors.mjs). Needs a long-lived HA access token.
  HA_TOKEN,
  DOOR_SENSORS = "binary_sensor.front_door_sensor=Front Door,binary_sensor.garage_door_sensor=Garage Door,binary_sensor.print_room_garage_door=Print Room Garage Door",
  DOOR_ALERT_MINUTES = "2",
  DOOR_REPEAT_MINUTES = "10",
  // A sensor silent this long gets a "sensor is offline" alert; 0 = never.
  DOOR_OFFLINE_MINUTES = "10",
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

async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024) throw new Error("too large");
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
          log("removing expired subscription", entry.label);
          delete subs[endpoint];
          dirty = true;
        } else {
          log("push failed", entry.label, err.statusCode ?? err.message);
        }
      }
    }),
  );
  if (dirty) await save();
  return sent;
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  try {
    if (req.method === "GET" && path === "/health") return reply(res, 200, { ok: true, subscriptions: Object.keys(subs).length });
    if (req.method === "GET" && path === "/vapid") return reply(res, 200, { publicKey: VAPID_PUBLIC_KEY });

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

    if (req.method === "POST" && path === "/send") {
      if (!secretOk(req.headers["x-push-secret"])) return reply(res, 401, { error: "bad secret" });
      const { title, message, url, tag, people } = await body(req);
      if (!title && !message) return reply(res, 400, { error: "title or message required" });
      const wanted = Array.isArray(people) && people.length ? people.map((p) => String(p).toLowerCase()) : null;
      const targets = Object.keys(subs).filter((e) => !wanted || wanted.includes((subs[e].person || "").toLowerCase()));
      const sent = await deliver(targets, { title: title ?? "", message: message ?? "", url: url || "/phone", tag: tag || undefined });
      log("sent", JSON.stringify(title), "to", sent, "of", targets.length);
      return reply(res, 200, { sent, targets: targets.length });
    }

    reply(res, 404, { error: "not found" });
  } catch (err) {
    log("error", err.message);
    reply(res, 400, { error: "bad request" });
  }
});

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
