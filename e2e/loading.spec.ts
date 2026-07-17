import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import {
  cursorX,
  feedbackBadge,
  generateScale,
  installFakeMidi,
  playSequence,
  setupApp,
} from './helpers';

const SCALE_FILE = fileURLToPath(new URL('./fixtures/c-major-scale.musicxml', import.meta.url));

test.describe('score loading', () => {
  test('generates the default scale with the cursor on the first note', async ({ page }) => {
    await installFakeMidi(page);
    await page.goto('/');

    await generateScale(page);

    await expect(page.locator('svg g.vf-stavenote').first()).toBeVisible();
    expect(await cursorX(page)).toBeGreaterThan(0);
    await expect(feedbackBadge(page)).toHaveText('Waiting for notes…');
  });

  test('loads a MusicXML file from disk via Open file…', async ({ page }) => {
    await installFakeMidi(page);
    await page.goto('/');

    await page.locator('input[type="file"]').setInputFiles(SCALE_FILE);

    await expect(page.locator('svg g.vf-stavenote').first()).toBeVisible();
    expect(await cursorX(page)).toBeGreaterThan(0);
  });

  test('an invalid file shows an error banner and the app stays usable', async ({ page }) => {
    await installFakeMidi(page);
    await page.goto('/');

    await page.locator('input[type="file"]').setInputFiles({
      name: 'broken.musicxml',
      mimeType: 'application/xml',
      buffer: Buffer.from('this is not MusicXML'),
    });
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Could not load score.');
    expect(await page.locator('svg g.vf-stavenote').count()).toBe(0);

    // A valid score can still be loaded afterwards, and the banner clears.
    await generateScale(page);
    await expect(page.locator('svg g.vf-stavenote').first()).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('playing the whole piece shows the completion badge', async ({ page }) => {
    await setupApp(page);

    // Default generated scale: C4 D4 E4 F4 | G4 A4 B4 C5.
    await playSequence(page, [60, 62, 64, 65, 67, 69, 71, 72]);

    await expect(feedbackBadge(page)).toHaveText('Piece complete!');

    // Extra input past the end is ignored.
    await playSequence(page, [60]);
    await expect(feedbackBadge(page)).toHaveText('Piece complete!');
  });
});
