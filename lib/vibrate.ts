/**
 * Repeating vibration for the ringing phase.
 *
 * `navigator.vibrate` fires a pattern once and then stops, so a continuous
 * alarm has to re-issue the pattern on a timer. Support is Android-only in
 * practice — iOS Safari does not implement the Vibration API at all, which is
 * why the setting is presented as a bonus on top of the siren rather than a
 * replacement for it.
 */

const PATTERN = [500, 250, 500, 250, 500, 700];
const CYCLE_MS = PATTERN.reduce((sum, n) => sum + n, 0);

export function vibrationSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

export class AlarmVibration {
  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (!vibrationSupported() || this.timer) return;
    const pulse = () => {
      try {
        navigator.vibrate(PATTERN);
      } catch {
        // Some browsers throw when the page has no user activation yet.
      }
    };
    pulse();
    this.timer = setInterval(pulse, CYCLE_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (!vibrationSupported()) return;
    try {
      navigator.vibrate(0);
    } catch {
      // Nothing to cancel.
    }
  }
}
