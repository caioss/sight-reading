/** Width of the chord-gesture grouping window, in ms (same clock as MidiNoteEvent.timestamp). */
export const GESTURE_WINDOW_MS = 100;

/** Outcome of judging a closed gesture against the expected notes. */
export interface GestureJudgment {
  /** True iff the played set exactly equals the (non-empty) expected set. */
  correct: boolean;
  /** Distinct notes played during the gesture, sorted. */
  played: number[];
  /** Expected notes that were not played, sorted. */
  missing: number[];
  /** Played notes outside the expected set, sorted. */
  extra: number[];
}

/**
 * Groups near-simultaneous key presses into a single chord attempt ("gesture")
 * and judges the attempt as a set against the expected notes, for the flow
 * play mode where the cursor advances regardless of correctness.
 *
 * A gesture opens on its first press and stays open while presses keep
 * arriving within `windowMs` of the previous one (the window is debounced from
 * the *last* press, so a rolled or held chord stays in a single gesture instead
 * of straddling into the next position). `press` reports 'complete' the moment
 * the played set exactly equals the expected set (the fast path — no need to
 * wait for the window). Otherwise the caller closes the gesture once a quiet
 * period of `windowMs` has passed and judges the result.
 *
 * The class is deliberately timer-free: it only compares the timestamps it is
 * given (never the wall clock), so it stays pure and unit-testable. The caller
 * owns any real timer.
 */
export class GestureMatcher {
  private expected = new Set<number>();
  private played = new Set<number>();
  private startTimestamp: number | null = null;
  private lastTimestamp: number | null = null;

  constructor(private readonly windowMs = GESTURE_WINDOW_MS) {}

  /** Load the expected notes for the current step, discarding any open gesture. */
  setExpected(notes: Iterable<number>): void {
    this.expected = new Set(notes);
    this.abort();
  }

  get isGestureOpen(): boolean {
    return this.startTimestamp !== null;
  }

  /**
   * True when `timestamp` falls more than `windowMs` after the gesture's most
   * recent press (i.e. the note belongs to a new gesture). Measuring from the
   * last press rather than the first lets a rolled/held chord — whose note-ons
   * can span more than one window in total — stay in a single gesture as long
   * as consecutive presses are close together. False while no gesture is open.
   */
  isExpired(timestamp: number): boolean {
    return this.lastTimestamp !== null && timestamp - this.lastTimestamp > this.windowMs;
  }

  /**
   * Add a played note to the gesture, opening one on the first press. Each
   * press extends the gesture's quiet-period window. Duplicate presses collapse
   * (set semantics). Returns 'complete' as soon as the played set exactly
   * equals the expected set, else 'pending'.
   */
  press(note: number, timestamp: number): 'complete' | 'pending' {
    if (this.startTimestamp === null) {
      this.startTimestamp = timestamp;
    }
    this.lastTimestamp = timestamp;
    this.played.add(note);
    return this.isExactMatch() ? 'complete' : 'pending';
  }

  /** Judge the open gesture against the expected notes and clear it. */
  close(): GestureJudgment {
    const played = [...this.played].sort((a, b) => a - b);
    const missing = [...this.expected].filter((note) => !this.played.has(note)).sort((a, b) => a - b);
    const extra = played.filter((note) => !this.expected.has(note));
    const judgment: GestureJudgment = {
      correct: this.isExactMatch(),
      played,
      missing,
      extra,
    };
    this.abort();
    return judgment;
  }

  /** Discard the open gesture without judging it (navigation, mode switch, load). */
  abort(): void {
    this.played.clear();
    this.startTimestamp = null;
    this.lastTimestamp = null;
  }

  private isExactMatch(): boolean {
    return (
      this.expected.size > 0 &&
      this.played.size === this.expected.size &&
      [...this.expected].every((note) => this.played.has(note))
    );
  }
}
