/**
 * Wall-clock time in, wall-clock time out.
 *
 * Every AI-facing surface speaks local strings — "2026-09-07", "16:00" — and
 * never ISO/UTC. Models reason about "Monday at 4pm", not offsets, and our own
 * REST layer already hands back 08:00 IST as "02:30Z", which is precisely the
 * kind of thing a model silently gets wrong. Converting at the edge means the
 * rest of the app keeps using real Date objects.
 */

import { dateKey, parseDateKey } from "../time";

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** "16:00-18:00", the shape a model naturally writes a class in. */
export const SPAN_RE = /^([01]\d|2[0-3]):([0-5]\d)\s*-\s*([01]\d|2[0-3]):([0-5]\d)$/;

export function today(): string {
  return dateKey();
}

/** Local "YYYY-MM-DD" + "HH:MM" into a real Date. */
export function at(date: string, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  const d = parseDateKey(date);
  d.setHours(h, m, 0, 0);
  return d;
}

export function toDate(d: Date): string {
  return dateKey(d);
}

export function toTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

export type Span = { start: string; end: string };

export function parseSpan(value: string): Span {
  const m = SPAN_RE.exec(value.trim());
  if (!m) {
    throw new Error(
      `time must look like "16:00-18:00" (24-hour). Got "${value}".`
    );
  }
  return { start: `${m[1]}:${m[2]}`, end: `${m[3]}:${m[4]}` };
}

/**
 * Durations as a model writes them: "10h", "90m", "1h30m", or plain minutes.
 * Returned in milliseconds.
 */
export function parseDuration(value: string | number): number {
  if (typeof value === "number") return value * 60_000;
  const text = String(value).trim().toLowerCase();
  if (/^\d+$/.test(text)) return Number(text) * 60_000;

  const m = /^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+)m)?$/.exec(text);
  if (!m || (!m[1] && !m[2])) {
    throw new Error(`duration must look like "10h", "90m" or "1h30m". Got "${value}".`);
  }
  return (Number(m[1] || 0) * 60 + Number(m[2] || 0)) * 60_000;
}

export function assertDate(value: unknown, field: string): string {
  const s = String(value ?? "");
  if (!DATE_RE.test(s)) {
    throw new Error(`${field} must be "YYYY-MM-DD". Got "${s}".`);
  }
  return s;
}
