import { describe, expect, it } from 'vitest';
import { createRng } from './rng';
import {
  allowedSpecs,
  beatUnit,
  generateMeasureRhythm,
  measureCapacity,
  planRests,
} from './rhythm';
import type { StaffConfig, TimeSignature } from './types';

const baseStaff: StaffConfig = {
  clef: 'treble',
  minMidi: 60,
  maxMidi: 84,
  allowedDurations: ['half', 'quarter', 'eighth'],
  allowDotted: false,
  allowRests: false,
  allowTies: false,
  allowAccidentals: false,
  allowChords: false,
};

const METERS: TimeSignature[] = [
  { beats: 2, beatType: 4 },
  { beats: 3, beatType: 4 },
  { beats: 4, beatType: 4 },
  { beats: 6, beatType: 8 },
];

describe('measureCapacity', () => {
  it('computes divisions per measure', () => {
    expect(measureCapacity({ beats: 4, beatType: 4 })).toBe(16);
    expect(measureCapacity({ beats: 3, beatType: 4 })).toBe(12);
    expect(measureCapacity({ beats: 2, beatType: 4 })).toBe(8);
    expect(measureCapacity({ beats: 6, beatType: 8 })).toBe(12);
  });
});

describe('beatUnit', () => {
  it('groups compound meters in threes', () => {
    expect(beatUnit({ beats: 4, beatType: 4 })).toBe(4);
    expect(beatUnit({ beats: 6, beatType: 8 })).toBe(6);
  });
});

describe('allowedSpecs', () => {
  it('adds only integer-division dotted variants', () => {
    const specs = allowedSpecs({
      ...baseStaff,
      allowedDurations: ['whole', 'half', 'sixteenth'],
      allowDotted: true,
    });
    const dotted = specs.filter((s) => s.dots === 1);
    expect(dotted).toEqual([{ base: 'half', dots: 1, div: 12 }]);
  });
});

describe('generateMeasureRhythm', () => {
  it('fills every meter exactly, across many seeds', () => {
    for (const time of METERS) {
      const capacity = measureCapacity(time);
      const beat = beatUnit(time);
      const specs = allowedSpecs(baseStaff);
      for (let seed = 0; seed < 200; seed += 1) {
        const rng = createRng(seed);
        const slots = generateMeasureRhythm(capacity, specs, beat, rng);
        const total = slots.reduce((sum, slot) => sum + slot.div, 0);
        expect(total).toBe(capacity);
        slots.forEach((slot, i) => {
          const startDiv = slots.slice(0, i).reduce((sum, s) => sum + s.div, 0);
          expect(slot.startDiv).toBe(startDiv);
        });
      }
    }
  });

  it('uses only allowed durations when they can tile the measure', () => {
    const specs = allowedSpecs(baseStaff);
    const allowedDivs = new Set(specs.map((s) => s.div));
    for (let seed = 0; seed < 200; seed += 1) {
      const rng = createRng(seed);
      const slots = generateMeasureRhythm(16, specs, 4, rng);
      for (const slot of slots) {
        expect(allowedDivs.has(slot.div)).toBe(true);
      }
    }
  });

  it('falls back to standard values when the allowed set cannot fill', () => {
    // Only whole notes in 3/4: capacity 12 < 16, fallback must fill exactly.
    const specs = allowedSpecs({ ...baseStaff, allowedDurations: ['whole'] });
    const rng = createRng(1);
    const slots = generateMeasureRhythm(12, specs, 4, rng);
    expect(slots.reduce((sum, slot) => sum + slot.div, 0)).toBe(12);
  });
});

describe('planRests', () => {
  const makeRhythms = (seed: number, measures: number) => {
    const rng = createRng(seed);
    const specs = allowedSpecs(baseStaff);
    return Array.from({ length: measures }, () => generateMeasureRhythm(16, specs, 4, rng));
  };

  it('marks no rests when rests are disabled', () => {
    const rhythms = makeRhythms(7, 8);
    const flags = planRests(rhythms, { allowRests: false, allowFullMeasureRest: false }, createRng(7));
    expect(flags.flat().every((f) => !f)).toBe(true);
  });

  it('keeps the first and last slots sounding and never doubles rests', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const rhythms = makeRhythms(seed, 8);
      const flags = planRests(
        rhythms,
        { allowRests: true, allowFullMeasureRest: false, restProbability: 0.5 },
        createRng(seed),
      );
      expect(flags[0][0]).toBe(false);
      const lastMeasure = flags[flags.length - 1];
      expect(lastMeasure[lastMeasure.length - 1]).toBe(false);
      const flat = flags.flat();
      for (let i = 1; i < flat.length; i += 1) {
        expect(flat[i - 1] && flat[i]).toBe(false);
      }
      // Every measure keeps at least one sounding slot.
      for (const measure of flags) {
        expect(measure.some((f) => !f)).toBe(true);
      }
    }
  });
});
