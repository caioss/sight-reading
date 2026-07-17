import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCALE_BASS_STAFF,
  DEFAULT_SCALE_CONFIG,
  DEFAULT_SCALE_STAFF,
  buildScaleRun,
  generateScaleMusicXml,
  generateScaleScore,
  validateScaleConfig,
} from './scale';
import type { ScaleConfig } from './scale';
import { measureCapacity } from './rhythm';
import { keyScale, midiOf } from './theory';
import type { GeneratedScore, ScoreEvent } from './types';

function makeConfig(overrides: Partial<ScaleConfig> = {}): ScaleConfig {
  return { ...DEFAULT_SCALE_CONFIG, ...overrides };
}

function makeGrandConfig(overrides: Partial<ScaleConfig> = {}): ScaleConfig {
  return {
    ...DEFAULT_SCALE_CONFIG,
    staffLayout: 'grand',
    staves: [DEFAULT_SCALE_STAFF, DEFAULT_SCALE_BASS_STAFF],
    ...overrides,
  };
}

function runMidi(config: ScaleConfig): number[] {
  return buildScaleRun(config, config.staves[0]).map((pitch) => pitch.midi);
}

function staffEvents(score: GeneratedScore, staffIndex: number): ScoreEvent[] {
  return score.measures.flatMap((measure) => measure.staves[staffIndex]);
}

describe('buildScaleRun', () => {
  it('produces the classic one-octave ascent by default', () => {
    expect(runMidi(DEFAULT_SCALE_CONFIG)).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
  });

  it('descends from the anchor tonic', () => {
    expect(runMidi(makeConfig({ motion: 'down' }))).toEqual([60, 59, 57, 55, 53, 52, 50, 48]);
  });

  it('spans multiple octaves', () => {
    const midi = runMidi(makeConfig({ octavesUp: 2 }));
    expect(midi).toHaveLength(15);
    expect(midi[0]).toBe(60);
    expect(midi[midi.length - 1]).toBe(84);
    for (let i = 1; i < midi.length; i += 1) {
      expect(midi[i]).toBeGreaterThan(midi[i - 1]);
    }
  });

  it('plays the turning point exactly once going up then down', () => {
    expect(runMidi(makeConfig({ motion: 'up-down' }))).toEqual([
      60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60,
    ]);
  });

  it('plays the turning point exactly once going down then up', () => {
    expect(runMidi(makeConfig({ motion: 'down-up' }))).toEqual([
      60, 59, 57, 55, 53, 52, 50, 48, 50, 52, 53, 55, 57, 59, 60,
    ]);
  });

  it('supports asymmetric octave counts', () => {
    const midi = runMidi(makeConfig({ motion: 'up-down', octavesUp: 1, octavesDown: 2 }));
    expect(midi[0]).toBe(60);
    expect(Math.max(...midi)).toBe(72);
    expect(midi[midi.length - 1]).toBe(48);
  });

  it('keeps only the selected degrees', () => {
    expect(runMidi(makeConfig({ degrees: [1, 3, 5] }))).toEqual([60, 64, 67, 72]);
  });

  it('collapses a deselected turning point into a single note', () => {
    const midi = runMidi(makeConfig({ motion: 'up-down', degrees: [7] }));
    expect(midi).toEqual([71]);
    const wider = runMidi(makeConfig({ motion: 'up-down', degrees: [7], octavesUp: 2, octavesDown: 2 }));
    expect(wider).toEqual([71, 83, 71]);
  });

  it('spells every pitch from the key scale with a consistent midi', () => {
    for (let fifths = -7; fifths <= 7; fifths += 1) {
      for (const mode of ['major', 'minor'] as const) {
        const config = makeConfig({ key: { fifths, mode }, motion: 'up-down' });
        const scale = keyScale(config.key).map(({ step, alter }) => `${step}:${alter}`);
        for (const pitch of buildScaleRun(config, config.staves[0])) {
          expect(scale).toContain(`${pitch.step}:${pitch.alter}`);
          expect(midiOf(pitch.step, pitch.alter, pitch.octave)).toBe(pitch.midi);
        }
      }
    }
  });

  it('anchors minor keys on their own tonic', () => {
    const midi = runMidi(makeConfig({ key: { fifths: 0, mode: 'minor' } }));
    // A natural minor starting on A4.
    expect(midi).toEqual([69, 71, 72, 74, 76, 77, 79, 81]);
  });

  it('numbers octaves with the C boundary', () => {
    const config = makeConfig({ key: { fifths: 3, mode: 'major' } });
    const run = buildScaleRun(config, config.staves[0]);
    // A major from A4: A4 B4 C#5 ...
    expect(run[0].octave).toBe(4);
    expect(run[2].step).toBe('C');
    expect(run[2].octave).toBe(5);
  });
});

