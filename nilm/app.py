"""
Unnamed-device detection (event-based NILM) for the dashboard's Energy page.

Watches the part of the house load that Sense hasn't identified ("Other"),
finds clean on/off steps in it, pairs each "on" with its matching "off", and
groups similar steps into unnamed devices (Device A, Device B, ...). It
doesn't know *what* a device is; it only says "something that draws ~4.6 kW
on both legs for ~8 minutes, 7 times a day". People name them from the UI.

Data sources, best first (see `pick_source`):
  * Sense's realtime websocket (SENSE_EMAIL / SENSE_PASSWORD): ~2 samples/s,
    with per-leg watts, so 240 V loads can be told apart from 120 V ones.
  * Home Assistant (HA_TOKEN): sensor.other_power state changes, which the
    Sense integration only updates every ~2 minutes. Good enough for big,
    long-running loads (water heater, dryer); small ones blur together.
  * NILM_REPLAY=<csv>: replays a recorded `ts,entity,w` file, for development.

Detected devices are optionally published back to HA as
sensor.nilm_device_<x>_power / _energy and binary_sensor.nilm_device_<x>.

Everything lives in /data/nilm.db. The API is proxied by the dashboard's
nginx at /api/nilm/ and checks the caller's HA token, like faces/.
"""

from __future__ import annotations

import asyncio
import csv
import json
import logging
import math
import os
import sqlite3
import statistics
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse

log = logging.getLogger("nilm")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

HA_URL = os.environ.get("HA_URL", "http://192.168.1.54:8123").rstrip("/")
HA_TOKEN = os.environ.get("HA_TOKEN", "")
SENSE_EMAIL = os.environ.get("SENSE_EMAIL", "")
SENSE_PASSWORD = os.environ.get("SENSE_PASSWORD", "")
REPLAY = os.environ.get("NILM_REPLAY", "")
REPLAY_SPEED = float(os.environ.get("NILM_REPLAY_SPEED", "120"))
OTHER_ENTITY = os.environ.get("NILM_OTHER_ENTITY", "sensor.other_power")
TOTAL_ENTITY = os.environ.get("NILM_TOTAL_ENTITY", "sensor.sense_1000001241_energy")
SOLAR_ENTITY = os.environ.get("NILM_SOLAR_ENTITY", "sensor.solar_power")
PUBLISH = os.environ.get("NILM_PUBLISH", "1") != "0"
DATA = os.environ.get("NILM_DATA", "/data")
TZ = ZoneInfo(os.environ.get("TZ", "America/Chicago"))

# Detection tuning. MIN_STEP: smallest on/off step worth tracking.
MIN_STEP = float(os.environ.get("NILM_MIN_STEP", "200"))
# Two steps belong to one device when their sizes are within this ratio.
CLUSTER_TOL = float(os.environ.get("NILM_CLUSTER_TOL", "0.15"))
# An "off" closes an "on" when its size is within this ratio (or 120 W).
PAIR_TOL = 0.25
MAX_OPEN_S = 6 * 3600
# A cluster becomes a "device" (shown, published) after this many runs.
MIN_EVENTS = int(os.environ.get("NILM_MIN_EVENTS", "4"))

PALETTE = ["#21e6f2", "#ff2fa8", "#ffb020", "#2ef2a3", "#a35bff", "#ff4d6d", "#5aa9ff", "#c6f432", "#ff8a3d", "#7ff0d0"]

# ------------------------------------------------------------------ storage

os.makedirs(DATA, exist_ok=True)
db = sqlite3.connect(os.path.join(DATA, "nilm.db"), check_same_thread=False)
db.row_factory = sqlite3.Row
db.execute("pragma journal_mode=wal")
db.execute("pragma synchronous=normal")
db.executescript(
    """
    create table if not exists clusters (
      id integer primary key,
      label text not null,          -- stable letter: A, B, ..., AA
      name text,                    -- what people called it
      color text not null,
      sig text not null,            -- '240', 'L1', 'L2' or '?' (legs unknown)
      center real not null,         -- typical step size, W
      hidden integer not null default 0,
      merged_into integer,
      created real not null
    );
    create table if not exists events (
      id integer primary key,
      cluster integer not null,
      t_on real not null,
      t_off real,
      dp real not null,             -- W added when it turned on
      dp_off real,                  -- W removed when it turned off
      sig text not null,
      source text not null,
      expired integer not null default 0
    );
    create index if not exists events_t on events(t_on);
    create index if not exists events_c on events(cluster, t_on);
    create table if not exists samples (
      t real primary key,           -- 10 s buckets
      other real, total real, solar real
    );
    create table if not exists meta (k text primary key, v text);
    """
)
db.commit()


