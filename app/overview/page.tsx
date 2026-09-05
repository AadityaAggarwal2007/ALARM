"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { categoryMeta } from "@/lib/categories";
import {
  addDays,
  dateKey,
  fmtDayLabel,
  fmtDuration,
  fmtTime,
  minutesOfDay,
  weekDays,
} from "@/lib/time";
import type { Category, Goal, Task, UndefinedTask } from "@/lib/types";

export default function OverviewPage() {
  const [week, setWeek] = useState(() => dateKey());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selected, setSelected] = useState(() => dateKey());
  const [inbox, setInbox] = useState<UndefinedTask[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [newNote, setNewNote] = useState("");
  const [showGoal, setShowGoal] = useState(false);

  const days = useMemo(() => weekDays(week), [week]);

  const load = useCallback(async () => {
    const [t, u, g, c] = await Promise.all([
      fetch(`/api/tasks?from=${days[0]}&to=${days[6]}`).then((r) =>
        r.ok ? r.json() : []
      ),
      fetch("/api/undefined-tasks").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/goals").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/categories").then((r) => (r.ok ? r.json() : [])),
    ]);
    setTasks(t);
    setInbox(u);
    setGoals(g);
    setCategories(c);
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const dayTasks = tasks.filter((t) => t.date === selected);

  const addInbox = async () => {
    const note = newNote.trim();
    if (!note || categories.length === 0) return;
    setNewNote("");
    await fetch("/api/undefined-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Multi-line paste becomes one task per line — the batch-create path.
      body: JSON.stringify(
        note.includes("\n")
          ? { bulk: note, mainCategoryId: categories[0].id }
          : { note, mainCategoryId: categories[0].id }
      ),
    });
    load();
  };

  const schedule = async (item: UndefinedTask) => {
    const start = new Date();
    start.setMinutes(Math.round(start.getMinutes() / 15) * 15 + 15, 0, 0);
    const end = new Date(start.getTime() + 3600000);
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: selected,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        mainCategoryId: item.mainCategoryId,
        subCategoryId: item.subCategoryId,
        priority: item.priority,
        note: item.note,
        planSource: "UNDEFINED",
      }),
    });
    await fetch(`/api/undefined-tasks?id=${item.id}`, { method: "DELETE" });
    load();
  };

  return (
    <main className="shell">
      <header className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="sub">Week of {fmtDayLabel(days[0])}</p>
        </div>
        <a className="icon-btn" href="/settings" aria-label="Settings">
          ⚙
        </a>
      </header>

      {/* --- Goals --- */}
      <section>
        <div className="row-between">
          <h2 className="sec-title">Goals</h2>
          <button className="ghost small" onClick={() => setShowGoal((v) => !v)}>
            {showGoal ? "Close" : "New goal"}
          </button>
        </div>

        {showGoal && (
          <GoalForm
            categories={categories}
            onDone={() => {
              setShowGoal(false);
              load();
            }}
          />
        )}

        {goals.length === 0 && !showGoal && (
          <p className="note">No goals yet.</p>
        )}

        <div className="hscroll">
          {goals.map((goal) => (
            <div key={goal.id} className="goal-card">
              <div className="goal-top">
                <span className="goal-title">{goal.title}</span>
                <span className={`status s-${goal.status.toLowerCase()}`}>
                  {goal.status.replace("_", " ")}
                </span>
              </div>
              <div className="bar">
                <div
                  className="bar-fill"
                  style={{
                    width: `${Math.min(100, Math.round(goal.progress * 100))}%`,
                  }}
                />
              </div>
              <p className="note">
                {goal.metric === "DURATION"
                  ? `${fmtDuration(goal.actualValue)} of ${fmtDuration(goal.targetValue)}`
                  : `${goal.actualValue} of ${goal.targetValue} blocks`}
                {goal.categoryLabel ? ` · ${goal.categoryLabel}` : ""}
              </p>
              <button
                className="ghost small"
                onClick={async () => {
                  await fetch(`/api/goals?id=${goal.id}`, { method: "DELETE" });
                  load();
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* --- Week timeline --- */}
      <section>
        <div className="row-between">
          <h2 className="sec-title">This week</h2>
          <div className="week-nav">
            <button className="ghost small" onClick={() => setWeek(addDays(week, -7))}>
              ‹
            </button>
            <button className="ghost small" onClick={() => setWeek(dateKey())}>
              Today
            </button>
            <button className="ghost small" onClick={() => setWeek(addDays(week, 7))}>
              ›
            </button>
          </div>
        </div>

        <div className="week-grid">
          {days.map((key) => {
            const dayItems = tasks.filter((t) => t.date === key);
            return (
              <button
                key={key}
                className={`week-col${key === selected ? " active" : ""}`}
                onClick={() => setSelected(key)}
              >
                <span className="wc-dow">
                  {new Date(key).toLocaleDateString([], { weekday: "narrow" })}
                </span>
                <span className="wc-day">{Number(key.slice(8))}</span>
                <span className="wc-track">
                  {dayItems.map((t) => {
                    const start = new Date(t.startTime);
                    const end = new Date(t.endTime);
                    const meta = categoryMeta(t.mainCategory);
                    const top = (minutesOfDay(start) / 1440) * 100;
                    const h = Math.max(
                      2,
                      ((end.getTime() - start.getTime()) / 86400000) * 100
                    );
                    return (
                      <span
                        key={t.id}
                        className="wc-block"
                        style={{
                          top: `${top}%`,
                          height: `${h}%`,
                          background: meta.color,
                        }}
                      />
                    );
                  })}
                </span>
                <span className="wc-count">{dayItems.length || ""}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* --- Selected day --- */}
      <section>
        <h2 className="sec-title">{fmtDayLabel(selected)}</h2>
        {dayTasks.length === 0 && <p className="note">Nothing scheduled.</p>}
        {dayTasks.map((t) => {
          const meta = categoryMeta(t.mainCategory);
          return (
            <div
              key={t.id}
              className="mini-row"
              style={{ borderLeftColor: meta.color }}
            >
              <span className="mini-time">
                {fmtTime(new Date(t.startTime))}
              </span>
              <span className="mini-title">
                {meta.icon} {t.note || meta.label}
              </span>
              {t.enforce && <span className="enforce-badge">!</span>}
            </div>
          );
        })}
      </section>

      {/* --- Inbox --- */}
      <section>
        <h2 className="sec-title">Inbox</h2>
        <p className="note">
          Things with no time yet. Schedule one onto {fmtDayLabel(selected)}.
        </p>
        <div className="card">
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Add one, or paste a list — one per line"
            rows={2}
          />
          <button className="ghost" onClick={addInbox} disabled={!newNote.trim()}>
            Add to inbox
          </button>
        </div>

        {inbox.map((item) => {
          const meta = categoryMeta(item.mainCategory);
          return (
            <div
              key={item.id}
              className="mini-row"
              style={{ borderLeftColor: meta.color }}
            >
              <span className="mini-title">
                {meta.icon} {item.note || meta.label}
              </span>
              <button className="ghost small" onClick={() => schedule(item)}>
                Schedule
              </button>
              <button
                className="ghost small"
                onClick={async () => {
                  await fetch(`/api/undefined-tasks?id=${item.id}`, {
                    method: "DELETE",
                  });
                  load();
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </section>
    </main>
  );
}

function GoalForm({
  categories,
  onDone,
}: {
  categories: Category[];
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [metric, setMetric] = useState<"DURATION" | "TASK_COUNT">("DURATION");
  const [direction, setDirection] = useState<"AT_LEAST" | "AT_MOST">("AT_LEAST");
  const [scopeType, setScopeType] = useState("ALL");
  const [mainCategoryId, setMainCategoryId] = useState<number | "">("");
  const [amount, setAmount] = useState("10");
  const [deadline, setDeadline] = useState(() => addDays(dateKey(), 7));

  const save = async () => {
    if (!title.trim()) return;
    const n = Number(amount) || 0;
    await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        metric,
        direction,
        scopeType,
        mainCategoryId: scopeType === "MAIN_CATEGORY" ? mainCategoryId : null,
        // Duration goals are entered in hours and stored as milliseconds.
        targetValue: metric === "DURATION" ? n * 3600000 : n,
        deadline: new Date(`${deadline}T23:59:59`).toISOString(),
      }),
    });
    onDone();
  };

  return (
    <div className="card">
      <label className="field">
        Title
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Study 10 hours"
        />
      </label>
      <label className="field">
        Track
        <div className="segmented">
          <button
            type="button"
            aria-pressed={metric === "DURATION"}
            onClick={() => setMetric("DURATION")}
          >
            Hours
          </button>
          <button
            type="button"
            aria-pressed={metric === "TASK_COUNT"}
            onClick={() => setMetric("TASK_COUNT")}
          >
            Blocks
          </button>
        </div>
      </label>
      <label className="field">
        Direction
        <div className="segmented">
          <button
            type="button"
            aria-pressed={direction === "AT_LEAST"}
            onClick={() => setDirection("AT_LEAST")}
          >
            At least
          </button>
          <button
            type="button"
            aria-pressed={direction === "AT_MOST"}
            onClick={() => setDirection("AT_MOST")}
          >
            At most
          </button>
        </div>
      </label>
      <label className="field">
        Scope
        <select
          value={scopeType}
          onChange={(e) => setScopeType(e.target.value)}
        >
          <option value="ALL">Everything</option>
          <option value="MAIN_CATEGORY">One category</option>
        </select>
      </label>
      {scopeType === "MAIN_CATEGORY" && (
        <label className="field">
          Category
          <select
            value={mainCategoryId}
            onChange={(e) => setMainCategoryId(Number(e.target.value))}
          >
            <option value="">Pick one</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {categoryMeta(c).label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="two-col">
        <label className="field">
          {metric === "DURATION" ? "Hours" : "Blocks"}
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min={0}
          />
        </label>
        <label className="field">
          By
          <input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </label>
      </div>
      <button className="primary" onClick={save} disabled={!title.trim()}>
        Save goal
      </button>
    </div>
  );
}
