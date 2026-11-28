import clsx from "clsx";
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, ChevronsDownUp, ChevronsUpDown, GripVertical, Pencil, RotateCcw } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { arrange, setEditingLayout, setLayout, useEditingLayout, useLayout } from "../../lib/layout";

export interface CardItem {
  /** Stable id, saved in the layout. */
  id: string;
  /** Shown on the collapsed bar and in edit mode. */
  label: string;
  node: ReactNode;
  /** Classes for the card's slot in the container (e.g. col-span-2). */
  className?: string;
}

/** True while the element renders nothing (a card that's hidden right now,
 * like the grill card between cooks). */
function useIsEmpty(ref: React.RefObject<HTMLElement | null>) {
  const [empty, setEmpty] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setEmpty(el.childElementCount === 0);
    check();
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true });
    return () => mo.disconnect();
  }, [ref]);
  return empty;
}

function Slot({
  item,
  collapsed,
  onToggle,
}: {
  item: CardItem;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const empty = useIsEmpty(ref);
  return (
    // A one-cell grid, so the card stretches to its row like it did before
    // it had a wrapper (side-by-side tiles stay the same height).
    <div className={clsx("group/slot relative grid min-w-0 grid-cols-[minmax(0,1fr)]", item.className, empty && "hidden")}>
      {collapsed && (
        <button
          onClick={onToggle}
          aria-expanded={false}
          className="glass rise flex min-h-12 items-center gap-2 rounded-[22px] px-5 py-3 text-left text-[15px] font-semibold text-text active:scale-[0.99]"
        >
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          <ChevronDown size={18} className="shrink-0 text-text-dim" />
        </button>
      )}
      <div ref={ref} className={collapsed ? "hidden" : "contents"}>
        {item.node}
      </div>
      {!collapsed && (
        <button
          onClick={onToggle}
          aria-expanded
          aria-label={`Collapse ${item.label}`}
          title={`Collapse ${item.label}`}
          className="glass absolute left-1/2 top-0 z-10 flex h-5 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-text-dim opacity-70 transition-opacity hover:opacity-100 active:scale-95"
        >
          <ChevronUp size={14} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

/** Mounts the card out of sight, just to learn whether it's showing now. */
function Probe({ node, onEmpty }: { node: ReactNode; onEmpty: (empty: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const empty = useIsEmpty(ref);
  useLayoutEffect(() => onEmpty(empty), [empty, onEmpty]);
  return (
    <div ref={ref} className="hidden">
      {node}
    </div>
  );
}

function EditList({
  layoutKey,
  items,
  order,
  collapsed,
  className,
}: {
  layoutKey: string;
  items: CardItem[];
  order: string[];
  collapsed: Set<string>;
  className?: string;
}) {
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [hiddenNow, setHiddenNow] = useState<Record<string, boolean>>({});
  const rows = useRef(new Map<string, HTMLDivElement>());
  const shown = draft ?? order;

  const save = (o: string[], c: Set<string>) =>
    setLayout(layoutKey, { order: o, collapsed: [...c].filter((id) => byId.has(id)) });

  function move(id: string, by: number) {
    const i = shown.indexOf(id);
    const j = i + by;
    if (j < 0 || j >= shown.length) return;
    const next = [...shown];
    [next[i], next[j]] = [next[j], next[i]];
    navigator.vibrate?.(6);
    save(next, collapsed);
  }

  function toggle(id: string) {
    const c = new Set(collapsed);
    if (c.has(id)) c.delete(id);
    else c.add(id);
    save(shown, c);
  }

  function onPointerDown(e: React.PointerEvent, id: string) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(id);
    setDraft(shown);
    navigator.vibrate?.(10);
  }

  function onPointerMove(e: React.PointerEvent, id: string) {
    if (dragging !== id || !draft) return;
    const i = draft.indexOf(id);
    // Swap with a neighbour once the finger passes its middle.
    const prev = draft[i - 1] && rows.current.get(draft[i - 1])?.getBoundingClientRect();
    const next = draft[i + 1] && rows.current.get(draft[i + 1])?.getBoundingClientRect();
    let to = i;
    if (prev && e.clientY < prev.top + prev.height / 2) to = i - 1;
    else if (next && e.clientY > next.top + next.height / 2) to = i + 1;
    if (to === i) return;
    const d = [...draft];
    [d[i], d[to]] = [d[to], d[i]];
    setDraft(d);
    navigator.vibrate?.(4);
  }

  function onPointerUp() {
    if (draft && draft.join() !== order.join()) save(draft, collapsed);
    setDraft(null);
    setDragging(null);
  }

  return (
    <div className={clsx("flex flex-col gap-2", className)}>
      {shown.map((id, i) => {
        const item = byId.get(id);
        if (!item) return null;
        const isCollapsed = collapsed.has(id);
        return (
          <div
            key={id}
            ref={(el) => {
              if (el) rows.current.set(id, el);
              else rows.current.delete(id);
            }}
            className={clsx(
              "glass flex items-center gap-1 rounded-[20px] py-1.5 pl-1 pr-1.5 transition-shadow",
              dragging === id && "z-10 scale-[1.02] ring-2 ring-accent",
            )}
          >
            <Probe node={item.node} onEmpty={(empty) => setHiddenNow((h) => (h[id] === empty ? h : { ...h, [id]: empty }))} />
            <button
              aria-label={`Drag ${item.label}`}
              onPointerDown={(e) => onPointerDown(e, id)}
              onPointerMove={(e) => onPointerMove(e, id)}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className="flex h-10 w-9 shrink-0 cursor-grab touch-none items-center justify-center text-text-dim active:cursor-grabbing"
            >
              <GripVertical size={20} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold text-text">{item.label}</div>
              {(hiddenNow[id] || isCollapsed) && (
                <div className="truncate text-xs text-text-dim">
                  {[isCollapsed && "Collapsed", hiddenNow[id] && "Not showing right now"].filter(Boolean).join(" · ")}
                </div>
              )}
            </div>
            <button
              onClick={() => toggle(id)}
              aria-label={isCollapsed ? `Expand ${item.label}` : `Collapse ${item.label}`}
              className={clsx(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                isCollapsed ? "bg-[var(--chip-off)] text-text" : "text-text-dim",
              )}
            >
              {isCollapsed ? <ChevronsUpDown size={18} /> : <ChevronsDownUp size={18} />}
            </button>
            <button
              onClick={() => move(id, -1)}
              disabled={i === 0}
              aria-label={`Move ${item.label} up`}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-text-dim disabled:opacity-30"
            >
              <ArrowUp size={18} />
            </button>
            <button
              onClick={() => move(id, 1)}
              disabled={i === shown.length - 1}
              aria-label={`Move ${item.label} down`}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-text-dim disabled:opacity-30"
            >
              <ArrowDown size={18} />
            </button>
          </div>
        );
      })}
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => setLayout(layoutKey, null)}
          className="glass flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold text-text active:scale-[0.98]"
        >
          <RotateCcw size={16} /> Reset to default
        </button>
        <button
          onClick={() => setEditingLayout(false)}
          className="flex flex-1 items-center justify-center rounded-full bg-accent py-3 text-sm font-semibold text-white active:scale-[0.98]"
        >
          Done
        </button>
      </div>
    </div>
  );
}

/**
 * A tab's cards in the order the person picked, each collapsible to a
 * one-line bar. The order and collapsed cards are saved per `layoutKey`
 * and shared by every device (lib/layout.ts). While edit mode is on
 * (EditLayoutButton), the cards turn into a list to drag or nudge around.
 * Cards that render nothing right now (the grill between cooks) keep their
 * place and simply don't show.
 */
export function CardLayout({
  layoutKey,
  items,
  className,
  editClassName,
}: {
  layoutKey: string;
  items: CardItem[];
  className?: string;
  /** Classes for the edit-mode list (e.g. to span a parent grid). */
  editClassName?: string;
}) {
  const layout = useLayout(layoutKey);
  const editing = useEditingLayout();
  const ids = items.map((i) => i.id);
  const order = arrange(ids, layout.order);
  const collapsed = new Set(layout.collapsed);
  const byId = new Map(items.map((i) => [i.id, i]));

  if (editing) return <EditList layoutKey={layoutKey} items={items} order={order} collapsed={collapsed} className={editClassName} />;

  return (
    <div className={className}>
      {order.map((id) => {
        const item = byId.get(id)!;
        return (
          <Slot
            key={id}
            item={item}
            collapsed={collapsed.has(id)}
            onToggle={() => {
              const c = new Set(collapsed);
              if (c.has(id)) c.delete(id);
              else c.add(id);
              navigator.vibrate?.(6);
              setLayout(layoutKey, { order: layout.order, collapsed: [...c].filter((x) => byId.has(x)) });
            }}
          />
        );
      })}
    </div>
  );
}

/** Turns the tab's edit mode on (and off). */
export function EditLayoutButton({ className }: { className?: string }) {
  const editing = useEditingLayout();
  if (editing) return null;
  return (
    <button
      onClick={() => {
        navigator.vibrate?.(8);
        setEditingLayout(true);
      }}
      aria-label="Rearrange cards"
      title="Rearrange cards"
      className={clsx(
        "glass flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold text-text active:scale-95",
        className,
      )}
    >
      <Pencil size={14} /> Edit
    </button>
  );
}
