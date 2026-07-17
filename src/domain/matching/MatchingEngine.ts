export interface MatchResult {
  /** Expected notes not yet played for the current step. */
  remaining: number[];
  /** True once every expected note has been played. */
  complete: boolean;
  /** True while an out-of-set (wrong) note is currently flagged. */
  wrong: boolean;
}

/**
 * Cumulative, order-independent chord matcher for a single cursor step.
 *
 * A step is "complete" once every expected MIDI note has been played at least
 * once (chords do not need to be pressed simultaneously). Any note outside the
 * expected set raises the `wrong` flag; the flag clears as soon as a correct
 * expected note is played, or when the step is reset.
 *
 * The engine is intentionally free of any MIDI-transport or rendering concerns
 * so it can be unit-tested in isolation and reused if either is swapped out.
 */
export class MatchingEngine {
  private expected = new Set<number>();
  private satisfied = new Set<number>();
  private hasWrong = false;

  /** Load the expected notes for the current step and reset progress. */
  setExpected(notes: Iterable<number>): void {
    this.expected = new Set(notes);
    this.satisfied.clear();
    this.hasWrong = false;
  }

  /** Register a played note. Returns the resulting match state. */
  pressNote(note: number): MatchResult {
    if (this.expected.has(note)) {
      this.satisfied.add(note);
      this.hasWrong = false;
    } else {
      this.hasWrong = true;
    }
    return this.state();
  }

  /**
   * Note-off is a no-op for cumulative matching but is part of the API so the
   * session can forward every event without special-casing.
   */
  releaseNote(_note: number): void {
    // Intentionally ignored.
  }

  /** Clear progress for the current step without changing the expected notes. */
  reset(): void {
    this.satisfied.clear();
    this.hasWrong = false;
  }

  get isComplete(): boolean {
    return this.expected.size > 0 && this.satisfied.size === this.expected.size;
  }

  private state(): MatchResult {
    const remaining = [...this.expected].filter((note) => !this.satisfied.has(note));
    return {
      remaining,
      complete: this.isComplete,
      wrong: this.hasWrong,
    };
  }
}
