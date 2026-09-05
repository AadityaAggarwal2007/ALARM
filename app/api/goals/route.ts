import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { evaluateGoal } from "@/lib/goals";

export const dynamic = "force-dynamic";

export async function GET() {
  const goals = await prisma.goal.findMany({
    include: { mainCategory: true, subCategory: true },
    orderBy: { deadline: "asc" },
  });
  const evaluated = await Promise.all(goals.map(evaluateGoal));
  // BigInt does not survive JSON.stringify, so targets are widened to numbers
  // on the way out. Values here are hours-in-millis or small counts.
  return NextResponse.json(evaluated);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "title is required." }, { status: 400 });
  }

  const data = {
    title,
    scopeType: ["ALL", "MAIN_CATEGORY", "SUB_CATEGORY"].includes(
      String(body.scopeType)
    )
      ? String(body.scopeType)
      : "ALL",
    mainCategoryId: body.mainCategoryId ? Number(body.mainCategoryId) : null,
    subCategoryId: body.subCategoryId ? Number(body.subCategoryId) : null,
    metric: body.metric === "TASK_COUNT" ? "TASK_COUNT" : "DURATION",
    direction: body.direction === "AT_MOST" ? "AT_MOST" : "AT_LEAST",
    targetValue: BigInt(Math.max(0, Math.round(Number(body.targetValue) || 0))),
    deadline: new Date(String(body.deadline)),
  };

  const goal = body.id
    ? await prisma.goal.update({ where: { id: Number(body.id) }, data })
    : await prisma.goal.create({ data });

  return NextResponse.json({ id: goal.id });
}

export async function DELETE(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  await prisma.goal.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
