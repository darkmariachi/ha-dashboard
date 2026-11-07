"""
Face recognition for the dashboard's Visitors page.

Runs locally on skylab; nothing leaves the network. It:
  * watches Home Assistant for UniFi Protect *person* detections and doorbell
    rings (never vehicles, animals or packages), fetches the frame through
    HA's Protect snapshot proxy, finds human faces with InsightFace
    (RetinaFace detector + ArcFace embeddings, CPU) and keeps a small crop and
    the 512-d embedding of each usable face in SQLite;
  * works through a queue, so a backfill of past detections (queued from the
    command line, see `backfill` below) goes through the same path;
  * matches faces against ones a person labelled (or uploaded), and groups
    the unlabelled ones into clusters to review.

Subjects are free-form strings owned by the dashboard: a visitor id from the
push service's visit log, "household:<name>", or "ignore".

HTTP API (behind nginx at /api/faces/, every call needs the caller's Home
Assistant token as a Bearer header, checked against HA):
  GET  /status                       counts, queue and model state
  GET  /clusters?limit=&samples=     unlabelled faces grouped by likeness
  GET  /subjects                     per-subject counts, last seen, a sample
  GET  /faces?subject=&limit=&offset=
  GET  /sightings?since=             labelled faces after a time (ms)
  POST /assign   {ids: [..], subject: str | null}
  POST /enroll   {subject, image: data URL}   reference photo upload
  POST /avatar   {subject, id | null}         choose / clear a profile picture
  POST /candidates {subject, windows: [[start, end]...]}  unnamed faces from those times
  POST /reject   {subject, ids}               "not them": stop suggesting these
  POST /delete   {ids}                        delete bad captures outright
  GET  /stats                                 queue / throughput / CPU for Insights
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import sqlite3
import sys
import threading
import time
from datetime import datetime, timezone

import warnings

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=DeprecationWarning)

import cv2  # noqa: E402
import httpx  # noqa: E402
import numpy as np  # noqa: E402
from fastapi import FastAPI, HTTPException, Request  # noqa: E402

HA_URL = os.environ.get("HA_URL", "http://192.168.1.54:8123").rstrip("/")
HA_TOKEN = os.environ.get("HA_TOKEN", "")
PROTECT_ENTRY = os.environ.get("PROTECT_ENTRY", "cd4d3f67c508e1e953aa4bb838d21980")
DATA = os.environ.get("DATA_DIR", "/data")
DB_PATH = os.path.join(DATA, "faces.db")

# Detection events that may contain a face -> (camera entity, allowed
# event_type values; None = any, for the doorbell's ring event).
SOURCES: dict[str, tuple[str, set[str] | None]] = {
    "event.g4_doorbell_pro_smart_detection": ("camera.g4_doorbell_pro_medium", {"person"}),
    "event.g4_doorbell_pro_doorbell": ("camera.g4_doorbell_pro_medium", None),
    "event.driveway_smart_detection": ("camera.driveway_medium", {"person"}),
}

# Tuned on real doorbell frames (1600x1200): faces at the door are ~50 px
# wide and score 0.55-0.8; profiles are what MAX_YAW is for.
MIN_DET = 0.60  # detector confidence
MIN_SIZE = 40  # face box width in px
MAX_YAW = 55  # degrees; profiles don't match well
# Frames per detection, as ms after it (on top of fetch_frame's +1 s):
# people often aren't facing the doorbell yet when Protect first flags them.
OFFSETS: dict[str, tuple[int, ...]] = {"camera.g4_doorbell_pro_medium": (0, 2000)}
MATCH = 0.42  # cosine similarity to call it the same person
NEAREST = 0.28  # below MATCH: only a "looks like" hint on an unnamed group
CLUSTER = 0.50  # similarity that links two unlabelled faces in a cluster
PACE_S = 0.25  # pause between queue items (Protect exports each frame)

log = logging.getLogger("faces")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# ------------------------------------------------------------------ storage

db_lock = threading.RLock()
db = sqlite3.connect(DB_PATH, check_same_thread=False)
db.row_factory = sqlite3.Row
db.executescript(
    """
    pragma journal_mode = wal;
    create table if not exists queue (
      key text primary key, camera text not null, t integer not null,
      kind text not null, prio integer not null default 0,
      status text not null default 'pending', tries integer not null default 0,
      faces integer, error text, updated integer
    );
    create index if not exists queue_pending on queue(status, prio, t);
    create table if not exists faces (
      id integer primary key, camera text not null, t integer not null,
      kind text not null, det real, size integer, yaw real,
      emb blob not null, crop blob not null,
      subject text, label text, score real, created integer
    );
    create index if not exists faces_subject on faces(subject);
    create index if not exists faces_t on faces(t);
    create table if not exists avatars (subject text primary key, face_id integer not null);
    create table if not exists rejections (subject text not null, face_id integer not null, primary key (subject, face_id));
    """
)
# When an item was queued (for live-detection delay); added after launch.
if "created" not in {r[1] for r in db.execute("pragma table_info(queue)")}:
    db.execute("alter table queue add column created integer")
    db.commit()


def now_ms() -> int:
    return int(time.time() * 1000)


def enqueue(camera: str, t: int, kind: str, prio: int) -> bool:
    # Rings and person detections often fire within a second of each other:
    # one frame per camera per 2 s.
    key = f"{camera}|{t // 2000}"
    with db_lock:
        cur = db.execute(
            "insert or ignore into queue(key, camera, t, kind, prio, updated, created) values (?,?,?,?,?,?,?)",
            (key, camera, t, kind, prio, now_ms(), now_ms()),
        )
        db.commit()
        return cur.rowcount > 0


def enqueue_detection(camera: str, t: int, kind: str, prio: int) -> int:
    """Queue every frame we look at for one detection; returns how many were new."""
    return sum(enqueue(camera, t + off, kind, prio) for off in OFFSETS.get(camera, (0,)))


# -------------------------------------------------------------------- model

model = None
model_error: str | None = None


def load_model():
    global model, model_error
    try:
        from insightface.app import FaceAnalysis

        fa = FaceAnalysis(
            name="buffalo_l",
            root=os.path.join(DATA, "models"),
            providers=["CPUExecutionProvider"],
            allowed_modules=["detection", "recognition", "landmark_3d_68"],
        )
        fa.prepare(ctx_id=-1, det_size=(640, 640))
        model = fa
        log.info("model ready")
    except Exception as e:  # noqa: BLE001
        model_error = str(e)
        log.exception("model failed to load")


def face_crops(img: np.ndarray):
    """Usable human faces in a frame: (det, width, yaw, embedding, jpeg)."""
    out = []
    h, w = img.shape[:2]
    for f in model.get(img):
        x1, y1, x2, y2 = [float(v) for v in f.bbox]
        fw = x2 - x1
        yaw = float(f.pose[1]) if getattr(f, "pose", None) is not None else 0.0
        if f.det_score < MIN_DET or fw < MIN_SIZE or abs(yaw) > MAX_YAW:
            continue
        m = fw * 0.35
        cx1, cy1 = max(0, int(x1 - m)), max(0, int(y1 - m * 1.2))
        cx2, cy2 = min(w, int(x2 + m)), min(h, int(y2 + m * 0.8))
        crop = img[cy1:cy2, cx1:cx2]
        side = max(crop.shape[:2])
        if side > 192:
            s = 192 / side
            crop = cv2.resize(crop, (int(crop.shape[1] * s), int(crop.shape[0] * s)), interpolation=cv2.INTER_AREA)
        ok, jpg = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if not ok:
            continue
        emb = np.asarray(f.normed_embedding, dtype=np.float32)
        out.append((float(f.det_score), int(fw), yaw, emb, jpg.tobytes()))
    return out


# ----------------------------------------------------------------- matching


def confirmed_matrix():
    with db_lock:
        rows = db.execute("select subject, emb from faces where label = 'confirmed' and subject is not null").fetchall()
    if not rows:
        return None, []
    return np.stack([np.frombuffer(r["emb"], dtype=np.float32) for r in rows]), [r["subject"] for r in rows]


def best_match(embs: np.ndarray, C, subjects):
    """Per row of embs: (subject, score) of the closest labelled face, or
    (None, score) below the threshold."""
    if C is None or len(embs) == 0:
        return [(None, 0.0)] * len(embs)
    sims = embs @ C.T
    idx = sims.argmax(axis=1)
    out = []
    for i, j in enumerate(idx):
        s = float(sims[i, j])
        out.append((subjects[j] if s >= MATCH else None, s))
    return out


def rematch_all():
    """Relabel every face nobody confirmed against the current labels."""
    C, subjects = confirmed_matrix()
    with db_lock:
        rows = db.execute("select id, emb from faces where label is null or label = 'auto'").fetchall()
        if not rows:
            return
        rejected = {(r[0], r[1]) for r in db.execute("select subject, face_id from rejections")}
        E = np.stack([np.frombuffer(r["emb"], dtype=np.float32) for r in rows])
        for r, (subj, score) in zip(rows, best_match(E, C, subjects)):
            if subj and (subj, r["id"]) in rejected:
                subj = None  # someone said it isn't them
            db.execute(
                "update faces set subject = ?, label = ?, score = ? where id = ?",
                (subj, "auto" if subj else None, score, r["id"]),
            )
        db.commit()


# ------------------------------------------------------------------- worker

worker_state = {"current": None, "done": 0, "started": now_ms()}


def iso(t_ms: int) -> str:
    return datetime.fromtimestamp(round(t_ms / 1000), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch_frame(client: httpx.Client, camera: str, t: int) -> np.ndarray:
    # Same path the dashboard's activity feed uses; +1 s lands on the frame
    # the detection was made on rather than just before it.
    url = f"{HA_URL}/api/unifiprotect/snapshot/{PROTECT_ENTRY}/{camera}/{iso(t + 1000)}?width=1920"
    r = client.get(url, headers={"Authorization": f"Bearer {HA_TOKEN}"}, timeout=30)
    r.raise_for_status()
    img = cv2.imdecode(np.frombuffer(r.content, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("not an image")
    return img


def worker():
    load_model()
    if model is None:
        return
    client = httpx.Client()
    while True:
        with db_lock:
            item = db.execute(
                "select * from queue where status = 'pending' order by prio desc, t desc limit 1"
            ).fetchone()
        if not item:
            time.sleep(2)
            continue
        worker_state["current"] = item["key"]
        try:
            img = fetch_frame(client, item["camera"], item["t"])
            found = face_crops(img)
            C, subjects = confirmed_matrix()
            matches = best_match(np.stack([f[3] for f in found]), C, subjects) if found else []
            with db_lock:
                for (det, size, yaw, emb, jpg), (subj, score) in zip(found, matches):
                    db.execute(
                        "insert into faces(camera, t, kind, det, size, yaw, emb, crop, subject, label, score, created)"
                        " values (?,?,?,?,?,?,?,?,?,?,?,?)",
                        (item["camera"], item["t"], item["kind"], det, size, yaw, emb.tobytes(), jpg, subj, "auto" if subj else None, score, now_ms()),
                    )
                db.execute(
                    "update queue set status = 'done', faces = ?, updated = ? where key = ?",
                    (len(found), now_ms(), item["key"]),
                )
                db.commit()
            worker_state["done"] += 1
        except Exception as e:  # noqa: BLE001
            with db_lock:
                tries = item["tries"] + 1
                db.execute(
                    "update queue set tries = ?, status = ?, error = ?, updated = ? where key = ?",
                    (tries, "failed" if tries >= 3 else "pending", str(e)[:300], now_ms(), item["key"]),
                )
                db.commit()
            log.warning("frame %s failed: %s", item["key"], e)
        worker_state["current"] = None
        time.sleep(PACE_S)


# ------------------------------------------------------------- HA watcher


async def watch_ha():
    import websockets

    ws_url = HA_URL.replace("http", "ws", 1) + "/api/websocket"
    backoff = 1
    while True:
        try:
            async with websockets.connect(ws_url, max_size=None) as ws:
                await ws.recv()
                await ws.send(json.dumps({"type": "auth", "access_token": HA_TOKEN}))
                if json.loads(await ws.recv()).get("type") != "auth_ok":
                    log.error("HA rejected HA_TOKEN")
                    await asyncio.sleep(300)
                    continue
                await ws.send(json.dumps({"id": 1, "type": "subscribe_events", "event_type": "state_changed"}))
                backoff = 1
                log.info("watching HA for person detections")
                async for raw in ws:
                    msg = json.loads(raw)
                    data = (msg.get("event") or {}).get("data") or {}
                    src = SOURCES.get(data.get("entity_id", ""))
                    new = data.get("new_state")
                    if not src or not new:
                        continue
                    camera, kinds = src
                    kind = (new.get("attributes") or {}).get("event_type") or "ring"
                    if kinds is not None and kind not in kinds:
                        continue  # vehicles, animals, packages: never
                    try:
                        t = int(datetime.fromisoformat(new["state"]).timestamp() * 1000)
                    except (ValueError, TypeError):
                        continue
                    if enqueue_detection(camera, t, "ring" if kinds is None else kind, prio=10):
                        log.info("queued live %s %s", camera, kind)
        except Exception as e:  # noqa: BLE001
            log.warning("HA socket: %s", e)
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 60)


# --------------------------------------------------------------------- API

app = FastAPI(title="faces")
token_cache: dict[str, float] = {}


async def require_ha_token(request: Request):
    auth = request.headers.get("authorization", "")
    token = auth[7:] if auth.lower().startswith("bearer ") else ""
    if len(token) < 20:
        raise HTTPException(401, "missing Home Assistant token")
    if token_cache.get(token, 0) > time.time():
        return
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{HA_URL}/api/", headers={"Authorization": f"Bearer {token}"}, timeout=10)
    if r.status_code != 200:
        raise HTTPException(401, "invalid Home Assistant token")
    token_cache[token] = time.time() + 600


def face_json(r) -> dict:
    return {
        "id": r["id"],
        "t": r["t"],
        "camera": r["camera"],
        "kind": r["kind"],
        "subject": r["subject"],
        "label": r["label"],
        "score": round(r["score"] or 0, 3),
        "det": round(r["det"] or 0, 3),
        "size": r["size"],
        "crop": "data:image/jpeg;base64," + base64.b64encode(r["crop"]).decode(),
    }


@app.on_event("startup")
async def startup():
    threading.Thread(target=worker, daemon=True).start()
    if HA_TOKEN:
        asyncio.get_event_loop().create_task(watch_ha())


@app.get("/status")
async def status(request: Request):
    await require_ha_token(request)
    with db_lock:
        q = {r["status"]: r["n"] for r in db.execute("select status, count(*) n from queue group by status")}
        f = db.execute(
            "select count(*) n, sum(subject is null) unknown, sum(label = 'confirmed') confirmed,"
            " sum(label = 'auto') auto, min(t) first, max(t) last from faces"
        ).fetchone()
    return {
        "model": "ready" if model else ("error: " + model_error if model_error else "loading"),
        "queue": q,
        "faces": dict(f),
        "processing": worker_state["current"],
    }


_cpu_sample: dict[str, float] = {}


def cpu_usage() -> dict:
    """This container's CPU use (cores) since the last call, and its limit,
    from cgroup v2. Empty if the files aren't there."""
    try:
        usec = next(int(l.split()[1]) for l in open("/sys/fs/cgroup/cpu.stat") if l.startswith("usage_usec"))
        quota, period = open("/sys/fs/cgroup/cpu.max").read().split()
    except (OSError, StopIteration, ValueError):
        return {}
    now = time.monotonic()
    prev = _cpu_sample.get("usec"), _cpu_sample.get("at")
    if prev[0] is None:  # first call: take a short sample
        time.sleep(0.5)
        later = time.monotonic()
        usec2 = next(int(l.split()[1]) for l in open("/sys/fs/cgroup/cpu.stat") if l.startswith("usage_usec"))
        cores = (usec2 - usec) / 1e6 / (later - now)
        usec, now = usec2, later
    else:
        cores = (usec - prev[0]) / 1e6 / max(1e-3, now - prev[1])
    _cpu_sample.update(usec=usec, at=now)
    limit = None if quota == "max" else int(quota) / int(period)
    return {"cores": round(cores, 2), "limit": limit, "host_cores": os.cpu_count()}


