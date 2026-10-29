// Visit log for the dashboard's Visitors tab. Holds a Home Assistant
// websocket and records when each UniFi Wi-Fi tracker (device_tracker with
// source_type "router") arrives and leaves, so the tab can show who's over
// and months of history — HA itself only keeps 10 days. On every connect it
// also backfills from HA's history, which fills any gap while this was down
// and seeds the log the first time.
//
// Every roaming device is logged, named or not, so naming one later in the
// app brings its past visits along. People's own trackers (person.*) are
// skipped. Devices that never leave (plugs, switches) never "arrive", so
// they never show up.
//
// A device HA has never seen before (its tracker entity was just created)
// gets a "new device on the Wi-Fi" alert through `notifyNewDevice`, linking
// to the tab's naming sheet.
//
// An away spell shorter than MIN_AWAY doesn't count: the visit carries on.
// That smooths over Wi-Fi blips and the burst of state changes an HA
// restart causes.

import { readFile, writeFile, rename } from "node:fs/promises";

const MIN_AWAY_MS = 10 * 60_000;
const KEEP_MS = 400 * 24 * 3_600_000;
const BACKFILL_MS = 10 * 24 * 3_600_000;
/** Don't announce an arrival if they were here this recently. */
const RENOTIFY_GAP_MS = 30 * 60_000;
/** A tracker created this recently is a device HA has never seen. (An
 * integration reload also re-adds every entity, but those are old.) */
const NEW_ENTITY_MS = 15 * 60_000;

/**
 * Stored as JSON:
 *   people:   [{ id, name, devices: [entityId], notify }]
 *   hidden:   [entityId]                    — "not a visitor", from the app
 *   names:    { entityId: friendly name }   — for naming new devices
 *   sessions: { entityId: [{ start, end }] } — ms, end null while there
 */
