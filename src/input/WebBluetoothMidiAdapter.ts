import { parseBleMidiPacket } from '../domain/midi/parseBleMidiPacket';
import { AbstractMidiInput } from './AbstractMidiInput';
import type { MidiDeviceInfo, MidiTransport } from './IMidiInput';

// Standard BLE-MIDI GATT identifiers (MMA / Apple spec).
const MIDI_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
const MIDI_CHARACTERISTIC = '7772e5db-3868-4112-a1a9-f2669d106bf3';

/**
 * MIDI input via Web Bluetooth (BLE-MIDI). Lets the user pair a Bluetooth
 * device from inside the app rather than through OS settings.
 *
 * `listDevices()` opens the browser's pairing chooser and must therefore be
 * called from a user gesture (e.g. a button click).
 */
export class WebBluetoothMidiAdapter extends AbstractMidiInput {
  readonly transport: MidiTransport = 'bluetooth';

  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  async listDevices(): Promise<MidiDeviceInfo[]> {
    if (!this.isSupported()) {
      throw new Error('Web Bluetooth is not supported in this browser.');
    }
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [MIDI_SERVICE] }],
      optionalServices: [MIDI_SERVICE],
    });
    this.device = device;
    return [{ id: device.id, name: device.name ?? 'Bluetooth MIDI device' }];
  }

  async connect(deviceId?: string): Promise<void> {
    if (!this.device || (deviceId && this.device.id !== deviceId)) {
      throw new Error('Pair a Bluetooth MIDI device first.');
    }
    const device = this.device;
    if (!device.gatt) {
      throw new Error('The selected device does not expose a GATT server.');
    }

    device.addEventListener('gattserverdisconnected', this.handleDisconnected);
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(MIDI_SERVICE);
    const characteristic = await service.getCharacteristic(MIDI_CHARACTERISTIC);
    await characteristic.startNotifications();
    characteristic.addEventListener('characteristicvaluechanged', this.handleValue);

    this.characteristic = characteristic;
    this.setConnected(device.id);
  }

  disconnect(): void {
    if (this.characteristic) {
      this.characteristic.removeEventListener('characteristicvaluechanged', this.handleValue);
      this.characteristic.stopNotifications().catch(() => undefined);
      this.characteristic = null;
    }
    if (this.device) {
      this.device.removeEventListener('gattserverdisconnected', this.handleDisconnected);
      this.device.gatt?.disconnect();
    }
    this.setConnected(null);
  }

  private readonly handleValue = (event: Event): void => {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
    const value = characteristic.value;
    if (!value) {
      return;
    }
    const bytes = new Uint8Array(value.buffer);
    for (const note of parseBleMidiPacket(bytes, performance.now())) {
      this.emitNote(note);
    }
  };

  private readonly handleDisconnected = (): void => {
    this.characteristic = null;
    this.setConnected(null);
  };
}
