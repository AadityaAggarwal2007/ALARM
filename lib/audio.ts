const SAMPLE_RATE = 44100;

function encodeWav(samples: Float32Array): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++)
      view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * iOS suspends page timers unless media is actively playing, and it treats a
 * track of digital silence as nothing playing at all. A 40 Hz tone just above
 * the noise floor is inaudible through a phone speaker but keeps the session
 * alive.
 */
function buildKeepAliveTrack(): Blob {
  const length = SAMPLE_RATE * 5;
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    samples[i] = Math.sin((2 * Math.PI * 40 * i) / SAMPLE_RATE) * 0.00015;
  }
  return encodeWav(samples);
}

/** Two-tone siren. iOS ignores HTMLAudioElement.volume, so amplitude is baked in. */
function buildAlarmTrack(): Blob {
  const beep = 0.28;
  const gap = 0.12;
  const cycle = (beep + gap) * 2;
  const length = Math.floor(SAMPLE_RATE * cycle);
  const samples = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    const inFirst = t < beep;
    const inSecond = t >= beep + gap && t < beep + gap + beep;
    if (!inFirst && !inSecond) continue;

    const freq = inFirst ? 880 : 1174;
    const local = inFirst ? t : t - beep - gap;
    const sine = Math.sin(2 * Math.PI * freq * local);
    const square = Math.sign(sine) * 0.35;
    // Short fades stop the loop seam from clicking.
    const fade = Math.min(1, local / 0.01, (beep - local) / 0.01);
    samples[i] = (sine * 0.65 + square) * 0.9 * Math.max(0, fade);
  }

  return encodeWav(samples);
}

export class AlarmAudio {
  private element: HTMLAudioElement | null = null;
  private keepAliveUrl = "";
  private alarmUrl = "";
  private ringing = false;

  /** Must be called from inside a user gesture or iOS will refuse playback. */
  async unlock(): Promise<void> {
    if (this.element) {
      await this.element.play().catch(() => {});
      return;
    }

    this.keepAliveUrl = URL.createObjectURL(buildKeepAliveTrack());
    this.alarmUrl = URL.createObjectURL(buildAlarmTrack());

    const el = new Audio(this.keepAliveUrl);
    el.loop = true;
    el.preload = "auto";
    el.setAttribute("playsinline", "");
    this.element = el;

    await el.play();
    this.guardAgainstPause();
  }

  /**
   * Control Center and the lock screen can pause playback, which would freeze
   * the timers this alarm depends on. Resume on every pause we did not ask for.
   */
  private guardAgainstPause() {
    const el = this.element;
    if (!el) return;

    el.addEventListener("pause", () => {
      if (el.dataset.stopping === "true") return;
      el.play().catch(() => {});
    });

    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: "Alarm armed",
        artist: "Keep this playing",
      });
      const resume = () => {
        el.play().catch(() => {});
      };
      for (const action of ["pause", "stop", "previoustrack", "nexttrack"] as const) {
        try {
          navigator.mediaSession.setActionHandler(action, resume);
        } catch {
          // Safari rejects handlers it does not implement; harmless.
        }
      }
    }
  }

  async ring(): Promise<void> {
    const el = this.element;
    if (!el || this.ringing) return;
    this.ringing = true;

    el.src = this.alarmUrl;
    el.loop = true;
    el.currentTime = 0;
    await el.play().catch(() => {});

    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: "ALARM — solve the challenge",
        artist: "Alarm",
      });
    }
  }

  async backToKeepAlive(): Promise<void> {
    const el = this.element;
    if (!el) return;
    this.ringing = false;
    el.src = this.keepAliveUrl;
    el.loop = true;
    await el.play().catch(() => {});
  }

  stop(): void {
    const el = this.element;
    if (!el) return;
    this.ringing = false;
    el.dataset.stopping = "true";
    el.pause();
    el.removeAttribute("src");
    el.load();
    this.element = null;
    URL.revokeObjectURL(this.keepAliveUrl);
    URL.revokeObjectURL(this.alarmUrl);
  }

  get isRinging(): boolean {
    return this.ringing;
  }
}
