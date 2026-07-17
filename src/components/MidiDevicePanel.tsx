import type { ChangeEvent } from 'react';
import type { MidiTransport } from '../input/IMidiInput';
import type { SightReadingSession } from '../session/useSightReadingSession';
import styles from './MidiDevicePanel.module.css';

interface Props {
  session: SightReadingSession;
}

const CONNECTION_LABELS: Record<SightReadingSession['connectionState'], string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  connected: 'Connected',
};

export function MidiDevicePanel({ session }: Props) {
  const { transport, midiSupported, connectionState } = session;
  const isConnected = connectionState === 'connected';

  const segClass = (active: boolean) => (active ? `${styles.seg} ${styles.segActive}` : styles.seg);

  const onSelectTransport = (next: MidiTransport) => {
    if (next !== transport) {
      session.setTransport(next);
    }
  };

  const onDeviceChange = (event: ChangeEvent<HTMLSelectElement>) => {
    session.setSelectedDeviceId(event.target.value || null);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.group} role="group" aria-label="MIDI transport">
        <button
          type="button"
          className={segClass(transport === 'webmidi')}
          aria-pressed={transport === 'webmidi'}
          disabled={!midiSupported.webmidi}
          onClick={() => onSelectTransport('webmidi')}
        >
          USB / Web MIDI
        </button>
        <button
          type="button"
          className={segClass(transport === 'bluetooth')}
          aria-pressed={transport === 'bluetooth'}
          disabled={!midiSupported.bluetooth}
          onClick={() => onSelectTransport('bluetooth')}
        >
          Bluetooth
        </button>
      </div>

      {transport === 'webmidi' ? (
        <div className={styles.row}>
          <button type="button" className={styles.button} onClick={() => void session.refreshDevices()}>
            Scan
          </button>
          <select
            className={styles.select}
            value={session.selectedDeviceId ?? ''}
            onChange={onDeviceChange}
            aria-label="MIDI input device"
          >
            <option value="">Select device…</option>
            {session.devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
          {isConnected ? (
            <button type="button" className={styles.button} onClick={session.disconnect}>
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              className={styles.button}
              disabled={!session.selectedDeviceId}
              onClick={() => void session.connect(session.selectedDeviceId ?? undefined)}
            >
              Connect
            </button>
          )}
        </div>
      ) : (
        <div className={styles.row}>
          {isConnected ? (
            <button type="button" className={styles.button} onClick={session.disconnect}>
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              className={styles.button}
              onClick={() => void session.refreshDevices()}
            >
              Pair Bluetooth device
            </button>
          )}
        </div>
      )}

      <span className={styles.status} data-state={connectionState}>
        {CONNECTION_LABELS[connectionState]}
      </span>

      {!midiSupported[transport] && (
        <span className={styles.error}>This transport is not supported in this browser.</span>
      )}
      {session.midiError && <span className={styles.error}>{session.midiError}</span>}
    </div>
  );
}
