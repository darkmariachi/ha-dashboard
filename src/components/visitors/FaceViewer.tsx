import { Trash2 } from "lucide-react";
import { camLabel, framePath, type Face } from "../../lib/faces";
import { SignedImg } from "../home/ActivityFeed";
import { Sheet } from "../home/Sheet";

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
  const when = new Date(face.t).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
  return (
    <Sheet title={face.camera === "upload" ? "Uploaded photo" : camLabel(face.camera)} subtitle={when} onClose={onClose}>
      {frame ? (
        <SignedImg path={frame} className="aspect-[4/3] w-full rounded-2xl object-contain" />
      ) : null}
      <div className="flex items-center gap-3">
        <img src={face.crop} alt="" className="h-24 w-24 shrink-0 rounded-2xl object-cover" />
        <div className="min-w-0 flex-1 text-[13px] text-text-dim">
          {detail}
          <div>
            Face {face.size}px wide · detector {Math.round(face.det * 100)}%
          </div>
          {face.camera !== "upload" && <div className="text-xs">The full frame is the camera's picture 1 s after the detection.</div>}
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
