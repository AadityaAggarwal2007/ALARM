import { promises as fs } from "fs";
import path from "path";
import type { PushSubscription } from "web-push";

export type Alarm = {
  id: string;
  label: string;
  fireAt: number;
  subscription: PushSubscription;
  sentAt: number | null;
};

const DATA_DIR = process.env.ALARM_DATA_DIR || path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "alarms.json");

let writeQueue: Promise<void> = Promise.resolve();

async function readAll(): Promise<Alarm[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as Alarm[];
  } catch {
    return [];
  }
}

async function writeAll(alarms: Alarm[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(alarms, null, 2));
  await fs.rename(tmp, FILE);
}

/** Serialize mutations so two concurrent requests cannot clobber each other. */
function mutate<T>(fn: (alarms: Alarm[]) => [Alarm[], T]): Promise<T> {
  const result = writeQueue.then(async () => {
    const [next, value] = fn(await readAll());
    await writeAll(next);
    return value;
  });
  writeQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export function listAlarms(): Promise<Alarm[]> {
  return readAll();
}

export function saveAlarm(alarm: Alarm): Promise<Alarm> {
  return mutate((alarms) => [
    [...alarms.filter((a) => a.id !== alarm.id), alarm],
    alarm,
  ]);
}

export function deleteAlarm(id: string): Promise<boolean> {
  return mutate((alarms) => {
    const next = alarms.filter((a) => a.id !== id);
    return [next, next.length !== alarms.length];
  });
}

export function markSent(id: string): Promise<void> {
  return mutate((alarms) => [
    alarms.map((a) => (a.id === id ? { ...a, sentAt: Date.now() } : a)),
    undefined,
  ]);
}

/** Drop alarms that fired long ago so the file does not grow without bound. */
export function pruneExpired(olderThanMs = 24 * 60 * 60 * 1000): Promise<void> {
  const cutoff = Date.now() - olderThanMs;
  return mutate((alarms) => [
    alarms.filter((a) => a.sentAt === null || a.sentAt > cutoff),
    undefined,
  ]);
}