@app.get("/stats")
async def stats(request: Request):
    """Everything the Insights "face scanning" dashboard shows."""
    await require_ha_token(request)
    now = now_ms()
    hour, day = 3600_000, 86_400_000
    with db_lock:
        by = {
            (r["prio"], r["status"]): r["n"]
            for r in db.execute("select prio, status, count(*) n from queue group by prio, status")
        }
        hourly = {
            r["h"]: (r["n"], r["faces"] or 0)
            for r in db.execute(
                "select (? - updated) / ? h, count(*) n, sum(faces) faces from queue"
                " where status = 'done' and updated > ? group by h",
                (now, hour, now - day),
            )
        }
        live = db.execute(
            "select count(*) n, avg(updated - created) delay, max(updated) last from queue"
            " where prio > 0 and status = 'done' and created is not null and updated > ?",
            (now - day,),
        ).fetchone()
        last_live = db.execute("select max(t) from queue where prio > 0").fetchone()[0]
        current = db.execute("select camera, t, kind, prio from queue where key = ?", (worker_state["current"] or "",)).fetchone()
        next_up = db.execute(
            "select camera, t, prio from queue where status = 'pending' order by prio desc, t desc limit 1"
        ).fetchone()
        oldest_pending = db.execute("select min(t) from queue where status = 'pending' and prio = 0").fetchone()[0]
        errors = [
            dict(r)
            for r in db.execute(
                "select camera, t, error, updated from queue where status = 'failed' order by updated desc limit 5"
            )
        ]
        f = db.execute(
            "select count(*) n, sum(subject is null) unknown, sum(label = 'confirmed' and subject != 'ignore') confirmed,"
            " sum(label = 'auto' and subject != 'ignore') auto, sum(subject = 'ignore') ignored, min(t) first, max(t) last"
            " from faces where camera != 'upload'"
        ).fetchone()
        per_day = [
            dict(r)
            for r in db.execute(
                "select date(t / 1000, 'unixepoch', 'localtime') d, count(*) n from faces"
                " where camera != 'upload' and t > ? group by d order by d",
                (now - 30 * day,),
            )
        ]
    done = sum(v for (p, s), v in by.items() if s == "done")
    pending = sum(v for (p, s), v in by.items() if s == "pending")
    failed = sum(v for (p, s), v in by.items() if s == "failed")
    last_hour = hourly.get(0, (0, 0))[0]
    return {
        "model": "ready" if model else ("error: " + model_error if model_error else "loading"),
        "now": now,
        "queue": {"done": done, "pending": pending, "failed": failed},
        "backfill": {
            "done": by.get((0, "done"), 0),
            "pending": by.get((0, "pending"), 0),
            "failed": by.get((0, "failed"), 0),
            "oldest_pending": oldest_pending,
        },
        "live": {
            "queued_ever": sum(v for (p, s), v in by.items() if p > 0),
            "done_24h": live["n"],
            "avg_delay_ms": live["delay"],
            "last_detection": last_live,
        },
        # Index 0 = the last hour, 23 = a day ago: [frames, faces].
        "hourly": [list(hourly.get(h, (0, 0))) for h in range(24)],
        "rate_per_hour": last_hour,
        "eta_ms": round(pending / last_hour * hour) if last_hour and pending else None,
        "current": dict(current) if current else None,
        "next": dict(next_up) if next_up else None,
        "errors": errors,
        "faces": dict(f),
        "faces_per_day": per_day,
        "cpu": await asyncio.to_thread(cpu_usage),
        "thresholds": {"det": MIN_DET, "size": MIN_SIZE, "yaw": MAX_YAW, "match": MATCH},
    }


