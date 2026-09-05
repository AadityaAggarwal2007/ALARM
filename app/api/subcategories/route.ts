import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const mainCategoryId = Number(body.mainCategoryId);
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : null;

  if (!name || !Number.isFinite(mainCategoryId)) {
    return NextResponse.json(
      { error: "name and mainCategoryId are required." },
      { status: 400 }
    );
  }

  if (body.id) {
    const updated = await prisma.subCategory.update({
      where: { id: Number(body.id) },
      data: { name, description },
    });
    return NextResponse.json(updated);
  }

  const created = await prisma.subCategory.create({
    data: { name, description, mainCategoryId },
  });
  return NextResponse.json(created);
}

export async function DELETE(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  await prisma.subCategory.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
