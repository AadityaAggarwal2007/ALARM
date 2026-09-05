import { NextResponse } from "next/server";
import { requireAgent } from "@/lib/ai/guard";
import { buildAnalyticsSummary } from "@/lib/ai/context";

export const dynamic = "force-dynamic";

/** Analytics on demand, so context stays cheap when it is not needed. */
export async function GET(request: Request) {
  const denied = await requireAgent(request);
  if (denied) return denied;

  const preset = new URL(request.url).searchParams.get("preset") || "WEEK";
  return NextResponse.json(await buildAnalyticsSummary(preset));
}