@app.post("/delete")
async def delete_faces(request: Request):
    """Delete faces outright (bad captures): gone from the library, so they
    can't match or be matched. The camera recording isn't touched."""
    await require_ha_token(request)
    ids = [int(i) for i in (await request.json()).get("ids", [])][:500]
    if not ids:
        return {"ok": True, "deleted": 0}
    marks = ",".join("?" * len(ids))
    with db_lock:
        cur = db.execute(f"delete from faces where id in ({marks})", ids)
        db.execute(f"delete from avatars where face_id in ({marks})", ids)
        db.execute(f"delete from rejections where face_id in ({marks})", ids)
        db.commit()
    await asyncio.to_thread(rematch_all)
    return {"ok": True, "deleted": cur.rowcount}


@app.get("/clusters")
async def clusters(request: Request, limit: int = 40, samples: int = 8):
    await require_ha_token(request)
    with db_lock:
        rows = db.execute("select * from faces where subject is null order by det * size desc").fetchall()
    if not rows:
        return []
    E = np.stack([np.frombuffer(r["emb"], dtype=np.float32) for r in rows])
    n = len(rows)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for start in range(0, n, 1024):
        sims = E[start : start + 1024] @ E.T
        ii, jj = np.nonzero(sims >= CLUSTER)
        for a, b in zip(ii + start, jj):
            if a < b:
                ra, rb = find(a), find(b)
                if ra != rb:
                    parent[rb] = ra
    groups: dict[int, list[int]] = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)

    # Closest named person per cluster, for a "looks like" hint on groups
    # that are near someone but under the auto-match bar.
    C, subjects = confirmed_matrix()
    keep = [i for i, s in enumerate(subjects) if s != "ignore"]
    C = C[keep] if C is not None and keep else None
    subjects = [subjects[i] for i in keep]

    out = []
    for members in sorted(groups.values(), key=len, reverse=True)[:limit]:
        rs = [rows[i] for i in members]  # already best-quality first
        nearest = None
        if C is not None:
            sims = E[members] @ C.T  # cluster faces x named faces
            per_subject: dict[str, float] = {}
            for j, s in enumerate(subjects):
                # The median across the cluster's faces, of each face's best
                # similarity to this person: one lucky face doesn't decide.
                per_subject[s] = max(per_subject.get(s, -1.0), float(np.median(sims[:, j])))
            best = max(per_subject.items(), key=lambda kv: kv[1], default=None)
            if best and best[1] >= NEAREST:
                nearest = {"subject": best[0], "score": round(best[1], 3)}
        out.append(
            {
                "ids": [r["id"] for r in rs],
                "times": sorted(r["t"] for r in rs),
                "cameras": sorted({r["camera"] for r in rs}),
                "faces": [face_json(r) for r in rs[:samples]],
                "nearest": nearest,
            }
        )
    return out


