import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { deleteAlarm, saveAlarm } from "@/lib/store";
import { pushReady } from "@/lib/push";

export const dynamic = "force-dynamic";

const MAX_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;

type Body = {
  fireAt?: unknown;
  label?: unknown;
  subscription?: unknown;
};

function validSubscription(value: unknown): value is {
  endpoint: string;
  keys: { p256dh: string; auth: string };
} {
  if (typeof value !== "object" || value === null) return false;
  const sub = value as Record<string, unknown>;
  const keys = sub.keys as Record<string, unknown> | undefined;
  return (
    typeof sub.endpoint === "string" &&
    sub.endpoint.startsWith("https://") &&
    typeof keys?.p256dh === "string" &&
    typeof keys?.auth === "string"
  );
}

export async function POST(request: Request) {
  if (!pushReady()) {
    return NextResponse.json(
      { error: "Push is not configured on this server." },
      { status: 503 }
    );
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const fireAt = Number(body.fireAt);
  if (!Number.isFinite(fireAt) || fireAt <= Date.now()) {
    return NextResponse.json(
      { error: "fireAt must be a timestamp in the future." },
      { status: 400 }
    );
  }
  if (fireAt - Date.now() > MAX_AHEAD_MS) {
    return NextResponse.json(
      { error: "Alarms cannot be more than 7 days out." },
      { status: 400 }
    );
  }
  if (!validSubscription(body.subscription)) {
    return NextResponse.json(
      { error: "A valid push subscription is required." },
      { status: 400 }
    );
  }

  const label =
    typeof body.label === "string" && body.label.trim()
      ? body.label.trim().slice(0, 60)
      : "Alarm";

  const alarm = await saveAlarm({
    id: randomUUID(),
    label,
    fireAt,
    subscription: body.subscription,
    sentAt: null,
  });

  return NextResponse.json({ id: alarm.id, fireAt: alarm.fireAt });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  return NextResponse.json({ deleted: await deleteAlarm(id) });
}
