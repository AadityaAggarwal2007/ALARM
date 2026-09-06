import { prisma } from "../db";
import { addDays, dateKey, weekdayOf } from "../time";
import { at, assertDate, parseDuration, parseSpan, toTime } from "./wall";
import { categoryMeta } from "../categories";

/**
 * The plan engine: one call, many intents, all or nothing.
 *
 * The governing rule, and the reason this file is careful:
 *
 *   Nothing recurs unless it was asked to recur, and no edit ever rewrites a
 *   rule by accident.
 *
 * `schedule` makes plain one-off blocks; it creates a repeating rule only when
 * `repeat` is given explicitly. `update` and `delete` default to scope "this",
 * touching single occurrences. If a selector lands on rule-generated blocks and
 * no scope was stated, nothing is written at all — the engine returns
 * `needs_scope` so the model can put the question back to a human. Guessing
 * there means silently changing an alarm weeks into the future.
 */

/** How far ahead rule occurrences are materialised. */
export const HORIZON_DAYS = 60;

export type Scope = "this" | "future" | "all";

export type ApplyResult = {
  ok: boolean;
  dryRun: boolean;
  summary: string;
  created: number;
  updated: number;
  deleted: number;
  changes: string[];
  needsScope?: {
    op: number;
    question: string;
    ruleBlocks: number;
    oneOffBlocks: number;
    rules: string[];
    choices: Record<string, string>;
  };
  error?: string;
  atOp?: number;
};

const norm = (s: string) => s.trim().toLowerCase();

// ------------------------------------------------------------- categories

type CatEntry = { id: number; subs: Map<string, number> };

async function loadCategories(): Promise<Map<string, CatEntry>> {
  const rows = await prisma.mainCategory.findMany({ include: { subCategories: true } });
  const map = new Map<string, CatEntry>();
  for (const c of rows) {
    const entry = {
      id: c.id,
      subs: new Map(c.subCategories.map((s) => [norm(s.name), s.id])),
    };
    // Reachable by display name ("Sleep") and by raw type ("SLEEP"), so a
    // model that saw either form in an earlier response still resolves.
    map.set(norm(categoryMeta(c).label), entry);
    if (c.defaultType) map.set(norm(c.defaultType), entry);
    if (c.customName) map.set(norm(c.customName), entry);
  }
  return map;
}

// ---------------------------------------------------------------- enforce

type EnforceInput = {
  mode?: string;
  challenge?: string;
  difficulty?: string;
  streak?: number;
  say?: string;
  vibrate?: boolean;
};

const MODES = ["SILENT", "VIBRATE", "SIREN", "VOICE"];

function enforceFields(e: EnforceInput | null | undefined) {
  if (e === null) return { enforce: false };
  if (!e) return {};

  const mode = String(e.mode || "SIREN").toUpperCase();
  if (!MODES.includes(mode)) {
    throw new Error(`enforce.mode must be one of ${MODES.join(", ")}. Got "${e.mode}".`);
  }
  const difficulty = String(e.difficulty || "easy").toLowerCase();
  if (!["easy", "medium", "hard"].includes(difficulty)) {
    throw new Error(`enforce.difficulty must be easy, medium or hard. Got "${e.difficulty}".`);
  }
  const challenge = String(e.challenge || "math").toLowerCase();
  if (!["math", "typing"].includes(challenge)) {
    throw new Error(`enforce.challenge must be math or typing. Got "${e.challenge}".`);
  }
  const streak = Number(e.streak ?? 3);
  if (![1, 3, 5].includes(streak)) {
    throw new Error(`enforce.streak must be 1, 3 or 5. Got ${e.streak}.`);
  }

  return {
    enforce: true,
    wakeMode: mode,
    challengeType: challenge,
    difficulty,
    requiredCorrect: streak,
    voiceText: e.say ? String(e.say).slice(0, 200) : null,
    vibrate: e.vibrate !== false,
  };
}

/**
 * Reminders, chosen individually.
 *
 * `true` means the ordinary "tell me when it starts"; a list picks exact
 * lead times. These are the gentle layer — one notification, unlike an
 * enforced block, which repeats until solved.
 */
const REMINDER_FIELDS: Record<string, string> = {
  "15m": "fifteenMinBefore",
  "1h": "oneHourBefore",
  "3h": "threeHourBefore",
  "1d": "oneDayBefore",
  "1w": "oneWeekBefore",
  end: "beforeEnd",
};

