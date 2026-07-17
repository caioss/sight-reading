import { scoreToMusicXml } from './musicXmlWriter';
import { BASE_DIVS, DIVISIONS, FALLBACK_SPECS, measureCapacity } from './rhythm';
import { diatonicPool, keyName, keyScale, midiOf, type PoolNote } from './theory';
import type {
  BaseDuration,
  ClefType,
  GeneratedScore,
  KeySignature,
  ScoreEvent,
  SpelledPitch,
  StaffConfig,
  TimeSignature,
} from './types';

export type MotionDirection = 'up' | 'down' | 'up-down' | 'down-up';

export interface ScaleStaffConfig {
  clef: ClefType;
  /** Octave of the anchor tonic (scientific pitch notation, C4 = octave 4). */
  startOctave: number;
}

export interface ScaleConfig {
  staffLayout: 'single' | 'grand';
  key: KeySignature;
  /** Scale degrees (1..7) that appear in the run; the rest are skipped. */
  degrees: number[];
  motion: MotionDirection;
  /** Octaves covered by the ascending leg ('up', 'up-down', 'down-up'). */
  octavesUp: number;
  /** Octaves covered by the descending leg ('down', 'up-down', 'down-up'). */
  octavesDown: number;
  /** Notated value of every scale note; must fit the measure evenly. */
  duration: BaseDuration;
  time: TimeSignature;
  /** Index 0 = upper staff. Length 1 for single, 2 for grand. */
  staves: ScaleStaffConfig[];
  title?: string;
}

export const MIN_OCTAVES = 1;
export const MAX_OCTAVES = 4;
export const MIN_START_OCTAVE = 1;
export const MAX_START_OCTAVE = 7;

export const DEFAULT_SCALE_STAFF: ScaleStaffConfig = { clef: 'treble', startOctave: 4 };
export const DEFAULT_SCALE_BASS_STAFF: ScaleStaffConfig = { clef: 'bass', startOctave: 3 };

export const DEFAULT_SCALE_CONFIG: ScaleConfig = {
  staffLayout: 'single',
  key: { fifths: 0, mode: 'major' },
  degrees: [1, 2, 3, 4, 5, 6, 7],
  motion: 'up',
  octavesUp: 1,
  octavesDown: 1,
  duration: 'quarter',
  time: { beats: 4, beatType: 4 },
  staves: [DEFAULT_SCALE_STAFF],
};

function usesUpLeg(motion: MotionDirection): boolean {
  return motion !== 'down';
}

function usesDownLeg(motion: MotionDirection): boolean {
  return motion !== 'up';
}

function anchorMidi(key: KeySignature, startOctave: number): number {
  const tonic = keyScale(key)[0];
  return midiOf(tonic.step, tonic.alter, startOctave);
}

