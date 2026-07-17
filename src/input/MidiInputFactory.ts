import type { IMidiInput, MidiTransport } from './IMidiInput';
import { WebBluetoothMidiAdapter } from './WebBluetoothMidiAdapter';
import { WebMidiInputAdapter } from './WebMidiInputAdapter';

/** Create the MIDI input adapter for the chosen transport. */
export function createMidiInput(transport: MidiTransport): IMidiInput {
  switch (transport) {
    case 'webmidi':
      return new WebMidiInputAdapter();
    case 'bluetooth':
      return new WebBluetoothMidiAdapter();
    default: {
      const exhaustive: never = transport;
      throw new Error(`Unknown MIDI transport: ${String(exhaustive)}`);
    }
  }
}

/** Whether a transport is available without instantiating a long-lived adapter. */
export function isTransportSupported(transport: MidiTransport): boolean {
  return createMidiInput(transport).isSupported();
}
