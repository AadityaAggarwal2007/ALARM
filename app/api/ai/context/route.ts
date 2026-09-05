import { NextResponse } from "next/server";
import { requireAgent } from "@/lib/ai/guard";
import { buildContext, buildAnalyticsSummary } from "@/lib/ai/context";

export const dynamic = "force-dynamic";

/** The single read endpoint: schedule, rules, goals, inbox, and optionally
 *  the discipline summary — in one response. */
export async function GET(request: Request) {
  const denied = await requireAgent(request);
  if (denied) return denied;

  const p = new URL(request.url).searchParams;
  const context = await buildContext({
    from: p.get("from") || undefined,
    days: p.get("days") ? Number(p.get("days")) : undefined,
  });

  if (p.get("analytics") === "1" || p.get("analytics") === "true") {
    return NextResponse.json({
      ...context,
      analytics: await buildAnalyticsSummary(p.get("preset") || "WEEK"),
    });
  }
  return NextResponse.json(context);
}
