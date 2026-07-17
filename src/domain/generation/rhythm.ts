import { chance, pickWeighted, type Rng } from './rng';
import type { BaseDuration, StaffConfig, TimeSignature } from './types';

/** Divisions per quarter note; a sixteenth is exactly 1 division. */
export const DIVISIONS = 4;

export interface DurationSpec {
  base: BaseDuration;
  dots: 0 | 1;
  div: number;
}

export const BASE_DIVS: Record<BaseDuration, number> = {
  whole: 16,
  half: 8,
  quarter: 4,
  eighth: 2,
  sixteenth: 1,
};

/** Dotted variants with a whole number of divisions (no dotted whole/sixteenth). */
const DOTTABLE: BaseDuration[] = ['half', 'quarter', 'eighth'];

/** Largest-first table used when the allowed set cannot exactly fill a measure. */
export const FALLBACK_SPECS: DurationSpec[] = [
  { base: 'whole', dots: 0, div: 16 },
  { base: 'half', dots: 1, div: 12 },
  { base: 'half', dots: 0, div: 8 },
  { base: 'quarter', dots: 1, div: 6 },
  { base: 'quarter', dots: 0, div: 4 },
  { base: 'eighth', dots: 1, div: 3 },
  { base: 'eighth', dots: 0, div: 2 },
  { base: 'sixteenth', dots: 0, div: 1 },
];

export function measureCapacity(time: TimeSignature): number {
  return time.beats * ((DIVISIONS * 4) / time.beatType);
}

/** Divisions between beat-group boundaries (compound meters group in threes). */
export function beatUnit(time: TimeSignature): number {
  const perBeat = (DIVISIONS * 4) / time.beatType;
  const compound = time.beatType === 8 && time.beats % 3 === 0;
  return compound ? perBeat * 3 : perBeat;
}

export function allowedSpecs(staff: StaffConfig): DurationSpec[] {
  const specs: DurationSpec[] = staff.allowedDurations.map((base) => ({
    base,
    dots: 0,
    div: BASE_DIVS[base],
  }));
  if (staff.allowDotted) {
    for (const base of staff.allowedDurations) {
      if (DOTTABLE.includes(base)) {
        specs.push({ base, dots: 1, div: BASE_DIVS[base] * 1.5 });
      }
    }
  }
  return specs.sort((a, b) => b.div - a.div);
}

export interface RhythmSlot extends DurationSpec {
  /** Offset of the slot's start from the beginning of its measure. */
  startDiv: number;
}

/**
 * Fill exactly `capacity` divisions with allowed durations. Weighted toward
 * values that land on beat boundaries or complete the measure, with a small
 * persistence bonus so rhythms feel coherent rather than scrambled.
 */
export function generateMeasureRhythm(
  capacity: number,
  specs: DurationSpec[],
  beat: number,
  rng: Rng,
): RhythmSlot[] {
  const slots: RhythmSlot[] = [];
  let filled = 0;
  let previous: DurationSpec | null = null;
  while (filled < capacity) {
    const remaining = capacity - filled;
    let candidates = specs.filter((spec) => spec.div <= remaining);
    if (candidates.length === 0) {
      candidates = FALLBACK_SPECS.filter((spec) => spec.div <= remaining).slice(0, 1);
    }
    const weighted = candidates.map((spec) => {
      let weight = 1;
      const end = filled + spec.div;
      if (end === capacity) {
        weight += 2;
      }
      if (end % beat === 0) {
        weight += 2;
      }
      if (previous && spec.base === previous.base && spec.dots === previous.dots) {
        weight += 0.75;
      }
      return [spec, weight] as const;
    });
    const spec = pickWeighted(rng, weighted);
    slots.push({ ...spec, startDiv: filled });
    filled += spec.div;
    previous = spec;
  }
  return slots;
}

export interface RestPlanOptions {
  allowRests: boolean;
  /** Rest-only measures break single-staff scores (cursor skips them entirely). */
  allowFullMeasureRest: boolean;
  restProbability?: number;
}

/**
 * Decide which slots become rests. Invariants that keep the cursor pipeline
 * healthy: the very first slot and the final (cadence) slot always sound, and
 * two rests never run back to back (counted across barlines).
 */
export function planRests(
  rhythms: RhythmSlot[][],
  options: RestPlanOptions,
  rng: Rng,
): boolean[][] {
  const probability = options.restProbability ?? 0.15;
  const restFlags = rhythms.map((slots) => slots.map(() => false));
  if (!options.allowRests) {
    return restFlags;
  }
  let previousWasRest = false;
  const lastMeasure = rhythms.length - 1;
  rhythms.forEach((slots, m) => {
    let soundingInMeasure = 0;
    slots.forEach((_, s) => {
      const isFirstOfScore = m === 0 && s === 0;
      const isCadence = m === lastMeasure && s === slots.length - 1;
      const wouldEmptyMeasure =
        !options.allowFullMeasureRest && s === slots.length - 1 && soundingInMeasure === 0;
      const eligible = !isFirstOfScore && !isCadence && !previousWasRest && !wouldEmptyMeasure;
      if (eligible && chance(rng, probability)) {
        restFlags[m][s] = true;
        previousWasRest = true;
      } else {
        previousWasRest = false;
        soundingInMeasure += 1;
      }
    });
  });
  return restFlags;
}
