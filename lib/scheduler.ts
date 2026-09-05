import { listAlarms, listSubs, deleteSub, type ServerAlarm } from "./store";
import { pushReady, sendPush } from "./push";

const TICK_MS = 1_000;

/**
 * A silent alarm has no siren, so the only thing that can wake you is the
 * phone buzzing for an incoming notification. One notification is a chime you
 * sleep through — so a silent alarm re-pushes on every tick until it is
 * dismissed, or until it gives up.
 */
const RING_INTERVAL_MS = Number(process.env.ALARM_BUZZ_INTERVAL_MS || 2_000);
/**
 * Capped at 3 minutes. At a 2s cadence that is ~90 notifications to Apple's
 * push service for one alarm; going faster or longer risks being throttled,
 * which would cost you the alarm entirely.
 */
const MAX_RING_MS = 3 * 60 * 1000;

type RingSession = {
  alarmId: string;
  startedAt: number;
  lastPushAt: number;
  pushes: number;
};

/**
 * Next.js can load this module more than once — instrumentation.ts and the
 * route handlers do not always share a module instance. Ring state has to be
 * the same object for both, or /api/dismiss would clear a map the scheduler
 * never reads and the phone would keep buzzing with no way to stop it.
 */
type SchedulerState = {
  timer: NodeJS.Timeout | null;
  sentToday: Map<string, boolean>;
  ringing: Map<string, RingSession>;
};

const globalState = globalThis as typeof globalThis & {
  __alarmScheduler?: SchedulerState;
};

const state: SchedulerState = (globalState.__alarmScheduler ??= {
  timer: null,
  sentToday: new Map(),
  ringing: new Map(),
});

const { sentToday, ringing } = state;

/**
 * Today's occurrence of an alarm time, past or future.
 *
 * Deliberately NOT "the next occurrence": rolling a passed time forward to
 * tomorrow makes it permanently in the future, so a due-check against it can
 * never pass and the alarm never fires.
 */
function todayOccurrence(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  const target = new Date();
  target.setHours(hours, minutes, 0, 0);
  return target.getTime();
}

function todayKey(alarmId: string): string {
  const d = new Date();
  return `${alarmId}:${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Called by /api/dismiss when the challenge is solved, to stop the buzzing. */
export function stopRinging(alarmId: string): boolean {
  return ringing.delete(alarmId);
}

export function activeRings(): string[] {
  return [...ringing.keys()];
}

async function pushToAll(alarm: ServerAlarm, repeat: number) {
  const subs = await listSubs();
  console.log(
    `[scheduler] push "${alarm.label}" silent=${alarm.silent} repeat=${repeat} to ${subs.length} device(s)`
  );
  for (const sub of subs) {
    const alive = await sendPush(sub.subscription, {
      title: alarm.label || "Alarm",
      body: "Open the app and solve the challenge to stop it.",
      alarmId: alarm.id,
      silent: alarm.silent,
      repeat,
    });
    if (!alive) await deleteSub(sub.id);
  }
}

async function tick() {
  if (!pushReady()) return;

  const now = Date.now();
  const alarms = await listAlarms();
  const byId = new Map(alarms.map((a) => [a.id, a]));

  // 1. Start sessions for alarms that just came due.
  for (const alarm of alarms) {
    if (!alarm.enabled) continue;
    const key = todayKey(alarm.id);
    if (sentToday.get(key)) continue;

    const fireAt = todayOccurrence(alarm.time);
    const late = now - fireAt;
    // Due when the time has passed, but not so long ago that the moment is gone.
    if (late < 0 || late > 2 * 60 * 1000) continue;

    sentToday.set(key, true);
    ringing.set(alarm.id, {
      alarmId: alarm.id,
      startedAt: now,
      lastPushAt: now,
      pushes: 1,
    });
    await pushToAll(alarm, 1);
  }

  // 2. Keep buzzing anything still ringing.
  for (const [id, session] of ringing) {
    const alarm = byId.get(id);
    if (!alarm || !alarm.enabled) {
      ringing.delete(id);
      continue;
    }
    if (now - session.startedAt > MAX_RING_MS) {
      ringing.delete(id);
      continue;
    }
    // A siren alarm wakes you through the audio layer; it does not need to be
    // re-notified. Only silent alarms repeat.
    if (!alarm.silent) {
      ringing.delete(id);
      continue;
    }
    if (now - session.lastPushAt < RING_INTERVAL_MS) continue;

    session.lastPushAt = now;
    session.pushes += 1;
    await pushToAll(alarm, session.pushes);
  }
}

export function startScheduler() {
  if (state.timer) return;

  const msToMidnight = () => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return midnight.getTime() - now.getTime();
  };
  const scheduleCleanup = () => {
    const t = setTimeout(() => {
      sentToday.clear();
      scheduleCleanup();
    }, msToMidnight());
    t.unref?.();
  };
  scheduleCleanup();

  state.timer = setInterval(() => {
    tick().catch((error) => console.error("[scheduler] tick failed", error));
  }, TICK_MS);
  state.timer.unref?.();
  console.log("[scheduler] started");
}
