import { NextResponse } from "next/server";
import { stopRinging, activeRings } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

/** The client calls this once the challenge is solved, to stop the buzzing. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const id = typeof body.alarmId === "string" ? body.alarmId : "";
  if (!id) {
    return NextResponse.json({ error: "alarmId is required." }, { status: 400 });
  }
  return NextResponse.json({ stopped: stopRinging(id) });
}

export async function GET() {
  return NextResponse.json({ ringing: activeRings() });
}
