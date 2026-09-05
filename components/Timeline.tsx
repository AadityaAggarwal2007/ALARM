"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { categoryMeta } from "@/lib/categories";
import { dateKey, minutesOfDay, parseDateKey } from "@/lib/time";
import type { Task } from "@/lib/types";

const HOUR_PX = 56;
/** Blocks land on 5-minute boundaries — fine enough to be useful, coarse
 *  enough that a thumb on a phone can hit it. */
const SNAP_MIN = 5;
const MIN_DURATION_MIN = 15;
/** Below this much movement a pointer gesture is a tap, not a drag. */
const DRAG_THRESHOLD_PX = 4;

type DragState = {
  id: number;
  mode: "move" | "resize";
  pointerY: number;
  origStart: number;
  origEnd: number;
  startMin: number;
  endMin: number;
  moved: boolean;
};

const snap = (min: number) => Math.round(min / SNAP_MIN) * SNAP_MIN;
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

function fmtMin(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function Timeline({
  tasks,
  day,
  now,
  onOpen,
  onCommit,
}: {
  tasks: Task[];
  day: string;
  now: number;
  onOpen: (t: Task) => void;
  /** Persist a moved or resized block. */
  onCommit: (id: number, startMin: number, endMin: number) => void;
}) {
  const isToday = day === dateKey();
  const nowMin = minutesOfDay(new Date(now));
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  const begin = useCallback(
    (
      event: React.PointerEvent,
      task: Task,
      mode: "move" | "resize"
    ) => {
      // Let the browser keep native scrolling for a two-finger gesture.
      if (!event.isPrimary) return;
      event.preventDefault();
      event.stopPropagation();
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);

      const start = minutesOfDay(new Date(task.startTime));
      const rawEnd = minutesOfDay(new Date(task.endTime));
      // An end at or before the start means the block runs past midnight;
      // work in a flat 0..1440+ scale so the arithmetic stays simple.
      const end = rawEnd <= start ? rawEnd + 1440 : rawEnd;

      setDrag({
        id: task.id,
        mode,
        pointerY: event.clientY,
        origStart: start,
        origEnd: end,
        startMin: start,
        endMin: end,
        moved: false,
      });
    },
    []
  );

  // Tracked on window so a fast drag that leaves the block still follows the
  // pointer, and so releasing outside the timeline still commits.
  useEffect(() => {
    if (!drag) return;

    const onMove = (event: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dy = event.clientY - d.pointerY;
      const deltaMin = (dy / HOUR_PX) * 60;
      const moved = d.moved || Math.abs(dy) > DRAG_THRESHOLD_PX;

      if (d.mode === "move") {
        const span = d.origEnd - d.origStart;
        const startMin = clamp(snap(d.origStart + deltaMin), 0, 1440 - span);
        setDrag({ ...d, startMin, endMin: startMin + span, moved });
      } else {
        const endMin = clamp(
          snap(d.origEnd + deltaMin),
          d.origStart + MIN_DURATION_MIN,
          1440
        );
        setDrag({ ...d, endMin, moved });
      }
    };

    const onUp = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;

      if (!d.moved) {
        // A tap, not a drag. Resize handles do not open the editor.
        if (d.mode === "move") {
          const task = tasks.find((t) => t.id === d.id);
          if (task) onOpen(task);
        }
        return;
      }
      if (d.startMin !== d.origStart || d.endMin !== d.origEnd) {
        onCommit(d.id, d.startMin, d.endMin);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag, tasks, onOpen, onCommit]);

  return (
    <div
      className={`timeline${drag ? " dragging" : ""}`}
      style={{ height: 24 * HOUR_PX }}
    >
      {Array.from({ length: 24 }, (_, h) => (
        <div key={h} className="tl-hour" style={{ top: h * HOUR_PX }}>
          <span>{String(h).padStart(2, "0")}</span>
        </div>
      ))}

      {isToday && (
        <div className="tl-now" style={{ top: (nowMin / 60) * HOUR_PX }} />
      )}

      {tasks.map((task) => {
        const active = drag?.id === task.id ? drag : null;

        const rawStart = minutesOfDay(new Date(task.startTime));
        const rawEnd = minutesOfDay(new Date(task.endTime));
        const startMin = active
          ? active.startMin
          : rawStart;
        const endMin = active
          ? active.endMin
          : rawEnd <= rawStart
            ? rawEnd + 1440
            : rawEnd;

        const mins = Math.max(MIN_DURATION_MIN, endMin - startMin);
        const meta = categoryMeta(task.mainCategory);

        return (
          <div
            key={task.id}
            className={`tl-block${active ? " active" : ""}`}
            style={{
              top: (startMin / 60) * HOUR_PX,
              height: (mins / 60) * HOUR_PX - 2,
              background: `${meta.color}22`,
              borderLeftColor: meta.color,
            }}
            onPointerDown={(e) => begin(e, task, "move")}
          >
            <span className="tl-label">
              {meta.icon} {task.note || meta.label}
            </span>
            {task.enforce && <span className="tl-enforce">!</span>}

            {active?.moved && (
              <span className="tl-ghost">
                {fmtMin(startMin)} – {fmtMin(endMin % 1440)}
              </span>
            )}

            <span
              className="tl-handle"
              onPointerDown={(e) => begin(e, task, "resize")}
              aria-hidden
            />
          </div>
        );
      })}
    </div>
  );
}

/** Convert minutes-since-midnight back to an ISO timestamp on `day`. */
export function minutesToISO(day: string, min: number): string {
  const d = parseDateKey(day);
  d.setMinutes(d.getMinutes() + min);
  return d.toISOString();
}
