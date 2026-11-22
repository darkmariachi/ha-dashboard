// Keeps an HA websocket honest. A socket opened while HA is restarting can
// hang without ever closing: no auth, no events, no "close" to retry from.
// That silently stopped every watcher here from 2026-11-07 to 11-18. This
// pings HA every 30 s once authenticated and calls `onDead` (once) if
// nothing at all has arrived for 70 s, including before auth.

const PING_MS = 30_000;
const DEAD_MS = 70_000;

export function keepAlive(ws, onDead) {
  let last = Date.now();
  let authed = false;
  let id = 1_000_000_000; // clear of the caller's own message ids
  let dead = false;
  ws.addEventListener("message", (ev) => {
    last = Date.now();
    if (!authed && typeof ev.data === "string" && ev.data.includes('"auth_ok"')) authed = true;
  });
  const timer = setInterval(() => {
    if (Date.now() - last > DEAD_MS) {
      clearInterval(timer);
      if (dead) return;
      dead = true;
      try {
        ws.close();
      } catch {
        /* already closing */
      }
      onDead();
      return;
    }
    // HA closes the socket on anything but auth before auth_ok.
    if (authed && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id: id++, type: "ping" }));
  }, PING_MS);
  ws.addEventListener("close", () => clearInterval(timer));
}
