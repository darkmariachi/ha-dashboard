import { Home, Loader2 } from "lucide-react";
import qrcode from "qrcode-generator";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useHa } from "../ha/HaProvider";
import { normalizeHassUrl } from "../ha/connection";
import { newPairingCode, pairingSupported, pairingUrl, pollLogin } from "../lib/pair";

const PAIR_POLL_MS = 2000;
/** A code left on screen is swapped for a fresh one this often. */
const PAIR_ROTATE_MS = 5 * 60_000;

function QrCode({ text }: { text: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    let d = "";
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
      }
    }
    return { size: count, path: d };
  }, [text]);
  // Always black on white with a 4-module quiet zone, whatever the theme —
  // phone cameras struggle with anything else.
  return (
    <svg
      viewBox={`-4 -4 ${size + 8} ${size + 8}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Sign-in QR code"
      className="h-48 w-48 rounded-xl bg-white"
    >
      <path d={path} fill="#000" />
    </svg>
  );
}

export function Login() {
  const { login, status, error } = useHa();
  const { pathname } = useLocation();
  const [hassUrl, setHassUrl] = useState("");
  const [token, setToken] = useState("");
  const connecting = status === "connecting";
  // A phone that scanned a code but isn't signed in itself lands here on
  // /pair; it needs the form, not a code of its own.
  const approving = pathname.startsWith("/pair");
  const [pairing, setPairing] = useState(() =>
    pairingSupported() && !approving ? newPairingCode() : null,
  );

  // Wait for a signed-in phone to approve the code on screen (lib/pair.ts).
  useEffect(() => {
    if (!pairing) return;
    let done = false;
    const poll = setInterval(async () => {
      if (done) return;
      let creds;
      try {
        creds = await pollLogin(pairing);
      } catch {
        return; // relay unreachable; keep trying
      }
      if (!creds || done) return;
      done = true;
      try {
        await login(creds.hassUrl, creds.token);
      } catch {
        // Error is surfaced via context; the code is spent either way.
        setPairing(newPairingCode());
      }
    }, PAIR_POLL_MS);
    const rotate = setTimeout(() => setPairing(newPairingCode()), PAIR_ROTATE_MS);
    return () => {
      done = true;
      clearInterval(poll);
      clearTimeout(rotate);
    };
  }, [pairing, login]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hassUrl.trim() || !token.trim()) return;
    try {
      await login(normalizeHassUrl(hassUrl), token.trim());
    } catch {
      /* error is surfaced via context */
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/20 text-accent">
            <Home size={18} />
          </div>
          <div>
            <div className="text-sm font-semibold text-text">Home Dashboard</div>
            <div className="text-xs text-text-dim">Connect to Home Assistant</div>
          </div>
        </div>

        {approving && (
          <p className="mb-4 text-xs text-text-dim">
            Sign in on this phone first, then you can approve the other device.
          </p>
        )}

        {pairing && (
          <>
            <div className="flex flex-col items-center gap-3">
              <QrCode text={pairingUrl(pairing)} />
              <p className="text-center text-xs text-text-dim">
                Scan with a phone that's already signed in to this dashboard.
              </p>
            </div>
            <div className="my-5 flex items-center gap-3 text-[11px] text-text-dim">
              <div className="h-px flex-1 bg-border" />
              or connect manually
              <div className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-dim">
              Home Assistant URL
            </span>
            <input
              className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent"
              placeholder={
                window.location.protocol === "https:"
                  ? "https://homeassistant.example.com"
                  : "http://192.168.1.50:8123"
              }
              value={hassUrl}
              onChange={(e) => setHassUrl(e.target.value)}
              autoFocus
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-dim">
              Long-lived access token
            </span>
            <input
              className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent"
              type="password"
              placeholder="Paste your token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <span className="text-[11px] text-text-dim">
              Create one from your HA profile → Security → Long-lived access
              tokens.
            </span>
          </label>

          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={connecting}
            className="flex items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {connecting && <Loader2 size={14} className="animate-spin" />}
            {connecting ? "Connecting…" : "Connect"}
          </button>
        </form>
      </div>
    </div>
  );
}
