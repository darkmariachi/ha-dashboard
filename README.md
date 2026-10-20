# Home Dashboard

A custom React dashboard for Home Assistant. Instead of building this in
Lovelace, it talks to your HA instance directly over its websocket API
(`home-assistant-js-websocket`, the same client library HA's own frontend
uses) — real-time state updates, no polling, and the whole UI is just React
components you can freely restyle or extend.

Everything runs client-side: this container only serves static files. Your
**browser** connects directly to Home Assistant, so as long as whatever
device you're viewing the dashboard from can already reach your HA instance,
it'll work.

## What's here

- **Home** — the landing screen: a curated set of rooms and the switches
  you actually reach for day to day, styled as soft color-coded room cards
  with floating icon toggles and a line-art illustration per room, plus a
  status bar (weather / power / devices-on / climate) and a wall of camera
  snapshots. Built for a landscape-mounted tablet. This is the one you'll
  probably put on the wall.
- **All Areas** — the automatic, everything-in-HA view: every area from
  Home Assistant, every supported entity, grouped and searchable. This is
  the fallback for anything that isn't on the curated Home screen — a full
  room's full inventory, not just the highlights.
- Cards for lights (with brightness), switches/fans/locks, climate,
  media players (transport + volume), sensors, binary sensors, vacuums,
  scenes, covers, and cameras (auto-refreshing snapshots)
- Full thermostat control: tap the Climate tile on the Home screen (or any
  climate card on the All Areas view) to open a control sheet with HVAC
  mode (off/heat/cool/heat_cool/auto/etc.), target temperature (or a
  low/high range for heat_cool setups), and fan mode — whatever your
  thermostat actually supports, read from its own attributes
- A Settings page to rename/reorder rooms, hide noisy entities, and pin
  favorites on the All Areas view — all saved in the browser, no rebuild
  needed
- Auth via a Home Assistant long-lived access token

## 1. Create a long-lived access token

In Home Assistant: click your profile (bottom left) → **Security** tab →
scroll to **Long-lived access tokens** → **Create Token**. Copy it
somewhere safe — HA only shows it once.

### Signing in more devices with a QR code

Once one phone is signed in, you don't have to type the token again on a
fridge, tablet or TV: the login screen shows a QR code, and scanning it with
the signed-in phone opens an approval page. Approving creates a separate
long-lived token for the new device (named on that page, revocable from the
same **Security** tab) and passes it across, encrypted, through the push
service. This needs the dashboard on `https://` and the `push` container
running.

## 2. Run it locally (optional, for tweaking)

```bash
npm install
npm run dev
```

Open the printed URL, paste in your HA URL (e.g. `http://192.168.1.50:8123`)
and the token from step 1.

## 3. Deploy alongside your other containers

This repo already has a `Dockerfile` and `docker-compose.yml`. From the
server, in this project's directory:

```bash
docker compose up -d --build
```

That builds the React app and serves it via nginx on **port 8081**. Visit
`http://<your-server-ip>:8081` and log in with the same URL + token as
above (credentials are stored in the browser's localStorage, not baked
into the image, so the same image works for anyone on your network).

### Merging into your existing docker-compose stack instead

If you'd rather keep everything in one compose file with your other
containers, copy this project's folder next to your other services (e.g.
`~/docker/ha-dashboard/`) and add a service block pointing at it:

```yaml
services:
  ha-dashboard:
    build: ./ha-dashboard
    container_name: ha-dashboard
    ports:
      - "8081:80"
    restart: unless-stopped
```

Then `docker compose up -d --build ha-dashboard` from your stack's root.

### Reverse proxy / HTTPS notes

If you put this behind Nginx Proxy Manager, Traefik, Caddy, etc. (recommended
if you want to reach it from outside your LAN), the proxy only needs to
forward plain HTTP to port 8081 on this container — nothing special, since
the container itself doesn't talk to Home Assistant at all.

