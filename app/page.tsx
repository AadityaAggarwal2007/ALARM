"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TaskEditor, {
  blankValue,
  taskToValue,
  type EditorValue,
} from "@/components/TaskEditor";
import Timeline, { minutesToISO } from "@/components/Timeline";
import { categoryMeta } from "@/lib/categories";
import {
  addDays,
  dateKey,
  fmtDayLabel,
  fmtDuration,
  fmtTime,
  hhmmToDate,
} from "@/lib/time";
import type { Category, Task } from "@/lib/types";

type View = "AGENDA" | "TIMELINE";

export default function TodayPage() {
  const [day, setDay] = useState(() => dateKey());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<View>("AGENDA");
  const [compact, setCompact] = useState(false);
  const [draft, setDraft] = useState<EditorValue | null>(null);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (key: string) => {
    const [t, c] = await Promise.all([
      fetch(`/api/tasks?date=${key}`).then((r) => (r.ok ? r.json() : [])),
      fetch("/api/categories").then((r) => (r.ok ? r.json() : [])),
    ]);
    setTasks(t);
    setCategories(c);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load(day);
  }, [day, load]);

  // The ring overlay fires this when a block is dismissed, so the day's list
  // reflects the new discipline record without a manual refresh.
  useEffect(() => {
    const refresh = () => load(day);
    window.addEventListener("discipline:changed", refresh);
    return () => window.removeEventListener("discipline:changed", refresh);
  }, [day, load]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const strip = useMemo(
    () => Array.from({ length: 15 }, (_, i) => addDays(dateKey(), i - 7)),
    []
  );

  // The strip starts a week in the past, so without this you land on last
  // Sunday instead of today.
  const stripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>(".date-chip.active");
    el?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [day]);

  const totalMs = tasks.reduce(
    (s, t) => s + (new Date(t.endTime).getTime() - new Date(t.startTime).getTime()),
    0
  );

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    const startDate = hhmmToDate(draft.start, draft.date);
    const endDate = hhmmToDate(draft.end, draft.date);
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...draft,
        startTime: startDate.toISOString(),
        endTime: endDate.toISOString(),
      }),
    });
    setSaving(false);
    if (res.ok) {
      setDraft(null);
      load(draft.date === day ? day : draft.date);
      if (draft.date !== day) setDay(draft.date);
    }
  };

  const remove = async () => {
    if (!draft?.id) return;
    await fetch(`/api/tasks?id=${draft.id}`, { method: "DELETE" });
    setDraft(null);
    load(day);
  };

  // Drag-to-move and resize on the timeline land here. The block is written
  // optimistically so it does not snap back to its old position while the
  // request is in flight, then reconciled from the server response.
  const moveOrResize = useCallback(
    async (id: number, startMin: number, endMin: number) => {
      const startTime = minutesToISO(day, startMin);
      const endTime = minutesToISO(day, endMin);

      setTasks((list) =>
        list.map((t) => (t.id === id ? { ...t, startTime, endTime } : t))
      );

      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, startTime, endTime }),
      });
      if (!res.ok) load(day);
    },
    [day, load]
  );

  const toggleComplete = async (task: Task) => {
    await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task.id, isCompleted: !task.isCompleted }),
    });
    load(day);
  };

  if (draft) {
    return (
      <TaskEditor
        title={draft.id ? "Edit block" : "New block"}
        value={draft}
        categories={categories}
        onChange={setDraft}
        onSave={save}
        onCancel={() => setDraft(null)}
        onDelete={draft.id ? remove : undefined}
        saving={saving}
      />
    );
  }

  return (
    <main className="shell">
      <header className="page-head">
        <div>
          <h1>{fmtDayLabel(day)}</h1>
          <p className="sub">
            {tasks.length
              ? `${tasks.length} block${tasks.length > 1 ? "s" : ""} · ${fmtDuration(totalMs)} scheduled`
              : "Nothing scheduled."}
          </p>
        </div>
        <a className="icon-btn" href="/settings" aria-label="Settings">
          ⚙
        </a>
      </header>

      <div className="date-strip" ref={stripRef}>
        {strip.map((key) => (
          <button
            key={key}
            className={`date-chip${key === day ? " active" : ""}`}
            onClick={() => setDay(key)}
          >
            <span className="dc-dow">
              {new Date(key).toLocaleDateString([], { weekday: "short" })}
            </span>
            <span className="dc-day">{Number(key.slice(8))}</span>
          </button>
        ))}
      </div>

      <div className="segmented">
        <button aria-pressed={view === "AGENDA"} onClick={() => setView("AGENDA")}>
          Agenda
        </button>
        <button
          aria-pressed={view === "TIMELINE"}
          onClick={() => setView("TIMELINE")}
        >
          Timeline
        </button>
      </div>

      {!loaded && <p className="note">Loading…</p>}

      {loaded && tasks.length === 0 && (
        <div className="card">
          <p className="note">
            No blocks for this day. Add one — and switch on Enforce if it is a
            block you intend to actually keep.
          </p>
        </div>
      )}

      {loaded && view === "AGENDA" && (
        <>
          {tasks.length > 0 && (
            <button
              className="ghost small"
              onClick={() => setCompact((c) => !c)}
            >
              {compact ? "Expanded view" : "Compact view"}
            </button>
          )}
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              compact={compact}
              now={now}
              onOpen={() => setDraft(taskToValue(task))}
              onToggle={() => toggleComplete(task)}
            />
          ))}
        </>
      )}

      {loaded && view === "TIMELINE" && (
        <Timeline
          tasks={tasks}
          day={day}
          now={now}
          onOpen={(t) => setDraft(taskToValue(t))}
          onCommit={moveOrResize}
        />
      )}

      <button
        className="primary"
        onClick={() =>
          setDraft(blankValue(day, categories[0]?.id ?? 1))
        }
        disabled={categories.length === 0}
      >
        Add block
      </button>
    </main>
  );
}

