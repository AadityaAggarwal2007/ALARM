import { deleteAlarm, listAlarms, markSent, pruneExpired } from "./store";
import { pushReady, sendPush } from "./push";

const TICK_MS = 10_000;
/** A push that is more than this late is stale — the moment has passed. */
const MAX_LATENESS_MS = 5 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

async function tick() {
  if (!pushReady()) return;

  const now = Date.now();
  const due = (await listAlarms()).filter(
    (a) => a.sentAt === null && a.fireAt <= now
  );

  for (const alarm of due) {
    if (now - alarm.fireAt > MAX_LATENESS_MS) {
      await markSent(alarm.id);
      continue;
    }

    const alive = await sendPush(alarm.subscription, {
      title: alarm.label || "Alarm",
      body: "Open the app and solve the challenge to stop it.",
      alarmId: alarm.id,
    });

    if (alive) await markSent(alarm.id);
    else await deleteAlarm(alarm.id);
  }
}

export function startScheduler() {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((error) => console.error("[scheduler] tick failed", error));
  }, TICK_MS);
  // Do not hold the process open on shutdown.
  timer.unref?.();
  pruneExpired().catch(() => {});
  console.log("[scheduler] started");
}
