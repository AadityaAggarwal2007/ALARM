/**
 * Spoken alarms, via the Web Speech API.
 *
 * Like the siren, this only reaches you while the page is alive — iOS suspends
 * a backgrounded tab and speech goes with it. The repeating push notification
 * is still the layer that works with the app closed; voice is what happens
 * when you are looking at the phone, or it is on the desk beside you.
 */

const REPEAT_MS = 6000;

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export class AlarmSpeech {
  private timer: ReturnType<typeof setInterval> | null = null;
  private phrase = "";

  /**
   * Must be called from inside a user gesture the first time, or iOS refuses
   * to speak for the rest of the page's life — the same rule the audio track
   * lives under.
   */
  static prime(): void {
    if (!speechSupported()) return;
    try {
      const u = new SpeechSynthesisUtterance("");
      u.volume = 0;
      window.speechSynthesis.speak(u);
      window.speechSynthesis.cancel();
    } catch {
      // Unsupported or blocked; the siren and push layers still work.
    }
  }

  start(phrase: string): void {
    if (!speechSupported() || this.timer) return;
    this.phrase = phrase;
    this.say();
    this.timer = setInterval(() => this.say(), REPEAT_MS);
  }

  private say(): void {
    try {
      // Cancel first: a queued backlog would keep talking long after the
      // challenge is solved.
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(this.phrase);
      u.rate = 0.95;
      u.pitch = 1;
      u.volume = 1;
      window.speechSynthesis.speak(u);
    } catch {
      // ignored
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (!speechSupported()) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignored
    }
  }
}

/** What a block says when it rings. */
export function defaultPhrase(title: string): string {
  return `${title}. It is time. ${title}.`;
}
