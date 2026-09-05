import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma 7 moved the connection URL out of schema.prisma and no longer loads
// .env by itself. The database is a file inside the project, not a credential,
// so it is resolved here rather than pulled from the environment — one source
// of truth that lib/db.ts reads too, with no dotenv dependency for one path.
//
// ALARM_DATA_DIR still overrides it, to keep the deployment knob the app has
// always had.
const dataDir = process.env.ALARM_DATA_DIR
  ? path.resolve(process.env.ALARM_DATA_DIR)
  : path.join(process.cwd(), "data");

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  datasource: {
    url: `file:${path.join(dataDir, "discipline.db")}`,
  },
});
