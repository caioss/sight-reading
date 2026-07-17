import { describe, expect, it } from 'vitest';
import { parseMidiMessage } from './parseMidiMessage';

describe('parseMidiMessage', () => {
  it('parses a note-on message', () => {
    expect(parseMidiMessage([0x90, 60, 100], 5)).toEqual({
      type: 'noteon',
      note: 60,
      velocity: 100,
      channel: 0,
      timestamp: 5,
    });
  });

  it('treats a note-on with velocity 0 as a note-off', () => {
    expect(parseMidiMessage([0x90, 60, 0], 0)?.type).toBe('noteoff');
  });

  it('parses a note-off message', () => {
    expect(parseMidiMessage([0x80, 60, 40], 0)?.type).toBe('noteoff');
  });

  it('captures the MIDI channel', () => {
    const event = parseMidiMessage([0x95, 62, 80], 0);
    expect(event?.channel).toBe(5);
    expect(event?.note).toBe(62);
  });

  it('ignores non-note messages', () => {
    expect(parseMidiMessage([0xb0, 7, 100])).toBeNull();
  });

  it('returns null for truncated messages', () => {
    expect(parseMidiMessage([0x90, 60])).toBeNull();
  });
});
