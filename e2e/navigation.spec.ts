import { expect, test } from '@playwright/test';
import {
  cursorX,
  expectCursorAdvanced,
  measureHighlightVisible,
  playNote,
  setGranularity,
  setSkip,
  setupApp,
} from './helpers';

test.describe('navigation and advance settings', () => {
  test.beforeEach(async ({ page }) => {
    await setupApp(page); // default generated scale: C4 D4 E4 F4 | G4 A4 B4 C5
  });

  test('manual next, previous and restart move the cursor', async ({ page }) => {
    const start = await cursorX(page);

    await page.getByRole('button', { name: 'Next note' }).click();
    const forward = await expectCursorAdvanced(page, start);

    await page.getByRole('button', { name: 'Previous note' }).click();
    await expect.poll(() => cursorX(page)).toBe(start);

    await page.getByRole('button', { name: 'Next note' }).click();
    await page.getByRole('button', { name: 'Next note' }).click();
    await expect.poll(() => cursorX(page)).toBeGreaterThan(forward);

    await page.getByRole('button', { name: 'Restart from beginning' }).click();
    await expect.poll(() => cursorX(page)).toBe(start);
  });

  test('the skip multiplier applies to manual and auto advance', async ({ page }) => {
    const start = await cursorX(page);

    // Reference: two single steps land on E4.
    await page.getByRole('button', { name: 'Next note' }).click();
    await page.getByRole('button', { name: 'Next note' }).click();
    const twoSteps = await cursorX(page);
    await page.getByRole('button', { name: 'Restart from beginning' }).click();
    await expect.poll(() => cursorX(page)).toBe(start);

    // Manual advance with skip 2 covers the same distance in one click.
    await setSkip(page, 2);
    await page.getByRole('button', { name: 'Next note' }).click();
    await expect.poll(() => cursorX(page)).toBe(twoSteps);
    await page.getByRole('button', { name: 'Restart from beginning' }).click();

    // Auto-advance on a correct note skips the same way (C4 -> E4).
    await playNote(page, 60);
    await expect.poll(() => cursorX(page)).toBe(twoSteps);
  });

  test('measure mode jumps a whole measure and shows the highlight', async ({ page }) => {
    const start = await cursorX(page);

    // Reference: one note step (D4).
    await page.getByRole('button', { name: 'Next note' }).click();
    const oneNote = await expectCursorAdvanced(page, start);
    await page.getByRole('button', { name: 'Restart from beginning' }).click();
    await expect.poll(() => cursorX(page)).toBe(start);

    expect(await measureHighlightVisible(page)).toBe(false);
    await setGranularity(page, 'Measure');
    await expect.poll(() => measureHighlightVisible(page)).toBe(true);

    // One step now crosses into measure 2 (G4), further than a note step.
    await page.getByRole('button', { name: 'Next note' }).click();
    await expect.poll(() => cursorX(page)).toBeGreaterThan(oneNote);

    await setGranularity(page, 'Note');
    await expect.poll(() => measureHighlightVisible(page)).toBe(false);
  });
});
