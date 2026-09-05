import { prisma } from "../db";
import { addDays, dateKey, weekdayOf } from "../time";
import { toDate, toTime } from "./wall";
import { computeAnalytics, resolveRange } from "../analytics";
import { categoryMeta } from "../categories";

/**
 * Everything an agent needs to reason about the schedule, in one response.
 *
 * Shaped for token economy as much as correctness: wall-clock strings, names
 * instead of ids, and no field that only matters to the UI. A model should be
 * able to answer "what does my week look like and how am I doing" without a
 * second round trip.
 */

export type ContextOptions = {
  from?: string;
  days?: number;
  /**
   * Which sections to return. Most questions need one or two, and a 60-day
   * block list is ~3300 tokens the model usually has no use for — so the
   * caller pays only for what it asks for.
   */
  include?: string[];
};

const ALL_SECTIONS = ["categories", "blocks", "rules", "goals", "inbox"] as const;

export async function buildContext(opts: ContextOptions = {}) {
  const from = opts.from || dateKey();
  const days = Math.min(Math.max(opts.days ?? 14, 1), 120);
  const to = addDays(from, days - 1);

  const want = new Set(
    opts.include?.length ? opts.include.map((s) => s.trim().toLowerCase()) : ALL_SECTIONS
  );
  const on = (s: string) => want.has(s);

  const [cats, blocks, rules, goals, inbox, subs] = await Promise.all([
    on("categories") || on("blocks") || on("rules")
      ? prisma.mainCategory.findMany({
          include: { subCategories: { orderBy: { name: "asc" } } },
          orderBy: { sortOrder: "asc" },
        })
      : [],
    on("blocks")
      ? prisma.timeTask.findMany({
          where: { date: { gte: from, lte: to } },
          include: { mainCategory: true, subCategory: true },
          orderBy: { startTime: "asc" },
        })
      : [],
    on("rules")
      ? prisma.template.findMany({
          include: { mainCategory: true, subCategory: true, repeatTimes: true },
        })
      : [],
    on("goals")
      ? prisma.goal.findMany({ include: { mainCategory: true, subCategory: true } })
      : [],
    on("inbox") ? prisma.undefinedTask.findMany({ include: { mainCategory: true } }) : [],
    prisma.pushSubscription.count(),
  ]);

  // The same names the UI shows, so a human and an agent describe the schedule
  // identically — "Sleep", never "SLEEP".
  const label = (c: { id: number; customName: string | null; defaultType: string | null }) =>
    categoryMeta(c).label;

  return {
    today: dateKey(),
    now: toTime(new Date()),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    window: { from, to },

    // Names an agent can address things by. No ids required anywhere.
    categories: !on("categories") ? undefined : cats.map((c) => ({
      name: label(c),
      builtIn: Boolean(c.defaultType),
      subs: c.subCategories.map((s) => s.name),
    })),

    blocks: !on("blocks") ? undefined : blocks.map((b) => ({
      id: b.id,
      key: b.planKey ?? undefined,
      date: b.date,
      weekday: weekdayOf(b.date),
      time: `${toTime(b.startTime)}-${toTime(b.endTime)}`,
      title: b.note || b.subCategory?.name || label(b.mainCategory),
      category: label(b.mainCategory),
      sub: b.subCategory?.name ?? undefined,
      priority: b.priority === "STANDARD" ? undefined : b.priority,
      // Present only when set, so the common case costs no tokens.
      enforce: b.enforce
        ? {
            mode: b.wakeMode,
            challenge: b.challengeType,
            difficulty: b.difficulty,
            streak: b.requiredCorrect,
          }
        : undefined,
      fromRule: b.linkedTemplateId ? true : undefined,
      done: b.isCompleted || undefined,
      // The discipline record, when there is one.
      startedLateSec:
        b.enforce && b.dismissedAt
          ? Math.max(
              0,
              Math.round((b.dismissedAt.getTime() - b.startTime.getTime()) / 1000)
            )
          : undefined,
      ignored: b.gaveUpAt ? true : undefined,
    })),

    rules: !on("rules") ? undefined : rules.map((r) => ({
      key: r.key ?? undefined,
      title: r.note || label(r.mainCategory),
      category: label(r.mainCategory),
      sub: r.subCategory?.name ?? undefined,
      time: `${toTime(r.startTime)}-${toTime(r.endTime)}`,
      weekdays: r.repeatTimes.filter((t) => t.type === "WEEK_DAY").map((t) => t.day),
      until: r.until ?? undefined,
      active: r.repeatEnabled,
      enforce: r.enforce
        ? { mode: r.wakeMode, challenge: r.challengeType, difficulty: r.difficulty, streak: r.requiredCorrect }
        : undefined,
    })),

    goals: !on("goals") ? undefined : goals.map((g) => ({
      title: g.title,
      metric: g.metric,
      direction: g.direction,
      target:
        g.metric === "DURATION"
          ? `${Math.round(Number(g.targetValue) / 3600000)}h`
          : Number(g.targetValue),
      scope:
        g.subCategory?.name ??
        (g.mainCategory ? label(g.mainCategory) : "everything"),
      until: toDate(g.deadline),
    })),

    inbox: !on("inbox") ? undefined : inbox.map((u) => ({
      id: u.id,
      title: u.note || label(u.mainCategory),
      category: label(u.mainCategory),
    })),

    devices: subs,
    canRing: subs > 0,
  };
}

/** Discipline and time-use summary, kept separate so it is only paid for when asked. */
export async function buildAnalyticsSummary(preset = "WEEK") {
  const range = resolveRange(preset, dateKey());
  const a = await computeAnalytics(range);
  return {
    range: a.range,
    scheduledHours: Math.round((a.summary.totalMs / 3600000) * 10) / 10,
    blocks: a.summary.totalTasks,
    completionRate: Math.round(a.summary.completionRate * 100),
    byCategory: a.categories.map((c) => ({
      name: c.label,
      hours: Math.round((c.ms / 3600000) * 10) / 10,
      share: Math.round(c.share * 100),
    })),
    discipline: {
      enforced: a.discipline.enforcedCount,
      kept: a.discipline.solvedCount,
      keptPercent: Math.round(a.discipline.honourRate * 100),
      ignored: a.discipline.gaveUpCount,
      avgLateSec: Math.round(a.discipline.avgLatenessMs / 1000),
      worstLateSec: Math.round(a.discipline.worstLatenessMs / 1000),
    },
  };
}
