import { Check, Loader2, MonitorSmartphone } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useHa } from "../ha/HaProvider";
import { loadCredentials } from "../ha/connection";
import { parsePairingHash, sendLogin } from "../lib/pair";

/** Where a phone lands after scanning the QR code on another device's login
 * screen (see Login.tsx). Approving hands that device a login. */
export function PairPage() {
  const { sendMessage } = useHa();
  const { hash } = useLocation();
  const code = parsePairingHash(hash);
  const [name, setName] = useState("Fridge");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [ownToken, setOwnToken] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    const mine = loadCredentials();
    if (!code || !mine) return;
    setState("sending");
    setError(null);
    try {
      // The new device gets a token of its own, so it can be revoked from the
      // HA profile without signing this phone out. HA refuses a duplicate
      // name, hence the timestamp. If HA won't mint one, share this phone's.
      let token = mine.token;
      let shared = true;
      try {
        token = await sendMessage<string>({
          type: "auth/long_lived_access_token",
          client_name: `${name.trim() || "Dashboard"} (${new Date().toLocaleString()})`,
          lifespan: 3650,
        });
        shared = false;
      } catch {
        /* fall back to this phone's token */
      }
      await sendLogin(code, { hassUrl: mine.hassUrl, token }, mine.token);
      setOwnToken(shared);
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign the device in.");
      setState("idle");
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/20 text-accent">
            {state === "done" ? <Check size={18} /> : <MonitorSmartphone size={18} />}
          </div>
          <div>
            <div className="text-sm font-semibold text-text">
              {state === "done" ? "Device signed in" : "Sign in a new device"}
            </div>
            <div className="text-xs text-text-dim">Home Dashboard</div>
          </div>
        </div>

        {!code ? (
          <p className="text-sm text-text-dim">
            This sign-in link isn't valid. Scan the code on the other device again.
          </p>
        ) : state === "done" ? (
          <p className="text-sm text-text-dim">
            It should connect within a few seconds.{" "}
            {ownToken
              ? "It's using the same access token as this phone."
              : "It has its own access token, listed under your Home Assistant profile → Security."}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-dim">
              The device showing the code you just scanned will get full access to this dashboard.
              Only continue if that's your device.
            </p>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-text-dim">Device name</span>
              <input
                className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
              />
            </label>

            {error && (
              <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                {error}
              </div>
            )}

            <button
              onClick={approve}
              disabled={state === "sending"}
              className="flex items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {state === "sending" && <Loader2 size={14} className="animate-spin" />}
              {state === "sending" ? "Signing in…" : "Sign in this device"}
            </button>
          </div>
        )}

        <Link to="/" className="mt-4 block text-center text-xs font-medium text-text-dim hover:text-text">
          {state === "done" ? "Done" : "Cancel"}
        </Link>
      </div>
    </div>
  );
}
