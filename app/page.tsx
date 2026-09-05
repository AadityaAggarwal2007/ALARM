"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlarmAudio } from "@/lib/audio";
import {
  isCorrect,
  makeChallenge,
  type Challenge,
  type ChallengeType,
  type Difficulty,
} from "@/lib/challenges";

type Phase = "idle" | "armed" | "ringing" | "done";

type Persisted = {
  targetTs: number;
  challengeType: ChallengeType;
  difficulty: Difficulty;
  requiredCorrect: number;
  label: string;
  alarmId: string | null;
};

const STORAGE_KEY = "alarm.state.v1";

function nextOccurrence(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  const target = new Date();
  target.setHours(hours, minutes, 0, 0);
  if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1);
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

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export default function Page() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [now, setNow] = useState(() => Date.now());

  const [timeValue, setTimeValue] = useState("07:00");
  const [label, setLabel] = useState("");
  const [challengeType, setChallengeType] = useState<ChallengeType>("math");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [requiredCorrect, setRequiredCorrect] = useState(3);

  const [targetTs, setTargetTs] = useState(0);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [input, setInput] = useState("");
  const [streak, setStreak] = useState(0);
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);

  const [audioReady, setAudioReady] = useState(false);
  const [pushNote, setPushNote] = useState("");
  const [dismissedAt, setDismissedAt] = useState(0);

  const audioRef = useRef<AlarmAudio | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const vapidRef = useRef<string | null>(null);
  const alarmIdRef = useRef<string | null>(null);
  const settingsRef = useRef({ challengeType, difficulty, requiredCorrect });

  settingsRef.current = { challengeType, difficulty, requiredCorrect };

  const getAudio = () => {
    if (!audioRef.current) audioRef.current = new AlarmAudio();
    return audioRef.current;
  };

  const persist = useCallback((state: Persisted | null) => {
    if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  const requestWakeLock = useCallback(async () => {
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    if (!wakeLock) return;
    try {
      wakeLockRef.current = await wakeLock.request("screen");
    } catch {
      // Denied on low battery, or unsupported. The alarm still sounds.
    }
  }, []);

  const startRinging = useCallback(() => {
    const { challengeType: type, difficulty: level } = settingsRef.current;
    setPhase("ringing");
    setChallenge(makeChallenge(type, level));
    setStreak(0);
    setInput("");
    setError("");
    void requestWakeLock();
    void getAudio().ring();
  }, [requestWakeLock]);

  // Rehydrate a running alarm across reloads and app restarts.
  useEffect(() => {
    let saved: Persisted | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      saved = raw ? (JSON.parse(raw) as Persisted) : null;
    } catch {
      saved = null;
    }
    if (!saved) return;

    setTargetTs(saved.targetTs);
    setChallengeType(saved.challengeType);
    setDifficulty(saved.difficulty);
    setRequiredCorrect(saved.requiredCorrect);
    setLabel(saved.label);
    setTimeValue(
      new Date(saved.targetTs).toTimeString().slice(0, 5)
    );
    alarmIdRef.current = saved.alarmId;
    settingsRef.current = {
      challengeType: saved.challengeType,
      difficulty: saved.difficulty,
      requiredCorrect: saved.requiredCorrect,
    };

    const overdue =
      Date.now() >= saved.targetTs ||
      new URLSearchParams(window.location.search).get("ring") === "1";

    if (overdue) {
      setPhase("ringing");
      setChallenge(
        makeChallenge(saved.challengeType, saved.difficulty)
      );
    } else {
      setPhase("armed");
    }
  }, []);

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

  // Single clock drives both the countdown and the fire check.
  useEffect(() => {
    if (phase !== "armed" && phase !== "ringing") return;
    const tick = () => {
      setNow(Date.now());
      if (phase === "armed" && targetTs && Date.now() >= targetTs) {
        startRinging();
      }
    };
    const id = setInterval(tick, 500);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [phase, targetTs, startRinging]);

  // A reload drops audio permission; the next tap anywhere restores it.
  useEffect(() => {
    if (phase !== "ringing" || audioReady) return;
    const restore = async () => {
      await getAudio().unlock().catch(() => {});
      setAudioReady(true);
      void getAudio().ring();
    };
    document.addEventListener("pointerdown", restore, { once: true });
    return () => document.removeEventListener("pointerdown", restore);
  }, [phase, audioReady]);

  useEffect(() => {
    if (phase !== "armed" && phase !== "ringing") return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  const scheduleServerPush = useCallback(
    async (fireAt: number, alarmLabel: string) => {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushNote(
          "Notifications are off, so there is no backup if you close the app."
        );
        return;
      }
      if (!vapidRef.current) {
        setPushNote("Server push is not configured — foreground alarm only.");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidRef.current),
        }));

      const response = await fetch("/api/alarms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fireAt, label: alarmLabel, subscription }),
      });
      if (!response.ok) throw new Error(await response.text());

      const { id } = (await response.json()) as { id: string };
      alarmIdRef.current = id;
      setPushNote("Backup notification scheduled.");

      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const state = JSON.parse(raw) as Persisted;
        persist({ ...state, alarmId: id });
      }
    },
    [persist]
  );

  const arm = () => {
    const fireAt = nextOccurrence(timeValue);
    const trimmed = label.trim() || "Alarm";

    // play() must be initiated inside this gesture or iOS blocks it forever.
    getAudio()
      .unlock()
      .then(() => setAudioReady(true))
      .catch(() =>
        setPushNote("Could not start background audio — tap Set Alarm again.")
      );

    setTargetTs(fireAt);
    setPhase("armed");
    setPushNote("");
    persist({
      targetTs: fireAt,
      challengeType,
      difficulty,
      requiredCorrect,
      label: trimmed,
      alarmId: null,
    });

    if ("Notification" in window && "serviceWorker" in navigator) {
      scheduleServerPush(fireAt, trimmed).catch(() =>
        setPushNote("Could not schedule the backup notification.")
      );
    }
  };

  const cancelServerPush = useCallback(async () => {
    const id = alarmIdRef.current;
    alarmIdRef.current = null;
    if (!id) return;
    await fetch(`/api/alarms?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch(() => {});
  }, []);

  const disarm = () => {
    getAudio().stop();
    releaseWakeLock();
    setAudioReady(false);
    setPhase("idle");
    setPushNote("");
    persist(null);
    void cancelServerPush();
  };

  const submitAnswer = (event: React.FormEvent) => {
    event.preventDefault();
    if (!challenge) return;

    const { challengeType: type, difficulty: level } = settingsRef.current;

    if (!isCorrect(challenge, input)) {
      setStreak(0);
      setInput("");
      setError("Wrong — streak reset. Here is a new one.");
      setChallenge(makeChallenge(type, level));
      setShake(true);
      setTimeout(() => setShake(false), 400);
      return;
    }

    const solved = streak + 1;
    setInput("");
    setError("");

    if (solved >= requiredCorrect) {
      getAudio().stop();
      releaseWakeLock();
      setAudioReady(false);
      setDismissedAt(Date.now());
      setPhase("done");
      setChallenge(null);
      persist(null);
      void cancelServerPush();
      return;
    }

    setStreak(solved);
    setChallenge(makeChallenge(type, level));
  };

  if (phase === "ringing") {
    return (
      <div className="ringing">
        <h2>Wake up</h2>
        {!audioReady && (
          <p className="error">Tap anywhere to restore the alarm sound.</p>
        )}
        <form
          className={`challenge${shake ? " shake" : ""}`}
          onSubmit={submitAnswer}
        >
          <div className="progress">
            {Array.from({ length: requiredCorrect }, (_, i) => (
              <span key={i} className={i < streak ? "done" : ""} />
            ))}
          </div>

          {challenge && challengeType === "math" ? (
            <p className="prompt-math">{challenge.prompt} = ?</p>
          ) : (
            <p className="prompt-typing">{challenge?.prompt}</p>
          )}

          <input
            type={challengeType === "math" ? "number" : "text"}
            inputMode={challengeType === "math" ? "numeric" : "text"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              challengeType === "math" ? "Answer" : "Type it exactly"
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
          {requiredCorrect} correct in a row stops the alarm. A wrong answer
          resets the streak.
        </p>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <main className="shell">
        <div>
          <h1>Good morning</h1>
          <p className="sub">Alarm cleared. You solved your way out.</p>
        </div>
        <div className="card">
          <p className="done-time">{formatClock(dismissedAt)}</p>
          <button className="primary" onClick={() => setPhase("idle")}>
            Set another alarm
          </button>
        </div>
      </main>
    );
  }

  if (phase === "armed") {
    return (
      <main className="shell">
        <div>
          <h1>Alarm armed</h1>
          <p className="sub">
            Keep this tab open. You can lock the phone or switch apps — the
            background audio keeps the timer alive.
          </p>
        </div>

        <div className="card">
          <p className="countdown">{formatGap(targetTs - now)}</p>
          <p className="target">
            Rings at {formatClock(targetTs)} · {label.trim() || "Alarm"}
          </p>
          <span className="pill">
            <span className={`dot${audioReady ? "" : " warn"}`} />
            {audioReady ? "Background audio running" : "Audio not running"}
          </span>
          {!audioReady && (
            <button
              className="ghost"
              onClick={() =>
                getAudio()
                  .unlock()
                  .then(() => setAudioReady(true))
                  .catch(() => {})
              }
            >
              Restore background audio
            </button>
          )}
        </div>

        <div className="card">
          <p className="note">
            To stop it you will solve {requiredCorrect}{" "}
            {difficulty} {challengeType === "math" ? "math problems" : "typing tests"}{" "}
            in a row.
          </p>
          {pushNote && <p className="note">{pushNote}</p>}
          <button className="ghost" onClick={disarm}>
            Cancel alarm
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <div>
        <h1>Alarm</h1>
        <p className="sub">
          An alarm you have to earn your way out of. Add this to your Home
          Screen so the backup notification works.
        </p>
      </div>

      <div className="card">
        <label className="field">
          Ring at
          <input
            type="time"
            value={timeValue}
            onChange={(e) => setTimeValue(e.target.value)}
          />
        </label>
        <p className="target">
          {formatGap(nextOccurrence(timeValue) - now)} from now
        </p>
        <label className="field">
          Label
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
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
                aria-pressed={challengeType === type}
                onClick={() => setChallengeType(type)}
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
                aria-pressed={difficulty === level}
                onClick={() => setDifficulty(level)}
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
                aria-pressed={requiredCorrect === count}
                onClick={() => setRequiredCorrect(count)}
              >
                {count}
              </button>
            ))}
          </div>
        </label>
      </div>

      <button className="primary" onClick={arm}>
        Set alarm
      </button>
    </main>
  );
}
