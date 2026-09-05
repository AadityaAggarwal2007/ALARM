import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { pushReady, sendPush } from "@/lib/push";

export const dynamic = "force-dynamic";

const BUZZES = 3;
const GAP_MS = 1500;

/** Fires a short burst so the phone can be checked in a pocket right now,
 *  instead of scheduling a block a minute out and waiting for it. */
export async function POST() {
  if (!pushReady()) {
    return NextResponse.json(
      { error: "Push is not configured on this server." },
      { status: 503 }
    );
  }

  const subs = await prisma.pushSubscription.findMany();
  if (subs.length === 0) {
    return NextResponse.json(
      { error: "No device is subscribed. Allow notifications first." },
      { status: 400 }
    );
  }

  let sent = 0;
  for (let i = 0; i < BUZZES; i++) {
    for (const sub of subs) {
      const alive = await sendPush(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        {
          title: "Test buzz",
          body: `Buzz ${i + 1} of ${BUZZES} — this is what a block feels like.`,
          repeat: i + 1,
        }
      );
      if (alive) sent += 1;
      else await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
    }
    if (i < BUZZES - 1) await new Promise((r) => setTimeout(r, GAP_MS));
  }

  return NextResponse.json({ sent, devices: subs.length });
}
