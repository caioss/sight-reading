import type { SightReadingSession } from '../session/useSightReadingSession';
import styles from './FeedbackIndicator.module.css';

interface Props {
  session: SightReadingSession;
}

type IndicatorState = 'neutral' | 'correct' | 'wrong' | 'complete';

const STATE_LABELS: Record<IndicatorState, string> = {
  neutral: 'Waiting for notes…',
  correct: 'Correct',
  wrong: 'Wrong note',
  complete: 'Piece complete!',
};

export function FeedbackIndicator({ session }: Props) {
  const state: IndicatorState = session.isComplete ? 'complete' : session.feedback;

  return (
    <div className={styles.indicator} data-state={state}>
      <span className={styles.badge}>{STATE_LABELS[state]}</span>

      {session.wrongNoteName && (
        <span className={styles.wrong}>Played: {session.wrongNoteName}</span>
      )}
    </div>
  );
}