function reminderFields(value: unknown) {
  if (value === false || value === null) {
    return { isEnableNotification: false };
  }
  const base: Record<string, unknown> = {
    isEnableNotification: true,
    fifteenMinBefore: false,
    oneHourBefore: false,
    threeHourBefore: false,
    oneDayBefore: false,
    oneWeekBefore: false,
    beforeEnd: false,
  };
  if (value === true) return base;
  if (!Array.isArray(value)) {
    throw new Error(
      `remind must be true, false, or a list from ${Object.keys(REMINDER_FIELDS).join(", ")}.`
    );
  }
  for (const item of value) {
    const field = REMINDER_FIELDS[String(item).toLowerCase()];
    if (!field) {
      throw new Error(
        `unknown reminder "${item}". Valid: ${Object.keys(REMINDER_FIELDS).join(", ")}.`
      );
    }
    base[field] = true;
  }
  return base;
}

// --------------------------------------------------------------- selector

export type Where = {
  key?: string;
  category?: string;
  sub?: string;
  note?: string;
  from?: string;
  to?: string;
  weekdays?: string[];
  ids?: number[];
  enforced?: boolean;
  /** "odd" / "even" over the matched set, for "half of them". */
  nth?: "odd" | "even";
};

async function select(where: Where) {
  const filters: Record<string, unknown> = {};

  if (where.ids?.length) filters.id = { in: where.ids.map(Number) };
  if (where.from || where.to) {
    filters.date = {
      ...(where.from ? { gte: assertDate(where.from, "where.from") } : {}),
      ...(where.to ? { lte: assertDate(where.to, "where.to") } : {}),
    };
  }
  if (where.note) filters.note = { contains: where.note };
  if (typeof where.enforced === "boolean") filters.enforce = where.enforced;

  if (where.key) filters.planKey = where.key;

  if (where.category) {
    const cats = await prisma.mainCategory.findMany();
    const wanted = norm(where.category!);
    const hit = cats.find(
      (c) =>
        norm(categoryMeta(c).label) === wanted ||
        norm(c.defaultType || "") === wanted ||
        norm(c.customName || "") === wanted
    );
    if (!hit) return [];
    filters.mainCategoryId = hit.id;
  }
  if (where.sub) {
    const subs = await prisma.subCategory.findMany();
    const hit = subs.find((s) => norm(s.name) === norm(where.sub!));
    if (!hit) return [];
    filters.subCategoryId = hit.id;
  }

  let rows = await prisma.timeTask.findMany({
    where: filters,
    orderBy: { startTime: "asc" },
  });

  if (where.weekdays?.length) {
    const want = new Set(where.weekdays.map((d) => String(d).toUpperCase()));
    rows = rows.filter((r) => want.has(weekdayOf(r.date)));
  }
  if (where.nth === "odd") rows = rows.filter((_, i) => i % 2 === 0);
  if (where.nth === "even") rows = rows.filter((_, i) => i % 2 === 1);

  return rows;
}

// ------------------------------------------------------------ generation

/** Materialise a rule across the rolling window, honouring tombstones. */
export async function materialise(
  templateId: number,
  from = dateKey(),
  days = HORIZON_DAYS
): Promise<number> {
  const tpl = await prisma.template.findUnique({
    where: { id: templateId },
    include: { repeatTimes: true, skips: true },
  });
  if (!tpl || !tpl.repeatEnabled) return 0;

  const keys = Array.from({ length: days }, (_, i) => addDays(from, i)).filter(
    (k) => !tpl.until || k <= tpl.until
  );
  if (keys.length === 0) return 0;

  const existing = await prisma.timeTask.findMany({
    where: { linkedTemplateId: tpl.id, date: { in: keys } },
    select: { date: true },
  });
  const have = new Set(existing.map((e) => e.date));
  const skipped = new Set(tpl.skips.map((s) => s.date));

  const startHM = toTime(tpl.startTime);
  const endHM = toTime(tpl.endTime);

  let made = 0;
  for (const key of keys) {
    if (have.has(key) || skipped.has(key)) continue;
    const matches = tpl.repeatTimes.some(
      (r) => r.type === "WEEK_DAY" && r.day === weekdayOf(key)
    );
    if (!matches) continue;

    const start = at(key, startHM);
    let end = at(key, endHM);
    let nextDate: string | null = null;
    if (end.getTime() <= start.getTime()) {
      end = new Date(end.getTime() + 86400000);
      nextDate = addDays(key, 1);
    }

    await prisma.timeTask.create({
      data: {
        date: key,
        nextDate,
        startTime: start,
        endTime: end,
        mainCategoryId: tpl.mainCategoryId,
        subCategoryId: tpl.subCategoryId,
        linkedTemplateId: tpl.id,
        planKey: tpl.key,
        priority: tpl.priority,
        note: tpl.note,
        isInStatistics: tpl.isInStatistics,
        isEnableNotification: tpl.isEnableNotification,
        planSource: "TEMPLATE",
        enforce: tpl.enforce,
        challengeType: tpl.challengeType,
        difficulty: tpl.difficulty,
        requiredCorrect: tpl.requiredCorrect,
        wakeMode: tpl.wakeMode,
        voiceText: tpl.voiceText,
        vibrate: tpl.vibrate,
      },
    });
    made += 1;
  }
  return made;
}

