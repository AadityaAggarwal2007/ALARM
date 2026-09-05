import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const tasks = await prisma.undefinedTask.findMany({
    include: { mainCategory: true, subCategory: true },
    orderBy: [{ deadline: "asc" }, { createdAt: "desc" }],
  });
  return NextResponse.json(tasks);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  // Batch create from pasted text: one task per non-empty line.
  if (typeof body.bulk === "string" && body.bulk.trim()) {
    const mainCategoryId = Number(body.mainCategoryId);
    if (!Number.isFinite(mainCategoryId)) {
      return NextResponse.json(
        { error: "mainCategoryId is required." },
        { status: 400 }
      );
    }
    const lines = body.bulk
      .split("\n")
      .map((l: string) => l.trim())
      .filter(Boolean)
      .slice(0, 200);
    await prisma.undefinedTask.createMany({
      data: lines.map((note: string) => ({ mainCategoryId, note })),
    });
    return NextResponse.json({ created: lines.length });
  }

  const data = {
    mainCategoryId: Number(body.mainCategoryId),
    subCategoryId: body.subCategoryId ? Number(body.subCategoryId) : null,
    priority: ["STANDARD", "MEDIUM", "MAX"].includes(String(body.priority))
      ? String(body.priority)
      : "STANDARD",
    note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
    deadline: body.deadline ? new Date(String(body.deadline)) : null,
  };

  if (!Number.isFinite(data.mainCategoryId)) {
    return NextResponse.json(
      { error: "mainCategoryId is required." },
      { status: 400 }
    );
  }

  if (body.id) {
    const updated = await prisma.undefinedTask.update({
      where: { id: Number(body.id) },
      data,
      include: { mainCategory: true, subCategory: true },
    });
    return NextResponse.json(updated);
  }

  const created = await prisma.undefinedTask.create({
    data,
    include: { mainCategory: true, subCategory: true },
  });
  return NextResponse.json(created);
}

export async function DELETE(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  await prisma.undefinedTask.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
