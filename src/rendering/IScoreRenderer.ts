import type { AdvanceMode, StepFeedback } from '../domain/score/types';

/** A snapshot of the cursor's current position. */
export interface ScoreStepInfo {
  /** MIDI note numbers required at the current cursor position (empty at end). */
  expectedMidiNotes: number[];
  /** 0-based index of the measure the cursor is currently in. */
  measureIndex: number;
  /** True once the cursor has advanced past the final note. */
  atEnd: boolean;
}

export const EMPTY_STEP: ScoreStepInfo = {
  expectedMidiNotes: [],
  measureIndex: 0,
  atEnd: true,
};

/**
 * Abstraction over the sheet-music engine (rendering + cursor). The rest of the
 * app depends only on this interface, so the underlying library (OSMD today,
 * potentially Verovio or another engine later) can be swapped by providing a
 * new implementation.
 */
export interface IScoreRenderer {
  /** Attach the renderer to a DOM container. Call once before `load`. */
  mount(container: HTMLElement): void;

  /** Load a score from MusicXML text or a compressed `.mxl` buffer. Clears all error marks. */
  load(content: string | ArrayBuffer): Promise<void>;

  readonly isLoaded: boolean;

  /** Move the cursor back to the first playable note. Clears all error marks. */
  resetCursor(): ScoreStepInfo;

  /** Advance the cursor by `count` units of the given granularity, skipping rests. */
  next(mode: AdvanceMode, count?: number): ScoreStepInfo;

  /** Move the cursor backwards by `count` units of the given granularity, skipping rests. */
  previous(mode: AdvanceMode, count?: number): ScoreStepInfo;

  /** Current position without moving the cursor. */
  getCurrentStep(): ScoreStepInfo;

  /** Colour the current notes to reflect match feedback. */
  setFeedback(feedback: StepFeedback): void;

  /**
   * Persistently mark the current cursor position as an error. Unlike
   * `setFeedback`, marks survive cursor movement and re-renders. Idempotent.
   */
  markErrorAtCursor(): void;

  /** Remove the persistent error mark at the current cursor position, if any. */
  clearErrorMarkAtCursor(): void;

  /** Remove every persistent error mark. */
  clearAllErrorMarks(): void;

  /** Number of positions currently marked as errors. */
  readonly errorMarkCount: number;

  /** Switch cursor granularity; toggles the measure highlight overlay. */
  setAdvanceMode(mode: AdvanceMode): void;

  /** Re-layout after a container resize. */
  resize(): void;

  dispose(): void;
}
