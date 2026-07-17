/**
 * Transport-agnostic representation of a MIDI note event.
 *
 * Both the Web MIDI and Web Bluetooth adapters normalise their raw input into
 * this shape so that the rest of the app never depends on a specific transport.
 */
export type MidiNoteEventType = 'noteon' | 'noteoff';

export interface MidiNoteEvent {
  type: MidiNoteEventType;
  /** MIDI note number, 0-127 (middle C = 60). */
  note: number;
  /** Velocity, 0-127. For note-off this is the release velocity (often 0). */
  velocity: number;
  /** MIDI channel, 0-15. */
  channel: number;
  /** Timestamp in milliseconds (high-resolution when the transport provides it). */
  timestamp: number;
}
