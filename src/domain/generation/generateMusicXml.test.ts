import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BASS_STAFF_CONFIG,
  DEFAULT_GENERATOR_CONFIG,
  DEFAULT_STAFF_CONFIG,
  generateMusicXml,
  generateScore,
  validateGeneratorConfig,
} from './generateMusicXml';
import { measureCapacity } from './rhythm';
import { keyScale, midiOf } from './theory';
import type { GeneratedScore, GeneratorConfig, ScoreEvent, StaffConfig } from './types';

const SEEDS = Array.from({ length: 100 }, (_, i) => i);

function makeConfig(overrides: Partial<GeneratorConfig> = {}, staff: Partial<StaffConfig> = {}): GeneratorConfig {
  return {
    ...DEFAULT_GENERATOR_CONFIG,
    measureCount: 8,
    staves: [{ ...DEFAULT_STAFF_CONFIG, ...staff }],
    ...overrides,
  };
}

function makeGrandConfig(
  overrides: Partial<GeneratorConfig> = {},
  upper: Partial<StaffConfig> = {},
  lower: Partial<StaffConfig> = {},
): GeneratorConfig {
  return {
    ...DEFAULT_GENERATOR_CONFIG,
    measureCount: 8,
    staffLayout: 'grand',
    staves: [
      { ...DEFAULT_STAFF_CONFIG, ...upper },
      { ...DEFAULT_BASS_STAFF_CONFIG, ...lower },
    ],
    ...overrides,
  };
}

function staffEvents(score: GeneratedScore, staffIndex: number): ScoreEvent[] {
  return score.measures.flatMap((measure) => measure.staves[staffIndex]);
}

function soundingEvents(score: GeneratedScore, staffIndex: number): ScoreEvent[] {
  return staffEvents(score, staffIndex).filter((event) => event.kind === 'note');
}

