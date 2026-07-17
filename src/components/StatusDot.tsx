import type { SightReadingSession } from '../session/useSightReadingSession';
import styles from './StatusDot.module.css';

interface Props {
  session: SightReadingSession;
  onOpen: () => void;
}

const STATE_TEXT: Record<SightReadingSession['connectionState'], string> = {
  disconnected: 'disconnected',
  connecting: 'connecting',
  connected: 'connected',
};

export function StatusDot({ session, onOpen }: Props) {
  const state = session.midiError ? 'error' : session.connectionState;
  const label = `MIDI ${session.midiError ? 'error' : STATE_TEXT[session.connectionState]} — open device settings`;

  return (
    <button type="button" className={styles.trigger} onClick={onOpen} aria-label={label} title={label}>
      <span className={styles.dot} data-state={state} />
    </button>
  );
}
