import { chance, pickWeighted, type Rng } from './rng';
import {
  allowedSpecs,
  beatUnit,
  generateMeasureRhythm,
  measureCapacity,
  planRests,
  type RhythmSlot,
} from './rhythm';
import {
  chromaticBetween,
  diatonicPool,
  diatonicTriad,
  midiOf,
  raisedSeventh,
  type PoolNote,
  type SpelledPitchClass,
} from './theory';
import type {
  KeySignature,
  ScoreEvent,
  SpelledPitch,
  StaffConfig,
  TimeSignature,
} from './types';

const TIE_PROBABILITY = 0.15;
const CHORD_TONE_SNAP_PROBABILITY = 0.8;
const GAP_FILL_PROBABILITY = 0.8;
const ACCIDENTAL_PROBABILITY = 0.5;
const LEADING_TONE_PROBABILITY = 0.6;

/** Interval sizes in scale steps, biased strongly toward stepwise motion. */
const INTERVAL_WEIGHTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.05],
  [1, 0.55],
  [2, 0.2],
  [3, 0.08],
  [4, 0.06],
  [5, 0.04],
  [7, 0.02],
];

/** Register targets across a 4-measure phrase (fractions of the pitch range). */
const PHRASE_TARGETS = [0.4, 0.65, 0.75, 0.5];

export interface StaffGenerationOptions {
  staff: StaffConfig;
  key: KeySignature;
  time: TimeSignature;
  /** Chord degree per measure, shared across all staves. */
  progression: number[];
  /** Grand-staff measures may rest entirely; single-staff ones must not. */
  allowFullMeasureRest: boolean;
}

/** Generate all measures of one staff: rhythm, rests, ties, pitches, extras. */
export function generateStaffMeasures(options: StaffGenerationOptions, rng: Rng): ScoreEvent[][] {
  const { staff, key, time, progression } = options;
  const pool = diatonicPool(key, staff.minMidi, staff.maxMidi);
  if (pool.length === 0) {
    throw new Error('Pitch range contains no notes of the selected key.');
  }
  const capacity = measureCapacity(time);
  const beat = beatUnit(time);
  const specs = allowedSpecs(staff);
  const rhythms = progression.map(() => generateMeasureRhythm(capacity, specs, beat, rng));
  const restFlags = planRests(
    rhythms,
    { allowRests: staff.allowRests, allowFullMeasureRest: options.allowFullMeasureRest },
    rng,
  );
  const ties = planTies(rhythms, restFlags, staff.allowTies, rng);
  const measures = assignPitches({ ...options, pool, capacity, beat, rhythms, restFlags, ties }, rng);
  if (staff.allowAccidentals) {
    applyAccidentals(measures, pool, key, beat, rng);
  }
  convertFullMeasureRests(measures, capacity);
  return measures;
}

/** ties[i] = the barline between measure i and i+1 carries a tie. */
function planTies(
  rhythms: RhythmSlot[][],
  restFlags: boolean[][],
  allowTies: boolean,
  rng: Rng,
): boolean[] {
  const ties = rhythms.slice(0, -1).map(() => false);
  if (!allowTies) {
    return ties;
  }
  for (let i = 0; i < ties.length; i += 1) {
    const lastSlot = rhythms[i].length - 1;
    const lastSounds = !restFlags[i][lastSlot];
    const firstSounds = !restFlags[i + 1][0];
    if (lastSounds && firstSounds && chance(rng, TIE_PROBABILITY)) {
      ties[i] = true;
    }
  }
  return ties;
}

interface PitchAssignmentContext extends StaffGenerationOptions {
  pool: PoolNote[];
  capacity: number;
  beat: number;
  rhythms: RhythmSlot[][];
  restFlags: boolean[][];
  ties: boolean[];
}

