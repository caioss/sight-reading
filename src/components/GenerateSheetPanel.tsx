import { useMemo, useState } from 'react';
import {
  DEFAULT_BASS_STAFF_CONFIG,
  DEFAULT_STAFF_CONFIG,
  MAX_MEASURES,
  MIN_MEASURES,
  validateGeneratorConfig,
} from '../domain/generation/generateMusicXml';
import { keyName } from '../domain/generation/theory';
import type {
  BaseDuration,
  ClefType,
  GeneratorConfig,
  StaffConfig,
} from '../domain/generation/types';
import { midiToNoteName } from '../domain/midi/noteNames';
import type { SightReadingSession } from '../session/useSightReadingSession';
import styles from './GenerateSheetPanel.module.css';

interface Props {
  session: SightReadingSession;
  onClose: () => void;
}

interface StaffDraft {
  minMidi: number;
  maxMidi: number;
  durations: BaseDuration[];
  dotted: boolean;
  rests: boolean;
  ties: boolean;
  accidentals: boolean;
  chords: boolean;
}

interface GeneratorDraft {
  layout: 'single' | 'grand';
  clef: ClefType;
  fifths: number;
  mode: 'major' | 'minor';
  timeId: string;
  measures: number;
}

interface Draft extends GeneratorDraft {
  /** Both staff drafts stay alive so toggling single/grand never loses edits. */
  treble: StaffDraft;
  bass: StaffDraft;
}

const TIME_OPTIONS = [
  { id: '2/4', beats: 2, beatType: 4 },
  { id: '3/4', beats: 3, beatType: 4 },
  { id: '4/4', beats: 4, beatType: 4 },
  { id: '6/8', beats: 6, beatType: 8 },
] as const;

const DURATION_OPTIONS: { value: BaseDuration; label: string }[] = [
  { value: 'whole', label: 'Whole' },
  { value: 'half', label: 'Half' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'eighth', label: 'Eighth' },
  { value: 'sixteenth', label: '16th' },
];

/** Natural notes across the piano keep the pickers scannable; accidentals
 * inside the range come from the key and accidental settings anyway. */
const PITCH_OPTIONS = Array.from({ length: 108 - 24 + 1 }, (_, i) => 24 + i).filter(
  (midi) => !midiToNoteName(midi).includes('#'),
);

const KEY_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, -1, -2, -3, -4, -5, -6, -7];

const STORAGE_KEY = 'sight-reading:generator-config:v1';

function staffDraftFrom(config: StaffConfig): StaffDraft {
  return {
    minMidi: config.minMidi,
    maxMidi: config.maxMidi,
    durations: [...config.allowedDurations],
    dotted: config.allowDotted,
    rests: config.allowRests,
    ties: config.allowTies,
    accidentals: config.allowAccidentals,
    chords: config.allowChords,
  };
}

function defaultDraft(): Draft {
  return {
    layout: 'single',
    clef: 'treble',
    fifths: 0,
    mode: 'major',
    timeId: '4/4',
    measures: 16,
    treble: staffDraftFrom(DEFAULT_STAFF_CONFIG),
    bass: staffDraftFrom(DEFAULT_BASS_STAFF_CONFIG),
  };
}

function loadStoredDraft(): Draft | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Draft;
    if (
      (parsed.layout !== 'single' && parsed.layout !== 'grand') ||
      typeof parsed.measures !== 'number' ||
      !Array.isArray(parsed.treble?.durations) ||
      !Array.isArray(parsed.bass?.durations)
    ) {
      return null;
    }
    return { ...defaultDraft(), ...parsed };
  } catch {
    return null;
  }
}

function saveDraft(draft: Draft): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Storage may be unavailable (private mode); generating still works.
  }
}

function staffConfigFrom(draft: StaffDraft, clef: ClefType): StaffConfig {
  return {
    clef,
    minMidi: draft.minMidi,
    maxMidi: draft.maxMidi,
    allowedDurations: [...draft.durations],
    allowDotted: draft.dotted,
    allowRests: draft.rests,
    allowTies: draft.ties,
    allowAccidentals: draft.accidentals,
    allowChords: draft.chords,
  };
}

