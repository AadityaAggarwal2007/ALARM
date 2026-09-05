import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateForRange } from "@/lib/repeat";
import { dateKey } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET() {
  const templates = await prisma.template.findMany({
    include: { mainCategory: true, subCategory: true, repeatTimes: true },
    orderBy: { startTime: "asc" },
  });
  return NextResponse.json(templates);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  const data = {
    startTime: new Date(String(body.startTime)),
    endTime: new Date(String(body.endTime)),
    mainCategoryId: Number(body.mainCategoryId),
    subCategoryId: body.subCategoryId ? Number(body.subCategoryId) : null,
    priority: ["STANDARD", "MEDIUM", "MAX"].includes(String(body.priority))
      ? String(body.priority)
      : "STANDARD",
    note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
    isEnableNotification: body.isEnableNotification === true,
    isInStatistics: body.isInStatistics !== false,
    repeatEnabled: body.repeatEnabled === true,
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

  if (!Number.isFinite(data.mainCategoryId)) {
    return NextResponse.json(
      { error: "mainCategoryId is required." },
      { status: 400 }
    );
  }

  const repeats = Array.isArray(body.repeatTimes) ? body.repeatTimes : [];
  const repeatData = repeats.map((r: Record<string, unknown>) => ({
    type: String(r.type),
    day: r.day ? String(r.day) : null,
    dayNumber: r.dayNumber != null ? Number(r.dayNumber) : null,
    month: r.month ? String(r.month) : null,
    weekNumber: r.weekNumber != null ? Number(r.weekNumber) : null,
  }));

  const id = body.id ? Number(body.id) : null;
  let template;

  if (id) {
    // Repeat rules are replaced wholesale — simpler and safer than diffing,
    // and they are only ever edited as a set in the UI.
    await prisma.repeatTime.deleteMany({ where: { templateId: id } });
    template = await prisma.template.update({
      where: { id },
      data: { ...data, repeatTimes: { create: repeatData } },
      include: { mainCategory: true, subCategory: true, repeatTimes: true },
    });
  } else {
    template = await prisma.template.create({
      data: { ...data, repeatTimes: { create: repeatData } },
      include: { mainCategory: true, subCategory: true, repeatTimes: true },
    });
  }

  // Materialise the next two weeks immediately, so a new repeating block shows
  // up on the calendar straight away rather than at the next daily pass.
  await generateForRange(dateKey(), 14).catch(() => {});

  return NextResponse.json(template);
}

export async function DELETE(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  await prisma.template.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
