import { prisma } from "./db";
import { addDays, dateKey, parseDateKey } from "./time";
import { categoryMeta } from "./categories";

/**
 * All analytics are computed from TimeTask rows in one pass per request.
 *
 * The Discipline section is the one the original planner could not produce:
 * it reads ringStartedAt / dismissedAt / dismissAttempts, which only exist
 * because an enforced block and a scheduled block are the same row.
 */

export type Range = { from: string; to: string };

export function resolveRange(
  preset: string,
  anchor: string,
  customFrom?: string | null,
  customTo?: string | null
): Range {
  if (preset === "CUSTOM" && customFrom && customTo) {
    return { from: customFrom, to: customTo };
  }
  const days =
    preset === "MONTH" ? 30 : preset === "HALF_YEAR" ? 182 : preset === "YEAR" ? 365 : 7;
  return { from: addDays(anchor, -(days - 1)), to: anchor };
}

export async function computeAnalytics(range: Range) {
  const tasks = await prisma.timeTask.findMany({
    where: { date: { gte: range.from, lte: range.to }, isInStatistics: true },
    include: { mainCategory: true, subCategory: true },
    orderBy: { startTime: "asc" },
  });

  const dur = (t: { startTime: Date; endTime: Date }) =>
    t.endTime.getTime() - t.startTime.getTime();

  const totalMs = tasks.reduce((s, t) => s + dur(t), 0);
  const completed = tasks.filter((t) => t.isCompleted).length;

  // --- 1. Summary ---
  const summary = {
    totalMs,
    totalTasks: tasks.length,
    completed,
    completionRate: tasks.length ? completed / tasks.length : 0,
  };

  // --- 2. Categories breakdown ---
  const byCategory = new Map<
    number,
    { label: string; color: string; icon: string; ms: number; count: number }
  >();
  for (const t of tasks) {
    const meta = categoryMeta(t.mainCategory);
    const row = byCategory.get(t.mainCategoryId) ?? {
      label: meta.label,
      color: meta.color,
      icon: meta.icon,
      ms: 0,
      count: 0,
    };
    row.ms += dur(t);
    row.count += 1;
    byCategory.set(t.mainCategoryId, row);
  }
  const categories = [...byCategory.entries()]
    .map(([id, v]) => ({ id, ...v, share: totalMs ? v.ms / totalMs : 0 }))
    .sort((a, b) => b.ms - a.ms);

  // --- 3. Load per day (also feeds the regularity calendar) ---
  const perDay = new Map<string, number>();
  for (
    let key = range.from;
    key <= range.to;
    key = addDays(key, 1)
  ) {
    perDay.set(key, 0);
  }
  for (const t of tasks) {
    perDay.set(t.date, (perDay.get(t.date) ?? 0) + dur(t));
  }
  const load = [...perDay.entries()].map(([date, ms]) => ({ date, ms }));

  // --- 4. Creation pattern: when blocks were planned, by hour ---
  const creation = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  for (const t of tasks) {
    creation[t.createdAt.getHours()].count += 1;
  }

  // --- 5. Duration distribution ---
  const BUCKETS = [15, 30, 45, 60, 90, 120, 180, 240];
  const distribution = BUCKETS.map((minutes, i) => ({
    label:
      i === BUCKETS.length - 1 ? `${BUCKETS[i - 1]}m+` : `≤${minutes}m`,
    minutes,
    count: 0,
  }));
  for (const t of tasks) {
    const mins = dur(t) / 60000;
    const idx = BUCKETS.findIndex((b) => mins <= b);
    distribution[idx === -1 ? distribution.length - 1 : idx].count += 1;
  }

  // --- 6. Plan source ---
  const planSource = { MANUAL: 0, TEMPLATE: 0, UNDEFINED: 0 } as Record<
    string,
    number
  >;
  for (const t of tasks) {
    planSource[t.planSource] = (planSource[t.planSource] ?? 0) + 1;
  }

  // --- 7. Key metrics ---
  const activeDays = load.filter((d) => d.ms > 0).length;
  const busiest = load.reduce(
    (a, b) => (b.ms > a.ms ? b : a),
    { date: "", ms: 0 }
  );
  const longest = tasks.reduce(
    (a, t) => (dur(t) > a.ms ? { ms: dur(t), note: t.note } : a),
    { ms: 0, note: null as string | null }
  );
  const metrics = {
    avgTasksPerDay: activeDays ? tasks.length / activeDays : 0,
    avgMsPerDay: activeDays ? totalMs / activeDays : 0,
    busiestDay: busiest.date,
    busiestMs: busiest.ms,
    longestMs: longest.ms,
    topCategory: categories[0]?.label ?? null,
    activeDays,
  };

  // --- 8. Regularity calendar is `load` rendered as a heatmap ---

  // --- 9. Weekday x hour heatmap ---
  const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const t of tasks) {
    const dow = (parseDateKey(t.date).getDay() + 6) % 7;
    const startH = t.startTime.getHours();
    const hours = Math.max(1, Math.round(dur(t) / 3600000));
    for (let i = 0; i < hours; i++) {
      heatmap[dow][(startH + i) % 24] += 1;
    }
  }

  // --- 10. Discipline: only possible because enforcement shares the row ---
  const enforced = tasks.filter((t) => t.enforce && t.ringStartedAt);
  const solved = enforced.filter((t) => t.dismissedAt);
  const gaveUp = enforced.filter((t) => t.gaveUpAt && !t.dismissedAt);
  const latenessMs = solved.map((t) =>
    Math.max(0, t.dismissedAt!.getTime() - t.startTime.getTime())
  );
  const discipline = {
    enforcedCount: enforced.length,
    solvedCount: solved.length,
    gaveUpCount: gaveUp.length,
    honourRate: enforced.length ? solved.length / enforced.length : 0,
    avgLatenessMs: latenessMs.length
      ? latenessMs.reduce((a, b) => a + b, 0) / latenessMs.length
      : 0,
    worstLatenessMs: latenessMs.length ? Math.max(...latenessMs) : 0,
    avgAttempts: solved.length
      ? solved.reduce((s, t) => s + t.dismissAttempts, 0) / solved.length
      : 0,
    // Per-day on-time record, for the streak strip.
    byDay: [...perDay.keys()].map((date) => {
      const day = enforced.filter((t) => t.date === date);
      const ok = day.filter(
        (t) =>
          t.dismissedAt &&
          t.dismissedAt.getTime() - t.startTime.getTime() <= 5 * 60 * 1000
      ).length;
      return { date, total: day.length, onTime: ok };
    }),
  };

  return {
    range,
    summary,
    categories,
    load,
    creation,
    distribution,
    planSource,
    metrics,
    heatmap,
    discipline,
  };
}