The one thing to get right is on the *Home Assistant* side: if you access
HA itself over `https://`, browsers block a page from opening a plain `ws://`
socket to it (mixed content), so your HA instance also needs to be reachable
over `https://`/`wss://` — e.g. via Nabu Casa, or your own reverse proxy in
front of HA with a valid cert. If both this dashboard and HA are on
`http://` (typical for local-only LAN use), you don't need to think about
this at all.

## Cameras

Camera cards poll a snapshot every 6 seconds — not a live stream, but it
works with any camera Home Assistant can already show you, with **zero
extra configuration**. It uses HA's `auth/sign_path` mechanism (the same
thing HA's own frontend uses for camera thumbnails) to get a short-lived,
self-authenticating image URL, so it sidesteps CORS entirely — unlike a
plain `fetch()` to the REST API, which HA blocks cross-origin by default
unless you add `cors_allowed_origins` to `configuration.yaml`. You don't
need to touch that setting for cameras to work here.

If you want true live video later (lower latency, actual motion instead of
a slideshow), that's a fast-follow, not a rebuild — worth doing once you
know whether it's mattering to you day to day, and how your cameras are
backed (e.g. go2rtc in front of UniFi Protect/RTSP sources works well for
a WebRTC or HLS embed).

## On the TV

`/tv` is a layout for a 10-foot screen, driven entirely with a remote's
D-pad: a tab rail (Home, Rooms, Cameras, Devices), arrows to move, OK to
press, Back to close a pop-up or step out. It works in any browser with
arrow keys, Enter and Escape, which is the easy way to try it.

`tv/` is a small Android TV app for it — a fullscreen WebView that loads
`/tv` from this container, so a normal dashboard deploy updates the TV too
and the APK only needs reinstalling when the shell itself changes. To put
it on an Nvidia Shield (needs the Android SDK and a JDK 17–24 on this PC):

1. On the Shield: Settings → Device Preferences → About, press OK on
   **Build** seven times, then Developer options → **Network debugging**.
2. From `tv/`:

   ```powershell
   .\deploy.ps1 -Tv <shield-ip> -Login
   ```

   Accept the debugging prompt on the TV the first time (and run it again).
   `-Login` asks for a long-lived access token and signs the TV in, so you
   don't have to type one with the remote; leave it off for later
   reinstalls. The dashboard address it loads is `dashboardUrl` in
   `tv/gradle.properties` (or `-DashboardUrl`).

## 4. Customize

**The Home screen** (rooms, toggles, cameras, which entities show up) is
defined in one file: `src/config/curatedHome.tsx`. It's plain data —
arrays of `{ entityId, label, icon }` per room — not something you dig for
in a UI, since the whole point of this screen is that it's exactly the set
you picked. Add a switch, rename a label, reorder rooms, swap an icon
(anything from `lucide-react` works), or add/remove a room entirely by
editing that file, then `docker compose up -d --build` again. Room card
colors cycle from `src/lib/roomPalette.ts`; the seven room illustrations
(kitchen, living room, etc.) are mapped in
`src/components/illustrations/RoomIllustrations.tsx`.

**The All Areas screen and its Settings page** are for everything else,
and don't need a rebuild — open **Settings** in the app itself:

- Rename or reorder rooms
- Search and hide entities you don't want cluttering a room (helpful
  since HA setups tend to accumulate stale/duplicate entities over time)
- Star any card to pin it to the All Areas page's Favorites shelf

That's stored in the browser's localStorage per-device. Beyond that, if
you want a meaningfully different look (new card types, different colors),
the code is organized to make it approachable:

- `src/components/cards/` — one file per entity type (`LightCard.tsx`,
  `ClimateCard.tsx`, etc.) — each is a self-contained ~60-line component
- `src/lib/domainOrder.ts` — controls section order/labels within a room
  (All Areas view)
- `src/index.css` — the color palette (`@theme` block at the top)
- `src/ha/HaProvider.tsx` — the websocket connection + state; you
  generally shouldn't need to touch this

## How it's built

- Vite + React + TypeScript
- Tailwind CSS v4
- `home-assistant-js-websocket` for the live connection (states + the
  area/device/entity registries, which is how rooms get populated)
- `react-router-dom` for the sidebar navigation
- No backend, no database — Home Assistant *is* the backend
