"use client";

import { useEffect, useMemo, useState } from "react";
import { categoryMeta, PRIORITIES, PRIORITY_LABEL } from "@/lib/categories";
import { speechSupported } from "@/lib/speech";
import { dateToHHMM, fmtDuration, hhmmToDate } from "@/lib/time";
import { vibrationSupported } from "@/lib/vibrate";
import type { Category, Task } from "@/lib/types";

export type EditorValue = {
  id?: number;
  date: string;
  start: string;
  end: string;
  mainCategoryId: number;
  subCategoryId: number | null;
  priority: "STANDARD" | "MEDIUM" | "MAX";
  note: string;
  isCompleted: boolean;
  isInStatistics: boolean;
  isEnableNotification: boolean;
  fifteenMinBefore: boolean;
  oneHourBefore: boolean;
  threeHourBefore: boolean;
  oneDayBefore: boolean;
  oneWeekBefore: boolean;
  beforeEnd: boolean;
  enforce: boolean;
  challengeType: "math" | "typing";
  difficulty: "easy" | "medium" | "hard";
  requiredCorrect: number;
  wakeMode: "SILENT" | "VIBRATE" | "SIREN" | "VOICE";
  voiceText: string;
  vibrate: boolean;
};

export function taskToValue(task: Task): EditorValue {
  return {
    id: task.id,
    date: task.date,
    start: dateToHHMM(new Date(task.startTime)),
    end: dateToHHMM(new Date(task.endTime)),
    mainCategoryId: task.mainCategoryId,
    subCategoryId: task.subCategoryId,
    priority: task.priority,
    note: task.note ?? "",
    isCompleted: task.isCompleted,
    isInStatistics: task.isInStatistics,
    isEnableNotification: task.isEnableNotification,
    fifteenMinBefore: task.fifteenMinBefore,
    oneHourBefore: task.oneHourBefore,
    threeHourBefore: task.threeHourBefore,
    oneDayBefore: task.oneDayBefore,
    oneWeekBefore: task.oneWeekBefore,
    beforeEnd: task.beforeEnd,
    enforce: task.enforce,
    challengeType: task.challengeType,
    difficulty: task.difficulty,
    requiredCorrect: task.requiredCorrect,
    wakeMode: task.wakeMode,
    voiceText: task.voiceText ?? "",
    vibrate: task.vibrate,
  };
}

export function blankValue(date: string, categoryId: number): EditorValue {
  const now = new Date();
  const start = new Date(now.getTime() + 30 * 60000);
  start.setMinutes(Math.round(start.getMinutes() / 15) * 15, 0, 0);
  const end = new Date(start.getTime() + 60 * 60000);
  return {
    date,
    start: dateToHHMM(start),
    end: dateToHHMM(end),
    mainCategoryId: categoryId,
    subCategoryId: null,
    priority: "STANDARD",
    note: "",
    isCompleted: false,
    isInStatistics: true,
    isEnableNotification: false,
    fifteenMinBefore: false,
    oneHourBefore: false,
    threeHourBefore: false,
    oneDayBefore: false,
    oneWeekBefore: false,
    beforeEnd: false,
    enforce: false,
    challengeType: "math",
    difficulty: "easy",
    requiredCorrect: 3,
    wakeMode: "SIREN",
    voiceText: "",
    vibrate: true,
  };
}

const REMINDERS = [
  ["fifteenMinBefore", "15 min before"],
  ["oneHourBefore", "1 hour before"],
  ["threeHourBefore", "3 hours before"],
  ["oneDayBefore", "1 day before"],
  ["oneWeekBefore", "1 week before"],
  ["beforeEnd", "Before it ends"],
] as const;

const PRESETS = [10, 15, 30, 45, 60, 120];