def meta_get(k: str, default=None):
    r = db.execute("select v from meta where k=?", (k,)).fetchone()
    return json.loads(r["v"]) if r else default


def meta_set(k: str, v) -> None:
    db.execute("insert or replace into meta(k, v) values(?, ?)", (k, json.dumps(v)))
    db.commit()


def letter(i: int) -> str:
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


# ------------------------------------------------------------------ model


@dataclass
class Sample:
    t: float
    other: float
    total: float | None = None
    solar: float | None = None
    legs: tuple[float, float] | None = None  # other-load watts per leg, when known


@dataclass
class Cluster:
    id: int
    label: str
    name: str | None
    color: str
    sig: str
    center: float
    hidden: bool
    merged_into: int | None
    recent: deque = field(default_factory=lambda: deque(maxlen=60))


def sig_ok(a: str, b: str) -> bool:
    return a == b or a == "?" or b == "?"


def leg_sig(d1: float, d2: float) -> str:
    tot = d1 + d2
    if abs(tot) < 1:
        return "?"
    share = d1 / tot
    if 0.3 <= share <= 0.7:
        return "240"
    return "L1" if share > 0.7 else "L2"


class Engine:
    """Step detection -> on/off pairing -> clustering, one sample at a time."""

    def __init__(self) -> None:
        self.clusters: dict[int, Cluster] = {}
        for r in db.execute("select * from clusters"):
            c = Cluster(r["id"], r["label"], r["name"], r["color"], r["sig"], r["center"], bool(r["hidden"]), r["merged_into"])
            for e in db.execute("select dp from events where cluster=? order by t_on desc limit 60", (c.id,)):
                c.recent.appendleft(e["dp"])
            self.clusters[c.id] = c
        # open events: id -> (cluster, t_on, dp, sig)
        self.open: dict[int, tuple[int, float, float, str]] = {}
        for r in db.execute("select * from events where t_off is null and expired=0"):
            self.open[r["id"]] = (r["cluster"], r["t_on"], r["dp"], r["sig"])
        self.level: float | None = None
        self.level_legs: tuple[float, float] | None = None
        self.pending: list[Sample] = []
        self.intervals: deque = deque(maxlen=50)
        self.last_t: float | None = None
        self.ring: deque = deque(maxlen=4000)  # raw samples for the live chart
        self.bucket: list[Sample] = []
        self.listeners: set[asyncio.Queue] = set()
        self.source = "none"
        self.source_detail = ""
        self.last_sample_wall = 0.0
        self.samples_seen = 0
        self.backfilling = False  # live samples are dropped while history replays

    # ---- helpers
    def resolve(self, cid: int) -> Cluster:
        c = self.clusters[cid]
        seen = 0
        while c.merged_into and seen < 20:
            c = self.clusters[c.merged_into]
            seen += 1
        return c

    def emit(self, msg: dict) -> None:
        for q in list(self.listeners):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                pass

    def stable_n(self) -> int:
        """Samples a new level must hold before it counts. ~3 s on the live
        stream; a single sample on HA's 2-minute updates."""
        if len(self.intervals) < 5:
            return 1
        med = statistics.median(self.intervals)
        return 1 if med > 20 else max(2, min(6, round(3 / max(med, 0.25))))

    @staticmethod
    def noise(level: float) -> float:
        return max(60.0, 0.04 * abs(level))

    # ---- main entry
    def feed(self, s: Sample, live: bool = True) -> None:
        if live and self.backfilling:
            return
        if self.last_t is not None:
            dt = s.t - self.last_t
            if dt <= 0:
                return
            self.intervals.append(dt)
        self.last_t = s.t
        self.store_bucket(s)
        if live:
            self.samples_seen += 1
            self.last_sample_wall = time.time()
            self.ring.append(s)
        if live:
            self.emit({"type": "sample", "t": s.t, "other": round(s.other, 1), "total": s.total, "solar": s.solar, "on": self.on_now()})

        if self.level is None:
            self.level, self.level_legs = s.other, s.legs
            return
        if abs(s.other - self.level) < self.noise(self.level):
            # Still on the same plateau: drift the level slowly, drop any
            # half-formed step (it was a transient, e.g. motor inrush).
            self.level += 0.1 * (s.other - self.level)
            # Leg watts are whole-house per leg; keep the latest reading so a
            # step's per-leg change is measured against just before it.
            self.level_legs = s.legs
            self.pending.clear()
            return
        # Off the plateau. Collect samples until they agree on a new level.
        if self.pending and abs(s.other - self.pending[-1].other) > self.noise(s.other):
            self.pending = []
        self.pending.append(s)
        if len(self.pending) < self.stable_n():
            return
        new = statistics.fmean(p.other for p in self.pending)
        dp = new - self.level
        sig = "?"
        new_legs = None
        if all(p.legs for p in self.pending) and self.level_legs:
            new_legs = tuple(statistics.fmean(p.legs[i] for p in self.pending) for i in (0, 1))  # type: ignore
            sig = leg_sig(new_legs[0] - self.level_legs[0], new_legs[1] - self.level_legs[1])
        t = self.pending[0].t
        self.level, self.level_legs = new, new_legs or (s.legs if s.legs else None)
        self.pending = []
        if abs(dp) >= MIN_STEP:
            if dp > 0:
                self.turn_on(t, dp, sig, live)
            else:
                self.turn_off(t, -dp, sig, live)
        self.expire(t)
        self.reconcile(t, live)

    # ---- events
    def turn_on(self, t: float, dp: float, sig: str, live: bool) -> None:
        c = self.assign(dp, sig, t)
        cur = db.execute(
            "insert into events(cluster, t_on, dp, sig, source) values(?,?,?,?,?)", (c.id, t, dp, sig, self.source)
        )
        db.commit()
        self.open[cur.lastrowid] = (c.id, t, dp, sig)
        if live:
            self.emit({"type": "on", "event": cur.lastrowid, "cluster": c.id, "label": c.label, "t": t, "dp": round(dp)})

    def turn_off(self, t: float, m: float, sig: str, live: bool) -> None:
        best, best_err = None, None
        for eid, (cid, t_on, dp, s) in self.open.items():
            if not sig_ok(s, sig):
                continue
            err = abs(dp - m)
            if err / dp > PAIR_TOL and err > 120:
                continue
            # prefer the closest size; break ties toward the most recent "on"
            score = err / dp - t_on * 1e-12
            if best_err is None or score < best_err:
                best, best_err = eid, score
        if best is None:
            return
        cid, t_on, dp, _ = self.open.pop(best)
        db.execute("update events set t_off=?, dp_off=? where id=?", (t, m, best))
        db.commit()
        if live:
            c = self.resolve(cid)
            self.emit({"type": "off", "event": best, "cluster": c.id, "label": c.label, "t": t, "dur": round(t - t_on), "dp": round(dp)})

    def reconcile(self, t: float, live: bool) -> None:
        """Devices can't add up to more than the load being measured. When an
        "off" was missed (two steps landing in one sample, a ramp), close the
        oldest open runs until what's on fits under the current level."""
        level = max(0.0, self.level or 0.0)
        slack = max(150.0, 0.15 * level)
        changed = False
        while self.open and sum(dp for _, _, dp, _ in self.open.values()) > level + slack:
            eid = min(self.open, key=lambda k: self.open[k][1])
            cid, t_on, dp, _ = self.open.pop(eid)
            # dp_off stays null: the off was inferred, not seen
            db.execute("update events set t_off=? where id=?", (max(t, t_on), eid))
            changed = True
            if live:
                c = self.resolve(cid)
                self.emit({"type": "off", "event": eid, "cluster": c.id, "label": c.label, "t": t, "dur": round(t - t_on), "dp": round(dp)})
        if changed:
            db.commit()

    def expire(self, now: float) -> None:
        for eid, (cid, t_on, dp, s) in list(self.open.items()):
            if now - t_on > MAX_OPEN_S:
                self.open.pop(eid)
                db.execute("update events set expired=1 where id=?", (eid,))
        db.commit()

    def assign(self, dp: float, sig: str, t: float) -> Cluster:
        best, best_d = None, None
        for c in self.clusters.values():
            if not sig_ok(c.sig, sig):
                continue
            d = abs(math.log(dp / c.center))
            if d < math.log(1 + CLUSTER_TOL) and (best_d is None or d < best_d):
                best, best_d = c, d
        if best is None:
            n = db.execute("select count(*) n from clusters").fetchone()["n"]
            cur = db.execute(
                "insert into clusters(label, color, sig, center, created) values(?,?,?,?,?)",
                (letter(n), PALETTE[n % len(PALETTE)], sig, dp, t),
            )
            db.commit()
            best = Cluster(cur.lastrowid, letter(n), None, PALETTE[n % len(PALETTE)], sig, dp, False, None)
            self.clusters[best.id] = best
        best.recent.append(dp)
        best.center = statistics.median(best.recent)
        if best.sig == "?" and sig != "?":
            best.sig = sig
        db.execute("update clusters set center=?, sig=? where id=?", (best.center, best.sig, best.id))
        db.commit()
        return self.resolve(best.id)

    # ---- live state
    def on_now(self) -> dict[int, float]:
        out: dict[int, float] = {}
        for cid, t_on, dp, _ in self.open.values():
            c = self.resolve(cid)
            out[c.id] = out.get(c.id, 0) + dp
        return {k: round(v) for k, v in out.items()}

    def store_bucket(self, s: Sample) -> None:
        b = math.floor(s.t / 10) * 10
        if self.bucket and math.floor(self.bucket[0].t / 10) * 10 != b:
            bt = math.floor(self.bucket[0].t / 10) * 10
            avg = lambda xs: statistics.fmean(xs) if xs else None  # noqa: E731
            db.execute(
                "insert or replace into samples(t, other, total, solar) values(?,?,?,?)",
                (
                    bt,
                    avg([x.other for x in self.bucket]),
                    avg([x.total for x in self.bucket if x.total is not None]),
                    avg([x.solar for x in self.bucket if x.solar is not None]),
                ),
            )
            self.bucket = []
        self.bucket.append(s)


