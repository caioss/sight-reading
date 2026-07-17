import { describe, expect, it } from 'vitest';
import { midiToNoteName } from './noteNames';

describe('midiToNoteName', () => {
  it('names middle C as C4', () => {
    expect(midiToNoteName(60)).toBe('C4');
  });

  it('names A4 (concert pitch)', () => {
    expect(midiToNoteName(69)).toBe('A4');
  });

  it('names sharps', () => {
    expect(midiToNoteName(61)).toBe('C#4');
  });

  it('names low notes across the octave boundary', () => {
    expect(midiToNoteName(48)).toBe('C3');
  });
});
