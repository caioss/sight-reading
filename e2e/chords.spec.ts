import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import {
  connectFakeDevice,
  countFill,
  cursorX,
  ERROR_MARK_ORANGE,
  expectCursorAdvanced,
  GESTURE_SETTLE_MS,
  installFakeMidi,
  playChord,
  playNote,
  releaseNotes,
  rollChordHeld,
  setPlayMode,
  TRANSIENT_WRONG_RED,
} from './helpers';

// A grand-staff score used only by these tests (not bundled with the app).
// First position spans both staves: C4+E4+G4 (treble) and C3 (bass) sound together.
const GRAND_STAFF = fileURLToPath(new URL('./fixtures/grand-staff.musicxml', import.meta.url));
const CHORD = [60, 64, 67, 48];

test.describe('chords on a grand staff', () => {
  test.beforeEach(async ({ page }) => {
    await installFakeMidi(page);
    await page.goto('/');
    await page.locator('input[type="file"]').setInputFiles(GRAND_STAFF);
    await page.waitForSelector('svg g.vf-stavenote', { timeout: 15000 });
    await connectFakeDevice(page);
  });

  test('wait: chord notes accumulate in any order across both staves', async ({ page }) => {
    const start = await cursorX(page);

    // Any order, one at a time; only the final missing note advances.
    await playNote(page, 67);
    await playNote(page, 48);
    await playNote(page, 60);
    expect(await cursorX(page)).toBe(start);

    await playNote(page, 64);
    await expectCursorAdvanced(page, start);
  });

  test('wait: a wrong note flags red but does not reset chord progress', async ({ page }) => {
    const start = await cursorX(page);

    await playNote(page, 60);
    await playNote(page, 64);
    await playNote(page, 61); // wrong
    await expect.poll(() => countFill(page, TRANSIENT_WRONG_RED)).toBeGreaterThan(0);
    expect(await cursorX(page)).toBe(start);

    // The two remaining notes complete the chord — earlier progress kept.
    await playNote(page, 67);
    await playNote(page, 48);
    await expectCursorAdvanced(page, start);
  });

  test('flow: a full chord played together advances instantly without a mark', async ({
    page,
  }) => {
    await setPlayMode(page, 'Flow');
    const start = await cursorX(page);

    await playChord(page, CHORD);
    await expectCursorAdvanced(page, start);
    expect(await countFill(page, ERROR_MARK_ORANGE)).toBe(0);
  });

  test('flow: a partial chord advances after the window and is marked', async ({ page }) => {
    await setPlayMode(page, 'Flow');
    const start = await cursorX(page);

    await playChord(page, [60, 64]); // two of the four required notes
    await page.waitForTimeout(GESTURE_SETTLE_MS);

    await expectCursorAdvanced(page, start);
    expect(await countFill(page, ERROR_MARK_ORANGE)).toBeGreaterThan(0);
  });
});

// Regression: a held/rolled chord must not leak its trailing note onto the
// next position when that position expects the same note. The fixture is a
// C4+E4+G4 chord followed by a lone C4, then a D4.
const CHORD_REPEAT = fileURLToPath(new URL('./fixtures/chord-repeat.musicxml', import.meta.url));

test.describe('chord followed by a shared note', () => {
  test.beforeEach(async ({ page }) => {
    await installFakeMidi(page);
    await page.goto('/');
    await page.locator('input[type="file"]').setInputFiles(CHORD_REPEAT);
    await page.waitForSelector('svg g.vf-stavenote', { timeout: 15000 });
    await connectFakeDevice(page);
  });

  test('flow: a rolled, held chord advances exactly one position', async ({ page }) => {
    // Map out the cursor x of each position by stepping through manually.
    const chordX = await cursorX(page);
    await page.getByRole('button', { name: 'Next note' }).click();
    const sharedNoteX = await cursorX(page);
    await page.getByRole('button', { name: 'Restart from beginning' }).click();
    await expect.poll(() => cursorX(page)).toBe(chordX);

    await setPlayMode(page, 'Flow');

    // Roll the chord with the shared note (C4) landing last, ~60 ms apart so
    // the note-ons span more than one gesture window, and keep it held.
    await rollChordHeld(page, [64, 67, 60], 60);
    await page.waitForTimeout(GESTURE_SETTLE_MS);

    // The chord is one correct gesture: the cursor rests on the shared C4
    // (not past it), and nothing is marked.
    expect(await cursorX(page)).toBe(sharedNoteX);
    expect(await countFill(page, ERROR_MARK_ORANGE)).toBe(0);

    // A genuine re-press of C4 is still required — and advances one step.
    await releaseNotes(page, [64, 67, 60]);
    await playNote(page, 60);
    await expectCursorAdvanced(page, sharedNoteX);
  });
});
