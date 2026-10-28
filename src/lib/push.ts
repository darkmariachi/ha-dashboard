import { loadCredentials } from "../ha/connection";

/** Where this browser stands with push notifications. */
export type PushSupport =
  | "unsupported" // no service worker / Push API at all
  | "needs-install" // iPhone in Safari: push only exists in the Home Screen app
  | "dev" // the service worker only registers in production builds
  | "supported";

export function pushSupport(): PushSupport {
  if (import.meta.env.DEV) return "dev";
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (!("serviceWorker" in navigator)) return "unsupported";
  if (!("PushManager" in window) || !("Notification" in window)) {
    return isIos && !standalone ? "needs-install" : "unsupported";
  }
  return "supported";
}

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function post(path: string, data: unknown) {
  const res = await fetch(`/api/push/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

function token() {
  const creds = loadCredentials();
  if (!creds) throw new Error("Sign in first.");
  return creds.token;
}

export async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** Ask for permission (must be called from a tap), subscribe, and register
 * the subscription with the push service under `person`. */
export async function enablePush(person: string, label: string) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked for this app. Allow them in the phone's settings, then try again."
        : "Notifications weren't allowed.",
    );
  }
  const { publicKey } = (await (await fetch("/api/push/vapid")).json()) as { publicKey: string };
  const reg = await navigator.serviceWorker.ready;
  // Always start fresh: a leftover subscription can be dead (restored from
  // an old phone, or made with a different key), and reusing it means the
  // push service drops it on the first send, every time.
  await (await reg.pushManager.getSubscription())?.unsubscribe().catch(() => {});
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await post("subscribe", { subscription: sub.toJSON(), token: token(), person, label });
  return sub;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await post("unsubscribe", { endpoint: sub.endpoint, token: token() }).catch(() => {});
  await sub.unsubscribe();
}

export async function sendTestPush() {
  const sub = await currentSubscription();
  if (!sub) throw new Error("Notifications aren't on for this phone.");
  return post("test", { endpoint: sub.endpoint, token: token() });
}