describe('generateScore', () => {
  it('is deterministic for the same config and seed', () => {
    const config = makeConfig({ seed: 42 }, { allowRests: true, allowTies: true });
    expect(generateMusicXml(config)).toBe(generateMusicXml(config));
    const other = makeConfig({ seed: 43 }, { allowRests: true, allowTies: true });
    expect(generateMusicXml(config)).not.toBe(generateMusicXml(other));
  });

  it('fills every measure of every staff exactly, across meters and seeds', () => {
    const meters = [
      { beats: 2, beatType: 4 as const },
      { beats: 3, beatType: 4 as const },
      { beats: 4, beatType: 4 as const },
      { beats: 6, beatType: 8 as const },
    ];
    for (const time of meters) {
      for (const seed of SEEDS.slice(0, 25)) {
        const config = makeGrandConfig(
          { time, seed },
          { allowRests: true, allowTies: true, allowDotted: true },
          { allowChords: true, allowRests: true },
        );
        const score = generateScore(config);
        const capacity = measureCapacity(time);
        for (const measure of score.measures) {
          for (const events of measure.staves) {
            expect(events.reduce((sum, event) => sum + event.durationDiv, 0)).toBe(capacity);
          }
        }
      }
    }
  });

  it('respects the pitch range on every staff', () => {
    for (const seed of SEEDS) {
      const config = makeGrandConfig(
        { seed },
        { minMidi: 62, maxMidi: 79, allowAccidentals: true },
        { minMidi: 40, maxMidi: 59, allowChords: true },
      );
      const score = generateScore(config);
      for (const staffIndex of [0, 1]) {
        const { minMidi, maxMidi } = config.staves[staffIndex];
        for (const event of soundingEvents(score, staffIndex)) {
          for (const pitch of event.pitches) {
            expect(pitch.midi).toBeGreaterThanOrEqual(minMidi);
            expect(pitch.midi).toBeLessThanOrEqual(maxMidi);
          }
        }
      }
    }
  });

  it('stays diatonic when accidentals are off, in every key and mode', () => {
    for (let fifths = -7; fifths <= 7; fifths += 1) {
      for (const mode of ['major', 'minor'] as const) {
        const config = makeConfig({ key: { fifths, mode }, seed: fifths + 20 });
        const score = generateScore(config);
        const scale = keyScale(config.key).map(({ step, alter }) => `${step}:${alter}`);
        for (const event of soundingEvents(score, 0)) {
          for (const pitch of event.pitches) {
            expect(scale).toContain(`${pitch.step}:${pitch.alter}`);
          }
        }
      }
    }
  });

  it('never spells sharps in flat keys when diatonic', () => {
    const config = makeConfig({ key: { fifths: -4, mode: 'major' }, seed: 9 });
    for (const event of soundingEvents(generateScore(config), 0)) {
      for (const pitch of event.pitches) {
        expect(pitch.alter).toBeLessThanOrEqual(0);
      }
    }
  });

  it('keeps spelling and midi consistent on every pitch', () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const config = makeGrandConfig(
        { seed, key: { fifths: -3, mode: 'minor' } },
        { allowAccidentals: true, allowRests: true, allowTies: true },
        { allowChords: true },
      );
      const score = generateScore(config);
      for (const staffIndex of [0, 1]) {
        for (const event of soundingEvents(score, staffIndex)) {
          for (const pitch of event.pitches) {
            expect(midiOf(pitch.step, pitch.alter, pitch.octave)).toBe(pitch.midi);
          }
        }
      }
    }
  });

  it('builds chords only from the diatonic triads of the shared progression', () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const config = makeGrandConfig({ seed }, {}, { allowChords: true });
      const score = generateScore(config);
      const scale = keyScale(config.key);
      const triadOf = (degree: number) =>
        [0, 2, 4].map((offset) => {
          const { step, alter } = scale[(degree - 1 + offset) % 7];
          return `${step}:${alter}`;
        });
      const allTriads = [1, 2, 3, 4, 5, 6, 7].map(triadOf);
      for (const event of soundingEvents(score, 1)) {
        if (event.pitches.length > 1) {
          const classes = event.pitches.map((p) => `${p.step}:${p.alter}`);
          const matches = allTriads.some((triad) => classes.every((c) => triad.includes(c)));
          expect(matches).toBe(true);
        }
      }
      // The closing chord belongs to the tonic triad.
      const sounding = soundingEvents(score, 1);
      const finalClasses = sounding[sounding.length - 1].pitches.map((p) => `${p.step}:${p.alter}`);
      for (const pitchClass of finalClasses) {
        expect(triadOf(1)).toContain(pitchClass);
      }
    }
  });

  it('pairs every tie start with a stop on the identical pitches', () => {
    let tieCount = 0;
    for (const seed of SEEDS) {
      const config = makeConfig({ seed }, { allowTies: true, allowRests: true });
      const score = generateScore(config);
      for (let m = 0; m < score.measures.length; m += 1) {
        const events = score.measures[m].staves[0];
        const last = events[events.length - 1];
        if (last.tieStart) {
          tieCount += 1;
          expect(m).toBeLessThan(score.measures.length - 1);
          const next = score.measures[m + 1].staves[0][0];
          expect(next.tieStop).toBe(true);
          expect(next.pitches.map((p) => p.midi)).toEqual(last.pitches.map((p) => p.midi));
        }
        for (const event of events.slice(0, -1)) {
          expect(event.tieStart ?? false).toBe(false);
        }
        for (const event of events.slice(1)) {
          expect(event.tieStop ?? false).toBe(false);
        }
      }
    }
    expect(tieCount).toBeGreaterThan(0);
  });

  it('produces no ties or rests when disabled', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const score = generateScore(makeConfig({ seed }));
      for (const event of staffEvents(score, 0)) {
        expect(event.kind).toBe('note');
        expect(event.tieStart ?? false).toBe(false);
        expect(event.tieStop ?? false).toBe(false);
      }
    }
  });

  it('always starts and ends with a sounding note when rests are on', () => {
    for (const seed of SEEDS) {
      const score = generateScore(makeConfig({ seed }, { allowRests: true }));
      const events = staffEvents(score, 0);
      expect(events[0].kind).toBe('note');
      expect(events[events.length - 1].kind).toBe('note');
      for (let i = 1; i < events.length; i += 1) {
        expect(events[i - 1].kind === 'rest' && events[i].kind === 'rest').toBe(false);
      }
    }
  });

  it('ends every melody on the tonic', () => {
    for (const seed of SEEDS) {
      const key = { fifths: 3, mode: 'major' as const };
      const score = generateScore(makeConfig({ seed, key }));
      const sounding = soundingEvents(score, 0);
      const final = sounding[sounding.length - 1];
      const tonic = keyScale(key)[0];
      expect(final.pitches[0].step).toBe(tonic.step);
      expect(final.pitches[0].alter).toBe(tonic.alter);
    }
  });

  it('generates a fixed pitch drill when min equals max', () => {
    const config = makeConfig(
      { seed: 5, measureCount: 2 },
      { minMidi: 60, maxMidi: 60, allowedDurations: ['quarter'] },
    );
    const events = staffEvents(generateScore(config), 0);
    expect(events).toHaveLength(8);
    for (const event of events) {
      expect(event.type).toBe('quarter');
      expect(event.pitches.map((p) => p.midi)).toEqual([60]);
    }
  });

  it('uses accidentals only when allowed', () => {
    let accidentalCount = 0;
    for (const seed of SEEDS) {
      const config = makeConfig(
        { seed, key: { fifths: 0, mode: 'minor' } },
        { allowAccidentals: true, allowedDurations: ['quarter', 'eighth'] },
      );
      const scale = keyScale(config.key).map(({ step, alter }) => `${step}:${alter}`);
      for (const event of soundingEvents(generateScore(config), 0)) {
        if (!scale.includes(`${event.pitches[0].step}:${event.pitches[0].alter}`)) {
          accidentalCount += 1;
          expect(Math.abs(event.pitches[0].alter)).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(accidentalCount).toBeGreaterThan(0);
  });
});

describe('generateMusicXml output', () => {
  function parse(xml: string): Document {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    return doc;
  }

  it('emits well-formed single-staff MusicXML', () => {
    const doc = parse(generateMusicXml(makeConfig({ seed: 1, measureCount: 4 })));
    expect(doc.documentElement.tagName).toBe('score-partwise');
    expect(doc.querySelectorAll('measure')).toHaveLength(4);
    expect(doc.querySelector('staves')).toBeNull();
    expect(doc.querySelector('backup')).toBeNull();
    expect(doc.querySelector('key > fifths')?.textContent).toBe('0');
    expect(doc.querySelector('clef > sign')?.textContent).toBe('G');
    expect(doc.querySelectorAll('barline bar-style')).toHaveLength(1);
  });

  it('emits a grand staff as one part with two staves and backups', () => {
    const doc = parse(generateMusicXml(makeGrandConfig({ seed: 2, measureCount: 4 })));
    expect(doc.querySelector('staves')?.textContent).toBe('2');
    expect(doc.querySelectorAll('part')).toHaveLength(1);
    expect(doc.querySelectorAll('backup')).toHaveLength(4);
    const capacity = String(measureCapacity({ beats: 4, beatType: 4 }));
    for (const backup of Array.from(doc.querySelectorAll('backup > duration'))) {
      expect(backup.textContent).toBe(capacity);
    }
    expect(doc.querySelectorAll('clef')).toHaveLength(2);
    for (const note of Array.from(doc.querySelectorAll('note'))) {
      expect(note.querySelector('staff')).not.toBeNull();
    }
  });

  it('prints no accidental glyphs for purely diatonic scores', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const doc = parse(
        generateMusicXml(makeConfig({ seed, key: { fifths: -5, mode: 'major' } })),
      );
      expect(doc.querySelectorAll('accidental')).toHaveLength(0);
    }
  });

  it('prints both tie and tied elements for generated ties', () => {
    // Whole notes in 4/4 give one slot per measure: maximum tie opportunities.
    const config = makeConfig(
      { seed: 3, measureCount: 16 },
      { allowTies: true, allowedDurations: ['whole'] },
    );
    const doc = parse(generateMusicXml(config));
    const tieStarts = doc.querySelectorAll('tie[type="start"]');
    expect(tieStarts.length).toBeGreaterThan(0);
    expect(doc.querySelectorAll('tied[type="start"]')).toHaveLength(tieStarts.length);
    expect(doc.querySelectorAll('tie[type="stop"]')).toHaveLength(tieStarts.length);
  });

  it('matches the reference snapshots', () => {
    expect(
      generateMusicXml(makeConfig({ seed: 11, measureCount: 4 })),
    ).toMatchSnapshot('single-treble-defaults');
    expect(
      generateMusicXml(
        makeGrandConfig(
          { seed: 12, measureCount: 4, key: { fifths: -3, mode: 'minor' } },
          { allowRests: true, allowTies: true, allowAccidentals: true },
          { allowChords: true },
        ),
      ),
    ).toMatchSnapshot('grand-eb-minor-full');
  });
});

