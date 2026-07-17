import { pick, type Rng } from './rng';
import type { KeySignature } from './types';

/**
 * Phrase templates in scale degrees (1 = tonic). Minor templates stay within
 * natural minor so no accidental is ever required to voice them.
 */
const MAJOR_PHRASES: number[][] = [
  [1, 4, 5, 1],
  [1, 5, 6, 4],
  [1, 6, 4, 5],
  [2, 5, 1, 1],
  [1, 4, 1, 5],
];

const MINOR_PHRASES: number[][] = [
  [1, 4, 5, 1],
  [1, 6, 3, 7],
  [1, 7, 6, 5],
  [1, 4, 1, 5],
  [1, 6, 7, 1],
];

/**
 * One diatonic chord degree per measure, built from 4-measure phrase
 * templates and always closing with an authentic V -> I cadence. The
 * progression is shared by every staff so both hands agree harmonically.
 */
export function generateProgression(key: KeySignature, measureCount: number, rng: Rng): number[] {
  const templates = key.mode === 'major' ? MAJOR_PHRASES : MINOR_PHRASES;
  const degrees: number[] = [];
  while (degrees.length < measureCount) {
    degrees.push(...pick(rng, templates));
  }
  degrees.length = measureCount;
  if (measureCount >= 2) {
    degrees[measureCount - 2] = 5;
  }
  degrees[measureCount - 1] = 1;
  return degrees;
}
