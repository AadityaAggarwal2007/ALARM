import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const [theme, tasks] = await Promise.all([
    prisma.themeSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
    prisma.tasksSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
  ]);
  return NextResponse.json({ theme, tasks });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  if (body.theme) {
    await prisma.themeSettings.update({ where: { id: 1 }, data: body.theme });
  }
  if (body.tasks) {
    await prisma.tasksSettings.update({ where: { id: 1 }, data: body.tasks });
  }

  const [theme, tasks] = await Promise.all([
    prisma.themeSettings.findUnique({ where: { id: 1 } }),
    prisma.tasksSettings.findUnique({ where: { id: 1 } }),
  ]);
  return NextResponse.json({ theme, tasks });
}