describe('generateScaleScore', () => {
  it('reproduces the old bundled sample with the default config', () => {
    const score = generateScaleScore(DEFAULT_SCALE_CONFIG);
    expect(score.measures).toHaveLength(2);
    const events = staffEvents(score, 0);
    expect(events).toHaveLength(8);
    expect(events.map((e) => e.pitches[0].midi)).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
    for (const event of events) {
      expect(event.type).toBe('quarter');
      expect(event.dots).toBe(0);
      expect(event.pitches[0].alter).toBe(0);
    }
  });

  it('fills every measure exactly across durations and meters', () => {
    const combos: Partial<ScaleConfig>[] = [
      { duration: 'eighth', time: { beats: 6, beatType: 8 } },
      { duration: 'half', time: { beats: 2, beatType: 4 } },
      { duration: 'quarter', time: { beats: 3, beatType: 4 } },
      { duration: 'sixteenth', time: { beats: 4, beatType: 4 } },
    ];
    for (const combo of combos) {
      const config = makeConfig({ ...combo, motion: 'up-down', octavesUp: 2 });
      const score = generateScaleScore(config);
      const capacity = measureCapacity(config.time);
      for (const measure of score.measures) {
        for (const events of measure.staves) {
          expect(events.reduce((sum, event) => sum + event.durationDiv, 0)).toBe(capacity);
        }
      }
    }
  });

  it('extends the final note instead of adding rests', () => {
    // 15 notes up-down: the last measure holds 3 quarters + the final note
    // stretched to a half.
    const score = generateScaleScore(makeConfig({ motion: 'up-down' }));
    const events = staffEvents(score, 0);
    expect(events.every((event) => event.kind === 'note')).toBe(true);
    const final = events[events.length - 1];
    expect(final.type).toBe('half');
    expect(final.durationDiv).toBe(8);
    expect(final.pitches[0].midi).toBe(60);
  });

  it('pads with a tie chain when a single value cannot fill the measure', () => {
    // 10 eighths in 4/4: the final note must cover 14 divisions, which no
    // single (even dotted) value can — expect dotted half tied to eighth.
    const config = makeConfig({ duration: 'eighth', degrees: [2, 3, 4, 5, 6], octavesUp: 2 });
    const events = staffEvents(generateScaleScore(config), 0);
    expect(events.map((e) => e.pitches[0].midi)).toEqual([
      62, 64, 65, 67, 69, 74, 76, 77, 79, 81, 81,
    ]);
    const chain = events.slice(-2);
    expect(chain[0].tieStart).toBe(true);
    expect(chain[0].type).toBe('half');
    expect(chain[0].dots).toBe(1);
    expect(chain[1].tieStop).toBe(true);
    expect(chain[1].type).toBe('eighth');
    expect(chain.reduce((sum, event) => sum + event.durationDiv, 0)).toBe(14);
    expect(chain[0].pitches[0].midi).toBe(chain[1].pitches[0].midi);
  });

  it('holds a single-note run for the whole measure', () => {
    const events = staffEvents(generateScaleScore(makeConfig({ degrees: [4] })), 0);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('whole');
    expect(events[0].durationDiv).toBe(16);
  });

  it('keeps grand staves aligned with the configured octave offset', () => {
    const score = generateScaleScore(makeGrandConfig({ motion: 'up-down' }));
    for (const measure of score.measures) {
      expect(measure.staves[0]).toHaveLength(measure.staves[1].length);
      measure.staves[0].forEach((event, i) => {
        const lower = measure.staves[1][i];
        expect(lower.pitches[0].midi).toBe(event.pitches[0].midi - 12);
        expect(lower.durationDiv).toBe(event.durationDiv);
      });
    }
    expect(score.config.staves[0].clef).toBe('treble');
    expect(score.config.staves[1].clef).toBe('bass');
  });
});