engine = Engine()

# ------------------------------------------------------------------ sources


async def sense_source() -> None:
    """Sense's realtime websocket. The "Other" figure is Sense's own
    unidentified-load device (id "unknown"); per-leg watts come from
    `channels`, scaled to the Other share of the total."""
    from sense_energy import ASyncSenseable
    from sense_energy.sense_exceptions import SenseMFARequiredException

    auth_path = os.path.join(DATA, "sense_auth.json")
    backoff = 5
    while True:
        gw = ASyncSenseable(wss_timeout=30)
        try:
            saved = json.load(open(auth_path)) if os.path.exists(auth_path) else None
            if saved:
                gw.set_ssl_context(True, "")
                gw.load_auth(saved["access_token"], saved["user_id"], saved["device_id"], saved["refresh_token"])
                gw.set_monitor_id(saved["monitor_id"])
            else:
                await gw.authenticate(SENSE_EMAIL, SENSE_PASSWORD)
                json.dump(
                    {
                        "access_token": gw.sense_access_token,
                        "user_id": gw.sense_user_id,
                        "device_id": gw.device_id,
                        "refresh_token": gw.refresh_token,
                        "monitor_id": gw.sense_monitor_id,
                    },
                    open(auth_path, "w"),
                )
                os.chmod(auth_path, 0o600)
            engine.source, engine.source_detail = "sense", "Sense realtime stream"

            def on_data(d: dict) -> None:
                devices = d.get("devices") or []
                other = next((float(x.get("w", 0)) for x in devices if x.get("id") == "unknown"), None)
                total = float(d.get("w", 0))
                if other is None:
                    known = sum(float(x.get("w", 0)) for x in devices if x.get("id") not in ("unknown", "solar"))
                    other = max(0.0, total - known)
                # Whole-house watts per 120 V leg. A step in "Other" shows up
                # in these too; which legs moved says 120 V (L1/L2) or 240 V.
                legs = None
                ch = d.get("channels")
                if isinstance(ch, list) and len(ch) >= 2:
                    legs = (float(ch[0]), float(ch[1]))
                engine.feed(Sample(time.time(), other, total, d.get("solar_w"), legs))

            backoff = 5
            await gw.async_realtime_stream(on_data)
        except SenseMFARequiredException:
            engine.source, engine.source_detail = "error", "Sense account needs a 2FA code; see nilm/README"
            log.error("Sense requires MFA; streaming disabled")
            await asyncio.sleep(3600)
        except Exception as ex:  # noqa: BLE001
            log.warning("sense stream: %s", ex)
            engine.source_detail = f"Sense reconnecting: {ex}"
            if "Unauthorized" in str(ex) and os.path.exists(auth_path):
                os.remove(auth_path)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 300)
        finally:
            try:
                await gw._client_session.close()
            except Exception:  # noqa: BLE001
                pass


