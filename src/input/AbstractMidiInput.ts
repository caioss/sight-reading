import type { MidiNoteEvent } from '../domain/midi/MidiNoteEvent';
import type {
  ConnectionListener,
  IMidiInput,
  MidiDeviceInfo,
  MidiTransport,
  NoteListener,
} from './IMidiInput';

/**
 * Shared listener bookkeeping for MIDI input adapters. Concrete adapters only
 * implement transport-specific discovery/connection and call the protected
 * `emitNote` / `setConnected` helpers.
 */
export abstract class AbstractMidiInput implements IMidiInput {
  abstract readonly transport: MidiTransport;

  private noteListeners = new Set<NoteListener>();
  private connectionListeners = new Set<ConnectionListener>();
  private _connectedDeviceId: string | null = null;

  abstract isSupported(): boolean;
  abstract listDevices(): Promise<MidiDeviceInfo[]>;
  abstract connect(deviceId?: string): Promise<void>;
  abstract disconnect(): void;

  get connectedDeviceId(): string | null {
    return this._connectedDeviceId;
  }

  onNote(listener: NoteListener): () => void {
    this.noteListeners.add(listener);
    return () => this.noteListeners.delete(listener);
  }

  onConnectionChange(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  protected emitNote(event: MidiNoteEvent): void {
    for (const listener of this.noteListeners) {
      listener(event);
    }
  }

  protected setConnected(deviceId: string | null): void {
    this._connectedDeviceId = deviceId;
    for (const listener of this.connectionListeners) {
      listener(deviceId);
    }
  }
}
