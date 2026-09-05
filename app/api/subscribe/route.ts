import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { saveSub, deleteSub } from "@/lib/store";
import { pushReady } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!pushReady()) {
    return NextResponse.json(
      { error: "Push is not configured on this server." },
      { status: 503 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const sub = body.subscription as Record<string, unknown> | undefined;
  const keys = sub?.keys as Record<string, unknown> | undefined;
  if (
    !sub ||
    typeof sub.endpoint !== "string" ||
    !sub.endpoint.startsWith("https://") ||
    typeof keys?.p256dh !== "string" ||
    typeof keys?.auth !== "string"
  ) {
    return NextResponse.json(
      { error: "A valid push subscription is required." },
      { status: 400 }
    );
  }

  const id = typeof body.id === "string" && body.id ? body.id : randomUUID();

  await saveSub({
    id,
    subscription: sub as unknown as Parameters<typeof saveSub>[0]["subscription"],
    createdAt: Date.now(),
  });

  return NextResponse.json({ id });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  await deleteSub(id);
  return NextResponse.json({ ok: true });
}
