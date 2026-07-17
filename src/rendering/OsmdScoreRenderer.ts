import {
  CursorType,
  type GraphicalNote,
  type IOSMDOptions,
  type Note,
  OpenSheetMusicDisplay,
} from 'opensheetmusicdisplay';
import type { AdvanceMode, StepFeedback } from '../domain/score/types';
import { EMPTY_STEP, type IScoreRenderer, type ScoreStepInfo } from './IScoreRenderer';

const FEEDBACK_COLORS: Record<StepFeedback, string | null> = {
  neutral: null,
  correct: '#16a34a',
  wrong: '#dc2626',
};

// Persistent error marks are orange, distinct from the transient wrong-red, so a
// reviewed mistake cannot be confused with live "wrong right now" feedback.
const ERROR_MARK_COLOR = '#ea580c';
const RESIZE_DEBOUNCE_MS = 150;

const MEASURE_CURSOR = 1;
const SYNC_GUARD_LIMIT = 10000;

/** Structural accessor: only VexFlow graphical notes expose the SVG element. */
interface SvgAccessibleNote {
  getSVGGElement(): SVGGElement | null;
}

function getNoteSvg(graphicalNote: GraphicalNote): SVGGElement | null {
  const candidate = graphicalNote as unknown as Partial<SvgAccessibleNote>;
  return typeof candidate.getSVGGElement === 'function' ? candidate.getSVGGElement() : null;
}

