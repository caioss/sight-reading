import { useRef, type ChangeEvent } from 'react';
import type { SightReadingSession } from '../session/useSightReadingSession';
import styles from './Toolbar.module.css';

interface Props {
  session: SightReadingSession;
  onOpenGenerate: () => void;
  onOpenGenerateScale: () => void;
}

export function Toolbar({ session, onOpenGenerate, onOpenGenerateScale }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);

  const closeMenu = () => {
    if (menuRef.current) {
      menuRef.current.open = false;
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void session.loadFile(file);
    }
    // Reset so selecting the same file again re-triggers a load.
    event.target.value = '';
  };

  const segClass = (active: boolean) => (active ? `${styles.seg} ${styles.segActive}` : styles.seg);

  const modeLabels = { note: 'Note', beat: 'Beat', measure: 'Measure' } as const;

  return (
    <div className={styles.toolbar}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xml,.musicxml,.mxl"
        className={styles.hiddenInput}
        onChange={onFileChange}
      />

      <details ref={menuRef} className={styles.menu}>
        <summary className={styles.menuButton}>Load</summary>
        <div className={styles.menuList} role="menu">
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => {
              closeMenu();
              fileInputRef.current?.click();
            }}
          >
            Open file…
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => {
              closeMenu();
              onOpenGenerate();
            }}
          >
            Generate…
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => {
              closeMenu();
              onOpenGenerateScale();
            }}
          >
            Generate scale…
          </button>
        </div>
      </details>

      <details className={styles.menu}>
        <summary className={styles.menuButton}>
          {session.playMode === 'flow' ? 'Flow · ' : ''}
          {modeLabels[session.advanceMode]} &times;{session.skip}
        </summary>
        <div className={styles.menuPanel}>
          <div className={styles.group} role="group" aria-label="Play mode">
            <button
              type="button"
              className={segClass(session.playMode === 'wait')}
              aria-pressed={session.playMode === 'wait'}
              title="Cursor waits until the notes are correct"
              onClick={() => session.setPlayMode('wait')}
            >
              Wait
            </button>
            <button
              type="button"
              className={segClass(session.playMode === 'flow')}
              aria-pressed={session.playMode === 'flow'}
              title="Cursor always advances; mistakes are marked on the sheet"
              onClick={() => session.setPlayMode('flow')}
            >
              Flow
            </button>
          </div>
          <div className={styles.group} role="group" aria-label="Cursor advance mode">
            <button
              type="button"
              className={segClass(session.advanceMode === 'note')}
              aria-pressed={session.advanceMode === 'note'}
              onClick={() => session.setAdvanceMode('note')}
            >
              Note
            </button>
            <button
              type="button"
              className={segClass(session.advanceMode === 'beat')}
              aria-pressed={session.advanceMode === 'beat'}
              onClick={() => session.setAdvanceMode('beat')}
            >
              Beat
            </button>
            <button
              type="button"
              className={segClass(session.advanceMode === 'measure')}
              aria-pressed={session.advanceMode === 'measure'}
              onClick={() => session.setAdvanceMode('measure')}
            >
              Measure
            </button>
          </div>
          <label className={styles.skipRow}>
            <span>Skip</span>
            <input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              className={styles.skipInput}
              value={session.skip}
              onChange={(event) => session.setSkip(Number(event.target.value))}
            />
          </label>
          <button
            type="button"
            className={styles.menuItem}
            disabled={session.errorMarkCount === 0}
            onClick={session.clearErrorMarks}
          >
            Clear marks{session.errorMarkCount > 0 ? ` (${session.errorMarkCount})` : ''}
          </button>
        </div>
      </details>

      <div className={styles.group}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={session.goPrevious}
          disabled={!session.isScoreLoaded}
          aria-label="Previous note"
        >
          &#9664;
        </button>
        <button
          type="button"
          className={styles.iconButton}
          onClick={session.goNext}
          disabled={!session.isScoreLoaded}
          aria-label="Next note"
        >
          &#9654;
        </button>
        <button
          type="button"
          className={styles.iconButton}
          onClick={session.resetCursor}
          disabled={!session.isScoreLoaded}
          aria-label="Restart from beginning"
        >
          &#8635;
        </button>
      </div>
    </div>
  );
}
