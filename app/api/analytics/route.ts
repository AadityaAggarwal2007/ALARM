import { NextResponse } from "next/server";
import { computeAnalytics, computeCategoryDetail, resolveRange } from "@/lib/analytics";
import { dateKey } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const range = resolveRange(
    p.get("preset") || "WEEK",
    p.get("anchor") || dateKey(),
    p.get("from"),
    p.get("to")
  );

  const categoryId = p.get("categoryId");
  if (categoryId) {
    return NextResponse.json(
      await computeCategoryDetail(Number(categoryId), range)
    );
  }

  return NextResponse.json(await computeAnalytics(range));
}
