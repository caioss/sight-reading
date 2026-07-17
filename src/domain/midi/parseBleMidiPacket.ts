import type { MidiNoteEvent } from './MidiNoteEvent';
import { parseMidiMessage } from './parseMidiMessage';

/** Number of data bytes that follow a channel-voice status byte. */
function channelDataLength(status: number): number {
  switch (status & 0xf0) {
    case 0x80: // note off
    case 0x90: // note on
    case 0xa0: // poly aftertouch
    case 0xb0: // control change
    case 0xe0: // pitch bend
      return 2;
    case 0xc0: // program change
    case 0xd0: // channel aftertouch
      return 1;
    default:
      return 0;
  }
}

/**
 * Parse a BLE-MIDI characteristic packet into normalised note events.
 *
 * BLE-MIDI framing (per the Apple / MMA spec):
 * - byte 0 is a header (`0x80 | timestampHigh`);
 * - every MIDI message is preceded by a timestamp byte (`0x80 | timestampLow`);
 * - a status byte may be omitted to reuse the previous one (running status);
 * - system real-time messages (0xF8-0xFF) may be interleaved and do not affect
 *   the running status.
 *
 * Timestamps in the packet are only used for ordering; we stamp every event
 * with the notification's arrival time so the rest of the app has a single,
 * comparable clock.
 */
export function parseBleMidiPacket(
  data: Uint8Array,
  timestamp: number = performance.now(),
): MidiNoteEvent[] {
  const events: MidiNoteEvent[] = [];
  if (data.length < 2) {
    return events;
  }

  let i = 1; // skip the header byte
  let runningStatus = 0;

  while (i < data.length) {
    // A high-bit byte at a message boundary is a timestamp byte.
    if ((data[i] & 0x80) !== 0) {
      i += 1; // consume timestamp low byte
      if (i >= data.length) {
        break;
      }
      // An immediately following high-bit byte is a status byte.
      if ((data[i] & 0x80) !== 0) {
        const statusByte = data[i];
        // System real-time: single byte, does not overwrite running status.
        if (statusByte >= 0xf8) {
          i += 1;
          continue;
        }
        runningStatus = statusByte;
        i += 1;
      }
    } else if (runningStatus === 0) {
      // No timestamp and nothing to run on: malformed, stop parsing.
      break;
    }

    const status = runningStatus;
    if (status === 0) {
      break;
    }

    // System exclusive: skip to the end-of-exclusive marker.
    if (status === 0xf0) {
      while (i < data.length && data[i] !== 0xf7) {
        i += 1;
      }
      if (i < data.length) {
        i += 1; // consume 0xF7
      }
      runningStatus = 0;
      continue;
    }

    const length = channelDataLength(status);
    if (length === 0 || i + length > data.length) {
      break;
    }

    const message = [status, ...Array.from(data.slice(i, i + length))];
    i += length;

    const event = parseMidiMessage(message, timestamp);
    if (event) {
      events.push(event);
    }
  }

  return events;
}
