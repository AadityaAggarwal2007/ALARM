import { NextResponse } from "next/server";
import { randomUUID, createHash } from "crypto";
import { prisma } from "@/lib/db";
import { pushReady } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!pushReady()) {
    return NextResponse.json(
      { error: "Push is not configured on this server." },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => ({}));
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

  // Keyed by endpoint so a device that re-subscribes replaces its own row
  // instead of leaving a dead one behind to be pushed at forever.
  const endpoint = sub.endpoint;
  const id =
    typeof body.id === "string" && body.id
      ? body.id
      : createHash("sha256").update(endpoint).digest("hex").slice(0, 32) ||
        randomUUID();

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { p256dh: keys.p256dh, auth: keys.auth },
    create: { id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
  });

  return NextResponse.json({ id });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  await prisma.pushSubscription.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
