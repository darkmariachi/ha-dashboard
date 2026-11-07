import { token } from "./push";
import { visitsOf, type VisitLog } from "./visitors";

// Client for the face recognition service (faces/app.py), proxied by nginx
// at /api/faces/. Every call carries the signed-in HA token.
//
// Subjects are plain strings: a visitor id from the visit log,
// "household:<name>", or "ignore".

export interface Face {
  id: number;
  t: number;
  camera: string;
  kind: string;
  subject: string | null;
  /** "confirmed" (someone said so, or uploaded it), "auto" (matched), or null. */
  label: "confirmed" | "auto" | null;
  score: number;
  det: number;
  size: number;
  /** data: URL of the face crop. */
  crop: string;
}

export interface FaceCluster {
  /** Every face in the cluster (faces holds only the best few). */
  ids: number[];
  times: number[];
  cameras: string[];
  faces: Face[];
}

export interface FaceSubject {
  subject: string;
  n: number;
  confirmed: number;
  last: number;
  sample: string | null;
}

export interface FaceStatus {
  model: string;
  queue: Record<string, number>;
  faces: { n: number; unknown: number | null; confirmed: number | null; auto: number | null; first: number | null; last: number | null };
  processing: string | null;
}

export interface Sighting {
  t: number;
  camera: string;
  subject: string;
  label: "confirmed" | "auto";
  score: number;
}

export const IGNORE = "ignore";
export const HOUSEHOLD = "household:";

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/faces/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token()}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export const faceStatus = () => call<FaceStatus>("status");
export const faceClusters = (limit = 40) => call<FaceCluster[]>(`clusters?limit=${limit}&samples=8`);
export const faceSubjects = () => call<FaceSubject[]>("subjects");
export const facesOf = (subject: string, limit = 60) => call<Face[]>(`faces?subject=${encodeURIComponent(subject)}&limit=${limit}`);
export const faceSightings = (since: number) => call<Sighting[]>(`sightings?since=${since}`);
export const assignFaces = (ids: number[], subject: string | null) => call<{ ok: true }>("assign", { ids, subject });
export const enrollFace = (subject: string, image: string) => call<{ ok: true; faces_in_photo: number }>("enroll", { subject, image });

/** "household:Andy" -> "Andy"; visitor ids are resolved by the caller. */
export function householdName(subject: string) {
  return subject.startsWith(HOUSEHOLD) ? subject.slice(HOUSEHOLD.length) : null;
}

/** Display name for a subject string. */
export function subjectName(subject: string | null, log: VisitLog | null) {
  if (!subject) return null;
  if (subject === IGNORE) return "Ignored";
  return householdName(subject) ?? log?.people.find((p) => p.id === subject)?.name ?? subject;
}

const CAMERA_LABEL: Record<string, string> = {
  "camera.g4_doorbell_pro_medium": "Front door",
  "camera.driveway_medium": "Driveway",
  upload: "Uploaded",
};
export const camLabel = (c: string) => CAMERA_LABEL[c] ?? c;

/** A visitor phone on the Wi-Fi around a face's time counts as a hint: from
 * 20 min before it joined (they're at the door first) to 5 min after it
 * left. */
const BEFORE_JOIN = 20 * 60_000;
const AFTER_LEAVE = 5 * 60_000;

/** The visitor whose phone was on the Wi-Fi for most of a cluster's
 * sightings, if it's convincing (at least 2, and 40 % of them). */
export function suggestFor(cluster: FaceCluster, log: VisitLog, now: number) {
  let best: { id: string; name: string; hits: number } | null = null;
  for (const p of log.people) {
    const visits = visitsOf(p.devices, log.sessions);
    const hits = cluster.times.filter((t) => visits.some((v) => t >= v.start - BEFORE_JOIN && t <= (v.end ?? now) + AFTER_LEAVE)).length;
    if (hits > (best?.hits ?? 0)) best = { id: p.id, name: p.name, hits };
  }
  if (!best || best.hits < Math.max(2, Math.ceil(cluster.times.length * 0.4))) return null;
  return best;
}

/** A picked photo as a JPEG data URL, downscaled (phones shoot 12 MP+). */
export function readScaled(file: File, max = 1600): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => reject(new Error("Couldn't read that image"));
    img.src = URL.createObjectURL(file);
  });
}

/** Upload up to 10 reference photos for a subject; a one-line summary. */
export async function uploadPhotos(subject: string, files: FileList | File[]) {
  let ok = 0;
  const errors: string[] = [];
  for (const f of [...files].slice(0, 10)) {
    try {
      await enrollFace(subject, await readScaled(f));
      ok++;
    } catch (e) {
      errors.push(`${f.name}: ${(e as Error).message}`);
    }
  }
  return [ok ? `Added ${ok} reference ${ok === 1 ? "photo" : "photos"}.` : "", ...errors].filter(Boolean).join(" ");
}