export default function TaskEditor({
  value,
  categories,
  onChange,
  onSave,
  onCancel,
  onDelete,
  saving,
  title,
  showDate = true,
}: {
  value: EditorValue;
  categories: Category[];
  onChange: (v: EditorValue) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  saving?: boolean;
  title: string;
  showDate?: boolean;
}) {
  const set = <K extends keyof EditorValue>(k: K, v: EditorValue[K]) =>
    onChange({ ...value, [k]: v });

  const category = categories.find((c) => c.id === value.mainCategoryId);
  const subs = category?.subCategories ?? [];

  const durationMs = useMemo(() => {
    const s = hhmmToDate(value.start);
    let e = hhmmToDate(value.end);
    if (e.getTime() <= s.getTime()) e = new Date(e.getTime() + 86400000);
    return e.getTime() - s.getTime();
  }, [value.start, value.end]);

  const overnight = hhmmToDate(value.end).getTime() <= hhmmToDate(value.start).getTime();

  // Ctrl/Cmd+S saves, matching the original app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        onSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSave]);

  const applyPreset = (minutes: number) => {
    const s = hhmmToDate(value.start);
    const e = new Date(s.getTime() + minutes * 60000);
    set("end", dateToHHMM(e));
  };

  return (
    <div className="editor">
      <div className="editor-head">
        <h1>{title}</h1>
        <p className="sub">
          {fmtDuration(durationMs)}
          {overnight ? " · runs past midnight" : ""}
        </p>
      </div>

      <div className="card">
        <label className="field">
          Category
          <div className="chip-row">
            {categories.map((c) => {
              const meta = categoryMeta(c);
              const active = c.id === value.mainCategoryId;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`chip${active ? " active" : ""}`}
                  style={active ? { borderColor: meta.color, color: meta.color } : undefined}
                  onClick={() =>
                    onChange({ ...value, mainCategoryId: c.id, subCategoryId: null })
                  }
                >
                  <span>{meta.icon}</span> {meta.label}
                </button>
              );
            })}
          </div>
        </label>

        {subs.length > 0 && (
          <label className="field">
            Subcategory
            <select
              value={value.subCategoryId ?? ""}
              onChange={(e) =>
                set("subCategoryId", e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">None</option>
              {subs.map((s) => (
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
            value={value.note}
            onChange={(e) => set("note", e.target.value)}
            placeholder="What is this block?"
            maxLength={120}
          />
        </label>
      </div>

      <div className="card">
        {showDate && (
          <label className="field">
            Date
            <input
              type="date"
              value={value.date}
              onChange={(e) => set("date", e.target.value)}
            />
          </label>
        )}
        <div className="two-col">
          <label className="field">
            Start
            <input
              type="time"
              value={value.start}
              onChange={(e) => set("start", e.target.value)}
            />
          </label>
          <label className="field">
            End
            <input
              type="time"
              value={value.end}
              onChange={(e) => set("end", e.target.value)}
            />
          </label>
        </div>
        <div className="chip-row">
          {PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              className="chip"
              onClick={() => applyPreset(m)}
            >
              {m}m
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <label className="field">
          Priority
          <div className="segmented">
            {PRIORITIES.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={value.priority === p}
                onClick={() => set("priority", p)}
              >
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </div>
        </label>

        <Toggle
          label="Count in statistics"
          note="Off for blocks you do not want skewing analytics."
          checked={value.isInStatistics}
          onChange={(v) => set("isInStatistics", v)}
        />
        <Toggle
          label="Mark completed"
          checked={value.isCompleted}
          onChange={(v) => set("isCompleted", v)}
        />
      </div>

      <div className="card">
        <Toggle
          label="Reminders"
          note="A single notification ahead of time. Easy to ignore."
          checked={value.isEnableNotification}
          onChange={(v) => set("isEnableNotification", v)}
        />
        {value.isEnableNotification && (
          <div className="check-grid">
            {REMINDERS.map(([key, label]) => (
              <label key={key} className="check">
                <input
                  type="checkbox"
                  checked={value[key] as boolean}
                  onChange={(e) => set(key, e.target.checked as never)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* The integration, in the UI. A block with this on is an alarm. */}
      <div className="card enforce-card">
        <Toggle
          label="Enforce this block"
          note="Rings at the start time and will not stop until you solve the challenge. This is what makes the block binding."
          checked={value.enforce}
          onChange={(v) => set("enforce", v)}
        />

        {value.enforce && (
          <>
            <label className="field">
              Challenge
              <div className="segmented">
                {(["math", "typing"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={value.challengeType === t}
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
                    aria-pressed={value.difficulty === d}
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
                    aria-pressed={value.requiredCorrect === n}
                    onClick={() => set("requiredCorrect", n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </label>

            <label className="field">
              How it wakes you
              <div className="segmented four">
                {(
                  [
                    ["SILENT", "Silent"],
                    ["VIBRATE", "Vibrate"],
                    ["SIREN", "Siren"],
                    ["VOICE", "Voice"],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={value.wakeMode === mode}
                    onClick={() => set("wakeMode", mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </label>

            {value.wakeMode === "VOICE" && (
              <label className="field">
                What it says
                <input
                  type="text"
                  value={value.voiceText}
                  onChange={(e) => set("voiceText", e.target.value)}
                  placeholder={`"${value.note || "Wake up"}. It is time."`}
                  maxLength={200}
                />
              </label>
            )}

            <p className="note">
              {value.wakeMode === "SILENT" &&
                "One notification, then nothing. It will not nag you — but you still have to solve the challenge to clear the block."}
              {value.wakeMode === "VIBRATE" &&
                "Notifications repeat about once a second, so the phone buzzes continuously until solved. No sound from the app. Put the phone on the silent switch so the notifications vibrate instead of chiming."}
              {value.wakeMode === "SIREN" &&
                "A loud two-tone alarm, plus the repeating notifications. The siren needs the app open; the notifications are what reach you with it closed."}
              {value.wakeMode === "VOICE" &&
                (speechSupported()
                  ? "Speaks the block aloud, over and over, plus the repeating notifications. Like the siren, the voice only plays while the app is open."
                  : "This browser cannot speak, so this behaves like Vibrate.")}
            </p>

            {value.wakeMode !== "SILENT" && value.wakeMode !== "VIBRATE" && (
              <Toggle
                label="Buzz as well"
                note={
                  vibrationSupported()
                    ? "Vibrate alongside the sound."
                    : "iOS Safari has no vibration API, so this does nothing on an iPhone — the repeating notifications are what buzz there."
                }
                checked={value.vibrate}
                onChange={(v) => set("vibrate", v)}
              />
            )}
          </>
        )}
      </div>

      <button className="primary" onClick={onSave} disabled={saving}>
        {saving ? "Saving..." : value.id ? "Save changes" : "Add block"}
      </button>
      <button className="ghost" onClick={onCancel}>
        Cancel
      </button>
      {onDelete && value.id && (
        <button className="ghost danger" onClick={onDelete}>
          Delete block
        </button>
      )}
    </div>
  );
}

function Toggle({
  label,
  note,
  checked,
  onChange,
}: {
  label: string;
  note?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="row-between">
      <div>
        <p className="row-title">{label}</p>
        {note && <p className="note">{note}</p>}
      </div>
      <label className="switch">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={label}
        />
        <span className="track" />
      </label>
    </div>
  );
}
