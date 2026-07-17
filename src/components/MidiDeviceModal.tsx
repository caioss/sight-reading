import { useEffect, useRef } from 'react';
import type { SightReadingSession } from '../session/useSightReadingSession';
import { MidiDevicePanel } from './MidiDevicePanel';
import styles from './MidiDeviceModal.module.css';

interface Props {
  session: SightReadingSession;
  open: boolean;
  onClose: () => void;
}

export function MidiDeviceModal({ session, open, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="midi-modal-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <h2 id="midi-modal-title" className={styles.title}>
            MIDI device
          </h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>
        <MidiDevicePanel session={session} />
      </div>
    </div>
  );
}