/** Nearest scrollable ancestor of the given element, if any. */
function findScrollParent(element: HTMLElement | null): HTMLElement | null {
  let node = element?.parentElement ?? null;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * OpenSheetMusicDisplay-backed implementation of {@link IScoreRenderer}.
 *
 * All OSMD-specific knowledge (MIDI extraction, grand-staff handling, cursor
 * management, note colouring) is contained here so the rest of the app stays
 * engine-agnostic.
 */
export class OsmdScoreRenderer implements IScoreRenderer {
  private osmd: OpenSheetMusicDisplay | null = null;
  private container: HTMLElement | null = null;
  private scrollParent: HTMLElement | null = null;
  private loaded = false;
  private advanceMode: AdvanceMode = 'note';
  private coloredElements: SVGElement[] = [];

  // Persistent error marks: source model notes per cursor-position signature.
  // Model notes survive re-renders (unlike SVG elements), so marks are
  // re-resolved and re-painted after every render.
  private errorMarks = new Map<string, Note[]>();
  private markedElements: SVGElement[] = [];
  private currentFeedback: StepFeedback = 'neutral';
  private resizeObserver: ResizeObserver | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private scrollAnimationFrame: number | null = null;

  mount(container: HTMLElement): void {
    const options: IOSMDOptions = {
      // autoResize would let OSMD re-render internally with no callback for us
      // to re-apply the error marks, so we own the resize handling instead.
      autoResize: false,
      backend: 'svg',
      drawingParameters: 'compact',
      pageBackgroundColor: '#FFFFFF',
      cursorsOptions: [
        { type: CursorType.Standard, color: '#2563eb', alpha: 0.3, follow: true },
        { type: CursorType.CurrentArea, color: '#94a3b8', alpha: 0.25, follow: false },
      ],
    };
    this.container = container;
    this.osmd = new OpenSheetMusicDisplay(container, options);
    this.scrollParent = findScrollParent(container);
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.loaded) {
        return;
      }
      if (this.resizeTimer !== null) {
        clearTimeout(this.resizeTimer);
      }
      this.resizeTimer = setTimeout(() => {
        this.resizeTimer = null;
        this.resize();
      }, RESIZE_DEBOUNCE_MS);
    });
    this.resizeObserver.observe(container);
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  async load(content: string | ArrayBuffer): Promise<void> {
    if (!this.osmd) {
      throw new Error('Renderer is not mounted.');
    }
    this.coloredElements = [];
    this.markedElements = [];
    this.errorMarks.clear();
    this.currentFeedback = 'neutral';
    const payload = typeof content === 'string' ? content : new Blob([content]);
    await this.osmd.load(payload);
    this.osmd.render();
    this.loaded = true;
    this.resetCursor();
  }

  resetCursor(): ScoreStepInfo {
    const cursor = this.osmd?.cursor;
    if (!cursor) {
      return EMPTY_STEP;
    }
    this.errorMarks.clear();
    this.currentFeedback = 'neutral';
    cursor.reset();
    cursor.show();
    this.skipEmptyForward();
    this.repaintColors();
    this.syncMeasureCursor();
    this.scrollCursorIntoViewIfNeeded();
    return this.getCurrentStep();
  }

  next(mode: AdvanceMode, count = 1): ScoreStepInfo {
    return this.step(mode, 'forward', count);
  }

  previous(mode: AdvanceMode, count = 1): ScoreStepInfo {
    return this.step(mode, 'backward', count);
  }

  getCurrentStep(): ScoreStepInfo {
    const iterator = this.osmd?.cursor?.Iterator;
    if (!iterator) {
      return EMPTY_STEP;
    }
    const atEnd = iterator.EndReached;
    return {
      expectedMidiNotes: atEnd ? [] : this.expectedNotesUnderCursor(),
      measureIndex: iterator.CurrentMeasureIndex ?? 0,
      atEnd,
    };
  }

  setFeedback(feedback: StepFeedback): void {
    this.currentFeedback = feedback;
    this.repaintColors();
  }

  markErrorAtCursor(): void {
    const notes = this.modelNotesUnderCursor();
    if (notes.length === 0) {
      return;
    }
    this.errorMarks.set(this.cursorPosition(), notes);
    this.repaintColors();
  }

  clearErrorMarkAtCursor(): void {
    if (this.errorMarks.delete(this.cursorPosition())) {
      this.repaintColors();
    }
  }

  clearAllErrorMarks(): void {
    if (this.errorMarks.size === 0) {
      return;
    }
    this.errorMarks.clear();
    this.repaintColors();
  }

  get errorMarkCount(): number {
    return this.errorMarks.size;
  }

  setAdvanceMode(mode: AdvanceMode): void {
    this.advanceMode = mode;
    const measureCursor = this.osmd?.cursors?.[MEASURE_CURSOR];
    if (!measureCursor) {
      return;
    }
    if (mode === 'measure') {
      this.syncMeasureCursor();
      measureCursor.show();
    } else {
      measureCursor.hide();
    }
  }

  resize(): void {
    if (!this.osmd || !this.loaded) {
      return;
    }
    // The re-render rebuilds the SVG, so previously tracked elements are stale.
    this.coloredElements = [];
    this.markedElements = [];
    this.currentFeedback = 'neutral';
    this.osmd.render();
    this.osmd.cursor?.show();
    this.repaintColors();
    this.syncMeasureCursor();
    this.scrollCursorIntoViewIfNeeded();
  }

  dispose(): void {
    this.cancelScrollAnimation();
    if (this.resizeTimer !== null) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.clearColors();
    this.clearMarkFills();
    this.errorMarks.clear();
    this.osmd?.clear();
    this.osmd = null;
    this.loaded = false;
  }

  private step(mode: AdvanceMode, direction: 'forward' | 'backward', count = 1): ScoreStepInfo {
    const cursor = this.osmd?.cursor;
    if (!cursor) {
      return EMPTY_STEP;
    }
    this.currentFeedback = 'neutral';
    const repetitions = Math.max(1, Math.floor(count));
    for (let i = 0; i < repetitions; i++) {
      const before = this.cursorPosition();
      this.moveOnce(mode, direction);
      if (this.cursorPosition() === before) {
        break; // reached the start or end of the sheet
      }
    }
    cursor.show();
    this.repaintColors();
    this.syncMeasureCursor();
    this.scrollCursorIntoViewIfNeeded();
    return this.getCurrentStep();
  }

  private moveOnce(mode: AdvanceMode, direction: 'forward' | 'backward'): void {
    const cursor = this.osmd?.cursor;
    if (!cursor) {
      return;
    }
    if (direction === 'forward') {
      if (mode === 'measure') {
        cursor.nextMeasure();
      } else if (mode === 'beat') {
        this.stepToNextBeat();
      } else {
        cursor.next();
      }
      this.skipEmptyForward();
    } else {
      if (mode === 'measure') {
        cursor.previousMeasure();
      } else if (mode === 'beat') {
        this.stepToPreviousBeat();
      } else {
        cursor.previous();
      }
      this.skipEmptyBackward();
    }
  }

  /** Length of one notated beat, in whole-note fractions (e.g. 0.25 for x/4). */
  private currentBeatLength(): number {
    const denominator =
      this.osmd?.cursor?.Iterator?.CurrentMeasure?.ActiveTimeSignature?.Denominator;
    return denominator && denominator > 0 ? 1 / denominator : 0.25;
  }

  /** Identifier for the beat the cursor is currently in (measure + beat index). */
  private beatSignature(): string {
    const iterator = this.osmd?.cursor?.Iterator;
    const measure = iterator?.CurrentMeasureIndex ?? -1;
    const relative = iterator?.CurrentRelativeInMeasureTimestamp?.RealValue ?? 0;
    return `${measure}:${Math.floor(relative / this.currentBeatLength() + 1e-6)}`;
  }

  /** Identifier for the cursor's exact position (used to detect no movement). */
  private cursorPosition(): string {
    const iterator = this.osmd?.cursor?.Iterator;
    const relative = iterator?.CurrentRelativeInMeasureTimestamp?.RealValue ?? -1;
    return `${iterator?.CurrentMeasureIndex ?? -1}:${relative}`;
  }

  /** Advance to the first note-group of the next beat. */
  private stepToNextBeat(): void {
    const cursor = this.osmd?.cursor;
    if (!cursor) {
      return;
    }
    const startBeat = this.beatSignature();
    let guard = 0;
    while (guard++ < SYNC_GUARD_LIMIT) {
      const before = this.cursorPosition();
      cursor.next();
      if (cursor.Iterator.EndReached || this.cursorPosition() === before) {
        return;
      }
      if (this.beatSignature() !== startBeat) {
        return; // reached the first note-group of a new beat
      }
    }
  }

  /** Move to the first note-group of the beat the cursor is currently in. */
  private snapToBeatStart(): void {
    const cursor = this.osmd?.cursor;
    if (!cursor) {
      return;
    }
    let guard = 0;
    while (guard++ < SYNC_GUARD_LIMIT) {
      const beatBefore = this.beatSignature();
      const positionBefore = this.cursorPosition();
      cursor.previous();
      // Stop when we leave the beat, or when the step made no real progress
      // (e.g. the pre-first-note position at the start of the sheet). In both
      // cases the previous() overshot, so step forward to the beat's first group.
      if (this.beatSignature() !== beatBefore || this.cursorPosition() === positionBefore) {
        cursor.next();
        return;
      }
    }
  }

  /** Move to the first note-group of the previous beat. */
  private stepToPreviousBeat(): void {
    const cursor = this.osmd?.cursor;
    if (!cursor) {
      return;
    }
    const positionBefore = this.cursorPosition();
    this.snapToBeatStart();
    if (this.cursorPosition() !== positionBefore) {
      return; // was mid-beat: snapping to the beat start is the previous-beat move
    }
    cursor.previous();
    if (this.cursorPosition() === positionBefore) {
      cursor.next(); // start of the sheet: undo the stalled step
      return;
    }
    this.snapToBeatStart();
  }

  /**
   * If the current measure is not fully visible in the score area (even if only
   * its top or bottom is clipped), scroll so the measure is centered vertically
   * in the viewport. Does nothing while the measure is already fully visible.
   */
  private scrollCursorIntoViewIfNeeded(): void {
    if (!this.scrollParent) {
      this.scrollParent = findScrollParent(this.container);
    }
    const viewport = this.scrollParent;
    const extent = this.currentMeasureExtent();
    if (!viewport || !extent) {
      return;
    }
    const viewportRect = viewport.getBoundingClientRect();
    const fullyVisible = extent.top >= viewportRect.top && extent.bottom <= viewportRect.bottom;
    if (fullyVisible) {
      // Don't let an in-flight scroll from a previous step push a measure that
      // is already fully visible back out of view.
      this.cancelScrollAnimation();
      return;
    }
    const measureCenter = (extent.top + extent.bottom) / 2 - viewportRect.top;
    this.animateScrollTo(viewport, viewport.scrollTop + measureCenter - viewportRect.height / 2);
  }

  /**
   * Smoothly scroll the viewport to `targetTop` with a short ease-out. A new
   * call retargets any running animation, so rapid steps stay responsive.
   */
  private animateScrollTo(viewport: HTMLElement, targetTop: number): void {
    this.cancelScrollAnimation();
    const start = viewport.scrollTop;
    const distance = targetTop - start;
    if (Math.abs(distance) < 1) {
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      viewport.scrollTop = targetTop;
      return;
    }
    // Snappy but visible: scale mildly with distance, never slower than 400 ms.
    const duration = Math.min(400, 150 + Math.abs(distance) * 0.25);
    const startTime = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      viewport.scrollTop = start + distance * eased;
      this.scrollAnimationFrame = progress < 1 ? requestAnimationFrame(tick) : null;
    };
    this.scrollAnimationFrame = requestAnimationFrame(tick);
  }

  private cancelScrollAnimation(): void {
    if (this.scrollAnimationFrame !== null) {
      cancelAnimationFrame(this.scrollAnimationFrame);
      this.scrollAnimationFrame = null;
    }
  }

  /**
   * The current measure's vertical screen extent, spanning every staff (both
   * staves of a grand staff) and including notes/ledger lines that reach above or
   * below the staff. Falls back to the cursor's staff area when notes cannot be
   * measured.
   */
  private currentMeasureExtent(): { top: number; bottom: number } | null {
    const osmd = this.osmd;
    const cursor = osmd?.cursor;
    if (!osmd || !cursor) {
      return null;
    }

    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    const include = (rect: DOMRect): void => {
      if (rect.height === 0 && rect.width === 0) {
        return;
      }
      top = Math.min(top, rect.top);
      bottom = Math.max(bottom, rect.bottom);
    };

    // The staff area itself (and the fallback when no notes can be measured).
    if (cursor.cursorElement) {
      include(cursor.cursorElement.getBoundingClientRect());
    }

    // Every note of the current measure, across all staves.
    const measureIndex = cursor.Iterator?.CurrentMeasureIndex ?? -1;
    const measures = osmd.GraphicSheet?.MeasureList?.[measureIndex] ?? [];
    for (const measure of measures) {
      for (const staffEntry of measure.staffEntries) {
        for (const voiceEntry of staffEntry.graphicalVoiceEntries) {
          for (const note of voiceEntry.notes) {
            const svg = getNoteSvg(note);
            if (svg) {
              include(svg.getBoundingClientRect());
            }
          }
        }
      }
    }

    if (top === Number.POSITIVE_INFINITY || bottom === Number.NEGATIVE_INFINITY) {
      return null;
    }
    return { top, bottom };
  }

  /** Model notes at the cursor that require a key press, across all staves/voices. */
  private modelNotesUnderCursor(): Note[] {
    const cursor = this.osmd?.cursor;
    if (!cursor) {
      return [];
    }
    const notes: Note[] = [];
    for (const voiceEntry of cursor.VoicesUnderCursor()) {
      if (voiceEntry.IsGrace) {
        continue;
      }
      for (const note of voiceEntry.Notes) {
        if (this.noteToMidi(note) !== null) {
          notes.push(note);
        }
      }
    }
    return notes;
  }

  /** MIDI notes required at the cursor, across all staves/voices (grand staff). */
  private expectedNotesUnderCursor(): number[] {
    const midiNotes = new Set<number>();
    for (const note of this.modelNotesUnderCursor()) {
      const midi = this.noteToMidi(note);
      if (midi !== null) {
        midiNotes.add(midi);
      }
    }
    return [...midiNotes].sort((a, b) => a - b);
  }

  private noteToMidi(note: Note): number | null {
    if (note.isRest() || note.IsGraceNote || !note.Pitch) {
      return null;
    }
    // A tie continuation is held rather than re-pressed, so it is not required.
    const tie = note.NoteTie;
    if (tie && tie.StartNote && tie.StartNote !== note) {
      return null;
    }
    // OSMD half-tone 0 == C0; MIDI note 12 == C0, hence the +12 offset.
    return note.halfTone + 12;
  }

  private skipEmptyForward(): void {
    const cursor = this.osmd?.cursor;
    if (!cursor) {
      return;
    }
    let guard = 0;
    while (
      !cursor.Iterator.EndReached &&
      this.expectedNotesUnderCursor().length === 0 &&
      guard < SYNC_GUARD_LIMIT
    ) {
      cursor.next();
      guard += 1;
    }
  }

  private skipEmptyBackward(): void {
    const cursor = this.osmd?.cursor;
    if (!cursor) {
      return;
    }
    let guard = 0;
    while (this.expectedNotesUnderCursor().length === 0 && guard < SYNC_GUARD_LIMIT) {
      const measureIndex = cursor.Iterator.CurrentMeasureIndex;
      cursor.previous();
      // Stop if we cannot move any further back (start of sheet).
      if (cursor.Iterator.CurrentMeasureIndex === measureIndex && measureIndex === 0) {
        break;
      }
      guard += 1;
    }
  }

  /** Keep the translucent measure highlight aligned with the note cursor. */
  private syncMeasureCursor(): void {
    if (this.advanceMode !== 'measure') {
      return;
    }
    const osmd = this.osmd;
    const measureCursor = osmd?.cursors?.[MEASURE_CURSOR];
    if (!osmd || !measureCursor) {
      return;
    }
    const target = osmd.cursor.Iterator.CurrentMeasureIndex ?? 0;
    try {
      measureCursor.reset();
      let guard = 0;
      while (
        !measureCursor.Iterator.EndReached &&
        (measureCursor.Iterator.CurrentMeasureIndex ?? 0) < target &&
        guard < SYNC_GUARD_LIMIT
      ) {
        measureCursor.nextMeasure();
        guard += 1;
      }
      measureCursor.update();
      measureCursor.show();
    } catch {
      // The measure highlight is non-essential; never let it break matching.
    }
  }

  /**
   * Single repaint invariant: wipe every inline fill, re-apply the persistent
   * error marks, then paint the transient cursor feedback on top so it wins on
   * shared elements. When feedback returns to neutral the mark shows again.
   */
  private repaintColors(): void {
    this.clearColors();
    this.clearMarkFills();
    this.applyErrorMarks();
    this.applyFeedbackColor();
  }

  private applyErrorMarks(): void {
    const rules = this.osmd?.EngravingRules;
    if (!rules) {
      return;
    }
    for (const notes of this.errorMarks.values()) {
      for (const note of notes) {
        // Model notes survive re-renders; resolve to the current graphical note.
        const graphicalNote = rules.GNote(note);
        const svg = graphicalNote ? getNoteSvg(graphicalNote) : null;
        if (!svg) {
          continue;
        }
        svg.querySelectorAll<SVGElement>('path, ellipse, rect, text').forEach((element) => {
          element.style.fill = ERROR_MARK_COLOR;
          this.markedElements.push(element);
        });
      }
    }
  }

  private applyFeedbackColor(): void {
    const color = FEEDBACK_COLORS[this.currentFeedback];
    const cursor = this.osmd?.cursor;
    if (!color || !cursor) {
      return;
    }
    for (const graphicalNote of cursor.GNotesUnderCursor()) {
      const svg = getNoteSvg(graphicalNote);
      if (!svg) {
        continue;
      }
      svg.querySelectorAll<SVGElement>('path, ellipse, rect, text').forEach((element) => {
        element.style.fill = color;
        this.coloredElements.push(element);
      });
    }
  }

  private clearColors(): void {
    for (const element of this.coloredElements) {
      element.style.fill = '';
    }
    this.coloredElements = [];
  }

  private clearMarkFills(): void {
    for (const element of this.markedElements) {
      element.style.fill = '';
    }
    this.markedElements = [];
  }
}