export async function startVisitLog({ haUrl, token, file, notify, notifyNewDevice, log }) {
  let data = { people: [], hidden: [], names: {}, sessions: {} };
  try {
    data = { ...data, ...JSON.parse(await readFile(file, "utf8")) };
  } catch {
    /* first run */
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const tmp = `${file}.tmp`;
        await writeFile(tmp, JSON.stringify(data));
        await rename(tmp, file);
      } catch (err) {
        log("visit log save failed", err.message);
      }
    }, 1000);
  }

  function prune() {
    const cutoff = Date.now() - KEEP_MS;
    for (const [id, list] of Object.entries(data.sessions)) {
      const kept = list.filter((s) => s.end === null || s.end >= cutoff);
      if (kept.length) data.sessions[id] = kept;
      else delete data.sessions[id];
    }
  }

  /** People's own trackers, from person.* — never visitors. */
  let household = new Set();
  /** entityId -> { state: "home" | "away", since } — last definite state. */
  const track = new Map();

  function personOf(entityId) {
    return data.people.find((p) => p.devices.includes(entityId));
  }

  function personHereElsewhere(person, entityId) {
    return person.devices.some((d) => d !== entityId && data.sessions[d]?.some((s) => s.end === null));
  }

  function lastLeft(person) {
    let last = 0;
    for (const d of person.devices) for (const s of data.sessions[d] ?? []) if (s.end) last = Math.max(last, s.end);
    return last;
  }

  /** Feed one state. `live` = happening now (may notify). */
  function update(entityId, state, at, live) {
    if (household.has(entityId)) return;
    const next = state === "home" ? "home" : state === "not_home" ? "away" : null;
    if (!next) return; // unavailable / unknown: keep the last definite state
    const prev = track.get(entityId);
    if (prev?.state === next) return;
    track.set(entityId, { state: next, since: at });
    if (!prev) return; // first sighting: no way to tell when it got here

    const list = data.sessions[entityId] ?? [];
    const last = list[list.length - 1];
    if (next === "away") {
      if (last && last.end === null) {
        last.end = at;
        save();
      }
      return;
    }
    // Back home. A short absence just continues the visit it interrupted.
    if (at - prev.since < MIN_AWAY_MS) {
      if (last && last.end !== null && Math.abs(last.end - prev.since) < 60_000) {
        last.end = null;
        save();
      }
      return;
    }
    if (last && last.end === null) return;
    const person = live ? personOf(entityId) : undefined;
    const announce = person?.notify && !personHereElsewhere(person, entityId) && at - lastLeft(person) > RENOTIFY_GAP_MS;
    list.push({ start: at, end: null });
    data.sessions[entityId] = list;
    save();
    if (announce) {
      log("visitor arrived", person.name);
      notify({ title: `${person.name} arrived`, message: "Just joined the Wi-Fi.", url: "/phone/visitors", tag: `visitor-${person.id}` }).catch(
        (err) => log("visitor notify failed", err.message),
      );
    }
  }

  /** Replay HA's recorded history for these trackers, oldest first, into
   * a scratch log, then merge visits we didn't already have. */
  async function backfill(entityIds) {
    if (!entityIds.length) return;
    const from = new Date(Date.now() - BACKFILL_MS).toISOString();
    // Without end_time HA returns just one day.
    const to = encodeURIComponent(new Date().toISOString());
    const url = `${haUrl}/api/history/period/${from}?end_time=${to}&filter_entity_id=${entityIds.join(",")}&minimal_response&no_attributes`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`history ${res.status}`);
    const history = await res.json();
    let added = 0;
    for (const series of history) {
      const entityId = series[0]?.entity_id;
      if (!entityId || household.has(entityId)) continue;
      // Run the same state machine over the history on its own...
      const saved = { sessions: data.sessions[entityId], track: track.get(entityId) };
      data.sessions[entityId] = [];
      track.delete(entityId);
      for (const s of series) update(entityId, s.state, Date.parse(s.last_changed), false);
      const replayed = data.sessions[entityId];
      const state = track.get(entityId);
      // ...then fold it into what we had: history wins where they overlap
      // (it saw departures we missed while down).
      const merged = saved.sessions ?? [];
      for (const r of replayed) {
        const hit = merged.find((m) => m.start < (r.end ?? Infinity) && r.start < (m.end ?? Infinity));
        if (hit) {
          hit.start = Math.min(hit.start, r.start);
          hit.end = r.end;
        } else {
          merged.push(r);
          added++;
        }
      }
      merged.sort((a, b) => a.start - b.start);
      if (merged.length) data.sessions[entityId] = merged;
      else delete data.sessions[entityId];
      if (state) track.set(entityId, state);
      else if (saved.track) track.set(entityId, saved.track);
    }
    prune();
    save();
    log("visit log backfilled", entityIds.length, "trackers,", added, "new visits");
  }

  // UniFi's friendly_name repeats the hostname ("iPad iPad"), and is just
  // the entity id for clients that send none.
  function deviceName(attrs) {
    if (attrs.host_name) return attrs.host_name;
    const tail = (attrs.mac ?? "").slice(-5).toUpperCase();
    if (attrs.oui && attrs.oui !== "Private") return `${attrs.oui} device ${tail}`.trim();
    return tail ? `Unnamed device ${tail}` : "Unnamed device";
  }

  function isRoamer(s) {
    return s.entity_id.startsWith("device_tracker.") && s.attributes?.source_type === "router";
  }

  let backoff = 1000;
  function connect() {
    const ws = new WebSocket(`${haUrl.replace(/^http/, "ws")}/api/websocket`);
    let nextId = 1;
    let statesId = 0;
    let ready = false;
    const queued = [];
    /** id -> resolve, for one-off requests. */
    const pending = new Map();

    function request(msg) {
      const id = nextId++;
      ws.send(JSON.stringify({ ...msg, id }));
      return new Promise((resolve) => {
        pending.set(id, resolve);
        setTimeout(() => pending.delete(id) && resolve(null), 10_000);
      });
    }

    /** A tracker that just appeared: if HA only now created it, this is
     * the device's first time on the Wi-Fi — log the visit and say so. */
    async function maybeNewDevice(s) {
      if (!s || s.state !== "home" || !isRoamer(s) || household.has(s.entity_id)) return;
      if (data.sessions[s.entity_id] || data.hidden.includes(s.entity_id)) return;
      const entry = await request({ type: "config/entity_registry/get", entity_id: s.entity_id });
      const raw = entry?.success ? entry.result?.created_at : null;
      const created = typeof raw === "number" ? (raw < 1e12 ? raw * 1000 : raw) : Date.parse(raw ?? "");
      if (!(Date.now() - created < NEW_ENTITY_MS)) return;
      const at = Date.parse(s.last_changed);
      // Pretend it was away, so this counts as an arrival.
      track.set(s.entity_id, { state: "away", since: 0 });
      update(s.entity_id, "home", at, false);
      const name = data.names[s.entity_id] ?? deviceName(s.attributes ?? {});
      log("new device", s.entity_id, name);
      notifyNewDevice?.({
        title: "New device on the Wi-Fi",
        message: `${name} just joined for the first time. Tap to name it or hide it.`,
        url: `/phone/visitors?device=${encodeURIComponent(s.entity_id)}`,
        tag: `new-device-${s.entity_id}`,
      }).catch((err) => log("new device notify failed", err.message));
    }

    function onState(s) {
      if (!s) return;
      if (s.entity_id.startsWith("person.")) {
        for (const d of s.attributes?.device_trackers ?? []) household.add(d);
        return;
      }
      if (!isRoamer(s)) return;
      const name = deviceName(s.attributes ?? {});
      if (data.names[s.entity_id] !== name) {
        data.names[s.entity_id] = name;
        save();
      }
      update(s.entity_id, s.state, Date.parse(s.last_changed), true);
    }

    ws.addEventListener("message", async (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "auth_required") {
        ws.send(JSON.stringify({ type: "auth", access_token: token }));
      } else if (msg.type === "auth_ok") {
        backoff = 1000;
        ws.send(JSON.stringify({ id: nextId++, type: "subscribe_events", event_type: "state_changed" }));
        statesId = nextId++;
        ws.send(JSON.stringify({ id: statesId, type: "get_states" }));
      } else if (msg.type === "auth_invalid") {
        log("visit log: HA rejected HA_TOKEN");
      } else if (msg.type === "result" && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      } else if (msg.type === "result" && msg.id === statesId && msg.success) {
        household = new Set(msg.result.filter((s) => s.entity_id.startsWith("person.")).flatMap((s) => s.attributes?.device_trackers ?? []));
        const roamers = msg.result.filter(isRoamer);
        try {
          await backfill(roamers.map((s) => s.entity_id));
        } catch (err) {
          log("visit log backfill failed", err.message);
        }
        for (const s of msg.result) onState(s);
        ready = true;
        for (const s of queued.splice(0)) onState(s);
        log("visit log connected,", roamers.length, "Wi-Fi trackers,", data.people.length, "visitors");
      } else if (msg.type === "event" && msg.event?.event_type === "state_changed") {
        const s = msg.event.data.new_state;
        if (!ready) return queued.push(s);
        onState(s);
        if (!msg.event.data.old_state) maybeNewDevice(s).catch((err) => log("new device check failed", err.message));
      }
    });

    ws.addEventListener("error", (e) => log("visit log socket error", e.message ?? ""));
    ws.addEventListener("close", () => {
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 60_000);
    });
  }

  connect();

  function slug(name) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "visitor";
    let id = base;
    for (let i = 2; data.people.some((p) => p.id === id); i++) id = `${base}-${i}`;
    return id;
  }

  // The API the server exposes at /visitors/*.
  return {
    list() {
      return {
        people: data.people,
        hidden: data.hidden,
        names: data.names,
        sessions: data.sessions,
        here: [...track].filter(([, t]) => t.state === "home").map(([id]) => id),
      };
    },
    savePerson({ id, name, devices, notify: wantsNotify }) {
      if (typeof name !== "string" || !name.trim()) throw new Error("name required");
      const devs = Array.isArray(devices) ? devices.filter((d) => typeof d === "string" && d.startsWith("device_tracker.")) : [];
      // A device belongs to one person at a time.
      for (const p of data.people) if (p.id !== id) p.devices = p.devices.filter((d) => !devs.includes(d));
      let person = data.people.find((p) => p.id === id);
      if (!person) data.people.push((person = { id: slug(name), devices: [] }));
      person.name = name.trim().slice(0, 40);
      person.devices = [...new Set(devs)];
      person.notify = wantsNotify === true;
      data.hidden = data.hidden.filter((h) => !devs.includes(h));
      save();
      return person;
    },
    deletePerson(id) {
      data.people = data.people.filter((p) => p.id !== id);
      save();
    },
    setHidden(entityId, hidden) {
      if (typeof entityId !== "string") throw new Error("bad entity");
      data.hidden = data.hidden.filter((h) => h !== entityId);
      if (hidden) data.hidden.push(entityId);
      save();
    },
  };
}