def avatar_for(subject: str):
    """The face chosen as a subject's profile picture, else their latest
    confirmed face (uploads included), else their latest matched one."""
    row = db.execute(
        "select f.* from avatars a join faces f on f.id = a.face_id where a.subject = ? and f.subject = ?",
        (subject, subject),
    ).fetchone()
    return row or db.execute(
        "select * from faces where subject = ? order by (label = 'confirmed') desc, t desc limit 1", (subject,)
    ).fetchone()


@app.get("/subjects")
async def subjects(request: Request):
    await require_ha_token(request)
    with db_lock:
        rows = db.execute(
            "select subject, count(*) n, sum(label = 'confirmed') confirmed, max(t) last from faces"
            " where subject is not null group by subject"
        ).fetchall()
        chosen = {r["subject"] for r in db.execute("select subject from avatars")}
        out = []
        for r in rows:
            face = avatar_for(r["subject"])
            out.append(
                {
                    **dict(r),
                    "sample": face_json(face)["crop"] if face else None,
                    "avatar_id": face["id"] if face else None,
                    "avatar_chosen": r["subject"] in chosen,
                }
            )
    return out


@app.post("/candidates")
async def candidates(request: Request):
    """Unnamed faces seen while a visitor was around: `windows` are
    [start, end] ms ranges (the dashboard sends their Wi-Fi visits, padded).
    Each comes with `sim`, its best likeness to the subject's confirmed
    faces (null when there are none yet); best first. Faces someone already
    said aren't this subject are left out."""
    await require_ha_token(request)
    body = await request.json()
    subject = body.get("subject")
    windows = [(int(a), int(b)) for a, b in (body.get("windows") or [])][:500]
    if not isinstance(subject, str) or not subject or not windows:
        return []
    clause = " or ".join(["(t between ? and ?)"] * len(windows))
    params = [v for w in windows for v in w]
    with db_lock:
        rows = db.execute(
            f"select * from faces where subject is null and camera != 'upload' and ({clause})"
            " and id not in (select face_id from rejections where subject = ?)",
            (*params, subject),
        ).fetchall()
        mine = db.execute("select emb from faces where subject = ? and label = 'confirmed'", (subject,)).fetchall()
    if not rows:
        return []
    sims = [None] * len(rows)
    if mine:
        M = np.stack([np.frombuffer(r["emb"], dtype=np.float32) for r in mine])
        E = np.stack([np.frombuffer(r["emb"], dtype=np.float32) for r in rows])
        sims = (E @ M.T).max(axis=1).tolist()
    out = [{**face_json(r), "sim": None if s is None else round(float(s), 3)} for r, s in zip(rows, sims)]
    out.sort(key=lambda f: (f["sim"] if f["sim"] is not None else -1, f["t"]), reverse=True)
    return out[: int(body.get("limit", 60))]