function TaskCard({
  task,
  compact,
  now,
  onOpen,
  onToggle,
}: {
  task: Task;
  compact: boolean;
  now: number;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const meta = categoryMeta(task.mainCategory);
  const start = new Date(task.startTime);
  const end = new Date(task.endTime);
  const live = now >= start.getTime() && now < end.getTime();

  // How the enforcement actually went — the thing a planner alone cannot show.
  let record: string | null = null;
  if (task.enforce) {
    if (task.dismissedAt) {
      const late = new Date(task.dismissedAt).getTime() - start.getTime();
      record =
        late <= 60_000
          ? "Started on time"
          : `Started ${fmtDuration(late)} late`;
    } else if (task.gaveUpAt) {
      record = "Ignored";
    } else if (now > start.getTime()) {
      record = "Waiting for you";
    }
  }

  return (
    <div
      className={`task-card${task.isCompleted ? " done" : ""}${live ? " live" : ""}`}
      style={{ borderLeftColor: meta.color }}
    >
      <button className="task-open" onClick={onOpen}>
        <div className="task-top">
          <span className="task-time">
            {fmtTime(start)} – {fmtTime(end)}
          </span>
          {task.priority !== "STANDARD" && (
            <span className={`prio prio-${task.priority.toLowerCase()}`}>
              {task.priority === "MAX" ? "MAX" : "MED"}
            </span>
          )}
          {task.enforce && <span className="enforce-badge">ENFORCED</span>}
        </div>
        <div className="task-title">
          <span>{meta.icon}</span>
          {task.note || task.subCategory?.name || meta.label}
        </div>
        {!compact && (
          <div className="task-meta">
            {meta.label}
            {task.subCategory ? ` · ${task.subCategory.name}` : ""} ·{" "}
            {fmtDuration(end.getTime() - start.getTime())}
            {record ? ` · ${record}` : ""}
          </div>
        )}
      </button>
      <button
        className={`check-btn${task.isCompleted ? " on" : ""}`}
        onClick={onToggle}
        aria-label={task.isCompleted ? "Mark not done" : "Mark done"}
      >
        ✓
      </button>
    </div>
  );
}