function toGeneratorConfig(draft: Draft): GeneratorConfig {
  const time = TIME_OPTIONS.find((option) => option.id === draft.timeId) ?? TIME_OPTIONS[2];
  const staves =
    draft.layout === 'grand'
      ? [staffConfigFrom(draft.treble, 'treble'), staffConfigFrom(draft.bass, 'bass')]
      : [staffConfigFrom(draft.clef === 'treble' ? draft.treble : draft.bass, draft.clef)];
  return {
    staffLayout: draft.layout,
    key: { fifths: draft.fifths, mode: draft.mode },
    time: { beats: time.beats, beatType: time.beatType },
    measureCount: draft.measures,
    staves,
  };
}

function keyOptionLabel(fifths: number, mode: 'major' | 'minor'): string {
  const accidentals = fifths === 0 ? '' : fifths > 0 ? ` (${fifths}♯)` : ` (${-fifths}♭)`;
  return `${keyName(fifths, mode)} ${mode}${accidentals}`;
}

const segClass = (active: boolean) => (active ? `${styles.seg} ${styles.segActive}` : styles.seg);

interface StaffSectionProps {
  legend: string;
  value: StaffDraft;
  onChange: (next: StaffDraft) => void;
}

function StaffSection({ legend, value, onChange }: StaffSectionProps) {
  const set = <K extends keyof StaffDraft>(key: K, next: StaffDraft[K]) =>
    onChange({ ...value, [key]: next });

  const toggleDuration = (duration: BaseDuration) => {
    const durations = value.durations.includes(duration)
      ? value.durations.filter((d) => d !== duration)
      : [...value.durations, duration];
    set('durations', durations);
  };

  const checkboxes: { key: keyof StaffDraft & string; label: string }[] = [
    { key: 'dotted', label: 'Dotted notes' },
    { key: 'rests', label: 'Rests' },
    { key: 'ties', label: 'Ties (held notes)' },
    { key: 'accidentals', label: 'Accidentals outside the key' },
    { key: 'chords', label: 'Chords' },
  ];

  return (
    <fieldset className={styles.staffSection}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.rangeRow}>
        <label className={styles.selectLabel}>
          <span>Lowest note</span>
          <select
            className={styles.select}
            aria-label="Lowest note"
            value={value.minMidi}
            onChange={(event) => set('minMidi', Number(event.target.value))}
          >
            {PITCH_OPTIONS.map((midi) => (
              <option key={midi} value={midi}>
                {midiToNoteName(midi)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.selectLabel}>
          <span>Highest note</span>
          <select
            className={styles.select}
            aria-label="Highest note"
            value={value.maxMidi}
            onChange={(event) => set('maxMidi', Number(event.target.value))}
          >
            {PITCH_OPTIONS.map((midi) => (
              <option key={midi} value={midi}>
                {midiToNoteName(midi)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.chipRow} role="group" aria-label="Note durations">
        {DURATION_OPTIONS.map((option) => {
          const active = value.durations.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              className={active ? `${styles.chip} ${styles.chipActive}` : styles.chip}
              aria-pressed={active}
              onClick={() => toggleDuration(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <div className={styles.checkGrid}>
        {checkboxes.map(({ key, label }) => (
          <label key={key} className={styles.checkRow}>
            <input
              type="checkbox"
              checked={Boolean(value[key])}
              onChange={(event) => set(key, event.target.checked as StaffDraft[typeof key])}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function GenerateSheetPanel({ session, onClose }: Props) {
  const [draft, setDraft] = useState<Draft>(() => loadStoredDraft() ?? defaultDraft());

  const set = <K extends keyof Draft>(key: K, next: Draft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: next }));

  const problems = useMemo(() => validateGeneratorConfig(toGeneratorConfig(draft)), [draft]);

  const onMeasuresChange = (raw: number) => {
    const clamped = Math.max(MIN_MEASURES, Math.min(MAX_MEASURES, Math.floor(raw) || MIN_MEASURES));
    set('measures', clamped);
  };

  const onGenerate = () => {
    saveDraft(draft);
    void session.generateScore(toGeneratorConfig(draft));
    onClose();
  };

  const grand = draft.layout === 'grand';

  return (
    <div className={styles.panel}>
      <div className={styles.fields}>
        <div className={styles.group} role="group" aria-label="Staff layout">
          <button
            type="button"
            className={segClass(!grand)}
            aria-pressed={!grand}
            onClick={() => set('layout', 'single')}
          >
            Single staff
          </button>
          <button
            type="button"
            className={segClass(grand)}
            aria-pressed={grand}
            onClick={() => set('layout', 'grand')}
          >
            Grand staff
          </button>
        </div>

        {!grand && (
          <div className={styles.group} role="group" aria-label="Clef">
            <button
              type="button"
              className={segClass(draft.clef === 'treble')}
              aria-pressed={draft.clef === 'treble'}
              onClick={() => set('clef', 'treble')}
            >
              Treble clef
            </button>
            <button
              type="button"
              className={segClass(draft.clef === 'bass')}
              aria-pressed={draft.clef === 'bass'}
              onClick={() => set('clef', 'bass')}
            >
              Bass clef
            </button>
          </div>
        )}

        <div className={styles.group} role="group" aria-label="Key mode">
          <button
            type="button"
            className={segClass(draft.mode === 'major')}
            aria-pressed={draft.mode === 'major'}
            onClick={() => set('mode', 'major')}
          >
            Major
          </button>
          <button
            type="button"
            className={segClass(draft.mode === 'minor')}
            aria-pressed={draft.mode === 'minor'}
            onClick={() => set('mode', 'minor')}
          >
            Minor
          </button>
        </div>

        <div className={styles.optionRow}>
          <label className={styles.selectLabel}>
            <span>Key signature</span>
            <select
              className={styles.select}
              aria-label="Key signature"
              value={draft.fifths}
              onChange={(event) => set('fifths', Number(event.target.value))}
            >
              {KEY_OPTIONS.map((fifths) => (
                <option key={fifths} value={fifths}>
                  {keyOptionLabel(fifths, draft.mode)}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.selectLabel}>
            <span>Time signature</span>
            <select
              className={styles.select}
              aria-label="Time signature"
              value={draft.timeId}
              onChange={(event) => set('timeId', event.target.value)}
            >
              {TIME_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.id}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.selectLabel}>
            <span>Measures</span>
            <input
              type="number"
              min={MIN_MEASURES}
              max={MAX_MEASURES}
              step={1}
              inputMode="numeric"
              className={styles.numberInput}
              value={draft.measures}
              onChange={(event) => onMeasuresChange(Number(event.target.value))}
            />
          </label>
        </div>

        {grand ? (
          <>
            <StaffSection
              legend="Treble"
              value={draft.treble}
              onChange={(next) => set('treble', next)}
            />
            <StaffSection
              legend="Bass"
              value={draft.bass}
              onChange={(next) => set('bass', next)}
            />
          </>
        ) : (
          <StaffSection
            legend="Notes"
            value={draft.clef === 'treble' ? draft.treble : draft.bass}
            onChange={(next) => set(draft.clef === 'treble' ? 'treble' : 'bass', next)}
          />
        )}
      </div>

      <div className={styles.footer}>
        {problems.length > 0 && <span className={styles.error}>{problems[0]}</span>}
        <div className={styles.footerButtons}>
          <button type="button" className={styles.button} onClick={() => setDraft(defaultDraft())}>
            Reset to defaults
          </button>
          <button
            type="button"
            className={styles.generateButton}
            disabled={problems.length > 0}
            onClick={onGenerate}
          >
            Generate
          </button>
        </div>
      </div>
    </div>
  );
}