@app.post("/reject")
async def reject(request: Request):
    """Mark faces as not this subject: they're taken off them (matched or
    confirmed), stop being suggested for them, and re-matching never gives
    them back to this subject (it may still match someone else)."""
    await require_ha_token(request)
    body = await request.json()
    subject = body.get("subject")
    ids = [int(i) for i in body.get("ids", [])][:1000]
    if not isinstance(subject, str) or not subject:
        raise HTTPException(400, "subject required")
    with db_lock:
        db.executemany("insert or ignore into rejections(subject, face_id) values (?, ?)", [(subject, i) for i in ids])
        db.executemany(
            "update faces set subject = null, label = null, score = 0 where id = ? and subject = ?",
            [(i, subject) for i in ids],
        )
        if ids:  # their profile picture falls back to the latest face
            db.execute("delete from avatars where subject = ? and face_id in (%s)" % ",".join("?" * len(ids)), (subject, *ids))
        db.commit()
    await asyncio.to_thread(rematch_all)
    return {"ok": True}


@app.post("/avatar")
async def set_avatar(request: Request):
    """Choose (id) or clear (id null) a subject's profile picture."""
    await require_ha_token(request)
    body = await request.json()
    subject, face_id = body.get("subject"), body.get("id")
    if not isinstance(subject, str) or not subject:
        raise HTTPException(400, "subject required")
    with db_lock:
        if face_id is None:
            db.execute("delete from avatars where subject = ?", (subject,))
        else:
            if not db.execute("select 1 from faces where id = ? and subject = ?", (int(face_id), subject)).fetchone():
                raise HTTPException(400, "that face isn't theirs")
            db.execute("insert or replace into avatars(subject, face_id) values (?, ?)", (subject, int(face_id)))
        db.commit()
    return {"ok": True}


