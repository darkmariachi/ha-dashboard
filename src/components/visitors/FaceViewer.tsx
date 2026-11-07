import { Download, Film, Loader2, Play, Trash2, VideoOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useHa } from "../../ha/HaProvider";
import { camLabel, clipPath, framePath, type Face } from "../../lib/faces";
import { SignedImg } from "../home/ActivityFeed";
import { Sheet } from "../home/Sheet";

/** The Protect recording around a face, played in place of the still. */
function FaceClip({ face, className }: { face: Face; className?: string }) {
  const { signPath } = useHa();
  const path = clipPath(face);
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    signPath(path, 600)
      .then((url) => !cancelled && setSrc(url))
      .catch(() => !cancelled && setState("failed"));
    return () => {
      cancelled = true;
    };
  }, [path, signPath]);

  if (state === "failed") {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 bg-black/40 text-center text-sm text-white/70 ${className ?? ""}`}>
        <VideoOff size={22} />
        No recording for this moment (Protect may have already deleted it).
      </div>
    );
  }
  return (
    <div className={`relative bg-black ${className ?? ""}`}>
      {src && (
        <video
          src={src}
          controls
          autoPlay
          muted
          playsInline
          onCanPlay={() => setState("ready")}
          onError={() => setState("failed")}
          className="h-full w-full object-contain"
        />
      )}
      {state === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/70">
          <Loader2 size={18} className="animate-spin" /> Loading the clip from Protect…
        </div>
      )}
      {src && state === "ready" && (
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          download={`${camLabel(face.camera)} ${new Date(face.t).toISOString().slice(0, 19).replace("T", " ")}.mp4`}
          className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white hover:bg-black/80"
        >
          <Download size={12} /> Save
        </a>
      )}
    </div>
  );
}

/**
 * A face up close: the full camera frame it was cut from (fetched from
 * Protect through HA at that moment) and the crop itself, larger. `children`
 * are the actions for wherever it was opened from. Used by every layout;
 * the Sheet picks up the light / night / desktop theme from its root.
 */
export function FaceViewer({
  face,
  detail,
  onClose,
  children,
}: {
  face: Face;
  detail?: React.ReactNode;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const frame = framePath(face);
  const [playing, setPlaying] = useState(false);
  const when = new Date(face.t).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
  return (
    <Sheet title={face.camera === "upload" ? "Uploaded photo" : camLabel(face.camera)} subtitle={when} onClose={onClose}>
      {frame && playing ? (
        <FaceClip face={face} className="aspect-[4/3] w-full overflow-hidden rounded-2xl" />
      ) : frame ? (
        <button onClick={() => setPlaying(true)} className="group relative block w-full" title="Play the recording around this moment">
          <SignedImg path={frame} className="aspect-[4/3] w-full rounded-2xl object-contain" />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm font-semibold text-white backdrop-blur-sm transition-transform group-hover:scale-105">
              <Play size={16} fill="currentColor" /> Play clip
            </span>
          </span>
        </button>
      ) : null}
      <div className="flex items-center gap-3">
        <img src={face.crop} alt="" className="h-24 w-24 shrink-0 rounded-2xl object-cover" />
        <div className="min-w-0 flex-1 text-[13px] text-text-dim">
          {detail}
          <div>
            Face {face.size}px wide · detector {Math.round(face.det * 100)}%
          </div>
          {face.camera !== "upload" && (
            <div className="flex items-center gap-1 text-xs">
              <Film size={12} /> {playing ? "Recording from 4 s before to 12 s after the sighting." : "Tap the picture to play the recording."}
            </div>
          )}
        </div>
      </div>
      {children && <div className="flex flex-wrap gap-2 pb-1">{children}</div>}
    </Sheet>
  );
}

/** "Delete this face?" — removes a bad capture from the face library. */
export function DeleteFaceSheet({ face, onConfirm, onClose }: { face: Face; onConfirm: () => void; onClose: () => void }) {
  return (
    <Sheet title="Delete this face?" subtitle="It's removed from the face library. The camera recording isn't affected." onClose={onClose}>
      <div className="flex items-center gap-3">
        <img src={face.crop} alt="" className="h-20 w-20 shrink-0 rounded-2xl object-cover" />
        <p className="text-sm text-text-dim">
          For bad captures: blurry, dark, or not really a face. Unlike Ignore, it doesn't affect how other faces are matched.
        </p>
      </div>
      <div className="flex gap-2 pb-1">
        <button onClick={onClose} className="flex-1 rounded-full bg-chip py-3 text-sm font-semibold text-text active:scale-95">
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold text-white active:scale-95"
          style={{ background: "#d14d5b" }}
        >
          <Trash2 size={16} /> Delete
        </button>
      </div>
    </Sheet>
  );
}
