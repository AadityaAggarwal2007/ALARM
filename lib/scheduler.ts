import { prisma } from "./db";
import { pushReady, sendPush } from "./push";
import { dateKey } from "./time";
import { generateForRange } from "./repeat";

const TICK_MS = 500;

/**
 * An enforced block keeps buzzing until its challenge is solved. One
 * notification is a chime you sleep through, so the burst repeats — see
 * app/page.tsx for the client half.
 */
const RING_INTERVAL_MS = Number(process.env.ALARM_BUZZ_INTERVAL_MS || 1_000);
/**
 * Capped at 3 minutes. At a 1s cadence that is ~180 notifications to Apple for
 * a single block, roughly where APNs starts throttling. The cap stops one
 * ignored block from spending the morning hammering it.
 */
const MAX_RING_MS = 3 * 60 * 1000;

/** Reminder triggers, in minutes before start. `beforeEnd` is handled apart. */
const REMINDERS: { field: string; minutes: number; label: string }[] = [
  { field: "fifteenMinBefore", minutes: 15, label: "in 15 minutes" },
  { field: "oneHourBefore", minutes: 60, label: "in 1 hour" },
  { field: "threeHourBefore", minutes: 180, label: "in 3 hours" },
  { field: "oneDayBefore", minutes: 1440, label: "tomorrow" },
  { field: "oneWeekBefore", minutes: 10080, label: "in a week" },
];

type RingSession = {
  taskId: number;
  startedAt: number;
  lastPushAt: number;
  pushes: number;
};

/**
 * Next.js does not guarantee that instrumentation.ts and the route handlers
 * share a module instance, so ring state lives on globalThis. Without it
 * /api/ring/dismiss would clear a map the scheduler never reads, and a ringing
 * block could not be stopped.
 */
type SchedulerState = {
  timer: NodeJS.Timeout | null;
  ringing: Map<number, RingSession>;
  firedToday: Set<string>;
  lastGeneratedFor: string | null;
};

const g = globalThis as typeof globalThis & { __discipline?: SchedulerState };

const state: SchedulerState = (g.__discipline ??= {
  timer: null,
  ringing: new Map(),
  firedToday: new Set(),
  lastGeneratedFor: null,
});

export function activeRings(): number[] {
  return [...state.ringing.keys()];
}

export function stopRinging(taskId: number): boolean {
  return state.ringing.delete(taskId);
}

async function pushAll(payload: Record<string, unknown>) {
  const subs = await prisma.pushSubscription.findMany();
  for (const sub of subs) {
    const alive = await sendPush(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      payload
    );
    if (!alive) {
      await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
    }
  }
}

function taskTitle(task: {
  note: string | null;
  mainCategory: { defaultType: string | null; customName: string | null };
}): string {
  if (task.note) return task.note;
  return task.mainCategory.customName || task.mainCategory.defaultType || "Block";
}

async function tick() {
  if (!pushReady()) return;
  const now = Date.now();
  const today = dateKey();

  // Materialise repeating templates for the days ahead, once per day.
  if (state.lastGeneratedFor !== today) {
    state.lastGeneratedFor = today;
    state.firedToday.clear();
    await generateForRange(today, 14).catch((e) =>
      console.error("[scheduler] template generation failed", e)
    );
  }

  const tasks = await prisma.timeTask.findMany({
    where: { date: { in: [today] } },
    include: { mainCategory: true },
  });

  for (const task of tasks) {
    const start = task.startTime.getTime();
    const end = task.endTime.getTime();

    // --- Reminder triggers: fire once, no repeat. ---
    if (task.isEnableNotification) {
      for (const r of REMINDERS) {
        if (!(task as unknown as Record<string, boolean>)[r.field]) continue;
        const at = start - r.minutes * 60_000;
        const key = `${task.id}:${r.field}`;
        if (state.firedToday.has(key)) continue;
        if (now < at || now - at > 60_000) continue;
        state.firedToday.add(key);
        await pushAll({
          title: taskTitle(task),
          body: `Starts ${r.label}.`,
          taskId: task.id,
        });
      }

      const endKey = `${task.id}:beforeEnd`;
      if (task.beforeEnd && !state.firedToday.has(endKey)) {
        const at = end - 60_000;
        if (now >= at && now - at <= 60_000) {
          state.firedToday.add(endKey);
          await pushAll({
            title: taskTitle(task),
            body: "Ends in a minute.",
            taskId: task.id,
          });
        }
      }
    }

    // --- Enforcement: ring at start, keep ringing until solved. ---
    if (!task.enforce || task.dismissedAt || task.gaveUpAt) continue;
    const startKey = `${task.id}:enforce`;
    if (state.firedToday.has(startKey) || state.ringing.has(task.id)) continue;
    if (now < start || now - start > 2 * 60 * 1000) continue;

    state.firedToday.add(startKey);
    state.ringing.set(task.id, {
      taskId: task.id,
      startedAt: now,
      lastPushAt: now,
      pushes: 1,
    });
    await prisma.timeTask
      .update({ where: { id: task.id }, data: { ringStartedAt: new Date() } })
      .catch(() => {});
    await pushAll({
      title: taskTitle(task),
      body: "Open the app and solve the challenge to stop it.",
      taskId: task.id,
      silent: task.silent,
      repeat: 1,
    });
  }

  // --- Keep buzzing whatever is still ringing. ---
  for (const [id, session] of state.ringing) {
    if (now - session.startedAt > MAX_RING_MS) {
      state.ringing.delete(id);
      await prisma.timeTask
        .update({ where: { id }, data: { gaveUpAt: new Date() } })
        .catch(() => {});
      continue;
    }
    if (now - session.lastPushAt < RING_INTERVAL_MS) continue;

    const task = await prisma.timeTask
      .findUnique({ where: { id }, include: { mainCategory: true } })
      .catch(() => null);
    if (!task || task.dismissedAt || !task.enforce) {
      state.ringing.delete(id);
      continue;
    }

    session.lastPushAt = now;
    session.pushes += 1;
    await pushAll({
      title: taskTitle(task),
      body: "Open the app and solve the challenge to stop it.",
      taskId: id,
      silent: task.silent,
      repeat: session.pushes,
    });
  }
}

export function startScheduler() {
  if (state.timer) return;
  state.timer = setInterval(() => {
    tick().catch((error) => console.error("[scheduler] tick failed", error));
  }, TICK_MS);
  state.timer.unref?.();
  console.log("[scheduler] started");
}
