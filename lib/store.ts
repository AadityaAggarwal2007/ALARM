import { promises as fs } from "fs";
import path from "path";
import type { PushSubscription } from "web-push";

export type ServerAlarm = {
  id: string;
  time: string;
  label: string;
  challengeType: "math" | "typing";
  difficulty: "easy" | "medium" | "hard";
  requiredCorrect: number;
  enabled: boolean;
  vibrate: boolean;
  /** No siren — wake by a repeating burst of push notifications instead. */
  silent: boolean;
};

export type PushSub = {
  id: string;
  subscription: PushSubscription;
  createdAt: number;
};

const DATA_DIR = process.env.ALARM_DATA_DIR || path.join(process.cwd(), "data");
const ALARMS_FILE = path.join(DATA_DIR, "alarms.json");
const SUBS_FILE = path.join(DATA_DIR, "subscriptions.json");

let writeQueue: Promise<void> = Promise.resolve();

async function readFile<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeFile(file: string, data: unknown): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}

function mutate<T>(fn: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(fn);
  writeQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

// ------------------------------------------------------------------ alarms

export function listAlarms(): Promise<ServerAlarm[]> {
  return readFile<ServerAlarm[]>(ALARMS_FILE, []);
}

export function saveAlarm(alarm: ServerAlarm): Promise<ServerAlarm[]> {
  return mutate(async () => {
    const all = await listAlarms();
    const idx = all.findIndex((a) => a.id === alarm.id);
    if (idx >= 0) all[idx] = alarm;
    else all.push(alarm);
    all.sort((a, b) => a.time.localeCompare(b.time));
    await writeFile(ALARMS_FILE, all);
    return all;
  });
}

export function deleteAlarm(id: string): Promise<ServerAlarm[]> {
  return mutate(async () => {
    const all = (await listAlarms()).filter((a) => a.id !== id);
    await writeFile(ALARMS_FILE, all);
    return all;
  });
}

// ---------------------------------------------------------- push subscriptions

export function listSubs(): Promise<PushSub[]> {
  return readFile<PushSub[]>(SUBS_FILE, []);
}

export function saveSub(sub: PushSub): Promise<void> {
  return mutate(async () => {
    const all = (await listSubs()).filter((s) => s.id !== sub.id);
    all.push(sub);
    await writeFile(SUBS_FILE, all);
  });
}

export function deleteSub(id: string): Promise<void> {
  return mutate(async () => {
    const all = (await listSubs()).filter((s) => s.id !== id);
    await writeFile(SUBS_FILE, all);
  });
}
