/**
 * Pure formatting for repeat rules — no database import.
 *
 * Kept apart from lib/repeat.ts because the templates screen is a client
 * component: importing it from the module that talks to Prisma would drag
 * better-sqlite3, and therefore `fs`, into the browser bundle.
 */

type RepeatLike = {
  type: string;
  day: string | null;
  dayNumber: number | null;
  month: string | null;
  weekNumber: number | null;
};

function nth(n: number | null): string {
  if (!n) return "";
  if (n % 10 === 1 && n !== 11) return "st";
  if (n % 10 === 2 && n !== 12) return "nd";
  if (n % 10 === 3 && n !== 13) return "rd";
  return "th";
}

const short = (d: string | null) =>
  d ? d.slice(0, 1) + d.slice(1, 3).toLowerCase() : "";

export function describeRepeat(rules: RepeatLike[]): string {
  if (rules.length === 0) return "";

  const weekly = rules.filter((r) => r.type === "WEEK_DAY");
  if (weekly.length === rules.length) {
    if (weekly.length === 7) return "Every day";
    return weekly.map((r) => short(r.day)).join(", ");
  }

  return rules
    .map((r) => {
      switch (r.type) {
        case "WEEK_DAY":
          return `Every ${short(r.day)}`;
        case "WEEK_DAY_IN_MONTH":
          return `${r.weekNumber}${nth(r.weekNumber)} ${short(r.day)} of month`;
        case "MONTH_DAY":
          return `${r.dayNumber}${nth(r.dayNumber)} of month`;
        case "YEAR_DAY":
          return `${r.month?.slice(0, 3)} ${r.dayNumber}`;
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join(" · ");
}