async def ha_source() -> None:
    """Fallback: HA's Sense entities (sensor.other_power), updated every
    ~2 minutes. No per-leg data."""
    import websockets

    ws_url = HA_URL.replace("http", "ws", 1) + "/api/websocket"
    latest: dict[str, float] = {}
    while True:
        try:
            async with websockets.connect(ws_url, max_size=None) as ws:
                await ws.recv()
                await ws.send(json.dumps({"type": "auth", "access_token": HA_TOKEN}))
                if json.loads(await ws.recv()).get("type") != "auth_ok":
                    engine.source, engine.source_detail = "error", "HA rejected HA_TOKEN"
                    await asyncio.sleep(600)
                    continue
                await ws.send(json.dumps({"id": 1, "type": "subscribe_entities", "entity_ids": [OTHER_ENTITY, TOTAL_ENTITY, SOLAR_ENTITY]}))
                engine.source, engine.source_detail = "ha", "Home Assistant (~2 min updates)"
                async for raw in ws:
                    msg = json.loads(raw)
                    ev = msg.get("event") or {}
                    changes = {**(ev.get("a") or {}), **{k: v.get("+", {}) for k, v in (ev.get("c") or {}).items()}}
                    got_other = False
                    for eid, st in changes.items():
                        try:
                            latest[eid] = float(st.get("s"))
                            got_other |= eid == OTHER_ENTITY
                        except (TypeError, ValueError):
                            pass
                    if got_other:
                        engine.feed(Sample(time.time(), latest[OTHER_ENTITY], latest.get(TOTAL_ENTITY), latest.get(SOLAR_ENTITY)))
        except Exception as ex:  # noqa: BLE001
            engine.source_detail = f"HA reconnecting: {ex}"
            await asyncio.sleep(10)


