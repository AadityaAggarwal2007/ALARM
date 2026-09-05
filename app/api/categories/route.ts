import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const categories = await prisma.mainCategory.findMany({
    include: { subCategories: { orderBy: { name: "asc" } } },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json(categories);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const name = typeof body.customName === "string" ? body.customName.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "customName is required." }, { status: 400 });
  }

  if (body.id) {
    const updated = await prisma.mainCategory.update({
      where: { id: Number(body.id) },
      data: { customName: name },
    });
    return NextResponse.json(updated);
  }

  const max = await prisma.mainCategory.aggregate({ _max: { sortOrder: true } });
  const created = await prisma.mainCategory.create({
    data: { customName: name, sortOrder: (max._max.sortOrder ?? 0) + 1 },
  });
  return NextResponse.json(created);
}

export async function DELETE(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  // Built-ins are not deletable: tasks cascade off categories, so removing one
  // would silently take its history with it.
  const category = await prisma.mainCategory.findUnique({ where: { id } });
  if (!category) return NextResponse.json({ ok: true });
  if (category.defaultType) {
    return NextResponse.json(
      { error: "Built-in categories cannot be deleted." },
      { status: 400 }
    );
  }
  await prisma.mainCategory.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
