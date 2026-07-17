import { expect, test, type Page } from '@playwright/test';
import {
  connectFakeDevice,
  cursorX,
  expectCursorAdvanced,
  feedbackBadge,
  installFakeMidi,
  playChord,
  playNote,
  playSequence,
} from './helpers';

async function openScaleDialog(page: Page) {
  await page.getByText('Load', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Generate scale…' }).click();
  return page.getByRole('dialog', { name: 'Generate scale' });
}

const C_MAJOR_UP = [60, 62, 64, 65, 67, 69, 71, 72];

test.describe('generate scale', () => {
  test('generates the default C major scale and plays it to completion', async ({ page }) => {
    await installFakeMidi(page);
    await page.goto('/');

    const dialog = await openScaleDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Generate', exact: true }).click();

    await expect(dialog).not.toBeVisible();
    await expect(page.locator('svg g.vf-stavenote').first()).toBeVisible();
    expect(await cursorX(page)).toBeGreaterThan(0);
    await expect(feedbackBadge(page)).toHaveText('Waiting for notes…');

    await connectFakeDevice(page);

    // A wrong note is reported and does not advance the cursor.
    const start = await cursorX(page);
    await playNote(page, 61);
    await expect(feedbackBadge(page)).toContainText('Wrong note');
    expect(await cursorX(page)).toBe(start);

    await playSequence(page, C_MAJOR_UP.slice(0, -1));
    await expectCursorAdvanced(page, start);
    await playNote(page, C_MAJOR_UP[C_MAJOR_UP.length - 1]);
    await expect(feedbackBadge(page)).toHaveText('Piece complete!');
  });

  test('up + down motion produces the full palindrome run', async ({ page }) => {
    await installFakeMidi(page);
    await page.goto('/');

    const dialog = await openScaleDialog(page);
    await dialog.getByRole('button', { name: 'Up + down' }).click();
    await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.locator('svg g.vf-stavenote').first()).toBeVisible();

    await connectFakeDevice(page);

    // Ascend and descend without repeating the top note; the final tonic is
    // stretched to fill the last measure but still takes a single press.
    const palindrome = [...C_MAJOR_UP, ...C_MAJOR_UP.slice(0, -1).reverse()];
    await playSequence(page, palindrome);
    await expect(feedbackBadge(page)).toHaveText('Piece complete!');
  });

  test('key and degree selection produce the expected notes', async ({ page }) => {
    await installFakeMidi(page);
    await page.goto('/');

    const dialog = await openScaleDialog(page);
    await dialog.getByLabel('Key signature').selectOption({ label: 'G major (1♯)' });
    // Keep only the tonic triad degrees; chip labels follow the key.
    for (const chip of ['2 · A', '4 · C', '6 · E', '7 · F♯']) {
      await dialog.getByRole('button', { name: chip }).click();
    }
    await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.locator('svg g.vf-stavenote').first()).toBeVisible();

    await connectFakeDevice(page);

    // G major, degrees {1,3,5}, one octave up from G4: G4 B4 D5 G5.
    await playSequence(page, [67, 71, 74, 79]);
    await expect(feedbackBadge(page)).toHaveText('Piece complete!');
  });

  test('grand staff plays both hands in parallel with per-staff octaves', async ({ page }) => {
    await installFakeMidi(page);
    await page.goto('/');

    const dialog = await openScaleDialog(page);
    await expect(dialog.getByLabel('Starting octave', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Grand staff' }).click();
    await expect(dialog.getByLabel('Starting octave', { exact: true })).not.toBeVisible();
    await expect(dialog.getByLabel('Treble starting octave')).toBeVisible();
    await expect(dialog.getByLabel('Bass starting octave')).toBeVisible();
    await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.locator('svg g.vf-stavenote').first()).toBeVisible();

    await connectFakeDevice(page);

    // Treble starts C4, bass an octave below (default starting octaves 4/3):
    // each position expects the two-note chord.
    const start = await cursorX(page);
    await playNote(page, 60);
    expect(await cursorX(page)).toBe(start);
    await playChord(page, [60, 48]);
    await expectCursorAdvanced(page, start);
  });

  test('a selectable note value and meter stay playable, ties included', async ({ page }) => {
    await installFakeMidi(page);
    await page.goto('/');

    const dialog = await openScaleDialog(page);
    await dialog.getByLabel('Time signature').selectOption('6/8');
    await dialog.getByLabel('Note value').selectOption({ label: 'Eighth' });
    await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.locator('svg g.vf-stavenote').first()).toBeVisible();

    await connectFakeDevice(page);

    // 8 eighths in 6/8 leave 2 in the last measure; the final note becomes a
    // tie chain, whose continuation must not demand an extra press.
    await playSequence(page, C_MAJOR_UP);
    await expect(feedbackBadge(page)).toHaveText('Piece complete!');
  });

  test('invalid options disable Generate with an inline error', async ({ page }) => {
    await installFakeMidi(page);
    await page.goto('/');

    const dialog = await openScaleDialog(page);
    const generate = dialog.getByRole('button', { name: 'Generate', exact: true });

    // No degrees selected.
    for (const chip of ['1 · C', '2 · D', '3 · E', '4 · F', '5 · G', '6 · A', '7 · B']) {
      await dialog.getByRole('button', { name: chip }).click();
    }
    await expect(generate).toBeDisabled();
    await expect(dialog.getByText(/at least one scale degree/)).toBeVisible();
    await dialog.getByRole('button', { name: '1 · C' }).click();
    await expect(generate).toBeEnabled();

    // A note value that cannot fill the measure evenly.
    await dialog.getByLabel('Time signature').selectOption('3/4');
    await dialog.getByLabel('Note value').selectOption({ label: 'Half' });
    await expect(generate).toBeDisabled();
    await expect(dialog.getByText(/note value must fit/)).toBeVisible();
    await dialog.getByLabel('Note value').selectOption({ label: 'Quarter' });
    await expect(generate).toBeEnabled();
  });

  test('the last-used options survive a reload', async ({ page }) => {
    await installFakeMidi(page);
    await page.goto('/');

    let dialog = await openScaleDialog(page);
    await dialog.getByRole('button', { name: 'Up + down' }).click();
    await dialog.getByLabel('Octaves up').fill('2');
    await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.locator('svg g.vf-stavenote').first()).toBeVisible();

    await page.reload();
    dialog = await openScaleDialog(page);
    await expect(dialog.getByRole('button', { name: 'Up + down' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(dialog.getByLabel('Octaves up')).toHaveValue('2');
  });
});
