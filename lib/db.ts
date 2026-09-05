import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

// Same resolution as prisma.config.ts, so the CLI and the running app always
// agree on which file the database is.
const dataDir = process.env.ALARM_DATA_DIR
  ? path.resolve(process.env.ALARM_DATA_DIR)
  : path.join(process.cwd(), "data");

const dbPath = path.join(dataDir, "discipline.db");

// Next.js does not guarantee one module instance across instrumentation and
// route handlers, and dev reloads re-import freely. Without this the app opens
// a new SQLite connection per reload until it runs out of handles.
const globalForPrisma = globalThis as typeof globalThis & {
  __prisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.__prisma ??
  new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: `file:${dbPath}` }),
  });

globalForPrisma.__prisma = prisma;
