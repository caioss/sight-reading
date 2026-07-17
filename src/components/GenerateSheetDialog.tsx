import { useEffect, useRef } from 'react';
import type { SightReadingSession } from '../session/useSightReadingSession';
import { GenerateSheetPanel } from './GenerateSheetPanel';
import styles from './GenerateSheetDialog.module.css';

interface Props {
  session: SightReadingSession;
  open: boolean;
  onClose: () => void;
}

export function GenerateSheetDialog({ session, open, onClose }: Props) {
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
        aria-labelledby="generate-sheet-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <h2 id="generate-sheet-title" className={styles.title}>
            Generate sheet
          </h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>
        <GenerateSheetPanel session={session} onClose={onClose} />
      </div>
    </div>
  );
}
