// Seeds the 15 built-in categories from the TimePlanner blueprint.
//
// Idempotent: defaultType is unique, so re-running only fills in what is
// missing and never duplicates or overwrites edits.

import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const dataDir = process.env.ALARM_DATA_DIR
  ? path.resolve(process.env.ALARM_DATA_DIR)
  : path.join(process.cwd(), "data");

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({
    url: `file:${path.join(dataDir, "discipline.db")}`,
  }),
});

const DEFAULTS = [
  "WORK",
  "REST",
  "SPORT",
  "SLEEP",
  "CULTURE",
  "AFFAIRS",
  "TRANSPORT",
  "STUDY",
  "EAT",
  "ENTERTAINMENTS",
  "EMPTY",
  "HYGIENE",
  "HEALTH",
  "SHOPPING",
  "OTHER",
];

async function main() {
  for (const [i, defaultType] of DEFAULTS.entries()) {
    await prisma.mainCategory.upsert({
      where: { defaultType },
      update: {},
      create: { defaultType, sortOrder: i },
    });
  }

  await prisma.themeSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
  await prisma.tasksSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });

  const count = await prisma.mainCategory.count();
  console.log(`[seed] ${count} categories present`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
