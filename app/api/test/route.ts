import { NextResponse } from "next/server";
import { listSubs, deleteSub } from "@/lib/store";
import { pushReady, sendPush } from "@/lib/push";

export const dynamic = "force-dynamic";

const BUZZES = 3;
const GAP_MS = 2000;

/**
 * Fires a short burst immediately so you can confirm the phone actually buzzes
 * in your pocket, without scheduling an alarm a minute out and waiting for it.
 */
export async function POST() {
  if (!pushReady()) {
    return NextResponse.json(
      { error: "Push is not configured on this server." },
      { status: 503 }
    );
  }

  const subs = await listSubs();
  if (subs.length === 0) {
    return NextResponse.json(
      { error: "No device is subscribed. Allow notifications first." },
      { status: 400 }
    );
  }

  let sent = 0;
  for (let i = 0; i < BUZZES; i++) {
    for (const sub of subs) {
      const alive = await sendPush(sub.subscription, {
        title: "Test buzz",
        body: `Buzz ${i + 1} of ${BUZZES} — this is what an alarm feels like.`,
        alarmId: "test",
        repeat: i + 1,
      });
      if (alive) sent += 1;
      else await deleteSub(sub.id);
    }
    if (i < BUZZES - 1) await new Promise((r) => setTimeout(r, GAP_MS));
  }

  return NextResponse.json({ sent, devices: subs.length });
}