async def replay_source() -> None:
    """Development: replay a `ts,entity,w` CSV (ISO timestamps)."""
    rows = []
    with open(REPLAY) as f:
        for r in csv.DictReader(f):
            if r["entity"] == OTHER_ENTITY:
                rows.append((datetime.fromisoformat(r["ts"]).timestamp(), float(r["w"])))
    rows.sort()
    engine.source, engine.source_detail = "replay", f"Replay of {os.path.basename(REPLAY)}, last 3 h at {REPLAY_SPEED:g}x"
    if not rows or db.execute("select count(*) n from events").fetchone()["n"]:
        return  # only replay into an empty database
    # Shift the recording so it ends at startup. Everything but the last
    # 3 hours goes in at once (history); the tail plays out at REPLAY_SPEED
    # so the live chart and stream have something to show.
    shift = time.time() - rows[-1][0]
    tail = rows[-1][0] - 3 * 3600
    for i, (t, w) in enumerate(rows):
        if t < tail:
            engine.feed(Sample(t + shift, w), live=False)
            if i % 500 == 0:
                await asyncio.sleep(0)
    t0, start = tail, time.time()
    for t, w in rows:
        if t < tail:
            continue
        wait = (t - t0) / REPLAY_SPEED - (time.time() - start)
        if wait > 0:
            await asyncio.sleep(wait)
        engine.feed(Sample(t + shift, w))


def pick_source():
    if REPLAY:
        return replay_source()
    if SENSE_EMAIL and SENSE_PASSWORD:
        return sense_source()
    if HA_TOKEN:
        return ha_source()
    engine.source, engine.source_detail = "none", "No data source configured"
    return None


# ------------------------------------------------------------------ stats


