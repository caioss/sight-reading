import { describe, expect, it } from 'vitest';
import { GestureMatcher } from './GestureMatcher';

describe('GestureMatcher', () => {
  it('completes a single expected note on the fast path', () => {
    const matcher = new GestureMatcher();
    matcher.setExpected([60]);
    expect(matcher.press(60, 1000)).toBe('complete');
  });

  it('completes a chord pressed in any order within the window', () => {
    const matcher = new GestureMatcher();
    matcher.setExpected([60, 64, 67]);
    expect(matcher.press(67, 1000)).toBe('pending');
    expect(matcher.press(60, 1020)).toBe('pending');
    expect(matcher.press(64, 1040)).toBe('complete');
  });

  it('collapses duplicate presses without falsely completing', () => {
    const matcher = new GestureMatcher();
    matcher.setExpected([60, 64]);
    expect(matcher.press(60, 1000)).toBe('pending');
    expect(matcher.press(60, 1010)).toBe('pending');
    const judgment = matcher.close();
    expect(judgment.correct).toBe(false);
    expect(judgment.missing).toEqual([64]);
  });

  it('never completes once a wrong note is in the gesture', () => {
    const matcher = new GestureMatcher();
    matcher.setExpected([60, 64]);
    expect(matcher.press(61, 1000)).toBe('pending');
    expect(matcher.press(60, 1010)).toBe('pending');
    expect(matcher.press(64, 1020)).toBe('pending');
    const judgment = matcher.close();
    expect(judgment.correct).toBe(false);
    expect(judgment.extra).toEqual([61]);
    expect(judgment.missing).toEqual([]);
  });

  it('judges a subset (missed chord tones) as incorrect', () => {
    const matcher = new GestureMatcher();
    matcher.setExpected([60, 64, 67]);
    matcher.press(60, 1000);
    const judgment = matcher.close();
    expect(judgment.correct).toBe(false);
    expect(judgment.missing).toEqual([64, 67]);
    expect(judgment.extra).toEqual([]);
    expect(judgment.played).toEqual([60]);
  });

  it('judges extra notes as incorrect', () => {
    const matcher = new GestureMatcher();
    matcher.setExpected([60]);
    matcher.press(60, 1000);
    matcher.press(62, 1010);
    const judgment = matcher.close();
    expect(judgment.correct).toBe(false);
    expect(judgment.extra).toEqual([62]);
  });

  it('expires strictly after the window has passed', () => {
    const matcher = new GestureMatcher();
    matcher.setExpected([60, 64]);
    expect(matcher.isExpired(1000)).toBe(false); // no gesture open yet
    matcher.press(61, 1000);
    expect(matcher.isExpired(1099)).toBe(false);
    expect(matcher.isExpired(1100)).toBe(false);
    expect(matcher.isExpired(1101)).toBe(true);
  });

  it('each press extends the window (debounced from the last press)', () => {
    const matcher = new GestureMatcher();
    matcher.setExpected([60, 64, 67]);
    matcher.press(60, 1000);
    matcher.press(64, 1090);
    expect(matcher.isExpired(1150)).toBe(false); // 150ms after start, 60ms after last press
    expect(matcher.isExpired(1201)).toBe(true); // 111ms after last press
  });

  it('completes a chord rolled across more than one window in total', () => {
    const matcher = new GestureMatcher();
    matcher.setExpected([60, 64, 67]);
    expect(matcher.press(67, 1000)).toBe('pending');
    expect(matcher.press(60, 1080)).toBe('pending');
    // 160ms after the first press, but each gap is inside the window.
    expect(matcher.isExpired(1160)).toBe(false);
    expect(matcher.press(64, 1160)).toBe('complete');
  });

  it('close clears the gesture and the next press opens a fresh one', () => {
    const matcher = new GestureMatcher();
    matcher.setExpected([60]);
    matcher.press(61, 1000);
    matcher.close();
    expect(matcher.isGestureOpen).toBe(false);
    matcher.press(62, 5000);
    expect(matcher.isGestureOpen).toBe(true);
    expect(matcher.isExpired(5050)).toBe(false); // window restarts at the new press
    const judgment = matcher.close();
    expect(judgment.played).toEqual([62]);
  });

  it('abort and setExpected discard an open gesture without judging', () => {
    const matcher = new GestureMatcher();
    matcher.setExpected([60]);
    matcher.press(61, 1000);
    matcher.abort();
    expect(matcher.isGestureOpen).toBe(false);

    matcher.press(61, 2000);
    matcher.setExpected([64]);
    expect(matcher.isGestureOpen).toBe(false);
    matcher.press(64, 3000);
    expect(matcher.close().correct).toBe(true);
  });

  it('never judges an empty (rest) step as correct', () => {
    const matcher = new GestureMatcher();
    matcher.setExpected([]);
    expect(matcher.press(60, 1000)).toBe('pending');
    const judgment = matcher.close();
    expect(judgment.correct).toBe(false);
    expect(judgment.extra).toEqual([60]);
  });

  it('respects a custom window size', () => {
    const matcher = new GestureMatcher(200);
    matcher.setExpected([60, 64]);
    matcher.press(61, 1000);
    expect(matcher.isExpired(1150)).toBe(false);
    expect(matcher.isExpired(1201)).toBe(true);
  });
});
