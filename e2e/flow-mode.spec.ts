import { expect, test } from '@playwright/test';
import {
  clearMarksButton,
  closeMenus,
  countFill,
  cursorX,
  ERROR_MARK_ORANGE,
  expectCursorAdvanced,
  GESTURE_SETTLE_MS,
  openAdvanceMenu,
  playChord,
  playNote,
  setPlayMode,
  setupApp,
} from './helpers';

// The default generated scale: C4 D4 E4 F4 | G4 A4 B4 C5.
const C4 = 60;
const CSHARP4 = 61;
const D4 = 62;
const EFLAT4 = 63;

test.describe('flow mode', () => {
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
    await setPlayMode(page, 'Flow');
  });

  test('a wrong note advances after the gesture window and leaves a mark', async ({ page }) => {
    const start = await cursorX(page);

    await playNote(page, CSHARP4); // expected C4
    await page.waitForTimeout(GESTURE_SETTLE_MS);

    await expectCursorAdvanced(page, start);
    expect(await countFill(page, ERROR_MARK_ORANGE)).toBeGreaterThan(0);
    await openAdvanceMenu(page);
    await expect(clearMarksButton(page)).toHaveText(/\(1\)/);
  });

  test('a correct note advances instantly without marking', async ({ page }) => {
    const start = await cursorX(page);

    await playNote(page, C4);
    await expectCursorAdvanced(page, start);
    expect(await countFill(page, ERROR_MARK_ORANGE)).toBe(0);
  });

  test('near-simultaneous notes form one gesture judged as a set', async ({ page }) => {
    const start = await cursorX(page);

    // Two wrong notes inside one window: one attempt, one advance, one mark.
    await playChord(page, [CSHARP4, EFLAT4]); // expected C4
    await page.waitForTimeout(GESTURE_SETTLE_MS);
    await expectCursorAdvanced(page, start);

    await openAdvanceMenu(page);
    await expect(clearMarksButton(page)).toHaveText(/\(1\)/);
    await closeMenus(page);

    // The cursor advanced exactly one step: D4 is now expected, and playing it
    // fast-path advances without creating a second mark.
    const afterGesture = await cursorX(page);
    await playNote(page, D4);
    await expectCursorAdvanced(page, afterGesture);
    await openAdvanceMenu(page);
    await expect(clearMarksButton(page)).toHaveText(/\(1\)/);
  });

  test('replaying a marked position correctly clears its mark', async ({ page }) => {
    await playNote(page, CSHARP4); // wrong at C4 -> mark
    await page.waitForTimeout(GESTURE_SETTLE_MS);
    await expect.poll(() => countFill(page, ERROR_MARK_ORANGE)).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Previous note' }).click();
    await playNote(page, C4); // correct this time
    await expect.poll(() => countFill(page, ERROR_MARK_ORANGE)).toBe(0);
    await openAdvanceMenu(page);
    await expect(clearMarksButton(page)).toBeDisabled();
  });

  test('marks survive navigation and window resize', async ({ page }) => {
    await playNote(page, CSHARP4); // wrong at C4 -> mark
    await page.waitForTimeout(GESTURE_SETTLE_MS);
    await expect.poll(() => countFill(page, ERROR_MARK_ORANGE)).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Next note' }).click();
    await page.getByRole('button', { name: 'Previous note' }).click();
    expect(await countFill(page, ERROR_MARK_ORANGE)).toBeGreaterThan(0);

    // A resize triggers a full OSMD re-render; the mark must be re-applied.
    await page.setViewportSize({ width: 700, height: 900 });
    await page.waitForTimeout(700); // debounce (150 ms) + re-render
    expect(await countFill(page, ERROR_MARK_ORANGE)).toBeGreaterThan(0);
  });

  test('clear-marks action and restart both clear all marks', async ({ page }) => {
    await playNote(page, CSHARP4); // mark at C4
    await page.waitForTimeout(GESTURE_SETTLE_MS);
    await expect.poll(() => countFill(page, ERROR_MARK_ORANGE)).toBeGreaterThan(0);

    await openAdvanceMenu(page);
    await clearMarksButton(page).click();
    await expect(clearMarksButton(page)).toBeDisabled();
    await closeMenus(page);
    expect(await countFill(page, ERROR_MARK_ORANGE)).toBe(0);

    await playNote(page, CSHARP4); // mark again (cursor is at D4 now)
    await page.waitForTimeout(GESTURE_SETTLE_MS);
    await expect.poll(() => countFill(page, ERROR_MARK_ORANGE)).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Restart from beginning' }).click();
    await expect.poll(() => countFill(page, ERROR_MARK_ORANGE)).toBe(0);
  });

  test('switching back to wait mode restores blocking', async ({ page }) => {
    await setPlayMode(page, 'Wait');
    const start = await cursorX(page);

    await playNote(page, CSHARP4);
    await page.waitForTimeout(GESTURE_SETTLE_MS);
    expect(await cursorX(page)).toBe(start);

    await playNote(page, C4);
    await expectCursorAdvanced(page, start);
    expect(await countFill(page, ERROR_MARK_ORANGE)).toBe(0);
  });

  test('toolbar summary reflects the active mode', async ({ page }) => {
    await expect(page.locator('summary', { hasText: 'Flow ·' })).toHaveCount(1);
    await setPlayMode(page, 'Wait');
    await expect(page.locator('summary', { hasText: 'Flow ·' })).toHaveCount(0);
  });
});
