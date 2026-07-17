import { parseMidiMessage } from '../domain/midi/parseMidiMessage';
import { AbstractMidiInput } from './AbstractMidiInput';
import type { MidiDeviceInfo, MidiTransport } from './IMidiInput';

/**
 * MIDI input via the Web MIDI API. Covers USB-OTG devices and any Bluetooth
 * device that has been paired at the operating-system level (Android surfaces
 * those as ordinary MIDI input ports).
 */
export class WebMidiInputAdapter extends AbstractMidiInput {
  readonly transport: MidiTransport = 'webmidi';

  private access: MIDIAccess | null = null;
  private activeInput: MIDIInput | null = null;

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  async listDevices(): Promise<MidiDeviceInfo[]> {
    const access = await this.ensureAccess();
    return [...access.inputs.values()].map((input) => ({
      id: input.id,
      name: input.name ?? `MIDI input ${input.id}`,
    }));
  }

  async connect(deviceId?: string): Promise<void> {
    const access = await this.ensureAccess();
    const inputs = [...access.inputs.values()];
    const input = deviceId ? inputs.find((candidate) => candidate.id === deviceId) : inputs[0];
    if (!input) {
      throw new Error('The selected MIDI device is not available.');
    }

    this.detachActiveInput();
    input.onmidimessage = (event: MIDIMessageEvent) => {
      if (!event.data) {
        return;
      }
      const note = parseMidiMessage(event.data, event.timeStamp);
      if (note) {
        this.emitNote(note);
      }
    };
    this.activeInput = input;
    this.setConnected(input.id);
  }

  disconnect(): void {
    this.detachActiveInput();
    this.setConnected(null);
  }

  private detachActiveInput(): void {
    if (this.activeInput) {
      this.activeInput.onmidimessage = null;
      this.activeInput = null;
    }
  }

  private async ensureAccess(): Promise<MIDIAccess> {
    if (!this.isSupported()) {
      throw new Error('Web MIDI is not supported in this browser.');
    }
    if (!this.access) {
      // sysex is not needed for sight-reading, so keep the permission minimal.
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.access.onstatechange = () => {
        if (this.activeInput && this.activeInput.state === 'disconnected') {
          this.disconnect();
        }
      };
    }
    return this.access;
  }
}