def cluster_stats() -> list[dict]:
    now = time.time()
    since = now - 7 * 86400
    on = engine.on_now()
    rows = db.execute("select cluster, t_on, t_off, dp, dp_off, expired from events where t_on > ?", (since,)).fetchall()
    first = db.execute("select min(t_on) t from events").fetchone()["t"] or now
    days = max(1 / 24, min(7, (now - max(first, since)) / 86400))
    by: dict[int, list] = {}
    for r in rows:
        by.setdefault(engine.resolve(r["cluster"]).id, []).append(r)
    out = []
    for c in engine.clusters.values():
        if c.merged_into:
            continue
        ev = by.get(c.id, [])
        closed = [e for e in ev if e["t_off"] and e["dp_off"] is not None]  # seen turning off
        durs = sorted((e["t_off"] - e["t_on"]) / 60 for e in closed)
        dps = sorted(e["dp"] for e in ev)

        def kwh(e, frm):
            end = e["t_off"] or (now if not e["expired"] else e["t_on"])
            return max(0.0, end - max(e["t_on"], frm)) / 3600 * e["dp"] / 1000

        hours = [0] * 24
        for e in ev:
            hours[datetime.fromtimestamp(e["t_on"], TZ).hour] += 1
        q = lambda xs, p: xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None  # noqa: E731
        out.append(
            {
                "id": c.id,
                "label": c.label,
                "name": c.name,
                "color": c.color,
                "sig": c.sig,
                "watts": round(c.center),
                "watts_range": [round(q(dps, 0.1) or c.center), round(q(dps, 0.9) or c.center)],
                "runs_7d": len(ev),
                "runs_per_day": round(len(ev) / days, 1),
                "minutes": round(q(durs, 0.5), 1) if durs else None,
                "minutes_range": [round(q(durs, 0.25), 1), round(q(durs, 0.75), 1)] if durs else None,
                "kwh_24h": round(sum(kwh(e, now - 86400) for e in ev if (e["t_off"] or now) > now - 86400), 2),
                "kwh_7d": round(sum(kwh(e, since) for e in ev), 2),
                "kwh_per_day": round(sum(kwh(e, since) for e in ev) / days, 2),
                "hours": hours,
                "last_on": max((e["t_on"] for e in ev), default=None),
                "on_w": on.get(c.id, 0),
                "hidden": c.hidden,
                "candidate": len(ev) < MIN_EVENTS and not c.name,
            }
        )
    out.sort(key=lambda x: -x["kwh_7d"])
    return out


# ------------------------------------------------------------------ HA publish

published: dict[str, str] = {}


async def publish_loop() -> None:
    """Mirror each confirmed device into HA as power/energy/on-off entities.
    Entity ids use the stable letter (sensor.nilm_device_a_power) so renaming
    only changes the friendly name."""
    if not (PUBLISH and HA_TOKEN):
        return
    async with httpx.AsyncClient(timeout=10) as client:
        last_full = 0.0
        while True:
            try:
                full = time.time() - last_full > 60
                stats = [s for s in cluster_stats() if not s["candidate"] and not s["hidden"]]
                energy_total = {
                    r["c"]: r["kwh"]
                    for r in db.execute(
                        "select cluster c, sum(dp * (coalesce(t_off, t_on) - t_on)) / 3600000.0 kwh from events group by cluster"
                    )
                }
                for s in stats:
                    slug = f"nilm_device_{s['label'].lower()}"
                    name = s["name"] or f"Device {s['label']}"
                    kwh = sum(v for k, v in energy_total.items() if engine.resolve(k).id == s["id"])
                    states = {
                        f"sensor.{slug}_power": (str(s["on_w"]), {"unit_of_measurement": "W", "device_class": "power", "state_class": "measurement", "friendly_name": f"{name} power"}),
                        f"sensor.{slug}_energy": (f"{kwh:.3f}", {"unit_of_measurement": "kWh", "device_class": "energy", "state_class": "total_increasing", "friendly_name": f"{name} energy"}),
                        f"binary_sensor.{slug}": ("on" if s["on_w"] else "off", {"device_class": "power", "friendly_name": name}),
                    }
                    for eid, (st, attrs) in states.items():
                        attrs = {**attrs, "icon": "mdi:flash-outline", "nilm_cluster": s["id"], "typical_watts": s["watts"], "legs": s["sig"]}
                        key = st + json.dumps(attrs, sort_keys=True)
                        if not full and published.get(eid) == key:
                            continue
                        await client.post(f"{HA_URL}/api/states/{eid}", headers={"Authorization": f"Bearer {HA_TOKEN}"}, json={"state": st, "attributes": attrs})
                        published[eid] = key
                if full:
                    last_full = time.time()
            except Exception as ex:  # noqa: BLE001
                log.warning("publish: %s", ex)
            await asyncio.sleep(5)