function assignPitches(context: PitchAssignmentContext, rng: Rng): ScoreEvent[][] {
  const { staff, key, progression, pool, capacity, beat, rhythms, restFlags, ties } = context;
  // Chords land on the strongest pulses only: halves of even-beat measures,
  // otherwise just the downbeat.
  const strongUnit = context.time.beats % 2 === 0 ? capacity / 2 : capacity;
  const chordDegrees = progression.map((degree) =>
    [0, 2, 4].map((offset) => ((degree - 1 + offset) % 7) + 1),
  );
  const voicings = staff.allowChords
    ? planVoicings(progression, key, pool, staff.minMidi, staff.maxMidi)
    : null;

  let idx = startIndex(pool, rng);
  let lastInterval = 0;
  const cadence = findCadenceSlots(rhythms, restFlags);

  const measures: ScoreEvent[][] = rhythms.map((slots, m) =>
    slots.map((slot, s) => {
      const event: ScoreEvent = {
        kind: restFlags[m][s] ? 'rest' : 'note',
        durationDiv: slot.div,
        type: slot.base,
        dots: slot.dots,
        pitches: [],
      };
      if (event.kind === 'rest') {
        return event;
      }

      const tieStopsHere = m > 0 && s === 0 && ties[m - 1];
      if (s === slots.length - 1 && m < ties.length && ties[m]) {
        event.tieStart = true;
      }
      if (tieStopsHere) {
        event.tieStop = true;
        // Pitches are copied from the tie-start event after the map completes.
        return event;
      }

      if (voicings && slot.startDiv % strongUnit === 0) {
        event.pitches = voicings[m];
        return event;
      }

      // Melodic random walk.
      let magnitude: number;
      let direction: number;
      if (Math.abs(lastInterval) >= 3 && chance(rng, GAP_FILL_PROBABILITY)) {
        // Gap fill: recover a leap with a step back the other way.
        magnitude = 1;
        direction = -Math.sign(lastInterval);
      } else {
        magnitude = pickWeighted(rng, INTERVAL_WEIGHTS);
        const target = phraseTargetIndex(pool.length, m);
        const pUp = idx < target ? 0.68 : idx > target ? 0.32 : 0.5;
        direction = chance(rng, pUp) ? 1 : -1;
      }
      let next = reflectIndex(idx + direction * magnitude, pool.length);

      const onBeat = slot.startDiv % beat === 0;
      if (onBeat && chance(rng, CHORD_TONE_SNAP_PROBABILITY)) {
        next = nearestWithDegree(pool, next, chordDegrees[m]) ?? next;
      }
      if (m === cadence.measure && s === cadence.slot) {
        next = nearestWithDegree(pool, next, [1]) ?? next;
      } else if (m === cadence.preMeasure && s === cadence.preSlot) {
        next = nearestWithDegree(pool, next, [2, 7, 5]) ?? next;
      }

      lastInterval = next - idx;
      idx = next;
      event.pitches = [poolPitch(pool[next])];
      return event;
    }),
  );

  // Tie continuations repeat the exact pitches of the note they extend.
  for (let m = 1; m < measures.length; m += 1) {
    if (ties[m - 1]) {
      const startEvent = measures[m - 1][measures[m - 1].length - 1];
      measures[m][0].pitches = startEvent.pitches.map((pitch) => ({ ...pitch }));
    }
  }
  return measures;
}

function poolPitch(note: PoolNote): SpelledPitch {
  return { step: note.step, alter: note.alter, octave: note.octave, midi: note.midi };
}

function startIndex(pool: PoolNote[], rng: Rng): number {
  const center = (pool.length - 1) / 2;
  const candidates = pool
    .map((note, i) => ({ note, i }))
    .filter(({ note }) => [1, 3, 5].includes(note.degree))
    .sort((a, b) => Math.abs(a.i - center) - Math.abs(b.i - center))
    .slice(0, 3);
  if (candidates.length === 0) {
    return Math.round(center);
  }
  return candidates[Math.floor(rng() * candidates.length)].i;
}

function phraseTargetIndex(poolLength: number, measure: number): number {
  return Math.round(PHRASE_TARGETS[measure % PHRASE_TARGETS.length] * (poolLength - 1));
}

function reflectIndex(index: number, length: number): number {
  let i = index;
  if (i < 0) {
    i = -i;
  }
  if (i > length - 1) {
    i = 2 * (length - 1) - i;
  }
  return Math.max(0, Math.min(length - 1, i));
}

function nearestWithDegree(pool: PoolNote[], from: number, degrees: number[]): number | null {
  for (let distance = 0; distance < pool.length; distance += 1) {
    for (const candidate of [from - distance, from + distance]) {
      if (candidate >= 0 && candidate < pool.length && degrees.includes(pool[candidate].degree)) {
        return candidate;
      }
    }
  }
  return null;
}

interface CadenceSlots {
  measure: number;
  slot: number;
  preMeasure: number;
  preSlot: number;
}

/** Locate the final sounding slot and the sounding slot before it. */
function findCadenceSlots(rhythms: RhythmSlot[][], restFlags: boolean[][]): CadenceSlots {
  const sounding: { m: number; s: number }[] = [];
  rhythms.forEach((slots, m) =>
    slots.forEach((_, s) => {
      if (!restFlags[m][s]) {
        sounding.push({ m, s });
      }
    }),
  );
  const last = sounding[sounding.length - 1] ?? { m: 0, s: 0 };
  const previous = sounding[sounding.length - 2] ?? { m: -1, s: -1 };
  return { measure: last.m, slot: last.s, preMeasure: previous.m, preSlot: previous.s };
}

/** One chord voicing per measure, chained to minimize hand movement. */
function planVoicings(
  progression: number[],
  key: KeySignature,
  pool: PoolNote[],
  minMidi: number,
  maxMidi: number,
): SpelledPitch[][] {
  let previous: SpelledPitch[] | null = null;
  return progression.map((degree) => {
    const voicing =
      bestVoicing(diatonicTriad(key, degree), minMidi, maxMidi, previous) ??
      [poolPitch(pool[Math.floor(pool.length / 2)])];
    previous = voicing;
    return voicing;
  });
}