describe('validateGeneratorConfig', () => {
  it('accepts the default config', () => {
    expect(validateGeneratorConfig(DEFAULT_GENERATOR_CONFIG)).toEqual([]);
  });

  it('rejects out-of-range measure counts', () => {
    expect(validateGeneratorConfig(makeConfig({ measureCount: 0 }))).not.toEqual([]);
    expect(validateGeneratorConfig(makeConfig({ measureCount: 65 }))).not.toEqual([]);
  });

  it('rejects an inverted pitch range', () => {
    const problems = validateGeneratorConfig(makeConfig({}, { minMidi: 72, maxMidi: 60 }));
    expect(problems.join(' ')).toMatch(/lowest note/i);
  });

  it('rejects an empty duration list', () => {
    const problems = validateGeneratorConfig(makeConfig({}, { allowedDurations: [] }));
    expect(problems.join(' ')).toMatch(/duration/i);
  });

  it('rejects a range with no notes of the key', () => {
    const problems = validateGeneratorConfig(makeConfig({}, { minMidi: 61, maxMidi: 61 }));
    expect(problems.join(' ')).toMatch(/no notes/i);
  });

  it('rejects a staff count that does not match the layout', () => {
    const config = { ...makeConfig(), staffLayout: 'grand' as const };
    expect(validateGeneratorConfig(config)).not.toEqual([]);
  });
});