/** Human-readable config problems; an empty list means the config is valid. */
export function validateScaleConfig(config: ScaleConfig): string[] {
  const problems: string[] = [];
  if (config.degrees.length === 0) {
    problems.push('Select at least one scale degree.');
  } else if (config.degrees.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    problems.push('Scale degrees must be between 1 and 7.');
  } else if (new Set(config.degrees).size !== config.degrees.length) {
    problems.push('Scale degrees must not repeat.');
  }
  if (!Number.isInteger(config.key.fifths) || Math.abs(config.key.fifths) > 7) {
    problems.push('Key signature must be between 7 flats and 7 sharps.');
  }
  const octavesValid = (value: number) =>
    Number.isInteger(value) && value >= MIN_OCTAVES && value <= MAX_OCTAVES;
  const upUsed = usesUpLeg(config.motion);
  const downUsed = usesDownLeg(config.motion);
  if (upUsed && !octavesValid(config.octavesUp)) {
    problems.push(`Octaves up must be a whole number between ${MIN_OCTAVES} and ${MAX_OCTAVES}.`);
  }
  if (downUsed && !octavesValid(config.octavesDown)) {
    problems.push(`Octaves down must be a whole number between ${MIN_OCTAVES} and ${MAX_OCTAVES}.`);
  }
  const legsValid =
    (!upUsed || octavesValid(config.octavesUp)) && (!downUsed || octavesValid(config.octavesDown));
  if (!Number.isInteger(config.time.beats) || config.time.beats < 1 || config.time.beats > 12) {
    problems.push('Time signature beats must be between 1 and 12.');
  } else {
    const capacity = measureCapacity(config.time);
    const durationDiv = BASE_DIVS[config.duration];
    if (durationDiv > capacity || capacity % durationDiv !== 0) {
      problems.push('The note value must fit the measure evenly.');
    }
  }
  const expectedStaves = config.staffLayout === 'grand' ? 2 : 1;
  if (config.staves.length !== expectedStaves) {
    problems.push(
      `A ${config.staffLayout} staff layout needs exactly ${expectedStaves} staff configuration(s).`,
    );
    return problems;
  }
  config.staves.forEach((staff, index) => {
    const label =
      config.staffLayout === 'grand' ? (index === 0 ? 'Upper staff' : 'Lower staff') : 'Staff';
    if (
      !Number.isInteger(staff.startOctave) ||
      staff.startOctave < MIN_START_OCTAVE ||
      staff.startOctave > MAX_START_OCTAVE
    ) {
      problems.push(
        `${label}: starting octave must be a whole number between ${MIN_START_OCTAVE} and ${MAX_START_OCTAVE}.`,
      );
      return;
    }
    // The range check needs sane octave counts to mean anything.
    if (legsValid) {
      const anchor = anchorMidi(config.key, staff.startOctave);
      const up = upUsed ? config.octavesUp : 0;
      const down = downUsed ? config.octavesDown : 0;
      if (anchor - 12 * down < 21 || anchor + 12 * up > 108) {
        problems.push(`${label}: the scale leaves the piano range (A0 to C8).`);
      }
    }
  });
  return problems;
}

/**
 * The ordered pitches of the scale run for one staff. Legs are built from the
 * unfiltered diatonic ladder so turning points are well-defined, then filtered
 * to the selected degrees; a deselected turning point can leave the same pitch
 * on both sides of the turn, so consecutive duplicates are collapsed.
 */
export function buildScaleRun(config: ScaleConfig, staff: ScaleStaffConfig): SpelledPitch[] {
  const anchor = anchorMidi(config.key, staff.startOctave);
  const ascending = (from: number, octaves: number) =>
    diatonicPool(config.key, from, from + 12 * octaves);
  const descending = (from: number, octaves: number) =>
    ascending(from - 12 * octaves, octaves).reverse();
  let path: PoolNote[];
  switch (config.motion) {
    case 'up':
      path = ascending(anchor, config.octavesUp);
      break;
    case 'down':
      path = descending(anchor, config.octavesDown);
      break;
    case 'up-down': {
      // slice(1) drops the turning point, which the first leg already played.
      const peak = anchor + 12 * config.octavesUp;
      path = [...ascending(anchor, config.octavesUp), ...descending(peak, config.octavesDown).slice(1)];
      break;
    }
    case 'down-up': {
      const bottom = anchor - 12 * config.octavesDown;
      path = [...descending(anchor, config.octavesDown), ...ascending(bottom, config.octavesUp).slice(1)];
      break;
    }
  }
  const selected = new Set(config.degrees);
  return path
    .filter((note) => selected.has(note.degree))
    .filter((note, i, run) => i === 0 || note.midi !== run[i - 1].midi)
    .map(({ step, alter, octave, midi }) => ({ step, alter, octave, midi }));
}

/**
 * Split a duration into notated values, largest first, for a tie chain. Any
 * total up to a full measure is representable because the fallback table
 * bottoms out at a single division.
 */