/** Top up every active rule. Called daily by the scheduler. */
export async function materialiseAll(): Promise<number> {
  const rules = await prisma.template.findMany({
    where: { repeatEnabled: true },
    select: { id: true },
  });
  let total = 0;
  for (const r of rules) total += await materialise(r.id);
  return total;
}

// ----------------------------------------------------------------- engine

type Op = Record<string, unknown>;

export async function applyPlan(
  ops: Op[],
  dryRun: boolean
): Promise<ApplyResult> {
  const changes: string[] = [];
  let created = 0;
  let updated = 0;
  let deleted = 0;

  const categories = await loadCategories();

  const resolve = async (name?: string, sub?: string) => {
    const wanted = norm(name || "Other");
    let entry = categories.get(wanted);
    if (!entry) {
      if (dryRun) {
        changes.push(`create category "${name || "Other"}"`);
        return { mainCategoryId: -1, subCategoryId: null };
      }
      const max = await prisma.mainCategory.aggregate({ _max: { sortOrder: true } });
      const row = await prisma.mainCategory.create({
        data: { customName: name || "Other", sortOrder: (max._max.sortOrder ?? 0) + 1 },
      });
      entry = { id: row.id, subs: new Map() };
      categories.set(wanted, entry);
      changes.push(`created category "${name || "Other"}"`);
    }
    let subId: number | null = null;
    if (sub) {
      const k = norm(sub);
      subId = entry.subs.get(k) ?? null;
      if (subId === null) {
        if (dryRun) {
          changes.push(`create subcategory "${sub}"`);
        } else {
          const row = await prisma.subCategory.create({
            data: { name: sub, mainCategoryId: entry.id },
          });
          entry.subs.set(k, row.id);
          subId = row.id;
          changes.push(`created subcategory "${sub}"`);
        }
      }
    }
    return { mainCategoryId: entry.id, subCategoryId: subId };
  };

  const KINDS = ["schedule", "update", "delete", "goal", "goal_delete", "inbox", "rule"];

  /**
   * Both Claude models reached for `{ "schedule": { ... } }` — the op name as a
   * key wrapping its own arguments — rather than `{ "op": "schedule", ... }`.
   * It is a perfectly reasonable reading, and rejecting it only bought a wasted
   * round trip before they retried in the documented shape. Accepting it costs
   * nothing and removes a whole class of retry.
   */
  const normalise = (raw: Op): Op => {
    if (raw.op) return raw;
    const key = KINDS.find((k) => raw[k] && typeof raw[k] === "object");
    if (!key) return raw;
    return { ...(raw[key] as Record<string, unknown>), op: key };
  };

  for (let i = 0; i < ops.length; i++) {
    const op = normalise(ops[i]);
    const kind = String(op.op || "").toLowerCase();

    try {
      // ------------------------------------------------------- schedule
      if (kind === "schedule") {
        const span = parseSpan(String(op.time || ""));
        const { mainCategoryId, subCategoryId } = await resolve(
          op.category as string,
          op.sub as string
        );
        const enforce = enforceFields(op.enforce as EnforceInput);
        const note =
          typeof op.note === "string" && op.note.trim()
            ? op.note.trim().slice(0, 120)
            : typeof op.title === "string"
              ? String(op.title).slice(0, 120)
              : null;
        const key = typeof op.key === "string" ? op.key : null;
        const priority = ["STANDARD", "MEDIUM", "MAX"].includes(
          String(op.priority || "").toUpperCase()
        )
          ? String(op.priority).toUpperCase()
          : "STANDARD";

        const repeat = op.repeat as
          | { weekdays?: string[]; from?: string; until?: string }
          | undefined;

        // --- A rule, only because `repeat` was given explicitly. ---
        if (repeat && Array.isArray(repeat.weekdays) && repeat.weekdays.length) {
          const from = repeat.from ? assertDate(repeat.from, "repeat.from") : dateKey();
          const until = repeat.until ? assertDate(repeat.until, "repeat.until") : null;
          const weekdays = repeat.weekdays.map((d) => String(d).toUpperCase());

          if (dryRun) {
            const span2 = until
              ? Math.max(0, Math.round((new Date(until).getTime() - new Date(from).getTime()) / 86400000))
              : HORIZON_DAYS;
            const est = Math.round((Math.min(span2, HORIZON_DAYS) / 7) * weekdays.length);
            changes.push(
              `repeat "${note}" ${weekdays.join("/")} ${span.start}-${span.end}` +
                `${until ? ` until ${until}` : ""} → ~${est} blocks in the next ${HORIZON_DAYS} days`
            );
            created += est;
            continue;
          }

          const data = {
            startTime: at(from, span.start),
            endTime: at(from, span.end),
            mainCategoryId,
            subCategoryId,
            priority,
            note,
            key,
            until,
            repeatEnabled: true,
            isInStatistics: op.countInStats !== false,
            ...reminderFields(op.remind ?? false),
            ...enforceFields(op.enforce as EnforceInput ?? undefined),
          };

          const existing = key
            ? await prisma.template.findUnique({ where: { key } })
            : null;

          const tpl = existing
            ? await prisma.template.update({
                where: { id: existing.id },
                data: { ...data, repeatTimes: { deleteMany: {} } },
              })
            : await prisma.template.create({ data });

          await prisma.repeatTime.createMany({
            data: weekdays.map((day) => ({
              templateId: tpl.id,
              type: "WEEK_DAY",
              day,
              dayNumber: null,
              month: null,
              weekNumber: null,
            })),
          });

          // Re-applying an edited rule replaces its future occurrences, but
          // never the past — history stays as it actually happened.
          if (existing) {
            const today = dateKey();
            const removed = await prisma.timeTask.deleteMany({
              where: {
                linkedTemplateId: tpl.id,
                date: { gte: today },
                dismissedAt: null,
              },
            });
            deleted += removed.count;
          }

          const made = await materialise(tpl.id, from);
          created += made;
          changes.push(
            `${existing ? "updated" : "created"} repeat "${note}" (${weekdays.join("/")}) → ${made} blocks`
          );
          continue;
        }

        // --- One-off blocks. The default, deliberately. ---
        //
        // A key promises idempotency — describe_api states that re-sending a
        // plan edits what the key made rather than duplicating it — and that
        // was only ever true for rules. A model that retried a one-off block
        // (a tool result it misread, a second pass over its own plan) silently
        // produced two. Re-applying a key now replaces what it made.
        if (key && !dryRun) {
          const removed = await prisma.timeTask.deleteMany({
            where: { planKey: key, linkedTemplateId: null, dismissedAt: null },
          });
          if (removed.count) {
            changes.push(`replaced ${removed.count} earlier block(s) under key "${key}"`);
          }
        }

        const dates: string[] = Array.isArray(op.dates)
          ? (op.dates as string[]).map((d) => assertDate(d, "dates[]"))
          : [assertDate(op.date ?? dateKey(), "date")];

        for (const date of dates) {
          const start = at(date, span.start);
          let end = at(date, span.end);
          let nextDate: string | null = null;
          if (end.getTime() <= start.getTime()) {
            end = new Date(end.getTime() + 86400000);
            nextDate = addDays(date, 1);
          }
          if (dryRun) {
            created += 1;
            continue;
          }
          await prisma.timeTask.create({
            data: {
              date,
              nextDate,
              startTime: start,
              endTime: end,
              mainCategoryId,
              subCategoryId,
              priority,
              note,
              planKey: key,
              planSource: "MANUAL",
              isInStatistics: op.countInStats !== false,
              ...reminderFields(op.remind ?? false),
              ...enforce,
            },
          });
          created += 1;
        }
        changes.push(
          `${dryRun ? "would add" : "added"} "${note}" ${span.start}-${span.end} on ${dates.join(", ")}`
        );
        continue;
      }

      // --------------------------------------------------------- update
      if (kind === "update" || kind === "delete") {
        const where = (op.where || {}) as Where;
        const rows = await select(where);
        if (rows.length === 0) {
          changes.push(`no blocks matched (op ${i})`);
          continue;
        }

        const fromRule = rows.filter((r) => r.linkedTemplateId !== null);
        const scope = op.scope ? (String(op.scope) as Scope) : null;

        // The safety gate. A selector that lands on rule-generated blocks with
        // no scope stated is a question, not an instruction.
        if (fromRule.length > 0 && !scope) {
          const ruleIds = [...new Set(fromRule.map((r) => r.linkedTemplateId!))];
          const rules = await prisma.template.findMany({
            where: { id: { in: ruleIds } },
            select: { note: true, key: true },
          });
          return {
            ok: false,
            dryRun,
            summary: "Needs a scope: some of these blocks come from a repeating rule.",
            created: 0,
            updated: 0,
            deleted: 0,
            changes,
            needsScope: {
              op: i,
              question:
                `${fromRule.length} of the ${rows.length} matched block(s) come from a repeating rule ` +
                `(${rules.map((r) => `"${r.note || r.key}"`).join(", ")}). ` +
                `Ask which was meant before re-sending with a scope.`,
              ruleBlocks: fromRule.length,
              oneOffBlocks: rows.length - fromRule.length,
              rules: rules.map((r) => r.key || r.note || "rule"),
              choices: {
                this: "Only the matched occurrences. The rule is untouched, so future ones keep the old settings.",
                future: "The matched occurrences and the rule, so every future one inherits the change.",
                all: "Every occurrence of the rule, past included.",
              },
            },
          };
        }

        // Scope narrows the time range; it must never widen the selection.
        //
        // "all" previously refetched every block of the rule and discarded the
        // selector, so "change the Fridays, all occurrences" silently rewrote
        // Mondays and Wednesdays too. Every model tested sent exactly that
        // shape — weekdays FRIDAY with scope all — and meant "all the Fridays".
        // Their reading is the correct one.
        const todayKey = dateKey();
        const targets =
          scope === "future" ? rows.filter((r) => r.date >= todayKey) : rows;

        if (kind === "delete") {
          if (!dryRun) {
            // Tombstone each removed occurrence, or generation recreates it.
            for (const r of targets) {
              if (r.linkedTemplateId) {
                await prisma.repeatSkip.upsert({
                  where: {
                    templateId_date: { templateId: r.linkedTemplateId, date: r.date },
                  },
                  update: {},
                  create: { templateId: r.linkedTemplateId, date: r.date },
                });
              }
            }
            await prisma.timeTask.deleteMany({
              where: { id: { in: targets.map((t) => t.id) } },
            });

            if (scope === "future" || scope === "all") {
              const ruleIds = [...new Set(fromRule.map((r) => r.linkedTemplateId!))];
              // Stopping future occurrences means ending the rule, not just
              // deleting rows that would immediately be regenerated.
              await prisma.template.updateMany({
                where: { id: { in: ruleIds } },
                data: { repeatEnabled: false },
              });
              changes.push(`stopped ${ruleIds.length} repeating rule(s)`);
            }
          }
          deleted += targets.length;
          changes.push(`${dryRun ? "would delete" : "deleted"} ${targets.length} block(s)`);
          continue;
        }

        const set = (op.set || {}) as Record<string, unknown>;
        const patch: Record<string, unknown> = {};

        if (typeof set.note === "string") patch.note = set.note.slice(0, 120);
        if (typeof set.priority === "string") {
          patch.priority = String(set.priority).toUpperCase();
        }
        if (typeof set.completed === "boolean") patch.isCompleted = set.completed;
        if (typeof set.countInStats === "boolean") patch.isInStatistics = set.countInStats;
        if (set.remind !== undefined) Object.assign(patch, reminderFields(set.remind));
        if (set.enforce !== undefined) {
          Object.assign(patch, enforceFields(set.enforce as EnforceInput));
        }
        // Moving a block to another day and retiming it are the same write:
        // the timestamps are anchored to the date, so changing one without the
        // other would leave the row describing two different days.
        const newDate = set.date ? assertDate(set.date, "set.date") : null;
        if (typeof set.time === "string" || newDate) {
          const s2 = typeof set.time === "string" ? parseSpan(set.time) : null;
          for (const r of targets) {
            if (dryRun) continue;
            const date = newDate ?? r.date;
            const start = s2 ? s2.start : toTime(r.startTime);
            const end = s2 ? s2.end : toTime(r.endTime);
            const st = at(date, start);
            let en = at(date, end);
            let nextDate: string | null = null;
            if (en.getTime() <= st.getTime()) {
              en = new Date(en.getTime() + 86400000);
              nextDate = addDays(date, 1);
            }
            await prisma.timeTask.update({
              where: { id: r.id },
              data: { date, nextDate, startTime: st, endTime: en },
            });
          }
          changes.push(
            newDate
              ? `moved to ${newDate}${s2 ? ` ${s2.start}-${s2.end}` : ""}`
              : `retimed to ${s2!.start}-${s2!.end}`
          );
        }
        if (set.category || set.sub) {
          const r = await resolve(set.category as string, set.sub as string);
          if (r.mainCategoryId > 0) patch.mainCategoryId = r.mainCategoryId;
          if (r.subCategoryId !== null) patch.subCategoryId = r.subCategoryId;
        }

        if (Object.keys(patch).length && !dryRun) {
          await prisma.timeTask.updateMany({
            where: { id: { in: targets.map((t) => t.id) } },
            data: patch,
          });
        }

        // "future" has to reach the rule, or occurrences generated later
        // silently revert. But a rule holds ONE set of settings across all its
        // weekdays, so patching it in place when only some weekdays were
        // selected would corrupt the others — changing Fridays would quietly
        // change every future Monday too. When the selection is a strict
        // subset, the rule is split instead: the targeted weekdays move to a
        // new rule carrying the change, and the original keeps the rest.
        if ((scope === "future" || scope === "all") && fromRule.length && !dryRun) {
          const ruleIds = [...new Set(fromRule.map((r) => r.linkedTemplateId!))];
          const rulePatch: Record<string, unknown> = { ...patch };
          delete rulePatch.isCompleted;
          if (typeof set.time === "string") {
            const s2 = parseSpan(set.time);
            rulePatch.startTime = at(dateKey(), s2.start);
            rulePatch.endTime = at(dateKey(), s2.end);
          }

          for (const ruleId of ruleIds) {
            const rule = await prisma.template.findUnique({
              where: { id: ruleId },
              include: { repeatTimes: true },
            });
            if (!rule) continue;

            const ruleDays = rule.repeatTimes
              .filter((t) => t.type === "WEEK_DAY" && t.day)
              .map((t) => t.day!);
            const wanted = where.weekdays?.length
              ? where.weekdays.map((d) => String(d).toUpperCase())
              : ruleDays;
            const targeted = ruleDays.filter((d) => wanted.includes(d));
            const remaining = ruleDays.filter((d) => !wanted.includes(d));

            if (remaining.length === 0) {
              // The whole rule was selected: patch it in place.
              if (Object.keys(rulePatch).length) {
                await prisma.template.updateMany({
                  where: { id: ruleId },
                  data: rulePatch,
                });
                changes.push(`updated rule "${rule.note || rule.key}"`);
              }
              continue;
            }

            // Strict subset — split.
            const base = {
              startTime: rule.startTime,
              endTime: rule.endTime,
              mainCategoryId: rule.mainCategoryId,
              subCategoryId: rule.subCategoryId,
              priority: rule.priority,
              note: rule.note,
              until: rule.until,
              repeatEnabled: true,
              isInStatistics: rule.isInStatistics,
              isEnableNotification: rule.isEnableNotification,
              enforce: rule.enforce,
              challengeType: rule.challengeType,
              difficulty: rule.difficulty,
              requiredCorrect: rule.requiredCorrect,
              wakeMode: rule.wakeMode,
              voiceText: rule.voiceText,
              vibrate: rule.vibrate,
            };

            const splitKey = rule.key
              ? `${rule.key}-${targeted.map((d) => d.slice(0, 3).toLowerCase()).join("")}`
              : null;

            const split = await prisma.template.create({
              data: {
                ...base,
                ...rulePatch,
                key: splitKey,
                repeatTimes: {
                  create: targeted.map((day) => ({
                    type: "WEEK_DAY",
                    day,
                    dayNumber: null,
                    month: null,
                    weekNumber: null,
                  })),
                },
              },
            });

            // The original keeps only the weekdays that were not selected.
            await prisma.repeatTime.deleteMany({
              where: { templateId: ruleId, day: { in: targeted } },
            });

            // Re-point the changed occurrences at the rule that now owns them,
            // so a later edit to either rule finds the right blocks.
            await prisma.timeTask.updateMany({
              where: { id: { in: targets.map((t) => t.id) } },
              data: { linkedTemplateId: split.id, planKey: splitKey },
            });

            changes.push(
              `split rule "${rule.note || rule.key}": ${targeted.join("/")} moved to its own rule` +
                `${splitKey ? ` (key "${splitKey}")` : ""}, ${remaining.join("/")} unchanged`
            );
          }
        }

        updated += targets.length;
        changes.push(
          `${dryRun ? "would update" : "updated"} ${targets.length} block(s)` +
            (scope ? ` (scope: ${scope})` : "")
        );
        continue;
      }

      // ----------------------------------------------------------- goal
      if (kind === "goal") {
        const title = String(op.title || "").trim();
        if (!title) throw new Error("goal.title is required.");
        const metricRaw = String(op.metric || "DURATION").toUpperCase();
        const metric =
          metricRaw === "TASK_COUNT" || metricRaw === "COUNT" || metricRaw === "TASKS"
            ? "TASK_COUNT"
            : "DURATION";
        // "up"/"down" and "min"/"max" are the shapes models actually reach for.
        const dirRaw = String(op.direction || "AT_LEAST").toUpperCase();
        const direction = ["AT_MOST", "DOWN", "MAX", "UNDER"].includes(dirRaw)
          ? "AT_MOST"
          : "AT_LEAST";
        const target =
          metric === "DURATION"
            ? parseDuration(op.target as string)
            : Number(op.target || 0);

        const scopeObj = (
          typeof op.scope === "string"
            ? { category: op.scope }
            : op.scope || {}
        ) as { category?: string; sub?: string };
        let mainCategoryId: number | null = null;
        let subCategoryId: number | null = null;
        let scopeType = "ALL";
        if (scopeObj.category) {
          const r = await resolve(scopeObj.category, scopeObj.sub);
          mainCategoryId = r.mainCategoryId > 0 ? r.mainCategoryId : null;
          subCategoryId = r.subCategoryId;
          scopeType = scopeObj.sub ? "SUB_CATEGORY" : "MAIN_CATEGORY";
        }

        if (!dryRun) {
          const existing = await prisma.goal.findFirst({ where: { title } });
          const data = {
            title,
            scopeType,
            mainCategoryId,
            subCategoryId,
            metric,
            direction,
            targetValue: BigInt(Math.round(target)),
            deadline: at(assertDate(op.until ?? addDays(dateKey(), 7), "until"), "23:59"),
          };
          if (existing) {
            await prisma.goal.update({ where: { id: existing.id }, data });
            updated += 1;
          } else {
            await prisma.goal.create({ data });
            created += 1;
          }
        } else {
          created += 1;
        }
        changes.push(`${dryRun ? "would set" : "set"} goal "${title}"`);
        continue;
      }

      // -------------------------------------------------------- inbox
      // Things with no time yet. Kept as its own op rather than a flavour of
      // schedule, because "capture this, I'll place it later" is a different
      // intent from "put this at four o'clock".
      if (kind === "inbox") {
        const action = String(op.action || "add").toLowerCase();

        if (action === "add") {
          const items: string[] = Array.isArray(op.items)
            ? (op.items as string[])
            : [String(op.title || "")];
          const { mainCategoryId, subCategoryId } = await resolve(
            op.category as string,
            op.sub as string
          );
          for (const title of items.filter(Boolean)) {
            if (dryRun) {
              created += 1;
              continue;
            }
            await prisma.undefinedTask.create({
              data: {
                mainCategoryId,
                subCategoryId,
                note: title.slice(0, 120),
                priority: "STANDARD",
                deadline: op.by ? at(assertDate(op.by, "by"), "23:59") : null,
              },
            });
            created += 1;
          }
          changes.push(`${dryRun ? "would add" : "added"} ${items.length} inbox item(s)`);
          continue;
        }

        if (action === "schedule") {
          const span = parseSpan(String(op.time || ""));
          const date = assertDate(op.date ?? dateKey(), "date");
          const items = await prisma.undefinedTask.findMany({
            where: op.title
              ? { note: { contains: String(op.title) } }
              : op.ids
                ? { id: { in: (op.ids as number[]).map(Number) } }
                : {},
            take: op.title || op.ids ? undefined : 1,
          });
          for (const item of items) {
            if (dryRun) {
              created += 1;
              continue;
            }
            const st = at(date, span.start);
            let en = at(date, span.end);
            if (en.getTime() <= st.getTime()) en = new Date(en.getTime() + 86400000);
            await prisma.timeTask.create({
              data: {
                date,
                startTime: st,
                endTime: en,
                mainCategoryId: item.mainCategoryId,
                subCategoryId: item.subCategoryId,
                priority: item.priority,
                note: item.note,
                planSource: "UNDEFINED",
                ...enforceFields(op.enforce as EnforceInput),
              },
            });
            await prisma.undefinedTask.delete({ where: { id: item.id } });
            created += 1;
          }
          changes.push(`${dryRun ? "would schedule" : "scheduled"} ${items.length} inbox item(s) on ${date}`);
          continue;
        }

        if (action === "remove") {
          const where = op.title
            ? { note: { contains: String(op.title) } }
            : { id: { in: ((op.ids as number[]) || []).map(Number) } };
          if (!dryRun) {
            const r = await prisma.undefinedTask.deleteMany({ where });
            deleted += r.count;
          }
          changes.push(`${dryRun ? "would remove" : "removed"} inbox item(s)`);
          continue;
        }

        throw new Error(`inbox.action must be add, schedule or remove.`);
      }

      // --------------------------------------------------------- rule
      // Pausing is not deleting: a paused rule keeps its settings and its
      // history, and stops producing new occurrences until resumed.
      if (kind === "rule") {
        const key = String(op.key || "");
        if (!key) throw new Error("rule.key is required.");
        const rule = await prisma.template.findUnique({ where: { key } });
        if (!rule) throw new Error(`no rule with key "${key}".`);

        const action = String(op.action || "").toLowerCase();
        if (!["pause", "resume", "delete"].includes(action)) {
          throw new Error("rule.action must be pause, resume or delete.");
        }

        if (!dryRun) {
          if (action === "delete") {
            const r = await prisma.timeTask.deleteMany({
              where: { linkedTemplateId: rule.id, date: { gte: dateKey() }, dismissedAt: null },
            });
            deleted += r.count;
            await prisma.template.delete({ where: { id: rule.id } });
          } else {
            await prisma.template.update({
              where: { id: rule.id },
              data: { repeatEnabled: action === "resume" },
            });
            if (action === "pause") {
              const r = await prisma.timeTask.deleteMany({
                where: { linkedTemplateId: rule.id, date: { gte: dateKey() }, dismissedAt: null },
              });
              deleted += r.count;
            } else {
              created += await materialise(rule.id);
            }
          }
        }
        updated += 1;
        changes.push(`${dryRun ? "would " : ""}${action}d rule "${rule.note || key}"`);
        continue;
      }

      // --------------------------------------------------------- goal
      if (kind === "goal_delete") {
        const title = String(op.title || "");
        if (!dryRun) {
          const r = await prisma.goal.deleteMany({ where: { title } });
          deleted += r.count;
        }
        changes.push(`${dryRun ? "would delete" : "deleted"} goal "${title}"`);
        continue;
      }

      throw new Error(
        `unknown op "${op.op}". Valid: schedule, update, delete, goal, goal_delete, inbox, rule.`
      );
    } catch (error) {
      return {
        ok: false,
        dryRun,
        summary: `Plan rejected at op ${i}: ${(error as Error).message}`,
        created: 0,
        updated: 0,
        deleted: 0,
        changes,
        error: (error as Error).message,
        atOp: i,
      };
    }
  }

  const parts: string[] = [];
  if (created) parts.push(`${created} created`);
  if (updated) parts.push(`${updated} updated`);
  if (deleted) parts.push(`${deleted} deleted`);

  return {
    ok: true,
    dryRun,
    summary: parts.length
      ? `${dryRun ? "Would apply" : "Applied"}: ${parts.join(", ")}.`
      : "Nothing to change.",
    created,
    updated,
    deleted,
    changes,
  };
}
