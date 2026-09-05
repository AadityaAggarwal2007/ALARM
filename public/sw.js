self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim())
);

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = {};
  }

  event.waitUntil(
    (async () => {
      // iOS only vibrates for a notification it considers NEW. Re-showing the
      // same tag (even with renotify) can land silently, which defeats the
      // whole point of a vibrate-only alarm — so each push gets a unique tag and
      // the previous one is closed first, leaving a single visible card that
      // still alerts every time.
      const existing = await self.registration.getNotifications();
      for (const note of existing) {
        if (note.tag && note.tag.startsWith("alarm-")) note.close();
      }

      const repeat = typeof data.repeat === "number" ? data.repeat : 1;

      await self.registration.showNotification(data.title || "Alarm", {
        body: data.body || "Open the app to stop the alarm.",
        tag: `alarm-${Date.now()}`,
        renotify: true,
        requireInteraction: true,
        // Honoured on Android; ignored on iOS, which uses system settings.
        vibrate: [500, 250, 500, 250, 500, 700],
        data: { url: "/?ring=1", alarmId: data.alarmId || null, repeat },
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ("focus" in client) return client.focus();
        }
        return self.clients.openWindow("/?ring=1");
      })
  );
});