function tieChainSpecs(totalDiv: number): { base: BaseDuration; dots: 0 | 1; div: number }[] {
  const parts: { base: BaseDuration; dots: 0 | 1; div: number }[] = [];
  let remaining = totalDiv;
  while (remaining > 0) {
    const spec = FALLBACK_SPECS.find((candidate) => candidate.div <= remaining);
    if (!spec) {
      throw new Error(`Cannot notate a duration of ${totalDiv} divisions.`);
    }
    parts.push({ base: spec.base, dots: spec.dots, div: spec.div });
    remaining -= spec.div;
  }
  return parts;
}

/**
 * The final note is extended to fill the rest of its measure (a scale ends on
 * a held note, never trailing rests — the cursor pipeline expects the last
 * slot to sound). When no single notated value fits, the extension becomes a
 * tie chain; tie continuations do not require an extra keypress.
 */
function runToEvents(run: SpelledPitch[], duration: BaseDuration, capacity: number): ScoreEvent[] {
  const durationDiv = BASE_DIVS[duration];
  const events: ScoreEvent[] = run.map((pitch) => ({
    kind: 'note',
    durationDiv,
    type: duration,
    dots: 0,
    pitches: [pitch],
  }));
  const total = run.length * durationDiv;
  const padding = (capacity - (total % capacity)) % capacity;
  if (padding === 0) {
    return events;
  }
  const finalPitch = run[run.length - 1];
  const chain = tieChainSpecs(durationDiv + padding);
  const finalEvents = chain.map((part, i) => {
    const event: ScoreEvent = {
      kind: 'note',
      durationDiv: part.div,
      type: part.base,
      dots: part.dots,
      pitches: [{ ...finalPitch }],
    };
    if (i > 0) {
      event.tieStop = true;
    }
    if (i < chain.length - 1) {
      event.tieStart = true;
    }
    return event;
  });
  return [...events.slice(0, -1), ...finalEvents];
}

/** Chunk a staff's flat event list into measures of exactly `capacity` divisions. */
function chunkIntoMeasures(events: ScoreEvent[], capacity: number): ScoreEvent[][] {
  const measures: ScoreEvent[][] = [];
  let current: ScoreEvent[] = [];
  let filled = 0;
  for (const event of events) {
    current.push(event);
    filled += event.durationDiv;
    if (filled === capacity) {
      measures.push(current);
      current = [];
      filled = 0;
    }
  }
  return measures;
}

/** Build the intermediate score model (exposed mainly for tests). */
export function generateScaleScore(config: ScaleConfig): GeneratedScore {
  const problems = validateScaleConfig(config);
  if (problems.length > 0) {
    throw new Error(problems.join(' '));
  }
  const capacity = measureCapacity(config.time);
  const runs = config.staves.map((staff) => buildScaleRun(config, staff));
  // Same degrees and motion on every staff: runs are equal length, so grand
  // staves stay vertically aligned note for note.
  const staffMeasures = runs.map((run) =>
    chunkIntoMeasures(runToEvents(run, config.duration, capacity), capacity),
  );
  const measureCount = staffMeasures[0].length;
  const staves: StaffConfig[] = config.staves.map((staff, index) => ({
    clef: staff.clef,
    minMidi: Math.min(...runs[index].map((p) => p.midi)),
    maxMidi: Math.max(...runs[index].map((p) => p.midi)),
    allowedDurations: [config.duration],
    allowDotted: false,
    allowRests: false,
    allowTies: false,
    allowAccidentals: false,
    allowChords: false,
  }));
  return {
    config: {
      staffLayout: config.staffLayout,
      key: config.key,
      time: config.time,
      measureCount,
      staves,
      title: config.title,
    },
    divisions: DIVISIONS,
    measures: Array.from({ length: measureCount }, (_, m) => ({
      staves: staffMeasures.map((measures) => measures[m]),
    })),
  };
}

/** Generate a complete MusicXML document string ready for the renderer. */
export function generateScaleMusicXml(config: ScaleConfig): string {
  const title =
    config.title ?? `${keyName(config.key.fifths, config.key.mode)} ${config.key.mode} scale`;
  return scoreToMusicXml(generateScaleScore({ ...config, title }));
}
