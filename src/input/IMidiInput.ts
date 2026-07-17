import type { MidiNoteEvent } from '../domain/midi/MidiNoteEvent';

/** Available MIDI transports. The user explicitly chooses which one to use. */
export type MidiTransport = 'webmidi' | 'bluetooth';

export interface MidiDeviceInfo {
  id: string;
  name: string;
}

export type NoteListener = (event: MidiNoteEvent) => void;
export type ConnectionListener = (deviceId: string | null) => void;

/**
 * Transport-agnostic MIDI input source.
 *
 * Concrete adapters (Web MIDI, Web Bluetooth) implement this interface so the
 * session layer and UI never depend on a specific technology. Swapping or
 * adding a transport only requires a new implementation plus a factory entry.
 */
export interface IMidiInput {
  readonly transport: MidiTransport;

  /** Whether this transport is usable in the current browser / secure context. */
  isSupported(): boolean;

  /**
   * Discover selectable devices.
   * - Web MIDI: returns every available input port.
   * - Web Bluetooth: opens the pairing chooser (requires a user gesture) and
   *   returns the single chosen device.
   */
  listDevices(): Promise<MidiDeviceInfo[]>;

  /** Attach to a device. Defaults to the first / most recently chosen device. */
  connect(deviceId?: string): Promise<void>;

  disconnect(): void;

  /** Subscribe to note events. Returns an unsubscribe function. */
  onNote(listener: NoteListener): () => void;

  /** Subscribe to connection changes. Returns an unsubscribe function. */
  onConnectionChange(listener: ConnectionListener): () => void;

  readonly connectedDeviceId: string | null;
}
