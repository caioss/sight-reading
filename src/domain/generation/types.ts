export type ClefType = 'treble' | 'bass';

export type BaseDuration = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth';

export interface KeySignature {
  /** Circle-of-fifths position: negative = flats, positive = sharps. */
  fifths: number;
  mode: 'major' | 'minor';
}

export interface TimeSignature {
  beats: number;
  beatType: 2 | 4 | 8;
}

export interface StaffConfig {
  clef: ClefType;
  /** Inclusive MIDI pitch bounds for every generated note on this staff. */
  minMidi: number;
  maxMidi: number;
  /** Base note values the rhythm generator may use; dotted variants via allowDotted. */
  allowedDurations: BaseDuration[];
  allowDotted: boolean;
  allowRests: boolean;
  /** Held notes across a barline (one keypress, two notated notes). */
  allowTies: boolean;
  /** Chromatic passing/neighbor tones outside the key signature. */
  allowAccidentals: boolean;
  /** Diatonic triads of the key's progression instead of single notes. */
  allowChords: boolean;
}

export interface GeneratorConfig {
  staffLayout: 'single' | 'grand';
  key: KeySignature;
  time: TimeSignature;
  measureCount: number;
  /** Index 0 = upper staff. Length 1 for single, 2 for grand. */
  staves: StaffConfig[];
  /** Same seed + same config produces the identical score. */
  seed?: number;
  title?: string;
}

export type Letter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

export interface SpelledPitch {
  step: Letter;
  alter: number;
  octave: number;
  midi: number;
}

/** One notated event (note, chord or rest) in a staff's voice. */
export interface ScoreEvent {
  kind: 'note' | 'rest';
  durationDiv: number;
  /** Base notated value; null only for a full-measure rest. */
  type: BaseDuration | null;
  dots: 0 | 1;
  /** Empty for rests, one entry for notes, three for triads. */
  pitches: SpelledPitch[];
  tieStart?: boolean;
  tieStop?: boolean;
  fullMeasureRest?: boolean;
}

export interface GeneratedScore {
  config: GeneratorConfig;
  /** Divisions per quarter note; fixed so a sixteenth is 1 division. */
  divisions: number;
  /** measures[i].staves[s] = ordered events of staff s in measure i. */
  measures: { staves: ScoreEvent[][] }[];
}
