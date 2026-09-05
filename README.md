# Alarm

An alarm you have to earn your way out of. It runs in the browser on your phone —
to silence it you must solve math problems or retype a phrase, correctly, several
times in a row.

Built because iOS gives web apps no alarm API. This works around that with two
independent layers.

## How it stays alive on iOS

| Layer | Covers | Loudness |
| --- | --- | --- |
| Keep-alive audio track | App open — phone locked or switched to another app | Full volume, continuous |
| Server web push | App fully closed | One notification chime |

**The audio layer.** iOS suspends a page's timers as soon as it is backgrounded,
unless the page is actively playing media. So the app plays a 40 Hz tone at
0.00015 amplitude — inaudible through a phone speaker, but not digital silence,
which iOS treats as nothing playing at all. When the alarm is due, the same
`<audio>` element swaps to a loud two-tone siren. iOS ignores
`HTMLAudioElement.volume`, so the loudness is baked into the generated waveform
rather than set as a property. Pausing from Control Center is caught and resumed
immediately, since a pause would freeze the timer the alarm depends on.

Cost: roughly 1–2% extra battery per hour.

**The push layer.** If the app is closed, the audio trick is gone with it. The
server holds the alarm time and sends a Web Push at that moment. This requires
the app to be installed to the Home Screen — iOS refuses web push in a plain
Safari tab. It is a notification, not an alarm: it chimes once and respects
silent mode. Tapping it opens the app, which then rings properly.

## Setup

```bash
npm install
npm run keys        # prints VAPID keys
```

Put the printed keys in `.env.local`:

```
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
```

```bash
npm run dev         # http://localhost:3002
```

## Deploying

```bash
npm run build
pm2 start npm --name alarm -- start
```

Two hard requirements for the push layer:

- **HTTPS.** Service workers and push are refused over plain HTTP.
- **Add to Home Screen** on the iPhone. Push does not work in a Safari tab.

Alarms are stored as JSON on disk (`./data`, or set `ALARM_DATA_DIR`). A
scheduler started from `instrumentation.ts` polls every 10 seconds and sends due
pushes. A push more than 5 minutes late is dropped rather than fired — the
moment has passed.

Note the push fallback fires from the server, so if that box is down at alarm
time you are left with the foreground layer only.

## Layout

```
app/page.tsx          state machine: idle -> armed -> ringing -> done
lib/audio.ts          WAV synthesis, keep-alive track, pause guard
lib/challenges.ts     math and typing challenges, three difficulties
lib/scheduler.ts      polls for due alarms, sends push
lib/store.ts          JSON persistence with serialized writes
public/sw.js          service worker: push + notification click
```
