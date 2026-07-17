import { describe, expect, it } from 'vitest';
import { MatchingEngine } from './MatchingEngine';

describe('MatchingEngine', () => {
  it('completes a single-note step when that note is played', () => {
    const engine = new MatchingEngine();
    engine.setExpected([60]);
    const result = engine.pressNote(60);
    expect(result.complete).toBe(true);
    expect(result.wrong).toBe(false);
    expect(result.remaining).toEqual([]);
  });

  it('requires all chord notes cumulatively and order-independently', () => {
    const engine = new MatchingEngine();
    engine.setExpected([60, 64, 67]);
    expect(engine.pressNote(64).complete).toBe(false);
    expect(engine.pressNote(67).complete).toBe(false);
    const result = engine.pressNote(60);
    expect(result.complete).toBe(true);
    expect(result.remaining).toEqual([]);
  });

  it('ignores duplicate presses of the same expected note', () => {
    const engine = new MatchingEngine();
    engine.setExpected([60, 64]);
    engine.pressNote(60);
    const result = engine.pressNote(60);
    expect(result.complete).toBe(false);
    expect(result.remaining).toEqual([64]);
  });

  it('flags a wrong note without completing', () => {
    const engine = new MatchingEngine();
    engine.setExpected([60, 64]);
    engine.pressNote(60);
    const result = engine.pressNote(61);
    expect(result.wrong).toBe(true);
    expect(result.complete).toBe(false);
  });

  it('clears the wrong flag once a correct note follows', () => {
    const engine = new MatchingEngine();
    engine.setExpected([60, 64]);
    expect(engine.pressNote(61).wrong).toBe(true);
    expect(engine.pressNote(60).wrong).toBe(false);
  });

  it('is octave-sensitive (exact MIDI number match)', () => {
    const engine = new MatchingEngine();
    engine.setExpected([60]);
    const result = engine.pressNote(72);
    expect(result.wrong).toBe(true);
    expect(result.complete).toBe(false);
  });

  it('never completes an empty (rest) step', () => {
    const engine = new MatchingEngine();
    engine.setExpected([]);
    expect(engine.isComplete).toBe(false);
  });

  it('reset clears progress but keeps the expected notes', () => {
    const engine = new MatchingEngine();
    engine.setExpected([60, 64]);
    engine.pressNote(60);
    engine.reset();
    const result = engine.pressNote(64);
    expect(result.remaining).toEqual([60]);
    expect(result.complete).toBe(false);
  });
});
