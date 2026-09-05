import { prisma } from "./db";
import { addDays, parseDateKey, weekdayOf, MONTHS, combine } from "./time";

/**
 * Turns repeating templates into real blocks.
 *
 * Blocks are materialised rather than computed on the fly so they can be
 * edited, completed and enforced individually — a generated 6am gym block you
 * moved to 7am must stay moved. Generation is therefore idempotent: a day that
 * already has a block linked to a template is left alone, including if you
 * deleted it on purpose... which is why deletion sets a tombstone rather than
 * removing the row outright would be the next refinement. For now, re-running
 * never duplicates.
 */

type RepeatRow = {
  type: string;
  day: string | null;
  dayNumber: number | null;
  month: string | null;
  weekNumber: number | null;
};

export function matchesDate(rule: RepeatRow, key: string): boolean {
  const d = parseDateKey(key);

  switch (rule.type) {
    case "WEEK_DAY":
      return rule.day === weekdayOf(key);

    case "WEEK_DAY_IN_MONTH": {
      if (rule.day !== weekdayOf(key)) return false;
      // Which occurrence of this weekday within the month, 1-based.
      const nth = Math.floor((d.getDate() - 1) / 7) + 1;
      return rule.weekNumber === nth;
    }

    case "MONTH_DAY":
      return rule.dayNumber === d.getDate();

    case "YEAR_DAY":
      return (
        rule.dayNumber === d.getDate() && rule.month === MONTHS[d.getMonth()]
      );

    default:
      return false;
  }
}

/** Generate blocks for `days` days starting at `from`, skipping what exists. */
export async function generateForRange(from: string, days: number): Promise<number> {
  const templates = await prisma.template.findMany({
    where: { repeatEnabled: true },
    include: { repeatTimes: true },
  });
  if (templates.length === 0) return 0;

  const keys = Array.from({ length: days }, (_, i) => addDays(from, i));

  const existing = await prisma.timeTask.findMany({
    where: { date: { in: keys }, linkedTemplateId: { not: null } },
    select: { date: true, linkedTemplateId: true },
  });
  const seen = new Set(existing.map((e) => `${e.date}:${e.linkedTemplateId}`));

  let created = 0;

  for (const key of keys) {
    for (const template of templates) {
      if (seen.has(`${key}:${template.id}`)) continue;
      if (!template.repeatTimes.some((r) => matchesDate(r, key))) continue;

      const start = combine(key, template.startTime);
      let end = combine(key, template.endTime);
      let nextDate: string | null = null;
      // An end before the start means the block runs past midnight.
      if (end.getTime() <= start.getTime()) {
        end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
        nextDate = addDays(key, 1);
      }

      await prisma.timeTask.create({
        data: {
          date: key,
          nextDate,
          startTime: start,
          endTime: end,
          mainCategoryId: template.mainCategoryId,
          subCategoryId: template.subCategoryId,
          linkedTemplateId: template.id,
          priority: template.priority,
          note: template.note,
          isInStatistics: template.isInStatistics,
          isEnableNotification: template.isEnableNotification,
          planSource: "TEMPLATE",
          enforce: template.enforce,
          challengeType: template.challengeType,
          difficulty: template.difficulty,
          requiredCorrect: template.requiredCorrect,
          silent: template.silent,
          vibrate: template.vibrate,
        },
      });
      created += 1;
    }
  }

  return created;
}

export { describeRepeat } from "./repeat-format";
