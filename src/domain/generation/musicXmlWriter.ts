import { measureCapacity } from './rhythm';
import { keyAlterations } from './theory';
import type { ClefType, GeneratedScore, Letter, ScoreEvent, SpelledPitch } from './types';

const ACCIDENTAL_NAMES: Record<number, string> = { [-1]: 'flat', 0: 'natural', 1: 'sharp' };

function clefXml(clef: ClefType, number?: number): string {
  const attr = number === undefined ? '' : ` number="${number}"`;
  const body = clef === 'treble' ? '<sign>G</sign><line>2</line>' : '<sign>F</sign><line>4</line>';
  return `<clef${attr}>${body}</clef>`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Tracks the effective accidental per (letter, octave) inside one measure so
 * the printed glyphs always imply exactly the sounding pitch — critical for a
 * sight-reading trainer where the player plays what the sheet shows.
 */
class AccidentalState {
  private effective = new Map<string, number>();

  constructor(private keyAlters: Partial<Record<Letter, number>>) {}

  /** Returns the glyph name to print for this pitch, or null for none. */
  glyphFor(pitch: SpelledPitch, suppressGlyph: boolean): string | null {
    const key = `${pitch.step}${pitch.octave}`;
    const expected = this.effective.get(key) ?? this.keyAlters[pitch.step] ?? 0;
    this.effective.set(key, pitch.alter);
    if (pitch.alter === expected || suppressGlyph) {
      return null;
    }
    return ACCIDENTAL_NAMES[pitch.alter] ?? null;
  }
}

function noteXml(
  event: ScoreEvent,
  pitchIndex: number,
  voice: number,
  staffNumber: number | null,
  accidentals: AccidentalState,
): string {
  const pitch = event.pitches[pitchIndex];
  const parts: string[] = [];
  if (pitchIndex > 0) {
    parts.push('<chord/>');
  }
  const alterXml = pitch.alter === 0 ? '' : `<alter>${pitch.alter}</alter>`;
  parts.push(
    `<pitch><step>${pitch.step}</step>${alterXml}<octave>${pitch.octave}</octave></pitch>`,
  );
  parts.push(`<duration>${event.durationDiv}</duration>`);
  if (event.tieStop) {
    parts.push('<tie type="stop"/>');
  }
  if (event.tieStart) {
    parts.push('<tie type="start"/>');
  }
  parts.push(`<voice>${voice}</voice>`);
  if (event.type) {
    parts.push(`<type>${event.type}</type>`);
  }
  if (event.dots === 1) {
    parts.push('<dot/>');
  }
  // A tie continuation keeps its accidental from the tied note; never reprint.
  const glyph = accidentals.glyphFor(pitch, Boolean(event.tieStop));
  if (glyph) {
    parts.push(`<accidental>${glyph}</accidental>`);
  }
  if (staffNumber !== null) {
    parts.push(`<staff>${staffNumber}</staff>`);
  }
  const notations: string[] = [];
  if (event.tieStop) {
    notations.push('<tied type="stop"/>');
  }
  if (event.tieStart) {
    notations.push('<tied type="start"/>');
  }
  if (notations.length > 0) {
    parts.push(`<notations>${notations.join('')}</notations>`);
  }
  return `<note>${parts.join('')}</note>`;
}

function restXml(event: ScoreEvent, voice: number, staffNumber: number | null): string {
  const parts: string[] = [];
  parts.push(event.fullMeasureRest ? '<rest measure="yes"/>' : '<rest/>');
  parts.push(`<duration>${event.durationDiv}</duration>`);
  parts.push(`<voice>${voice}</voice>`);
  if (event.type) {
    parts.push(`<type>${event.type}</type>`);
  }
  if (event.dots === 1) {
    parts.push('<dot/>');
  }
  if (staffNumber !== null) {
    parts.push(`<staff>${staffNumber}</staff>`);
  }
  return `<note>${parts.join('')}</note>`;
}

function staffEventsXml(
  events: ScoreEvent[],
  voice: number,
  staffNumber: number | null,
  keyAlters: Partial<Record<Letter, number>>,
): string {
  const accidentals = new AccidentalState(keyAlters);
  return events
    .map((event) => {
      if (event.kind === 'rest') {
        return restXml(event, voice, staffNumber);
      }
      return event.pitches
        .map((_, i) => noteXml(event, i, voice, staffNumber, accidentals))
        .join('\n      ');
    })
    .join('\n      ');
}

/** Serialize the generated model to a MusicXML (partwise 3.1) string. */
export function scoreToMusicXml(score: GeneratedScore): string {
  const { config } = score;
  const grand = config.staffLayout === 'grand';
  const capacity = measureCapacity(config.time);
  const keyAlters = keyAlterations(config.key.fifths);
  const title = config.title ?? 'Generated practice sheet';

  const clefsXml = grand
    ? `<staves>2</staves>
        ${clefXml(config.staves[0].clef, 1)}
        ${clefXml(config.staves[1].clef, 2)}`
    : clefXml(config.staves[0].clef);

  const measuresXml = score.measures
    .map((measure, index) => {
      const attributes =
        index === 0
          ? `<attributes>
        <divisions>${score.divisions}</divisions>
        <key><fifths>${config.key.fifths}</fifths><mode>${config.key.mode}</mode></key>
        <time><beats>${config.time.beats}</beats><beat-type>${config.time.beatType}</beat-type></time>
        ${clefsXml}
      </attributes>
      `
          : '';
      const upper = staffEventsXml(measure.staves[0], 1, grand ? 1 : null, keyAlters);
      const lower = grand
        ? `
      <backup><duration>${capacity}</duration></backup>
      ${staffEventsXml(measure.staves[1], 2, 2, keyAlters)}`
        : '';
      const finalBarline =
        index === score.measures.length - 1
          ? `
      <barline location="right"><bar-style>light-heavy</bar-style></barline>`
          : '';
      return `    <measure number="${index + 1}">
      ${attributes}${upper}${lower}${finalBarline}
    </measure>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work>
    <work-title>${escapeXml(title)}</work-title>
  </work>
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
${measuresXml}
  </part>
</score-partwise>
`;
}
