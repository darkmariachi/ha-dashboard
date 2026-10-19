// "Lights are unreachable" alerts, sent as web push. Some smart bulbs sit
// behind a regular wall switch; once it's flipped off they drop off the
// network and every automation that uses them quietly stops working. This
// holds a Home Assistant websocket, watches groups of entities, and notifies
// once any member has been unavailable for `thresholdMs`, then again when the
// whole group is back. Both alerts for a group share a tag so the "back"
// message replaces the "unreachable" one.

/**
 * "Driveway lights:light.a,light.b;Porch:light.c"
 *   -> [{ label: "Driveway lights", entityIds: ["light.a", "light.b"] }, ...]
 */
export function parseGroups(spec) {
  return spec
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(":");
      const label = s.slice(0, i).trim();
      const entityIds = s
        .slice(i + 1)
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);
      return { label: label || entityIds[0], entityIds };
    })
    .filter((g) => g.entityIds.length);
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

function slug(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function startReachabilityWatcher({ haUrl, token, groups, thresholdMs, notify, log }) {
  /** entityId -> group */
  const groupOf = new Map();
  for (const g of groups) for (const id of g.entityIds) groupOf.set(id, g);
  /** entityId -> ms since it went unavailable (absent = reachable) */
  const down = new Map();
  /** group label -> { since, notified, timeout } */
  const alerts = new Map();

  function downIn(group) {
    return group.entityIds.filter((id) => down.has(id));
  }

  function alert(group, st) {
    st.notified = true;
    const n = downIn(group).length;
    const total = group.entityIds.length;
    const which = n === total ? (total === 1 ? "It has" : `All ${total} have`) : `${n} of ${total} ${n === 1 ? "has" : "have"}`;
    const hint = n === total ? " The wall switch is probably off." : "";
    log("unreachable", group.label, `${n}/${total}`, minutes(Date.now() - st.since));
    notify({
      title: `${group.label} are unreachable`,
      message: `${which} been unreachable for ${minutes(Date.now() - st.since)}.${hint}`,
      url: "/phone",
      tag: `unreachable-${slug(group.label)}`,
    }).catch((err) => log("reachability notify failed", err.message));
  }

  function check(group) {
    const st = alerts.get(group.label);
    if (downIn(group).length === 0) {
      if (!st) return;
      clearTimeout(st.timeout);
      alerts.delete(group.label);
      if (!st.notified) return;
      log("reachable again", group.label);
      notify({
        title: `${group.label} are back`,
        message: `They were unreachable for ${howLong(Date.now() - st.since)}.`,
        url: "/phone",
        tag: `unreachable-${slug(group.label)}`,
      }).catch((err) => log("reachability notify failed", err.message));
      return;
    }
    if (st) return;
    const since = Math.min(...downIn(group).map((id) => down.get(id)));
    const next = { since, notified: false, timeout: null };
    alerts.set(group.label, next);
    next.timeout = setTimeout(() => alert(group, next), Math.max(0, since + thresholdMs - Date.now()));
  }

  function update(entityId, state, lastChanged) {
    const group = groupOf.get(entityId);
    if (!group) return;
    if (state === "unavailable") {
      if (!down.has(entityId)) {
        const parsed = Date.parse(lastChanged);
        down.set(entityId, Number.isNaN(parsed) ? Date.now() : parsed);
      }
    } else {
      down.delete(entityId);
    }
    check(group);
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
        log("reachability watcher connected,", groupOf.size, "entities in", groups.length, "groups");
      } else if (msg.type === "auth_invalid") {
        log("reachability watcher: HA rejected HA_TOKEN");
      } else if (msg.type === "result" && msg.id === statesId && msg.success) {
        const seen = new Set();
        for (const s of msg.result) {
          if (!groupOf.has(s.entity_id)) continue;
          seen.add(s.entity_id);
          update(s.entity_id, s.state, s.last_changed);
        }
        // Missing from HA entirely (removed or renamed) counts as unreachable.
        for (const id of groupOf.keys()) if (!seen.has(id)) update(id, "unavailable");
      } else if (msg.type === "event" && msg.event?.event_type === "state_changed") {
        const { entity_id, new_state } = msg.event.data;
        if (groupOf.has(entity_id)) update(entity_id, new_state?.state ?? "unavailable", new_state?.last_changed);
      }
    });

    // A close always follows an error, so reconnect from there only.
    ws.addEventListener("error", (e) => log("reachability watcher socket error", e.message ?? ""));
    ws.addEventListener("close", () => {
      log("reachability watcher disconnected, retrying in", backoff / 1000, "s");
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 60_000);
    });
  }

  connect();
}
