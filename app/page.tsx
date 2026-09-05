"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlarmAudio } from "@/lib/audio";
import { AlarmVibration } from "@/lib/vibrate";
import {
  isCorrect,
  makeChallenge,
  type Challenge,
  type ChallengeType,
  type Difficulty,
} from "@/lib/challenges";

type ServerAlarm = {
  id: string;
  time: string;
  label: string;
  challengeType: ChallengeType;
  difficulty: Difficulty;
  requiredCorrect: number;
  enabled: boolean;
  vibrate: boolean;
  silent: boolean;
};

type ClientAlarm = ServerAlarm & {
  fireAt: number;
};

const MAX_LATE_MS = 5 * 60 * 1000;
const SUB_ID_KEY = "alarm.pushSubId";

function nextOccurrence(hhmm: string, after = Date.now()): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  const target = new Date(after);
  target.setHours(hours, minutes, 0, 0);
  if (target.getTime() <= after) target.setDate(target.getDate() + 1);
  return target.getTime();
}

function formatGap(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimeLabel(hhmm: string): string {
  const [hours, minutes] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `a${Date.now()}${Math.random().toString(16).slice(2)}`;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function enrich(server: ServerAlarm[]): ClientAlarm[] {
  const now = Date.now();
  return server
    .map((a) => ({
      ...a,
      fireAt: a.enabled ? nextOccurrence(a.time) : nextOccurrence(a.time, now),
    }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

type Draft = {
  id: string | null;
  time: string;
  label: string;
  challengeType: ChallengeType;
  difficulty: Difficulty;
  requiredCorrect: number;
  vibrate: boolean;
  silent: boolean;
};

const blankDraft = (): Draft => ({
  id: null,
  time: "07:00",
  label: "",
  challengeType: "math",
  difficulty: "easy",
  requiredCorrect: 3,
  vibrate: true,
  silent: false,
});

export default function Page() {
  const [alarms, setAlarms] = useState<ClientAlarm[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const [draft, setDraft] = useState<Draft | null>(null);
  const [ringingId, setRingingId] = useState<string | null>(null);

  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [input, setInput] = useState("");
  const [streak, setStreak] = useState(0);
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);
  const [dismissedAt, setDismissedAt] = useState(0);

  const [audioReady, setAudioReady] = useState(false);
  const [pushNote, setPushNote] = useState("");

  const audioRef = useRef<AlarmAudio | null>(null);
  const vibrationRef = useRef<AlarmVibration | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const vapidRef = useRef<string | null>(null);
  const alarmsRef = useRef<ClientAlarm[]>([]);

  alarmsRef.current = alarms;

  const ringing = alarms.find((a) => a.id === ringingId) ?? null;
  const enabled = useMemo(() => alarms.filter((a) => a.enabled), [alarms]);
  const nextUp = useMemo(
    () =>
      enabled.length
        ? enabled.reduce((a, b) => (a.fireAt <= b.fireAt ? a : b))
        : null,
    [enabled]
  );

  const getAudio = () => {
    if (!audioRef.current) audioRef.current = new AlarmAudio();
    return audioRef.current;
  };

  const getVibration = () => {
    if (!vibrationRef.current) vibrationRef.current = new AlarmVibration();
    return vibrationRef.current;
  };

  const stopVibration = useCallback(() => {
    vibrationRef.current?.stop();
  }, []);

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  const requestWakeLock = useCallback(async () => {
    const wakeLock = (
      navigator as Navigator & {
        wakeLock?: {
          request: (t: string) => Promise<{ release: () => Promise<void> }>;
        };
      }
    ).wakeLock;
    if (!wakeLock) return;
    try {
      wakeLockRef.current = await wakeLock.request("screen");
    } catch {}
  }, []);

  // ----------------------------------------------------------------- sync

  const api = useCallback(
    async (
      method: string,
      path: string,
      body?: Record<string, unknown>
    ): Promise<Response> => {
      const opts: RequestInit = {
        method,
        headers: { "Content-Type": "application/json" },
      };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(path, opts);
      if (res.status === 401) window.location.reload();
      return res;
    },
    []
  );

  const fetchAlarms = useCallback(async () => {
    const res = await api("GET", "/api/alarms");
    if (res.ok) {
      const data = (await res.json()) as ServerAlarm[];
      setAlarms(enrich(data));
    }
    setLoaded(true);
  }, [api]);

  useEffect(() => {
    fetchAlarms();
  }, [fetchAlarms]);

  // ------------------------------------------------------------------ push

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    fetch("/api/vapid")
      .then((res) => res.json())
      .then((data: { enabled: boolean; publicKey: string | null }) => {
        vapidRef.current = data.enabled ? data.publicKey : null;
      })
      .catch(() => {});
  }, []);

  const registerPush = useCallback(async () => {
    if (
      !("Notification" in window) ||
      !("serviceWorker" in navigator) ||
      !vapidRef.current
    ) {
      setPushNote("Push not available on this browser.");
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setPushNote("Notifications denied — no backup if you close the app.");
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidRef.current),
      }));

    let subId = "";
    try {
      subId = localStorage.getItem(SUB_ID_KEY) || "";
    } catch {}

    const res = await api("POST", "/api/subscribe", {
      id: subId || undefined,
      subscription,
    });

    if (res.ok) {
      const data = (await res.json()) as { id: string };
      try {
        localStorage.setItem(SUB_ID_KEY, data.id);
      } catch {}
      setPushNote("Notifications enabled.");
    } else {
      setPushNote("Could not register push.");
    }
  }, [api]);

  useEffect(() => {
    if (!loaded) return;
    if (enabled.length > 0) registerPush();
  }, [loaded, enabled.length > 0, registerPush]);

  // ----------------------------------------------------------------- audio

  const unlockAudio = useCallback(() => {
    getAudio()
      .unlock()
      .then(() => setAudioReady(true))
      .catch(() =>
        setPushNote("Could not start background audio — tap the toggle again.")
      );
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (enabled.length === 0 && !ringingId) {
      stopVibration();
      if (audioRef.current) {
        audioRef.current.stop();
        audioRef.current = null;
        setAudioReady(false);
      }
    }
  }, [enabled.length, ringingId, loaded, stopVibration]);

  // Never leave the phone buzzing behind a closed tab.
  useEffect(() => stopVibration, [stopVibration]);

  useEffect(() => {
    if (!ringingId || audioReady) return;
    const restore = async () => {
      await getAudio().unlock().catch(() => {});
      setAudioReady(true);
      void getAudio().ring();
    };
    document.addEventListener("pointerdown", restore, { once: true });
    return () => document.removeEventListener("pointerdown", restore);
  }, [ringingId, audioReady]);

  // ------------------------------------------------------------- the clock

  const startRinging = useCallback(
    (alarm: ClientAlarm) => {
      setRingingId(alarm.id);
      setChallenge(makeChallenge(alarm.challengeType, alarm.difficulty));
      setStreak(0);
      setInput("");
      setError("");
      setDraft(null);
      void requestWakeLock();
      // A silent alarm must not make a sound, but the audio element still has
      // to keep playing or iOS freezes the timers behind it.
      if (alarm.silent) void getAudio().ringSilent();
      else void getAudio().ring();
      if (alarm.vibrate) getVibration().start();
    },
    [requestWakeLock]
  );

  useEffect(() => {
    if (!loaded) return;
    if (enabled.length === 0 && !ringingId) return;

    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (ringingId) return;
      const due = alarmsRef.current.find(
        (a) => a.enabled && a.fireAt <= t && t - a.fireAt <= MAX_LATE_MS
      );
      if (due) startRinging(due);
    };

    const id = setInterval(tick, 500);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [loaded, enabled.length, ringingId, startRinging]);

  useEffect(() => {
    if (enabled.length === 0 && !ringingId) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [enabled.length, ringingId]);

  // Re-derive fireAt every minute for the countdown display.
  useEffect(() => {
    if (!loaded || alarms.length === 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [loaded, alarms.length]);

  // ------------------------------------------------------------- mutations

  const saveDraft = async () => {
    if (!draft) return;
    const label = draft.label.trim();

    unlockAudio();
    setSyncing(true);

    const body: Record<string, unknown> = {
      id: draft.id ?? newId(),
      time: draft.time,
      label,
      challengeType: draft.challengeType,
      difficulty: draft.difficulty,
      requiredCorrect: draft.requiredCorrect,
      vibrate: draft.vibrate,
      silent: draft.silent,
      enabled: true,
    };

    const res = await api("POST", "/api/alarms", body);
    if (res.ok) {
      const data = (await res.json()) as ServerAlarm[];
      setAlarms(enrich(data));
    }
    setSyncing(false);
    setDraft(null);
    setPushNote("");
  };

  const toggleAlarm = async (id: string) => {
    const current = alarms.find((a) => a.id === id);
    if (!current) return;
    const turningOn = !current.enabled;

    if (turningOn) unlockAudio();

    const body: Record<string, unknown> = {
      ...current,
      enabled: turningOn,
    };
    delete (body as Record<string, unknown>).fireAt;

    const res = await api("POST", "/api/alarms", body);
    if (res.ok) {
      const data = (await res.json()) as ServerAlarm[];
      setAlarms(enrich(data));
    }
  };

  const removeAlarm = async (id: string) => {
    const res = await api("DELETE", `/api/alarms?id=${encodeURIComponent(id)}`);
    if (res.ok) {
      const data = (await res.json()) as ServerAlarm[];
      setAlarms(enrich(data));
    }
  };

  const submitAnswer = (event: React.FormEvent) => {
    event.preventDefault();
    if (!challenge || !ringing) return;

    if (!isCorrect(challenge, input)) {
      setStreak(0);
      setInput("");
      setError("Wrong — streak reset. Here is a new one.");
      setChallenge(makeChallenge(ringing.challengeType, ringing.difficulty));
      setShake(true);
      setTimeout(() => setShake(false), 400);
      return;
    }

    const solved = streak + 1;
    setInput("");
    setError("");

    if (solved < ringing.requiredCorrect) {
      setStreak(solved);
      setChallenge(makeChallenge(ringing.challengeType, ringing.difficulty));
      return;
    }

    releaseWakeLock();
    stopVibration();
    // Stop the server's repeating buzz for this alarm.
    void api("POST", "/api/dismiss", { alarmId: ringing.id });
    setDismissedAt(Date.now());
    setRingingId(null);
    setChallenge(null);

    // The alarm that just rang stays enabled and rolls to tomorrow, so the
    // keep-alive track has to carry on — dropping it here would freeze the
    // timer every alarm depends on. Only a list with nothing left armed
    // releases the audio element.
    const stillArmed = alarms.some((a) => a.enabled);
    if (stillArmed) {
      void getAudio().backToKeepAlive();
    } else {
      getAudio().stop();
      audioRef.current = null;
      setAudioReady(false);
    }

    // Re-derive fireAt for the dismissed alarm (rolls to tomorrow).
    setAlarms((list) =>
      list.map((a) =>
        a.id === ringing.id
          ? { ...a, fireAt: nextOccurrence(a.time, Date.now() + 1000) }
          : a
      )
    );
  };

  // ------------------------------------------------------------------ view

  if (!loaded) {
    return (
      <main className="shell" style={{ justifyContent: "center" }}>
        <p className="sub" style={{ textAlign: "center" }}>Loading...</p>
      </main>
    );
  }

  if (ringing) {
    return (
      <div className="ringing">
        <h2>{ringing.label || "Wake up"}</h2>
        {!audioReady && (
          <p className="error">Tap anywhere to restore the alarm sound.</p>
        )}
        <form
          className={`challenge${shake ? " shake" : ""}`}
          onSubmit={submitAnswer}
        >
          <div className="progress">
            {Array.from({ length: ringing.requiredCorrect }, (_, i) => (
              <span key={i} className={i < streak ? "done" : ""} />
            ))}
          </div>

          {challenge && ringing.challengeType === "math" ? (
            <p className="prompt-math">{challenge.prompt} = ?</p>
          ) : (
            <p className="prompt-typing">{challenge?.prompt}</p>
          )}

          <input
            type={ringing.challengeType === "math" ? "number" : "text"}
            inputMode={ringing.challengeType === "math" ? "numeric" : "text"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              ringing.challengeType === "math" ? "Answer" : "Type it exactly"
            }
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus
          />

          <p className="error">{error}</p>

          <button className="primary" type="submit" disabled={!input.trim()}>
            Submit
          </button>
        </form>
        <p className="note">
          {ringing.requiredCorrect} correct in a row stops the alarm. A wrong
          answer resets the streak.
        </p>
      </div>
    );
  }

  if (draft) {
    const isNew = !draft.id;
    return (
      <main className="shell">
        <div>
          <h1>{isNew ? "New alarm" : "Edit alarm"}</h1>
          <p className="sub">
            {formatGap(nextOccurrence(draft.time) - now)} from now.
          </p>
        </div>

        <div className="card">
          <label className="field">
            Ring at
            <input
              type="time"
              value={draft.time}
              onChange={(e) => setDraft({ ...draft, time: e.target.value })}
            />
          </label>
          <label className="field">
            Label
            <input
              type="text"
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder="Wake up"
              maxLength={60}
            />
          </label>
        </div>

        <div className="card">
          <label className="field">
            Challenge
            <div className="segmented">
              {(["math", "typing"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={draft.challengeType === type}
                  onClick={() => setDraft({ ...draft, challengeType: type })}
                >
                  {type === "math" ? "Math" : "Typing"}
                </button>
              ))}
            </div>
          </label>

          <label className="field">
            Difficulty
            <div className="segmented">
              {(["easy", "medium", "hard"] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  aria-pressed={draft.difficulty === level}
                  onClick={() => setDraft({ ...draft, difficulty: level })}
                >
                  {level[0].toUpperCase() + level.slice(1)}
                </button>
              ))}
            </div>
          </label>

          <label className="field">
            How many in a row
            <div className="segmented">
              {[1, 3, 5].map((count) => (
                <button
                  key={count}
                  type="button"
                  aria-pressed={draft.requiredCorrect === count}
                  onClick={() =>
                    setDraft({ ...draft, requiredCorrect: count })
                  }
                >
                  {count}
                </button>
              ))}
            </div>
          </label>
        </div>

        <div className="card">
          <label className="field">
            How it wakes you
            <div className="segmented">
              <button
                type="button"
                aria-pressed={!draft.silent}
                onClick={() => setDraft({ ...draft, silent: false })}
              >
                Siren
              </button>
              <button
                type="button"
                aria-pressed={draft.silent}
                onClick={() => setDraft({ ...draft, silent: true })}
              >
                Vibrate only
              </button>
            </div>
          </label>
          <p className="note">
            {draft.silent
              ? "No sound. Your phone buzzes every 5 seconds via notifications until you solve the challenge. Put the phone on the silent switch so it vibrates instead of chiming — and keep the app on your Home Screen, or iOS will not deliver the push."
              : "Plays a loud two-tone siren through the phone speaker."}
          </p>
        </div>

        <button
          className="primary"
          onClick={saveDraft}
          disabled={syncing}
        >
          {syncing ? "Saving..." : isNew ? "Add alarm" : "Save changes"}
        </button>
        <button className="ghost" onClick={() => setDraft(null)}>
          Cancel
        </button>
        {!isNew && (
          <button
            className="ghost danger"
            onClick={() => {
              removeAlarm(draft.id as string);
              setDraft(null);
            }}
          >
            Delete alarm
          </button>
        )}
      </main>
    );
  }

  return (
    <main className="shell">
      <div>
        <h1>Alarms</h1>
        <p className="sub">
          {nextUp
            ? `Next in ${formatGap(nextUp.fireAt - now)} — keep this tab open.`
            : "An alarm you have to earn your way out of."}
        </p>
      </div>

      {alarms.length === 0 && (
        <div className="card">
          <p className="note">No alarms yet.</p>
        </div>
      )}

      {alarms.map((alarm) => (
        <div
          key={alarm.id}
          className={`alarm-row${alarm.enabled ? "" : " off"}`}
        >
          <button
            className="alarm-open"
            onClick={() =>
              setDraft({
                id: alarm.id,
                time: alarm.time,
                label: alarm.label,
                challengeType: alarm.challengeType,
                difficulty: alarm.difficulty,
                requiredCorrect: alarm.requiredCorrect,
                vibrate: alarm.vibrate,
                silent: alarm.silent,
              })
            }
          >
            <span className="alarm-time">{formatTimeLabel(alarm.time)}</span>
            <span className="alarm-meta">
              {alarm.label || "Alarm"} · {alarm.requiredCorrect}{" "}
              {alarm.difficulty}{" "}
              {alarm.challengeType === "math" ? "math" : "typing"}
              {alarm.silent ? " · vibrate only" : " · siren"}
              {alarm.enabled
                ? ` · in ${formatGap(alarm.fireAt - now)}`
                : " · off"}
            </span>
          </button>

          <label className="switch">
            <input
              type="checkbox"
              checked={alarm.enabled}
              onChange={() => toggleAlarm(alarm.id)}
              aria-label={`${alarm.enabled ? "Turn off" : "Turn on"} the ${formatTimeLabel(alarm.time)} alarm`}
            />
            <span className="track" />
          </label>
        </div>
      ))}

      <button className="primary" onClick={() => setDraft(blankDraft())}>
        Add alarm
      </button>

      {enabled.length > 0 && (
        <div className="card">
          <span className="pill">
            <span className={`dot${audioReady ? "" : " warn"}`} />
            {audioReady ? "Background audio running" : "Audio not running"}
          </span>
          {!audioReady && (
            <button className="ghost" onClick={unlockAudio}>
              Restore background audio
            </button>
          )}
          {pushNote && <p className="note">{pushNote}</p>}
        </div>
      )}

      {dismissedAt > 0 && (
        <p className="note">
          Last alarm cleared at {formatClock(dismissedAt)}.
        </p>
      )}
    </main>
  );
}