describe('generateScaleMusicXml', () => {
  function parse(xml: string): Document {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    return doc;
  }

  it('emits well-formed single-staff MusicXML with the key signature', () => {
    const doc = parse(generateScaleMusicXml(makeConfig({ key: { fifths: -5, mode: 'major' } })));
    expect(doc.documentElement.tagName).toBe('score-partwise');
    expect(doc.querySelector('key > fifths')?.textContent).toBe('-5');
    expect(doc.querySelector('work-title')?.textContent).toBe('Db major scale');
    expect(doc.querySelector('clef > sign')?.textContent).toBe('G');
    // Diatonic scales never print accidental glyphs; the signature covers them.
    expect(doc.querySelectorAll('accidental')).toHaveLength(0);
    expect(doc.querySelectorAll('barline bar-style')).toHaveLength(1);
  });

  it('emits a grand staff as one part with two staves and backups', () => {
    const doc = parse(generateScaleMusicXml(makeGrandConfig()));
    expect(doc.querySelector('staves')?.textContent).toBe('2');
    expect(doc.querySelectorAll('part')).toHaveLength(1);
    expect(doc.querySelectorAll('backup')).toHaveLength(doc.querySelectorAll('measure').length);
    expect(doc.querySelectorAll('clef')).toHaveLength(2);
  });

  it('respects a bass clef on a single staff', () => {
    const doc = parse(
      generateScaleMusicXml(makeConfig({ staves: [{ clef: 'bass', startOctave: 3 }] })),
    );
    expect(doc.querySelector('clef > sign')?.textContent).toBe('F');
    expect(doc.querySelector('staves')).toBeNull();
  });

  it('matches the reference snapshots', () => {
    expect(generateScaleMusicXml(DEFAULT_SCALE_CONFIG)).toMatchSnapshot('default-c-major-up');
    expect(
      generateScaleMusicXml(
        makeGrandConfig({
          key: { fifths: -6, mode: 'minor' },
          motion: 'up-down',
          octavesUp: 2,
          octavesDown: 1,
          degrees: [1, 2, 3, 5, 6],
          duration: 'eighth',
          time: { beats: 3, beatType: 4 },
        }),
      ),
    ).toMatchSnapshot('grand-eb-minor-up-down');
  });
});

describe('validateScaleConfig', () => {
  it('accepts the default config', () => {
    expect(validateScaleConfig(DEFAULT_SCALE_CONFIG)).toEqual([]);
  });

  it('rejects an empty degree selection', () => {
    expect(validateScaleConfig(makeConfig({ degrees: [] })).join(' ')).toMatch(/scale degree/i);
  });

  it('rejects out-of-range or repeated degrees', () => {
    expect(validateScaleConfig(makeConfig({ degrees: [0, 8] }))).not.toEqual([]);
    expect(validateScaleConfig(makeConfig({ degrees: [1, 1] }))).not.toEqual([]);
  });

  it('rejects out-of-range octave counts only for the legs in use', () => {
    expect(validateScaleConfig(makeConfig({ octavesUp: 0 }))).not.toEqual([]);
    expect(validateScaleConfig(makeConfig({ octavesUp: 5 }))).not.toEqual([]);
    // 'up' never descends, so a bad octavesDown is irrelevant.
    expect(validateScaleConfig(makeConfig({ octavesDown: 99 }))).toEqual([]);
    expect(validateScaleConfig(makeConfig({ motion: 'down', octavesDown: 99 }))).not.toEqual([]);
  });

  it('rejects a note value that does not fit the measure evenly', () => {
    const problems = validateScaleConfig(
      makeConfig({ duration: 'half', time: { beats: 3, beatType: 4 } }),
    );
    expect(problems.join(' ')).toMatch(/note value/i);
    expect(
      validateScaleConfig(makeConfig({ duration: 'whole', time: { beats: 2, beatType: 4 } })),
    ).not.toEqual([]);
  });

  it('rejects a staff count that does not match the layout', () => {
    expect(validateScaleConfig(makeConfig({ staffLayout: 'grand' }))).not.toEqual([]);
  });

  it('rejects a run that leaves the piano range', () => {
    const problems = validateScaleConfig(
      makeConfig({ staves: [{ clef: 'treble', startOctave: 7 }], octavesUp: 2 }),
    );
    expect(problems.join(' ')).toMatch(/piano range/i);
    expect(
      validateScaleConfig(
        makeConfig({ motion: 'down', staves: [{ clef: 'bass', startOctave: 1 }] }),
      ),
    ).not.toEqual([]);
  });

  it('rejects an out-of-range starting octave', () => {
    const problems = validateScaleConfig(makeConfig({ staves: [{ clef: 'treble', startOctave: 0 }] }));
    expect(problems.join(' ')).toMatch(/starting octave/i);
  });
});
