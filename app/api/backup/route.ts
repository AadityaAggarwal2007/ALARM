import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Full export. Push subscriptions are deliberately excluded — they are device
 *  secrets and are worthless on a restore anyway. */
export async function GET() {
  const [categories, subCategories, tasks, templates, repeats, undef, goals] =
    await Promise.all([
      prisma.mainCategory.findMany(),
      prisma.subCategory.findMany(),
      prisma.timeTask.findMany(),
      prisma.template.findMany(),
      prisma.repeatTime.findMany(),
      prisma.undefinedTask.findMany(),
      prisma.goal.findMany(),
    ]);

  const body = JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      categories,
      subCategories,
      tasks,
      templates,
      repeatTimes: repeats,
      undefinedTasks: undef,
      goals: goals.map((g) => ({ ...g, targetValue: Number(g.targetValue) })),
    },
    null,
    2
  );

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="discipline-backup-${new Date()
        .toISOString()
        .slice(0, 10)}.json"`,
    },
  });
}
