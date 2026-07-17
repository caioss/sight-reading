import { useState } from 'react';
import { useSightReadingSession } from '../session/useSightReadingSession';
import { FeedbackIndicator } from './FeedbackIndicator';
import { GenerateScaleDialog } from './GenerateScaleDialog';
import { GenerateSheetDialog } from './GenerateSheetDialog';
import { MidiDeviceModal } from './MidiDeviceModal';
import { ScoreView } from './ScoreView';
import { StatusDot } from './StatusDot';
import { Toolbar } from './Toolbar';
import styles from './App.module.css';

export function App() {
  const session = useSightReadingSession();
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [generateScaleOpen, setGenerateScaleOpen] = useState(false);

  return (
    <div className={styles.app}>
      <header className={styles.bar}>
        <StatusDot session={session} onOpen={() => setDeviceModalOpen(true)} />
        <span className={styles.brand}>Sight Reading</span>
        <Toolbar
          session={session}
          onOpenGenerate={() => setGenerateDialogOpen(true)}
          onOpenGenerateScale={() => setGenerateScaleOpen(true)}
        />
        <div className={styles.feedback}>
          <FeedbackIndicator session={session} />
        </div>
      </header>

      <ScoreView session={session} />

      <MidiDeviceModal
        session={session}
        open={deviceModalOpen}
        onClose={() => setDeviceModalOpen(false)}
      />

      <GenerateSheetDialog
        session={session}
        open={generateDialogOpen}
        onClose={() => setGenerateDialogOpen(false)}
      />

      <GenerateScaleDialog
        session={session}
        open={generateScaleOpen}
        onClose={() => setGenerateScaleOpen(false)}
      />
    </div>
  );
}
