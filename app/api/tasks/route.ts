import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { addDays } from "@/lib/time";

export const dynamic = "force-dynamic";

const INCLUDE = {
  mainCategory: true,
  subCategory: true,
} as const;

/** GET /api/tasks?date=YYYY-MM-DD  or  ?from=...&to=... */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  if (date) {
    const tasks = await prisma.timeTask.findMany({
      where: { date },
      include: INCLUDE,
      orderBy: { startTime: "asc" },
    });
    return NextResponse.json(tasks);
  }

  if (from && to) {
    const tasks = await prisma.timeTask.findMany({
      where: { date: { gte: from, lte: to } },
      include: INCLUDE,
      orderBy: { startTime: "asc" },
    });
    return NextResponse.json(tasks);
  }

  const today = new Date().toISOString().slice(0, 10);
  const tasks = await prisma.timeTask.findMany({
    where: { date: { gte: today, lte: addDays(today, 7) } },
    include: INCLUDE,
    orderBy: { startTime: "asc" },
  });
  return NextResponse.json(tasks);
}

function parseBody(body: Record<string, unknown>) {
  const start = new Date(String(body.startTime));
  let end = new Date(String(body.endTime));
  const date = String(body.date);
  let nextDate: string | null = null;

  // End at or before start means the block runs past midnight.
  if (end.getTime() <= start.getTime()) {
    end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    nextDate = addDays(date, 1);
  }

  return {
    date,
    nextDate,
    startTime: start,
    endTime: end,
    mainCategoryId: Number(body.mainCategoryId),
    subCategoryId: body.subCategoryId ? Number(body.subCategoryId) : null,
    priority: ["STANDARD", "MEDIUM", "MAX"].includes(String(body.priority))
      ? String(body.priority)
      : "STANDARD",
    note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
    isCompleted: body.isCompleted === true,
    isInStatistics: body.isInStatistics !== false,
    isEnableNotification: body.isEnableNotification === true,
    fifteenMinBefore: body.fifteenMinBefore === true,
    oneHourBefore: body.oneHourBefore === true,
    threeHourBefore: body.threeHourBefore === true,
    oneDayBefore: body.oneDayBefore === true,
    oneWeekBefore: body.oneWeekBefore === true,
    beforeEnd: body.beforeEnd === true,
    enforce: body.enforce === true,
    challengeType: body.challengeType === "typing" ? "typing" : "math",
    difficulty: ["easy", "medium", "hard"].includes(String(body.difficulty))
      ? String(body.difficulty)
      : "easy",
    requiredCorrect: [1, 3, 5].includes(Number(body.requiredCorrect))
      ? Number(body.requiredCorrect)
      : 3,
    silent: body.silent === true,
    vibrate: body.vibrate !== false,
  };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const data = parseBody(body);
  if (!data.date || !Number.isFinite(data.mainCategoryId)) {
    return NextResponse.json(
      { error: "date and mainCategoryId are required." },
      { status: 400 }
    );
  }

  const id = body.id ? Number(body.id) : null;

  if (id) {
    const task = await prisma.timeTask.update({
      where: { id },
      data,
      include: INCLUDE,
    });
    return NextResponse.json(task);
  }

  const task = await prisma.timeTask.create({
    data: {
      ...data,
      planSource:
        typeof body.planSource === "string" ? body.planSource : "MANUAL",
      linkedTemplateId: body.linkedTemplateId
        ? Number(body.linkedTemplateId)
        : null,
    },
    include: INCLUDE,
  });
  return NextResponse.json(task);
}

export async function DELETE(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  await prisma.timeTask.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}

/** PATCH for cheap partial updates: completion, drag-to-move, resize. */
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  if (!body || !Number.isFinite(id)) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.isCompleted === "boolean") data.isCompleted = body.isCompleted;
  if (body.startTime) data.startTime = new Date(String(body.startTime));
  if (body.endTime) data.endTime = new Date(String(body.endTime));
  if (typeof body.date === "string") data.date = body.date;
  if (typeof body.note === "string") data.note = body.note;

  const task = await prisma.timeTask.update({
    where: { id },
    data,
    include: INCLUDE,
  });
  return NextResponse.json(task);
}
