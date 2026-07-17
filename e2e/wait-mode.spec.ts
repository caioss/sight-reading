import { expect, test } from '@playwright/test';
import {
  clearMarksButton,
  countFill,
  cursorX,
  expectCursorAdvanced,
  feedbackBadge,
  openAdvanceMenu,
  playNote,
  setupApp,
  TRANSIENT_WRONG_RED,
} from './helpers';

// The default generated scale: C4 D4 E4 F4 | G4 A4 B4 C5.
const C4 = 60;
const CSHARP4 = 61;
const D4 = 62;

test.describe('wait mode (default)', () => {
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
  });

  test('wrong note blocks with transient red until the correct note is played', async ({
    page,
  }) => {
    const start = await cursorX(page);

    // Wrong note: the cursor must not move and the current note flags red.
    await playNote(page, CSHARP4);
    await expect.poll(() => countFill(page, TRANSIENT_WRONG_RED)).toBeGreaterThan(0);
    expect(await cursorX(page)).toBe(start);

    // The correct note advances and clears the red flag.
    await playNote(page, C4);
    await expectCursorAdvanced(page, start);
    expect(await countFill(page, TRANSIENT_WRONG_RED)).toBe(0);
  });

  test('matching is octave-sensitive', async ({ page }) => {
    const start = await cursorX(page);

    await playNote(page, 72); // C5 where C4 is expected
    await expect.poll(() => countFill(page, TRANSIENT_WRONG_RED)).toBeGreaterThan(0);
    expect(await cursorX(page)).toBe(start);
  });

  test('the wrong-note badge names the played note', async ({ page }) => {
    await playNote(page, CSHARP4);
    await expect(feedbackBadge(page)).toHaveText(/Wrong note/);
    await expect(page.getByText('Played: C#4')).toBeVisible();

    // The badge clears once the correct note is played.
    await playNote(page, C4);
    await expect(feedbackBadge(page)).toHaveText('Waiting for notes…');
  });

  test('never creates persistent error marks', async ({ page }) => {
    // A mistake followed by the correct notes leaves nothing marked behind.
    await playNote(page, CSHARP4);
    await playNote(page, C4);
    await playNote(page, D4);

    await openAdvanceMenu(page);
    await expect(clearMarksButton(page)).toBeDisabled();
  });
});