# ------------------------------------------------------------------ backfill


async def backfill(days: int) -> dict:
    """Seed clusters from HA's recorded sensor.other_power history (~2 min
    resolution). Runs through the same detector, without live messages."""
    start = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    async with httpx.AsyncClient(timeout=120) as c:
        r = await c.get(
            f"{HA_URL}/api/history/period/{start}",
            params={"filter_entity_id": OTHER_ENTITY, "minimal_response": "", "no_attributes": ""},
            headers={"Authorization": f"Bearer {HA_TOKEN}"},
        )
    r.raise_for_status()
    pts = []
    for st in (r.json() or [[]])[0]:
        try:
            pts.append((datetime.fromisoformat(st["last_changed"]).timestamp(), float(st["state"])))
        except (KeyError, ValueError, TypeError):
            pass
    first_live = db.execute("select min(t_on) t from events").fetchone()["t"] or time.time()
    pts = [p for p in pts if p[0] < first_live]
    if engine.backfilling:
        raise HTTPException(409, "a backfill is already running")
    engine.backfilling = True
    saved = (engine.level, engine.level_legs, engine.last_t, list(engine.intervals), engine.source)
    try:
        engine.level, engine.level_legs, engine.last_t, engine.source = None, None, None, "backfill"
        engine.intervals.clear()
        for i, (t, w) in enumerate(pts):
            engine.feed(Sample(t, w), live=False)
            if i % 500 == 0:
                await asyncio.sleep(0)
        # anything still "on" at the end of history is unknowable; drop it
        for eid, (_, t_on, _, _) in list(engine.open.items()):
            if t_on < first_live:
                engine.open.pop(eid)
                db.execute("update events set expired=1 where id=?", (eid,))
        db.commit()
    finally:
        engine.level, engine.level_legs, engine.last_t, iv, engine.source = saved
        engine.intervals.clear()
        engine.intervals.extend(iv)
        engine.backfilling = False
    return {"samples": len(pts), "clusters": len(engine.clusters)}


# ------------------------------------------------------------------ API

app = FastAPI(title="nilm")
token_cache: dict[str, float] = {}


async def require_ha_token(request: Request) -> None:
    if os.environ.get("NILM_NO_AUTH") == "1":  # local development only
        return
    auth = request.headers.get("authorization", "")
    token = auth[7:] if auth.lower().startswith("bearer ") else request.query_params.get("token", "")
    if len(token) < 20:
        raise HTTPException(401, "missing Home Assistant token")
    if token_cache.get(token, 0) > time.time():
        return
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{HA_URL}/api/", headers={"Authorization": f"Bearer {token}"}, timeout=10)
    if r.status_code != 200:
        raise HTTPException(401, "invalid Home Assistant token")
    token_cache[token] = time.time() + 600


@app.on_event("startup")
async def startup() -> None:
    src = pick_source()
    if src:
        asyncio.get_event_loop().create_task(src)
    asyncio.get_event_loop().create_task(publish_loop())
    asyncio.get_event_loop().create_task(housekeeping())


async def housekeeping() -> None:
    while True:
        await asyncio.sleep(3600)
        db.execute("delete from samples where t < ?", (time.time() - 7 * 86400,))
        db.commit()


@app.get("/status")
async def status(request: Request):
    await require_ha_token(request)
    iv = list(engine.intervals)
    return {
        "source": engine.source,
        "detail": engine.source_detail,
        "sample_interval_s": round(statistics.median(iv), 2) if iv else None,
        "last_sample_age_s": round(time.time() - engine.last_sample_wall, 1) if engine.last_sample_wall else None,
        "samples": engine.samples_seen,
        "level_w": round(engine.level) if engine.level is not None else None,
        "open_events": len(engine.open),
        "min_step_w": MIN_STEP,
        "publishing": bool(PUBLISH and HA_TOKEN),
    }


