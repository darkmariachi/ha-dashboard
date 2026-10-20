import type { HaCredentials } from "../ha/connection";

// QR sign-in. A device on the login screen shows a pairing code; a phone
// that's already signed in scans it and hands over a login through the push
// service (/api/push/pair/*). The login is AES-GCM encrypted with a key that
// only travels in the QR's URL fragment, so the relay never sees it.

export interface PairingCode {
  id: string;
  key: string;
}

function toBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string) {
  const padded = (text + "=".repeat((4 - (text.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** WebCrypto only exists on https (or localhost). */
export function pairingSupported() {
  return typeof crypto !== "undefined" && !!crypto.subtle;
}

export function newPairingCode(): PairingCode {
  return {
    id: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
    key: toBase64Url(crypto.getRandomValues(new Uint8Array(32))),
  };
}

export function pairingUrl(code: PairingCode) {
  return `${window.location.origin}/pair#${code.id}.${code.key}`;
}

export function parsePairingHash(hash: string): PairingCode | null {
  const match = /^#?([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(hash);
  return match ? { id: match[1], key: match[2] } : null;
}

function importKey(code: PairingCode) {
  return crypto.subtle.importKey("raw", fromBase64Url(code.key), "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** The relay couldn't be reached or refused the request (as opposed to a
 * login that arrived but couldn't be opened). */
export class RelayError extends Error {}

async function post<T>(path: string, data: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/push/pair/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch (err) {
    throw new RelayError(err instanceof Error ? err.message : String(err));
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new RelayError(err.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** Phone side: leave `creds` for the device showing `code`. `authToken` is
 * this phone's own HA token, which the relay checks before accepting. */
export async function sendLogin(code: PairingCode, creds: HaCredentials, authToken: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await importKey(code),
      new TextEncoder().encode(JSON.stringify(creds)),
    ),
  );
  const blob = new Uint8Array(iv.length + sealed.length);
  blob.set(iv);
  blob.set(sealed, iv.length);
  await post("complete", { id: code.id, token: authToken, blob: toBase64Url(blob) });
}

/** New-device side: resolves to the login once a phone has approved `code`,
 * or null while it's still waiting. */
export async function pollLogin(code: PairingCode): Promise<HaCredentials | null> {
  const { blob } = await post<{ blob: string | null }>("poll", { id: code.id });
  if (!blob) return null;
  const bytes = fromBase64Url(blob);
  const opened = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, 12) },
    await importKey(code),
    bytes.slice(12),
  );
  const creds = JSON.parse(new TextDecoder().decode(opened)) as Partial<HaCredentials>;
  if (typeof creds.hassUrl !== "string" || typeof creds.token !== "string") {
    throw new Error("That sign-in couldn't be read.");
  }
  return { hassUrl: creds.hassUrl, token: creds.token };
}