export async function computeCategoryDetail(categoryId: number, range: Range) {
  const tasks = await prisma.timeTask.findMany({
    where: {
      date: { gte: range.from, lte: range.to },
      isInStatistics: true,
      mainCategoryId: categoryId,
    },
    include: { subCategory: true, mainCategory: true },
    orderBy: { startTime: "asc" },
  });

  const dur = (t: { startTime: Date; endTime: Date }) =>
    t.endTime.getTime() - t.startTime.getTime();
  const totalMs = tasks.reduce((s, t) => s + dur(t), 0);

  const bySub = new Map<string, { ms: number; count: number }>();
  for (const t of tasks) {
    const name = t.subCategory?.name ?? "—";
    const row = bySub.get(name) ?? { ms: 0, count: 0 };
    row.ms += dur(t);
    row.count += 1;
    bySub.set(name, row);
  }

  // Day parts, so you can see when this category actually happens.
  const parts = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  for (const t of tasks) {
    const h = t.startTime.getHours();
    if (h < 6) parts.night += dur(t);
    else if (h < 12) parts.morning += dur(t);
    else if (h < 18) parts.afternoon += dur(t);
    else parts.evening += dur(t);
  }

  const perDay = new Map<string, number>();
  for (let key = range.from; key <= range.to; key = addDays(key, 1)) {
    perDay.set(key, 0);
  }
  for (const t of tasks) perDay.set(t.date, (perDay.get(t.date) ?? 0) + dur(t));

  return {
    label: tasks[0] ? categoryMeta(tasks[0].mainCategory).label : "Category",
    totalMs,
    count: tasks.length,
    completed: tasks.filter((t) => t.isCompleted).length,
    avgMs: tasks.length ? totalMs / tasks.length : 0,
    subCategories: [...bySub.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.ms - a.ms),
    dayParts: parts,
    load: [...perDay.entries()].map(([date, ms]) => ({ date, ms })),
    tasks: tasks.map((t) => ({
      id: t.id,
      date: t.date,
      startTime: t.startTime.toISOString(),
      endTime: t.endTime.toISOString(),
      note: t.note,
      sub: t.subCategory?.name ?? null,
      isCompleted: t.isCompleted,
    })),
  };
}

export const todayKey = dateKey;
