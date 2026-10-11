// Door/window left-open alerts, sent as web push even when no phone has the
// dashboard open. Holds a Home Assistant websocket, tracks each watched
// sensor, and notifies once it has been open for `thresholdMs`, then repeats
// every `repeatMs` while it stays open. All alerts for a sensor share a tag so
// they replace each other, and the "closed" message replaces the last alert.
//
// A sensor that stops reporting (unavailable / unknown / gone from HA) looks
// the same as a closed door from here, so its alerts would just stop. Once it
// has been silent for `offlineMs` that gets its own notification, and another
// when it reports again.

/** "binary_sensor.a=Front Door,binary_sensor.b=Garage" -> [{ entityId, label }] */
export function parseDoors(spec) {
  return spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [entityId, ...rest] = s.split("=");
      return { entityId: entityId.trim(), label: rest.join("=").trim() || entityId.trim() };
    });
}

function minutes(ms) {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m === 1 ? "1 minute" : `${m} minutes`;
}

/** Like minutes(), for outages that can run to hours or days. */
function howLong(ms) {
  const m = Math.round(ms / 60_000);
  if (m < 60) return minutes(ms);
  const h = Math.round(m / 60);
  if (h < 48) return h === 1 ? "1 hour" : `${h} hours`;
  return `${Math.round(h / 24)} days`;
}

export function startDoorWatcher({ haUrl, token, doors, thresholdMs, repeatMs, offlineMs = 0, notify, log }) {
  const byId = new Map(doors.map((d) => [d.entityId, d]));
  /** entityId -> { openedAt, notified, timeout, interval } */
  const open = new Map();
  /** entityId -> { since, notified, timeout } */
  const offline = new Map();

  function wentOffline(door, lastChanged) {
    if (!(offlineMs > 0) || offline.has(door.entityId)) return;
    const parsed = Date.parse(lastChanged);
    const st = { since: Number.isNaN(parsed) ? Date.now() : parsed, notified: false, timeout: null };
    offline.set(door.entityId, st);
    st.timeout = setTimeout(() => {
      st.notified = true;
      log("sensor offline", door.label, howLong(Date.now() - st.since));
      notify({
        title: `${door.label} sensor is offline`,
        message: `No signal for ${howLong(Date.now() - st.since)}. You won't get open-door alerts for it until it's back.`,
        url: "/phone",
        tag: `door-offline-${door.entityId}`,
      }).catch((err) => log("door notify failed", err.message));
    }, Math.max(0, st.since + offlineMs - Date.now()));
  }

  function cameBack(door) {
    const st = offline.get(door.entityId);
    if (!st) return;
    clearTimeout(st.timeout);
    offline.delete(door.entityId);
    if (!st.notified) return;
    log("sensor back", door.label);
    notify({
      title: `${door.label} sensor is back`,
      message: `It was offline for ${howLong(Date.now() - st.since)}.`,
      url: "/phone",
      tag: `door-offline-${door.entityId}`,
    }).catch((err) => log("door notify failed", err.message));
  }

  function alert(door, st) {
    st.notified = true;
    const elapsed = Date.now() - st.openedAt;
    log("door open", door.label, minutes(elapsed));
    notify({
      title: `${door.label} is open`,
      message: `${door.label} has been open for ${minutes(elapsed)}.`,
      url: "/phone",
      tag: `door-${door.entityId}`,
    }).catch((err) => log("door notify failed", err.message));
  }

  function clear(entityId) {
    const st = open.get(entityId);
    if (!st) return null;
    clearTimeout(st.timeout);
    clearInterval(st.interval);
    open.delete(entityId);
    return st;
  }

  function update(entityId, state, lastChanged) {
    const door = byId.get(entityId);
    if (!door) return;
    if (state === "on" || state === "off") cameBack(door);
    else wentOffline(door, lastChanged);
    if (state === "on") {
      if (open.has(entityId)) return;
      const parsed = Date.parse(lastChanged);
      const st = { openedAt: Number.isNaN(parsed) ? Date.now() : parsed, notified: false, timeout: null, interval: null };
      open.set(entityId, st);
      st.timeout = setTimeout(() => {
        alert(door, st);
        st.interval = setInterval(() => alert(door, st), repeatMs);
      }, Math.max(0, st.openedAt + thresholdMs - Date.now()));
      return;
    }
    const st = clear(entityId);
    if (st?.notified && state === "off") {
      log("door closed", door.label);
      notify({
        title: `${door.label} closed`,
        message: `${door.label} was open for ${minutes(Date.now() - st.openedAt)}.`,
        url: "/phone",
        tag: `door-${door.entityId}`,
      }).catch((err) => log("door notify failed", err.message));
    }
  }

  let backoff = 1000;

  function connect() {
    const ws = new WebSocket(`${haUrl.replace(/^http/, "ws")}/api/websocket`);
    let nextId = 1;
    let statesId = 0;

    ws.addEventListener("message", (ev) => {
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
        log("door watcher connected,", doors.length, "sensors");
      } else if (msg.type === "auth_invalid") {
        log("door watcher: HA rejected HA_TOKEN");
      } else if (msg.type === "result" && msg.id === statesId && msg.success) {
        const seen = new Set();
        for (const s of msg.result) {
          if (!byId.has(s.entity_id)) continue;
          seen.add(s.entity_id);
          update(s.entity_id, s.state, s.last_changed);
        }
        // A sensor that isn't in HA at all (vanished while we were
        // disconnected, or renamed).
        for (const id of byId.keys()) if (!seen.has(id)) update(id, "unavailable");
      } else if (msg.type === "event" && msg.event?.event_type === "state_changed") {
        const { entity_id, new_state } = msg.event.data;
        if (byId.has(entity_id)) update(entity_id, new_state?.state ?? "unavailable", new_state?.last_changed);
      }
    });

    // A close always follows an error, so reconnect from there only.
    ws.addEventListener("error", (e) => log("door watcher socket error", e.message ?? ""));
    ws.addEventListener("close", () => {
      log("door watcher disconnected, retrying in", backoff / 1000, "s");
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 60_000);
    });
  }

  connect();
}