/**
 * Every closed-position placement of the triad inside the range; when the
 * range is too narrow for three notes the chord degrades to a dyad, the bare
 * root, or null (caller substitutes a scale note) rather than failing.
 */
function bestVoicing(
  pitchClasses: SpelledPitchClass[],
  minMidi: number,
  maxMidi: number,
  previous: SpelledPitch[] | null,
): SpelledPitch[] | null {
  for (let size = pitchClasses.length; size >= 1; size -= 1) {
    const candidates: SpelledPitch[][] = [];
    for (let rotation = 0; rotation < size; rotation += 1) {
      const order = pitchClasses
        .slice(0, size)
        .map((_, i) => pitchClasses[(rotation + i) % size]);
      for (let octave = -1; octave <= 9; octave += 1) {
        const voicing = stackUpward(order, octave);
        if (voicing.every((pitch) => pitch.midi >= minMidi && pitch.midi <= maxMidi)) {
          candidates.push(voicing);
        }
      }
    }
    if (candidates.length > 0) {
      return candidates.reduce((best, candidate) =>
        voicingCost(candidate, previous, minMidi, maxMidi) <
        voicingCost(best, previous, minMidi, maxMidi)
          ? candidate
          : best,
      );
    }
  }
  return null;
}

function stackUpward(order: SpelledPitchClass[], bottomOctave: number): SpelledPitch[] {
  const result: SpelledPitch[] = [];
  let floor = -Infinity;
  let octave = bottomOctave;
  for (const pc of order) {
    let midi = midiOf(pc.step, pc.alter, octave);
    while (midi <= floor) {
      octave += 1;
      midi = midiOf(pc.step, pc.alter, octave);
    }
    result.push({ step: pc.step, alter: pc.alter, octave, midi });
    floor = midi;
  }
  return result;
}

function voicingCost(
  voicing: SpelledPitch[],
  previous: SpelledPitch[] | null,
  minMidi: number,
  maxMidi: number,
): number {
  if (!previous) {
    const center = (minMidi + maxMidi) / 2;
    return Math.abs(voicing[0].midi - center);
  }
  const length = Math.min(voicing.length, previous.length);
  let cost = 0;
  for (let i = 0; i < length; i += 1) {
    cost += Math.abs(voicing[i].midi - previous[i].midi);
  }
  return cost;
}

/**
 * Chromatic decoration pass: replace a weak-beat note between two notes a
 * whole step apart with the chromatic passing tone, and raise the 7th before
 * a tonic arrival in minor (leading tone). Both always resolve by step.
 */
function applyAccidentals(
  measures: ScoreEvent[][],
  pool: PoolNote[],
  key: KeySignature,
  beat: number,
  rng: Rng,
): void {
  const byMidi = new Map(pool.map((note) => [note.midi, note]));
  for (const events of measures) {
    let startDiv = 0;
    const starts = events.map((event) => {
      const s = startDiv;
      startDiv += event.durationDiv;
      return s;
    });
    for (let i = 1; i < events.length - 1; i += 1) {
      const [a, e, b] = [events[i - 1], events[i], events[i + 1]];
      const singleNotes = [a, e, b].every(
        (event) => event.kind === 'note' && event.pitches.length === 1,
      );
      const tied = e.tieStart || e.tieStop || a.tieStart || b.tieStop;
      const weakBeat = starts[i] % beat !== 0;
      if (!singleNotes || tied || !weakBeat) {
        continue;
      }
      const from = byMidi.get(a.pitches[0].midi);
      const to = byMidi.get(b.pitches[0].midi);
      if (!from || !to) {
        continue;
      }
      if (chance(rng, ACCIDENTAL_PROBABILITY)) {
        const passing = chromaticBetween(from, to);
        if (passing) {
          e.pitches = [passing];
          continue;
        }
        const seventh = byMidi.get(e.pitches[0].midi);
        if (
          seventh &&
          to.degree === 1 &&
          to.midi - seventh.midi === 2 &&
          chance(rng, LEADING_TONE_PROBABILITY)
        ) {
          const raised = raisedSeventh(key, seventh);
          if (raised) {
            e.pitches = [raised];
          }
        }
      }
    }
  }
}

/** A lone rest filling its whole measure becomes a proper measure rest. */
function convertFullMeasureRests(measures: ScoreEvent[][], capacity: number): void {
  for (const events of measures) {
    if (events.length === 1 && events[0].kind === 'rest' && events[0].durationDiv === capacity) {
      events[0].fullMeasureRest = true;
      events[0].type = null;
      events[0].dots = 0;
    }
  }
}
