import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { listAlarms, saveAlarm, deleteAlarm, type ServerAlarm } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listAlarms());
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const time = typeof body.time === "string" ? body.time : "";
  if (!/^\d{2}:\d{2}$/.test(time)) {
    return NextResponse.json({ error: "time must be HH:MM." }, { status: 400 });
  }

  const alarm: ServerAlarm = {
    id: typeof body.id === "string" && body.id ? body.id : randomUUID(),
    time,
    label:
      typeof body.label === "string" ? body.label.trim().slice(0, 60) : "",
    challengeType:
      body.challengeType === "typing" ? "typing" : "math",
    difficulty:
      body.difficulty === "easy"
        ? "easy"
        : body.difficulty === "hard"
          ? "hard"
          : "medium",
    requiredCorrect:
      typeof body.requiredCorrect === "number" &&
      [1, 3, 5].includes(body.requiredCorrect)
        ? body.requiredCorrect
        : 3,
    enabled: body.enabled !== false,
    vibrate: body.vibrate === true,
    silent: body.silent === true,
  };

  const all = await saveAlarm(alarm);
  return NextResponse.json(all);
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  const all = await deleteAlarm(id);
  return NextResponse.json(all);
}