@app.get("/faces")
async def faces(request: Request, subject: str, limit: int = 60, offset: int = 0):
    await require_ha_token(request)
    with db_lock:
        rows = db.execute(
            "select * from faces where subject = ? order by t desc limit ? offset ?", (subject, limit, offset)
        ).fetchall()
    return [face_json(r) for r in rows]


@app.get("/sightings")
async def sightings(request: Request, since: int = 0):
    await require_ha_token(request)
    with db_lock:
        rows = db.execute(
            "select t, camera, subject, label, score from faces where subject is not null"
            " and subject != 'ignore' and t >= ? order by t desc limit 500",
            (since,),
        ).fetchall()
    return [dict(r) for r in rows]


@app.post("/assign")
async def assign(request: Request):
    await require_ha_token(request)
    body = await request.json()
    ids = [int(i) for i in body.get("ids", [])][:5000]
    subject = body.get("subject")
    if subject is not None and (not isinstance(subject, str) or not subject.strip() or len(subject) > 80):
        raise HTTPException(400, "bad subject")
    with db_lock:
        db.executemany(
            "update faces set subject = ?, label = ?, score = 1 where id = ?",
            [(subject, "confirmed" if subject else None, i) for i in ids],
        )
        db.commit()
    await asyncio.to_thread(rematch_all)
    return {"ok": True, "updated": len(ids)}


