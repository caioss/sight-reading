import { useMemo, useState } from 'react';
import {
  MAX_OCTAVES,
  MAX_START_OCTAVE,
  MIN_OCTAVES,
  MIN_START_OCTAVE,
  validateScaleConfig,
} from '../domain/generation/scale';
import type { MotionDirection, ScaleConfig } from '../domain/generation/scale';
import { keyName, keyScale } from '../domain/generation/theory';
import type { BaseDuration, ClefType } from '../domain/generation/types';
import type { SightReadingSession } from '../session/useSightReadingSession';
import styles from './GenerateScalePanel.module.css';

interface Props {
  session: SightReadingSession;
  onClose: () => void;
}

interface Draft {
  layout: 'single' | 'grand';
  clef: ClefType;
  fifths: number;
  mode: 'major' | 'minor';
  degrees: number[];
  motion: MotionDirection;
  octavesUp: number;
  octavesDown: number;
  duration: BaseDuration;
  timeId: string;
  /** Both octaves stay alive so toggling single/grand never loses edits. */
  trebleOctave: number;
  bassOctave: number;
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

const MOTION_OPTIONS: { value: MotionDirection; label: string }[] = [
  { value: 'up', label: 'Up' },
  { value: 'down', label: 'Down' },
  { value: 'up-down', label: 'Up + down' },
  { value: 'down-up', label: 'Down + up' },
];

const KEY_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, -1, -2, -3, -4, -5, -6, -7];

const OCTAVE_OPTIONS = Array.from(
  { length: MAX_START_OCTAVE - MIN_START_OCTAVE + 1 },
  (_, i) => MIN_START_OCTAVE + i,
);

const STORAGE_KEY = 'sight-reading:scale-config:v1';

