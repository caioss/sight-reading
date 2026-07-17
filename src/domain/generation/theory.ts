import type { KeySignature, Letter, SpelledPitch } from './types';

const LETTERS: Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_SEMITONE: Record<Letter, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_ORDER: Letter[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: Letter[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

export interface SpelledPitchClass {
  step: Letter;
  alter: number;
}

/** A scale member: spelling plus its 1-based degree within the key. */
export interface ScaleDegree extends SpelledPitchClass {
  degree: number;
}

/** A concrete scale pitch inside a range, still carrying its degree. */
export interface PoolNote extends SpelledPitch {
  degree: number;
}

/** Per-letter alteration implied by the key signature (missing letter = natural). */
export function keyAlterations(fifths: number): Partial<Record<Letter, number>> {
  const alterations: Partial<Record<Letter, number>> = {};
  if (fifths > 0) {
    for (const letter of SHARP_ORDER.slice(0, fifths)) {
      alterations[letter] = 1;
    }
  } else if (fifths < 0) {
    for (const letter of FLAT_ORDER.slice(0, -fifths)) {
      alterations[letter] = -1;
    }
  }
  return alterations;
}

function tonicLetterIndex(key: KeySignature): number {
  // Major tonics advance a fifth (4 letter steps) per sharp; the relative
  // minor sits 5 letter steps above the major tonic (C major -> A minor).
  const majorIndex = (((key.fifths * 4) % 7) + 7) % 7;
  return key.mode === 'major' ? majorIndex : (majorIndex + 5) % 7;
}

/** The 7 scale degrees of the key (natural minor for minor keys). */
export function keyScale(key: KeySignature): ScaleDegree[] {
  const alterations = keyAlterations(key.fifths);
  const start = tonicLetterIndex(key);
  return LETTERS.map((_, i) => {
    const letter = LETTERS[(start + i) % 7];
    return { step: letter, alter: alterations[letter] ?? 0, degree: i + 1 };
  });
}

export function midiOf(step: Letter, alter: number, octave: number): number {
  // Matches the renderer's halfTone + 12 convention (C4 = 60).
  return LETTER_SEMITONE[step] + alter + 12 * (octave + 1);
}

/** Every scale pitch within [minMidi, maxMidi], sorted ascending. */
export function diatonicPool(key: KeySignature, minMidi: number, maxMidi: number): PoolNote[] {
  const scale = keyScale(key);
  const pool: PoolNote[] = [];
  for (let octave = -1; octave <= 9; octave += 1) {
    for (const degree of scale) {
      const midi = midiOf(degree.step, degree.alter, octave);
      if (midi >= minMidi && midi <= maxMidi) {
        pool.push({ ...degree, octave, midi });
      }
    }
  }
  pool.sort((a, b) => a.midi - b.midi);
  return pool;
}

/** Triad on a degree: thirds stacked from the scale (1-based degrees). */
export function diatonicTriad(key: KeySignature, degree: number): SpelledPitchClass[] {
  const scale = keyScale(key);
  return [0, 2, 4].map((offset) => {
    const { step, alter } = scale[(degree - 1 + offset) % 7];
    return { step, alter };
  });
}

/**
 * Spell the chromatic pitch one semitone between two scale notes a whole step
 * apart. Ascending prefers raising the lower note, descending prefers
 * lowering the upper one; falls back to the other spelling when the preferred
 * one would need a double accidental. Returns null if neither spelling fits.
 */
export function chromaticBetween(from: PoolNote, to: PoolNote): SpelledPitch | null {
  if (Math.abs(to.midi - from.midi) !== 2) {
    return null;
  }
  const ascending = to.midi > from.midi;
  const lower = ascending ? from : to;
  const upper = ascending ? to : from;
  const raised: SpelledPitch = {
    step: lower.step,
    alter: lower.alter + 1,
    octave: lower.octave,
    midi: lower.midi + 1,
  };
  const lowered: SpelledPitch = {
    step: upper.step,
    alter: upper.alter - 1,
    octave: upper.octave,
    midi: upper.midi - 1,
  };
  const preferred = ascending ? [raised, lowered] : [lowered, raised];
  return preferred.find((pitch) => Math.abs(pitch.alter) <= 1) ?? null;
}

/** Raised 7th degree (leading tone) spelling, or null if it needs a double sharp. */
export function raisedSeventh(key: KeySignature, seventh: PoolNote): SpelledPitch | null {
  if (key.mode !== 'minor' || seventh.degree !== 7 || seventh.alter + 1 > 1) {
    return null;
  }
  return {
    step: seventh.step,
    alter: seventh.alter + 1,
    octave: seventh.octave,
    midi: seventh.midi + 1,
  };
}

const MAJOR_KEY_NAMES = [
  'Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#',
];
const MINOR_KEY_NAMES = [
  'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#',
];

/** Display name for a fifths value, e.g. keyName(1, 'major') -> "G". */
export function keyName(fifths: number, mode: 'major' | 'minor'): string {
  const names = mode === 'major' ? MAJOR_KEY_NAMES : MINOR_KEY_NAMES;
  return names[fifths + 7] ?? '?';
}