@app.post("/enroll")
async def enroll(request: Request):
    await require_ha_token(request)
    if model is None:
        raise HTTPException(503, "model not ready")
    body = await request.json()
    subject, image = body.get("subject"), body.get("image", "")
    if not isinstance(subject, str) or not subject.strip():
        raise HTTPException(400, "subject required")
    raw = base64.b64decode(image.split(",", 1)[-1])
    if len(raw) > 15_000_000:
        raise HTTPException(413, "image too large")
    img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "not an image")
    side = max(img.shape[:2])
    if side > 1920:
        s = 1920 / side
        img = cv2.resize(img, (int(img.shape[1] * s), int(img.shape[0] * s)))
    found = await asyncio.to_thread(face_crops, img)
    if not found:
        raise HTTPException(422, "no clear face found in that photo")
    det, size, yaw, emb, jpg = max(found, key=lambda f: f[0] * f[1])  # the main face
    with db_lock:
        cur = db.execute(
            "insert into faces(camera, t, kind, det, size, yaw, emb, crop, subject, label, score, created)"
            " values ('upload', ?, 'upload', ?, ?, ?, ?, ?, ?, 'confirmed', 1, ?)",
            (now_ms(), det, size, yaw, emb.tobytes(), jpg, subject, now_ms()),
        )
        db.commit()
    await asyncio.to_thread(rematch_all)
    return {"ok": True, "id": cur.lastrowid, "faces_in_photo": len(found)}


# ------------------------------------------------------------- backfill CLI


def backfill(path: str):
    """Queue past detections: a JSON list of {camera, t (ms), kind}. Kinds
    other than person / ring are refused, so nothing else gets in."""
    items = json.load(open(path))
    added = 0
    for it in items:
        if it.get("kind") not in ("person", "ring"):
            continue
        added += enqueue_detection(it["camera"], int(it["t"]), it["kind"], prio=0)
    print(f"queued {added} frames for {len(items)} detections")


if __name__ == "__main__" and len(sys.argv) == 3 and sys.argv[1] == "backfill":
    backfill(sys.argv[2])
