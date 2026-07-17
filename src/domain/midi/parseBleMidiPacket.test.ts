import { describe, expect, it } from 'vitest';
import { parseBleMidiPacket } from './parseBleMidiPacket';

describe('parseBleMidiPacket', () => {
  it('parses a single note-on', () => {
    const packet = new Uint8Array([0x80, 0x80, 0x90, 60, 100]);
    const events = parseBleMidiPacket(packet, 1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'noteon', note: 60, velocity: 100, timestamp: 1 });
  });

  it('parses multiple messages with individual timestamps', () => {
    const packet = new Uint8Array([0x80, 0x81, 0x90, 60, 100, 0x82, 0x80, 60, 0]);
    const events = parseBleMidiPacket(packet);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('noteon');
    expect(events[1].type).toBe('noteoff');
  });

  it('supports running status (status byte omitted)', () => {
    const packet = new Uint8Array([0x80, 0x81, 0x90, 60, 100, 0x82, 62, 100]);
    const events = parseBleMidiPacket(packet);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.note)).toEqual([60, 62]);
  });

  it('ignores interleaved system real-time bytes', () => {
    // 0xF8 (clock) is preceded by a timestamp and must not corrupt running status.
    const packet = new Uint8Array([0x80, 0x81, 0x90, 60, 100, 0x82, 0xf8, 0x83, 62, 100]);
    const events = parseBleMidiPacket(packet);
    expect(events.map((event) => event.note)).toEqual([60, 62]);
  });

  it('returns nothing for an empty packet', () => {
    expect(parseBleMidiPacket(new Uint8Array([0x80]))).toEqual([]);
  });
});
