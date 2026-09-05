"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlarmAudio } from "@/lib/audio";
import { AlarmVibration } from "@/lib/vibrate";
import { AlarmSpeech, defaultPhrase } from "@/lib/speech";
import { isCorrect, makeChallenge, type Challenge } from "@/lib/challenges";
import { categoryMeta } from "@/lib/categories";
import type { Task } from "@/lib/types";

/**
 * The enforcement layer, mounted once in the root layout so it can take over
 * from any screen. This is the piece that makes a scheduled block binding:
 * while a block is ringing there is nothing else to interact with.
 *
 * It owns three jobs: keep the keep-alive audio running so iOS does not
 * suspend the page's timers, notice locally when a block comes due, and poll
 * the server so a phone that was asleep when the push arrived still lands
 * here on open.
 */

const POLL_MS = 4000;
const LOCAL_TICK_MS = 500;
const MAX_LATE_MS = 5 * 60 * 1000;

export default function RingGuard() {
  const [task, setTask] = useState<Task | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [input, setInput] = useState("");
  const [streak, setStreak] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [armed, setArmed] = useState(false);

  const audioRef = useRef<AlarmAudio | null>(null);
  const vibrationRef = useRef<AlarmVibration | null>(null);
  const speechRef = useRef<AlarmSpeech | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const taskRef = useRef<Task | null>(null);
  taskRef.current = task;

  const getAudio = () => (audioRef.current ??= new AlarmAudio());
  const getVibration = () => (vibrationRef.current ??= new AlarmVibration());
  const getSpeech = () => (speechRef.current ??= new AlarmSpeech());

  const unlockAudio = useCallback(async () => {
    try {
      await getAudio().unlock();
      AlarmSpeech.prime();
      setAudioReady(true);
      setArmed(true);
    } catch {
      setAudioReady(false);
    }
  }, []);

  // Any tap anywhere counts as the gesture iOS needs to allow playback. Once
  // armed, the keep-alive tone holds the page's timers open in the background.
  useEffect(() => {
    if (armed) return;
    const arm = () => void unlockAudio();
    document.addEventListener("pointerdown", arm, { once: true });
    return () => document.removeEventListener("pointerdown", arm);
  }, [armed, unlockAudio]);

  const beginRinging = useCallback((next: Task) => {
    setTask(next);
    setChallenge(makeChallenge(next.challengeType, next.difficulty));
    setStreak(0);
    setAttempts(0);
    setInput("");
    setError("");

    // The audio element must keep playing in every mode or iOS suspends the
    // timers behind it — only SIREN actually makes it audible.
    if (next.wakeMode === "SIREN") void getAudio().ring();
    else void getAudio().ringSilent();

    if (next.wakeMode === "VOICE") {
      const spoken =
        next.voiceText?.trim() ||
        defaultPhrase(
          next.note || next.subCategory?.name || categoryMeta(next.mainCategory).label
        );
      getSpeech().start(spoken);
    }

    // VIBRATE buzzes on its own; the other loud tiers buzz only if asked.
    if (next.wakeMode === "VIBRATE" || (next.vibrate && next.wakeMode !== "SILENT")) {
      getVibration().start();
    }

    const wakeLock = (
      navigator as Navigator & {
        wakeLock?: {
          request: (t: string) => Promise<{ release: () => Promise<void> }>;
        };
      }
    ).wakeLock;
    wakeLock
      ?.request("screen")
      .then((l) => (wakeLockRef.current = l))
      .catch(() => {});
  }, []);

  // Server poll — the authority, and what catches a block that came due while
  // this tab was closed or asleep.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      if (taskRef.current) return;
      try {
        const res = await fetch("/api/ring");
        if (!res.ok) return;
        const data = (await res.json()) as { ringing: Task | null };
        if (alive && data.ringing && !taskRef.current) beginRinging(data.ringing);
      } catch {
        // Offline. The local tick below still fires on time.
      }
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [beginRinging]);

  // Local tick — fires the instant a block is due, without waiting for a poll,
  // and keeps working if the network drops.
  useEffect(() => {
    const id = setInterval(async () => {
      if (taskRef.current) return;
      const now = Date.now();
      const today = new Date();
      const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      try {
        const res = await fetch(`/api/tasks?date=${key}`);
        if (!res.ok) return;
        const tasks = (await res.json()) as Task[];
        const due = tasks.find(
          (t) =>
            t.enforce &&
            !t.dismissedAt &&
            !t.gaveUpAt &&
            now >= new Date(t.startTime).getTime() &&
            now - new Date(t.startTime).getTime() <= MAX_LATE_MS
        );
        if (due && !taskRef.current) beginRinging(due);
      } catch {
        // ignored
      }
    }, LOCAL_TICK_MS * 20);
    return () => clearInterval(id);
  }, [beginRinging]);

  const finish = useCallback(async (solved: Task, tries: number) => {
    vibrationRef.current?.stop();
    speechRef.current?.stop();
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;

    setTask(null);
    setChallenge(null);

    // Hand the audio back to the keep-alive tone rather than tearing it down:
    // later blocks still need the page's timers alive.
    void getAudio().backToKeepAlive();

    await fetch("/api/ring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: solved.id, attempts: tries }),
    }).catch(() => {});

    window.dispatchEvent(new CustomEvent("discipline:changed"));
  }, []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!challenge || !task) return;

    if (!isCorrect(challenge, input)) {
      setStreak(0);
      setAttempts((a) => a + 1);
      setInput("");
      setError("Wrong — streak reset.");
      setChallenge(makeChallenge(task.challengeType, task.difficulty));
      setShake(true);
      setTimeout(() => setShake(false), 400);
      return;
    }

    const solved = streak + 1;
    setInput("");
    setError("");

    if (solved < task.requiredCorrect) {
      setStreak(solved);
      setChallenge(makeChallenge(task.challengeType, task.difficulty));
      return;
    }
    void finish(task, attempts);
  };

  // Never leave the phone talking or buzzing behind a closed tab.
  useEffect(
    () => () => {
      vibrationRef.current?.stop();
      speechRef.current?.stop();
    },
    []
  );

  if (!task) return null;

  const meta = categoryMeta(task.mainCategory);
  const title = task.note || task.subCategory?.name || meta.label;

  return (
    <div className="ringing">
      <h2 style={{ color: meta.color }}>
        {meta.icon} {title}
      </h2>
      {!audioReady && (
        <p className="error">Tap anywhere to restore the alarm sound.</p>
      )}
      <form className={`challenge${shake ? " shake" : ""}`} onSubmit={submit}>
        <div className="progress">
          {Array.from({ length: task.requiredCorrect }, (_, i) => (
            <span key={i} className={i < streak ? "done" : ""} />
          ))}
        </div>

        {challenge && task.challengeType === "math" ? (
          <p className="prompt-math">{challenge.prompt} = ?</p>
        ) : (
          <p className="prompt-typing">{challenge?.prompt}</p>
        )}

        <input
          type={task.challengeType === "math" ? "number" : "text"}
          inputMode={task.challengeType === "math" ? "numeric" : "text"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            task.challengeType === "math" ? "Answer" : "Type it exactly"
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
        {task.requiredCorrect} correct in a row starts this block. A wrong
        answer resets the streak.
      </p>
    </div>
  );
}
