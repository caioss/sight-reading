import type { MidiNoteEvent } from './MidiNoteEvent';

const STATUS_MASK = 0xf0;
const CHANNEL_MASK = 0x0f;
const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;

/**
 * Parse a single raw MIDI channel-voice message into a normalised note event.
 *
 * Only note-on / note-off messages are relevant for sight-reading, so every
 * other message type resolves to `null`. A note-on with velocity 0 is treated
 * as a note-off, per the MIDI specification.
 */
export function parseMidiMessage(
  data: Uint8Array | number[],
  timestamp: number = performance.now(),
): MidiNoteEvent | null {
  if (data.length < 3) {
    return null;
  }

  const status = data[0] & STATUS_MASK;
  const channel = data[0] & CHANNEL_MASK;
  const note = data[1];
  const velocity = data[2];

  if (status === NOTE_ON) {
    return {
      type: velocity > 0 ? 'noteon' : 'noteoff',
      note,
      velocity,
      channel,
      timestamp,
    };
  }

  if (status === NOTE_OFF) {
    return { type: 'noteoff', note, velocity, channel, timestamp };
  }

  return null;
}
