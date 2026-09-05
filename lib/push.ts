import webpush from "web-push";

let configured = false;

export function pushReady(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
  );
}

export function publicKey(): string {
  return process.env.VAPID_PUBLIC_KEY || "";
}

function configure() {
  if (configured) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:alarm@localhost",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
  configured = true;
}

/** Returns false when the subscription is dead and should be discarded. */
export async function sendPush(
  subscription: webpush.PushSubscription,
  payload: Record<string, unknown>
): Promise<boolean> {
  configure();
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), {
      TTL: 300,
      urgency: "high",
    });
    return true;
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return false;
    console.error("[push] send failed", status, error);
    return true;
  }
}
