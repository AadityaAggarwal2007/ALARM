"use client";

import { useCallback, useEffect, useState } from "react";
import { categoryMeta, PRIORITIES, PRIORITY_LABEL } from "@/lib/categories";
import { dateToHHMM, fmtTime, hhmmToDate, WEEKDAYS } from "@/lib/time";
import { describeRepeat } from "@/lib/repeat-format";
import type { Category, RepeatTime, Template } from "@/lib/types";

type Draft = {
  id?: number;
  start: string;
  end: string;
  mainCategoryId: number;
  subCategoryId: number | null;
  priority: "STANDARD" | "MEDIUM" | "MAX";
  note: string;
  isEnableNotification: boolean;
  isInStatistics: boolean;
  repeatEnabled: boolean;
  days: string[];
  enforce: boolean;
  challengeType: "math" | "typing";
  difficulty: "easy" | "medium" | "hard";
  requiredCorrect: number;
  silent: boolean;
  vibrate: boolean;
};

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    const [t, c] = await Promise.all([
      fetch("/api/templates").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/categories").then((r) => (r.ok ? r.json() : [])),
    ]);
    setTemplates(t);
    setCategories(c);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const blank = (): Draft => ({
    start: "07:00",
    end: "08:00",
    mainCategoryId: categories[0]?.id ?? 1,
    subCategoryId: null,
    priority: "STANDARD",
    note: "",
    isEnableNotification: false,
    isInStatistics: true,
    repeatEnabled: true,
    days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    enforce: false,
    challengeType: "math",
    difficulty: "easy",
    requiredCorrect: 3,
    silent: false,
    vibrate: true,
  });

  const toDraft = (t: Template): Draft => ({
    id: t.id,
    start: dateToHHMM(new Date(t.startTime)),
    end: dateToHHMM(new Date(t.endTime)),
    mainCategoryId: t.mainCategoryId,
    subCategoryId: t.subCategoryId,
    priority: t.priority,
    note: t.note ?? "",
    isEnableNotification: t.isEnableNotification,
    isInStatistics: t.isInStatistics,
    repeatEnabled: t.repeatEnabled,
    days: t.repeatTimes.filter((r) => r.type === "WEEK_DAY").map((r) => r.day!),
    enforce: t.enforce,
    challengeType: t.challengeType,
    difficulty: t.difficulty,
    requiredCorrect: t.requiredCorrect,
    silent: t.silent,
    vibrate: t.vibrate,
  });

  const save = async () => {
    if (!draft) return;
    const repeatTimes: RepeatTime[] = draft.days.map((day) => ({
      type: "WEEK_DAY",
      day,
      dayNumber: null,
      month: null,
      weekNumber: null,
    }));
    await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...draft,
        startTime: hhmmToDate(draft.start).toISOString(),
        endTime: hhmmToDate(draft.end).toISOString(),
        repeatTimes,
      }),
    });
    setDraft(null);
    load();
  };

  if (draft) {
    const category = categories.find((c) => c.id === draft.mainCategoryId);
    const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
      setDraft({ ...draft, [k]: v });

    return (
      <div className="editor">
        <div className="editor-head">
          <h1>{draft.id ? "Edit repeat" : "New repeat"}</h1>
          <p className="sub">
            Generates blocks automatically on the days you pick.
          </p>
        </div>

        <div className="card">
          <label className="field">
            Category
            <div className="chip-row">
              {categories.map((c) => {
                const meta = categoryMeta(c);
                const active = c.id === draft.mainCategoryId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`chip${active ? " active" : ""}`}
                    style={
                      active
                        ? { borderColor: meta.color, color: meta.color }
                        : undefined
                    }
                    onClick={() =>
                      setDraft({ ...draft, mainCategoryId: c.id, subCategoryId: null })
                    }
                  >
                    <span>{meta.icon}</span> {meta.label}
                  </button>
                );
              })}
            </div>
          </label>
          {(category?.subCategories.length ?? 0) > 0 && (
            <label className="field">
              Subcategory
              <select
                value={draft.subCategoryId ?? ""}
                onChange={(e) =>
                  set("subCategoryId", e.target.value ? Number(e.target.value) : null)
                }
              >
                <option value="">None</option>
                {category!.subCategories.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            Note
            <input
              type="text"
              value={draft.note}
              onChange={(e) => set("note", e.target.value)}
              placeholder="e.g. Morning gym"
            />
          </label>
        </div>

        <div className="card">
          <div className="two-col">
            <label className="field">
              Start
              <input
                type="time"
                value={draft.start}
                onChange={(e) => set("start", e.target.value)}
              />
            </label>
            <label className="field">
              End
              <input
                type="time"
                value={draft.end}
                onChange={(e) => set("end", e.target.value)}
              />
            </label>
          </div>
          <label className="field">
            Repeat on
            <div className="chip-row">
              {WEEKDAYS.map((d) => {
                const on = draft.days.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    className={`chip${on ? " active" : ""}`}
                    onClick={() =>
                      set(
                        "days",
                        on
                          ? draft.days.filter((x) => x !== d)
                          : [...draft.days, d]
                      )
                    }
                  >
                    {d.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </label>
          <label className="field">
            Priority
            <div className="segmented">
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={draft.priority === p}
                  onClick={() => set("priority", p)}
                >
                  {PRIORITY_LABEL[p]}
                </button>
              ))}
            </div>
          </label>
        </div>

        <div className="card enforce-card">
          <div className="row-between">
            <div>
              <p className="row-title">Enforce every occurrence</p>
              <p className="note">
                Every generated block rings until solved. A daily wake-up is
                just this — one repeat, enforced.
              </p>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={draft.enforce}
                onChange={(e) => set("enforce", e.target.checked)}
                aria-label="Enforce every occurrence"
              />
              <span className="track" />
            </label>
          </div>

          {draft.enforce && (
            <>
              <label className="field">
                Challenge
                <div className="segmented">
                  {(["math", "typing"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={draft.challengeType === t}
                      onClick={() => set("challengeType", t)}
                    >
                      {t === "math" ? "Math" : "Typing"}
                    </button>
                  ))}
                </div>
              </label>
              <label className="field">
                Difficulty
                <div className="segmented">
                  {(["easy", "medium", "hard"] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={draft.difficulty === d}
                      onClick={() => set("difficulty", d)}
                    >
                      {d[0].toUpperCase() + d.slice(1)}
                    </button>
                  ))}
                </div>
              </label>
              <label className="field">
                How many in a row
                <div className="segmented">
                  {[1, 3, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={draft.requiredCorrect === n}
                      onClick={() => set("requiredCorrect", n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </label>
              <label className="field">
                How it wakes you
                <div className="segmented">
                  <button
                    type="button"
                    aria-pressed={!draft.silent}
                    onClick={() => set("silent", false)}
                  >
                    Siren
                  </button>
                  <button
                    type="button"
                    aria-pressed={draft.silent}
                    onClick={() => set("silent", true)}
                  >
                    Vibrate only
                  </button>
                </div>
              </label>
            </>
          )}
        </div>

        <button className="primary" onClick={save}>
          {draft.id ? "Save repeat" : "Create repeat"}
        </button>
        <button className="ghost" onClick={() => setDraft(null)}>
          Cancel
        </button>
        {draft.id && (
          <button
            className="ghost danger"
            onClick={async () => {
              await fetch(`/api/templates?id=${draft.id}`, { method: "DELETE" });
              setDraft(null);
              load();
            }}
          >
            Delete repeat
          </button>
        )}
      </div>
    );
  }

  return (
    <main className="shell">
      <header className="page-head">
        <div>
          <h1>Repeats</h1>
          <p className="sub">
            Blocks that generate themselves. Your wake-up lives here.
          </p>
        </div>
        <a className="icon-btn" href="/settings" aria-label="Settings">
          ⚙
        </a>
      </header>

      {templates.length === 0 && (
        <div className="card">
          <p className="note">
            No repeats yet. Create one for your wake-up: Sleep category, ending
            at your wake time, enforced.
          </p>
        </div>
      )}

      <div className="tpl-grid">
        {templates.map((t) => {
          const meta = categoryMeta(t.mainCategory);
          return (
            <button
              key={t.id}
              className="tpl-card"
              style={{ borderTopColor: meta.color }}
              onClick={() => setDraft(toDraft(t))}
            >
              <span className="tpl-icon">{meta.icon}</span>
              <span className="tpl-title">
                {t.note || t.subCategory?.name || meta.label}
              </span>
              <span className="tpl-time">
                {fmtTime(new Date(t.startTime))} – {fmtTime(new Date(t.endTime))}
              </span>
              {t.repeatEnabled && t.repeatTimes.length > 0 && (
                <span className="tpl-repeat">
                  {describeRepeat(t.repeatTimes)}
                </span>
              )}
              {t.enforce && <span className="enforce-badge">ENFORCED</span>}
            </button>
          );
        })}
      </div>

      <button
        className="primary"
        onClick={() => setDraft(blank())}
        disabled={categories.length === 0}
      >
        New repeat
      </button>
    </main>
  );
}