@app.get("/live")
async def live(request: Request, seconds: int = 900):
    await require_ha_token(request)
    cut = time.time() - min(seconds, 86400)
    raw = [{"t": s.t, "other": round(s.other, 1), "total": s.total, "solar": s.solar} for s in engine.ring if s.t >= cut]
    # Older than the in-memory ring: the 10 s buckets (thinned to ~1500
    # points so a 24 h window stays light).
    ring_start = raw[0]["t"] if raw else time.time()
    old = [dict(r) for r in db.execute("select t, other, total, solar from samples where t >= ? and t < ? order by t", (cut, ring_start))]
    if len(old) > 1500:
        k = math.ceil(len(old) / 1500)
        old = [
            {"t": g[0]["t"], "other": max(x["other"] for x in g), "total": g[0]["total"], "solar": g[0]["solar"]}
            for g in (old[i : i + k] for i in range(0, len(old), k))
        ]
    pts = old + raw
    ev = db.execute("select * from events where coalesce(t_off, t_on) >= ? or t_off is null order by t_on", (cut,)).fetchall()
    return {"samples": pts, "events": [event_json(e) for e in ev if not e["expired"]], "on": engine.on_now()}


def event_json(e) -> dict:
    c = engine.resolve(e["cluster"])
    return {"id": e["id"], "cluster": c.id, "label": c.label, "t_on": e["t_on"], "t_off": e["t_off"], "dp": round(e["dp"]), "sig": e["sig"]}


@app.get("/events")
async def events(request: Request, limit: int = 100, cluster: int | None = None):
    await require_ha_token(request)
    rows = db.execute("select * from events where expired=0 order by t_on desc limit ?", (limit * 4 if cluster else limit,)).fetchall()
    out = [event_json(r) for r in rows]
    if cluster is not None:
        out = [e for e in out if e["cluster"] == cluster][:limit]
    return out


@app.get("/clusters")
async def clusters(request: Request):
    await require_ha_token(request)
    return cluster_stats()


@app.post("/clusters/{cid}")
async def update_cluster(cid: int, request: Request):
    await require_ha_token(request)
    body = await request.json()
    c = engine.clusters.get(cid)
    if not c:
        raise HTTPException(404, "no such device")
    if "name" in body:
        c.name = (body["name"] or "").strip()[:60] or None
        db.execute("update clusters set name=? where id=?", (c.name, cid))
    if "hidden" in body:
        c.hidden = bool(body["hidden"])
        db.execute("update clusters set hidden=? where id=?", (int(c.hidden), cid))
    db.commit()
    published.clear()
    return {"ok": True}


@app.post("/merge")
async def merge(request: Request):
    """Fold clusters into the first one (same device split by size drift)."""
    await require_ha_token(request)
    ids = [int(i) for i in (await request.json()).get("ids", [])]
    if len(ids) < 2 or any(i not in engine.clusters for i in ids):
        raise HTTPException(400, "need two or more device ids")
    target = engine.resolve(ids[0])
    for i in ids[1:]:
        c = engine.resolve(i)
        if c.id == target.id:
            continue
        c.merged_into = target.id
        db.execute("update clusters set merged_into=? where id=?", (target.id, c.id))
    db.commit()
    published.clear()
    return {"ok": True, "into": target.id}


@app.post("/backfill")
async def do_backfill(request: Request, days: int = 10):
    await require_ha_token(request)
    if not HA_TOKEN:
        raise HTTPException(400, "HA_TOKEN not configured")
    return await backfill(min(days, 30))


@app.get("/stream")
async def stream(request: Request):
    """Newline-delimited JSON: samples as they arrive, plus on/off events.
    (A fetch stream rather than EventSource, so it can carry the token.)"""
    await require_ha_token(request)
    q: asyncio.Queue = asyncio.Queue(maxsize=500)
    engine.listeners.add(q)

    async def gen():
        try:
            yield json.dumps({"type": "hello", "source": engine.source, "detail": engine.source_detail}) + "\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), 15)
                except asyncio.TimeoutError:
                    msg = {"type": "ping"}
                yield json.dumps(msg) + "\n"
        finally:
            engine.listeners.discard(q)

    return StreamingResponse(gen(), media_type="application/x-ndjson", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
