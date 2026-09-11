export interface TimedInput {
  type: string;
  time: number;
}

/**
 * Palm rejection by time, not by position.
 *
 * A resting hand reports touches seconds after the pen landed, and those
 * touches are indistinguishable from a deliberate finger tap by shape alone.
 * Time is the reliable signal: while a pen is in use, touch is ignored for a
 * window that every pen event extends.
 */
export class PalmRejection {
  private activeUntil = Number.NEGATIVE_INFINITY;

  constructor(private readonly windowMs = 800) {}

  notePen(time: number): void {
    this.activeUntil = Math.max(this.activeUntil, time + this.windowMs);
  }

  accept(input: TimedInput): boolean {
    if (input.type === "pen") {
      this.notePen(input.time);
      return true;
    }

    // Mouse and trackpad are never ambiguous.
    if (input.type !== "touch") return true;

    return input.time >= this.activeUntil;
  }

  get suppressedUntil(): number {
    return this.activeUntil;
  }
}
