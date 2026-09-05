import { NextResponse } from "next/server";
import { requireAgent } from "@/lib/ai/guard";
import { applyPlan } from "@/lib/ai/apply";

export const dynamic = "force-dynamic";

/**
 * The single write endpoint. One call, many intents.
 *
 * Every plan is validated as a dry run first and only executed if the whole
 * thing is sound, so a malformed op late in a plan cannot leave the schedule
 * half-changed. `dryRun: true` stops after that pass and returns the diff.
 */
export async function POST(request: Request) {
  const denied = await requireAgent(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const ops = Array.isArray(body.ops) ? body.ops : null;
  if (!ops || ops.length === 0) {
    return NextResponse.json(
      { ok: false, error: "ops must be a non-empty array. Call /api/ai/describe for the shape." },
      { status: 400 }
    );
  }
  if (ops.length > 100) {
    return NextResponse.json(
      { ok: false, error: "A plan is limited to 100 ops. Use repeat and selectors instead of one op per block." },
      { status: 400 }
    );
  }

  const preview = await applyPlan(ops, true);
  if (!preview.ok || body.dryRun === true) {
    return NextResponse.json(preview, { status: preview.ok ? 200 : 409 });
  }

  return NextResponse.json(await applyPlan(ops, false));
}
