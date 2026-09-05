import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { activeRings, stopRinging } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

/**
 * The client polls this to learn that a block is ringing, so a phone that was
 * asleep when the push arrived still lands in the challenge on open.
 */
export async function GET() {
  const ids = activeRings();
  if (ids.length === 0) return NextResponse.json({ ringing: null });

  const task = await prisma.timeTask.findFirst({
    where: { id: { in: ids }, dismissedAt: null },
    include: { mainCategory: true, subCategory: true },
    orderBy: { startTime: "asc" },
  });
  return NextResponse.json({ ringing: task ?? null });
}

/** Solving the challenge lands here: stop the burst, record the discipline. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const id = Number(body.taskId);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "taskId is required." }, { status: 400 });
  }

  const stopped = stopRinging(id);
  const attempts = Number.isFinite(Number(body.attempts))
    ? Number(body.attempts)
    : 0;

  // First write wins. A second call — a stale tab that was still polling, a
  // retry, a double tap — would otherwise overwrite the record with a later
  // time and zero attempts, quietly making the discipline history a lie.
  const { count } = await prisma.timeTask.updateMany({
    where: { id, dismissedAt: null },
    data: { dismissedAt: new Date(), dismissAttempts: attempts },
  });

  return NextResponse.json({ stopped, recorded: count > 0 });
}
