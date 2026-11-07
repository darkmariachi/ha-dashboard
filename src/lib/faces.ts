import { token } from "./push";

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
