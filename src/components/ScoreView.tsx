import type { SightReadingSession } from '../session/useSightReadingSession';
import styles from './ScoreView.module.css';

interface Props {
  session: SightReadingSession;
}

export function ScoreView({ session }: Props) {
  return (
    <main className={styles.scoreArea}>
      {session.scoreError && (
        <div role="alert" className={styles.errorBanner}>
          <strong>Could not load score.</strong> {session.scoreError}
        </div>
      )}
      <div className={styles.paper}>
        {/* OSMD renders into this element; it must stay mounted for the cursor. */}
        <div ref={session.scoreContainerRef} className={styles.osmd} />
      </div>
    </main>
  );
}
