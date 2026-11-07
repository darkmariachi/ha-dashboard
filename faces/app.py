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

import cv2
import httpx
import numpy as np
from fastapi import FastAPI, HTTPException, Request

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

MIN_DET = 0.72  # detector confidence
MIN_SIZE = 36  # face box width in px, at 1920 wide
MAX_YAW = 55  # degrees; profiles don't match well
MATCH = 0.42  # cosine similarity to call it the same person
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
    """
)


def now_ms() -> int:
    return int(time.time() * 1000)


def enqueue(camera: str, t: int, kind: str, prio: int) -> bool:
    # Rings and person detections often fire within a second of each other:
    # one frame per camera per 2 s.
    key = f"{camera}|{t // 2000}"
    with db_lock:
        cur = db.execute(
            "insert or ignore into queue(key, camera, t, kind, prio, updated) values (?,?,?,?,?,?)",
            (key, camera, t, kind, prio, now_ms()),
        )
        db.commit()
        return cur.rowcount > 0


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
        E = np.stack([np.frombuffer(r["emb"], dtype=np.float32) for r in rows])
        for r, (subj, score) in zip(rows, best_match(E, C, subjects)):
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
                    if enqueue(camera, t, "ring" if kinds is None else kind, prio=10):
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
    out = []
    for members in sorted(groups.values(), key=len, reverse=True)[:limit]:
        rs = [rows[i] for i in members]  # already best-quality first
        out.append(
            {
                "ids": [r["id"] for r in rs],
                "times": sorted(r["t"] for r in rs),
                "cameras": sorted({r["camera"] for r in rs}),
                "faces": [face_json(r) for r in rs[:samples]],
            }
        )
    return out


@app.get("/subjects")
async def subjects(request: Request):
    await require_ha_token(request)
    with db_lock:
        rows = db.execute(
            "select subject, count(*) n, sum(label = 'confirmed') confirmed, max(t) last from faces"
            " where subject is not null group by subject"
        ).fetchall()
        out = []
        for r in rows:
            best = db.execute(
                "select * from faces where subject = ? order by (label = 'confirmed') desc, det * size desc limit 1",
                (r["subject"],),
            ).fetchone()
            out.append({**dict(r), "sample": face_json(best)["crop"] if best else None})
    return out


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
        added += enqueue(it["camera"], int(it["t"]), it["kind"], prio=0)
    print(f"queued {added} of {len(items)} ({len(items) - added} duplicates or skipped)")


if __name__ == "__main__" and len(sys.argv) == 3 and sys.argv[1] == "backfill":
    backfill(sys.argv[2])
