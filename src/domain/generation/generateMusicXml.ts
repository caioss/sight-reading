import { generateProgression } from './harmony';
import { generateStaffMeasures } from './melody';
import { scoreToMusicXml } from './musicXmlWriter';
import { DIVISIONS } from './rhythm';
import { diatonicPool, keyName } from './theory';
import { createRng } from './rng';
import type { GeneratedScore, GeneratorConfig, StaffConfig } from './types';

export const MIN_MEASURES = 1;
export const MAX_MEASURES = 64;

export const DEFAULT_STAFF_CONFIG: StaffConfig = {
  clef: 'treble',
  minMidi: 60, // C4
  maxMidi: 84, // C6
  allowedDurations: ['half', 'quarter', 'eighth'],
  allowDotted: false,
  allowRests: false,
  allowTies: false,
  allowAccidentals: false,
  allowChords: false,
};

export const DEFAULT_BASS_STAFF_CONFIG: StaffConfig = {
  ...DEFAULT_STAFF_CONFIG,
  clef: 'bass',
  minMidi: 36, // C2
  maxMidi: 60, // C4
};

export const DEFAULT_GENERATOR_CONFIG: GeneratorConfig = {
  staffLayout: 'single',
  key: { fifths: 0, mode: 'major' },
  time: { beats: 4, beatType: 4 },
  measureCount: 16,
  staves: [DEFAULT_STAFF_CONFIG],
};

/** Human-readable config problems; an empty list means the config is valid. */
export function validateGeneratorConfig(config: GeneratorConfig): string[] {
  const problems: string[] = [];
  if (
    !Number.isInteger(config.measureCount) ||
    config.measureCount < MIN_MEASURES ||
    config.measureCount > MAX_MEASURES
  ) {
    problems.push(`Measures must be a whole number between ${MIN_MEASURES} and ${MAX_MEASURES}.`);
  }
  if (!Number.isInteger(config.key.fifths) || Math.abs(config.key.fifths) > 7) {
    problems.push('Key signature must be between 7 flats and 7 sharps.');
  }
  if (!Number.isInteger(config.time.beats) || config.time.beats < 1 || config.time.beats > 12) {
    problems.push('Time signature beats must be between 1 and 12.');
  }
  const expectedStaves = config.staffLayout === 'grand' ? 2 : 1;
  if (config.staves.length !== expectedStaves) {
    problems.push(
      `A ${config.staffLayout} staff layout needs exactly ${expectedStaves} staff configuration(s).`,
    );
    return problems;
  }
  config.staves.forEach((staff, index) => {
    const label =
      config.staffLayout === 'grand' ? (index === 0 ? 'Upper staff' : 'Lower staff') : 'Staff';
    if (!Number.isInteger(staff.minMidi) || !Number.isInteger(staff.maxMidi)) {
      problems.push(`${label}: pitch bounds must be MIDI note numbers.`);
      return;
    }
    if (staff.minMidi > staff.maxMidi) {
      problems.push(`${label}: lowest note must not be above the highest note.`);
      return;
    }
    if (staff.minMidi < 21 || staff.maxMidi > 108) {
      problems.push(`${label}: pitch range must stay within the piano (A0 to C8).`);
      return;
    }
    if (staff.allowedDurations.length === 0) {
      problems.push(`${label}: select at least one note duration.`);
    }
    if (diatonicPool(config.key, staff.minMidi, staff.maxMidi).length === 0) {
      problems.push(`${label}: the pitch range contains no notes of the selected key.`);
    }
  });
  return problems;
}

/** Build the intermediate score model (exposed mainly for tests). */
export function generateScore(config: GeneratorConfig): GeneratedScore {
  const problems = validateGeneratorConfig(config);
  if (problems.length > 0) {
    throw new Error(problems.join(' '));
  }
  const seed = config.seed ?? Math.floor(Math.random() * 0xffffffff);
  const rng = createRng(seed);
  const progression = generateProgression(config.key, config.measureCount, rng);
  const grand = config.staffLayout === 'grand';
  const staffMeasures = config.staves.map((staff, index) =>
    generateStaffMeasures(
      {
        staff,
        key: config.key,
        time: config.time,
        progression,
        // The upper staff always keeps at least one sounding note per measure
        // so a slice with expected notes exists everywhere in the score.
        allowFullMeasureRest: grand && index > 0,
      },
      rng,
    ),
  );
  return {
    config,
    divisions: DIVISIONS,
    measures: progression.map((_, m) => ({
      staves: staffMeasures.map((measures) => measures[m]),
    })),
  };
}

/** Generate a complete MusicXML document string ready for the renderer. */
export function generateMusicXml(config: GeneratorConfig): string {
  const title =
    config.title ??
    `Practice in ${keyName(config.key.fifths, config.key.mode)} ${config.key.mode}`;
  return scoreToMusicXml(generateScore({ ...config, title }));
}
