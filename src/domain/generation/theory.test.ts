import { describe, expect, it } from 'vitest';
import {
  chromaticBetween,
  diatonicPool,
  diatonicTriad,
  keyName,
  keyScale,
  midiOf,
} from './theory';
import type { KeySignature } from './types';

describe('keyScale', () => {
  it('spells C major with naturals', () => {
    const scale = keyScale({ fifths: 0, mode: 'major' });
    expect(scale.map((d) => d.step).join('')).toBe('CDEFGAB');
    expect(scale.every((d) => d.alter === 0)).toBe(true);
  });

  it('spells G major with F#', () => {
    const scale = keyScale({ fifths: 1, mode: 'major' });
    expect(scale[0]).toMatchObject({ step: 'G', alter: 0 });
    expect(scale[6]).toMatchObject({ step: 'F', alter: 1 });
  });

  it('spells Eb major with flats, never sharps', () => {
    const scale = keyScale({ fifths: -3, mode: 'major' });
    expect(scale[0]).toMatchObject({ step: 'E', alter: -1 });
    expect(scale.every((d) => d.alter <= 0)).toBe(true);
    expect(scale.filter((d) => d.alter === -1).map((d) => d.step).sort()).toEqual(['A', 'B', 'E']);
  });

  it('spells the relative minor from the same signature', () => {
    const aMinor = keyScale({ fifths: 0, mode: 'minor' });
    expect(aMinor[0]).toMatchObject({ step: 'A', alter: 0 });
    const cMinor = keyScale({ fifths: -3, mode: 'minor' });
    expect(cMinor[0]).toMatchObject({ step: 'C', alter: 0 });
    expect(cMinor[2]).toMatchObject({ step: 'E', alter: -1 });
  });

  it('keeps letters consecutive for every key signature', () => {
    for (let fifths = -7; fifths <= 7; fifths += 1) {
      for (const mode of ['major', 'minor'] as const) {
        const scale = keyScale({ fifths, mode });
        const letters = 'CDEFGAB';
        for (let i = 1; i < scale.length; i += 1) {
          const prev = letters.indexOf(scale[i - 1].step);
          expect(letters.indexOf(scale[i].step)).toBe((prev + 1) % 7);
        }
      }
    }
  });

  it('produces adjacent scale steps of 1 or 2 semitones in every key', () => {
    for (let fifths = -7; fifths <= 7; fifths += 1) {
      for (const mode of ['major', 'minor'] as const) {
        const pool = diatonicPool({ fifths, mode }, 40, 80);
        for (let i = 1; i < pool.length; i += 1) {
          const gap = pool[i].midi - pool[i - 1].midi;
          expect(gap === 1 || gap === 2).toBe(true);
        }
      }
    }
  });
});

describe('midiOf', () => {
  it('matches scientific pitch notation with C4 = 60', () => {
    expect(midiOf('C', 0, 4)).toBe(60);
    expect(midiOf('A', 0, 4)).toBe(69);
    expect(midiOf('B', -1, 2)).toBe(46);
    expect(midiOf('F', 1, 5)).toBe(78);
  });
});

describe('diatonicPool', () => {
  it('returns only pitches inside the range, sorted', () => {
    const pool = diatonicPool({ fifths: 0, mode: 'major' }, 60, 72);
    expect(pool[0].midi).toBe(60);
    expect(pool[pool.length - 1].midi).toBe(72);
    expect(pool).toHaveLength(8); // C4..C5 in C major
    expect(pool.every((n, i) => i === 0 || n.midi > pool[i - 1].midi)).toBe(true);
  });

  it('is empty when the range misses every scale note', () => {
    // C# major has no C natural / F natural; MIDI 61 is C#, but 60 is C.
    const pool = diatonicPool({ fifths: 0, mode: 'major' }, 61, 61);
    expect(pool).toHaveLength(0);
  });
});

describe('diatonicTriad', () => {
  it('builds I and V in C major', () => {
    const key: KeySignature = { fifths: 0, mode: 'major' };
    expect(diatonicTriad(key, 1).map((p) => p.step)).toEqual(['C', 'E', 'G']);
    expect(diatonicTriad(key, 5).map((p) => p.step)).toEqual(['G', 'B', 'D']);
  });

  it('keeps chord tones inside the key signature', () => {
    for (let fifths = -7; fifths <= 7; fifths += 1) {
      const key: KeySignature = { fifths, mode: 'major' };
      const scale = keyScale(key);
      for (let degree = 1; degree <= 7; degree += 1) {
        for (const tone of diatonicTriad(key, degree)) {
          expect(scale).toContainEqual(expect.objectContaining(tone));
        }
      }
    }
  });
});

describe('chromaticBetween', () => {
  const pool = diatonicPool({ fifths: 0, mode: 'major' }, 60, 72);
  const byMidi = (midi: number) => pool.find((n) => n.midi === midi)!;

  it('raises the lower note when ascending', () => {
    const passing = chromaticBetween(byMidi(60), byMidi(62));
    expect(passing).toMatchObject({ step: 'C', alter: 1, midi: 61 });
  });

  it('lowers the upper note when descending', () => {
    const passing = chromaticBetween(byMidi(62), byMidi(60));
    expect(passing).toMatchObject({ step: 'D', alter: -1, midi: 61 });
  });

  it('returns null when the notes are not a whole step apart', () => {
    expect(chromaticBetween(byMidi(60), byMidi(64))).toBeNull();
    expect(chromaticBetween(byMidi(64), byMidi(65))).toBeNull();
  });

  it('never produces a double accidental in any key', () => {
    for (let fifths = -7; fifths <= 7; fifths += 1) {
      const keyPool = diatonicPool({ fifths, mode: 'major' }, 48, 84);
      for (let i = 1; i < keyPool.length; i += 1) {
        if (keyPool[i].midi - keyPool[i - 1].midi === 2) {
          const passing = chromaticBetween(keyPool[i - 1], keyPool[i]);
          expect(passing).not.toBeNull();
          expect(Math.abs(passing!.alter)).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('keyName', () => {
  it('names common keys', () => {
    expect(keyName(0, 'major')).toBe('C');
    expect(keyName(1, 'major')).toBe('G');
    expect(keyName(-3, 'major')).toBe('Eb');
    expect(keyName(0, 'minor')).toBe('A');
    expect(keyName(-3, 'minor')).toBe('C');
  });
});