function defaultDraft(): Draft {
  return {
    layout: 'single',
    clef: 'treble',
    fifths: 0,
    mode: 'major',
    degrees: [1, 2, 3, 4, 5, 6, 7],
    motion: 'up',
    octavesUp: 1,
    octavesDown: 1,
    duration: 'quarter',
    timeId: '4/4',
    trebleOctave: 4,
    bassOctave: 3,
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
      !Array.isArray(parsed.degrees) ||
      typeof parsed.octavesUp !== 'number' ||
      typeof parsed.trebleOctave !== 'number'
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

function toScaleConfig(draft: Draft): ScaleConfig {
  const time = TIME_OPTIONS.find((option) => option.id === draft.timeId) ?? TIME_OPTIONS[2];
  const staves =
    draft.layout === 'grand'
      ? [
          { clef: 'treble' as const, startOctave: draft.trebleOctave },
          { clef: 'bass' as const, startOctave: draft.bassOctave },
        ]
      : [
          {
            clef: draft.clef,
            startOctave: draft.clef === 'treble' ? draft.trebleOctave : draft.bassOctave,
          },
        ];
  return {
    staffLayout: draft.layout,
    key: { fifths: draft.fifths, mode: draft.mode },
    degrees: [...draft.degrees].sort((a, b) => a - b),
    motion: draft.motion,
    octavesUp: draft.octavesUp,
    octavesDown: draft.octavesDown,
    duration: draft.duration,
    time: { beats: time.beats, beatType: time.beatType },
    staves,
  };
}

function keyOptionLabel(fifths: number, mode: 'major' | 'minor'): string {
  const accidentals = fifths === 0 ? '' : fifths > 0 ? ` (${fifths}♯)` : ` (${-fifths}♭)`;
  return `${keyName(fifths, mode)} ${mode}${accidentals}`;
}

function degreeNoteName(step: string, alter: number): string {
  return `${step}${alter === 1 ? '♯' : alter === -1 ? '♭' : ''}`;
}

const segClass = (active: boolean) => (active ? `${styles.seg} ${styles.segActive}` : styles.seg);

export function GenerateScalePanel({ session, onClose }: Props) {
  const [draft, setDraft] = useState<Draft>(() => loadStoredDraft() ?? defaultDraft());

  const set = <K extends keyof Draft>(key: K, next: Draft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: next }));

  const problems = useMemo(() => validateScaleConfig(toScaleConfig(draft)), [draft]);
  const scale = useMemo(() => keyScale({ fifths: draft.fifths, mode: draft.mode }), [draft.fifths, draft.mode]);

  const toggleDegree = (degree: number) => {
    const degrees = draft.degrees.includes(degree)
      ? draft.degrees.filter((d) => d !== degree)
      : [...draft.degrees, degree];
    set('degrees', degrees);
  };

  const onOctavesChange = (key: 'octavesUp' | 'octavesDown', raw: number) => {
    const clamped = Math.max(MIN_OCTAVES, Math.min(MAX_OCTAVES, Math.floor(raw) || MIN_OCTAVES));
    set(key, clamped);
  };

  const onGenerate = () => {
    saveDraft(draft);
    void session.generateScale(toScaleConfig(draft));
    onClose();
  };

  const grand = draft.layout === 'grand';
  const upUsed = draft.motion !== 'down';
  const downUsed = draft.motion !== 'up';
  const singleOctaveKey = draft.clef === 'treble' ? 'trebleOctave' : 'bassOctave';

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
            <span>Note value</span>
            <select
              className={styles.select}
              aria-label="Note value"
              value={draft.duration}
              onChange={(event) => set('duration', event.target.value as BaseDuration)}
            >
              {DURATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className={styles.chipRow} role="group" aria-label="Scale degrees">
          {scale.map(({ step, alter, degree }) => {
            const active = draft.degrees.includes(degree);
            return (
              <button
                key={degree}
                type="button"
                className={active ? `${styles.chip} ${styles.chipActive}` : styles.chip}
                aria-pressed={active}
                onClick={() => toggleDegree(degree)}
              >
                {degree} · {degreeNoteName(step, alter)}
              </button>
            );
          })}
        </div>

        <div className={styles.group} role="group" aria-label="Motion">
          {MOTION_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={segClass(draft.motion === option.value)}
              aria-pressed={draft.motion === option.value}
              onClick={() => set('motion', option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className={styles.optionRow}>
          {upUsed && (
            <label className={styles.selectLabel}>
              <span>Octaves up</span>
              <input
                type="number"
                min={MIN_OCTAVES}
                max={MAX_OCTAVES}
                step={1}
                inputMode="numeric"
                aria-label="Octaves up"
                className={styles.numberInput}
                value={draft.octavesUp}
                onChange={(event) => onOctavesChange('octavesUp', Number(event.target.value))}
              />
            </label>
          )}
          {downUsed && (
            <label className={styles.selectLabel}>
              <span>Octaves down</span>
              <input
                type="number"
                min={MIN_OCTAVES}
                max={MAX_OCTAVES}
                step={1}
                inputMode="numeric"
                aria-label="Octaves down"
                className={styles.numberInput}
                value={draft.octavesDown}
                onChange={(event) => onOctavesChange('octavesDown', Number(event.target.value))}
              />
            </label>
          )}
        </div>

        <div className={styles.optionRow}>
          {grand ? (
            <>
              <label className={styles.selectLabel}>
                <span>Treble starting octave</span>
                <select
                  className={styles.select}
                  aria-label="Treble starting octave"
                  value={draft.trebleOctave}
                  onChange={(event) => set('trebleOctave', Number(event.target.value))}
                >
                  {OCTAVE_OPTIONS.map((octave) => (
                    <option key={octave} value={octave}>
                      {octave}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.selectLabel}>
                <span>Bass starting octave</span>
                <select
                  className={styles.select}
                  aria-label="Bass starting octave"
                  value={draft.bassOctave}
                  onChange={(event) => set('bassOctave', Number(event.target.value))}
                >
                  {OCTAVE_OPTIONS.map((octave) => (
                    <option key={octave} value={octave}>
                      {octave}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <label className={styles.selectLabel}>
              <span>Starting octave</span>
              <select
                className={styles.select}
                aria-label="Starting octave"
                value={draft[singleOctaveKey]}
                onChange={(event) => set(singleOctaveKey, Number(event.target.value))}
              >
                {OCTAVE_OPTIONS.map((octave) => (
                  <option key={octave} value={octave}>
                    {octave}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
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
