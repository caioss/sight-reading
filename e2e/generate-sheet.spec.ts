import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  connectFakeDevice,
  cursorX,
  expectCursorAdvanced,
  feedbackBadge,
  installFakeMidi,
  playNote,
  playSequence,
} from './helpers';

async function openGenerateDialog(page: Page) {
  await page.getByText('Load', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Generate…' }).click();
  return page.getByRole('dialog', { name: 'Generate sheet' });
}

/**
 * Constrain the dialog so the generated sheet is fully predictable without
 * seed plumbing: a one-note range and quarter notes only means every position
 * expects exactly that pitch.
 */
async function constrainToSinglePitch(dialog: Locator) {
  await dialog.getByLabel('Lowest note').selectOption({ label: 'C4' });
  await dialog.getByLabel('Highest note').selectOption({ label: 'C4' });
  await dialog.getByRole('button', { name: 'Half' }).click();
  await dialog.getByRole('button', { name: 'Eighth' }).click();
  await expect(dialog.getByRole('button', { name: 'Quarter' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
}

test.describe('generate sheet', () => {
  test('generates a sheet with the default options', async ({ page }) => {
    await installFakeMidi(page);
    await page.goto('/');

    const dialog = await openGenerateDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Generate', exact: true }).click();

    await expect(dialog).not.toBeVisible();
    await expect(page.locator('svg g.vf-stavenote').first()).toBeVisible();
    expect(await cursorX(page)).toBeGreaterThan(0);
    await expect(feedbackBadge(page)).toHaveText('Waiting for notes…');
  });

  test('grand staff layout shows a section per hand and renders two staves', async ({ page }) => {
    await installFakeMidi(page);
    await page.goto('/');

    const dialog = await openGenerateDialog(page);
    await expect(dialog.getByRole('group', { name: 'Clef' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Grand staff' }).click();

    await expect(dialog.getByRole('group', { name: 'Clef' })).not.toBeVisible();
    await expect(dialog.getByRole('group', { name: 'Treble' })).toBeVisible();
    await expect(dialog.getByRole('group', { name: 'Bass' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.locator('svg g.vf-stavenote').first()).toBeVisible();
  });

  test('a constrained sheet is playable end-to-end with matching feedback', async ({ page }) => {
    await installFakeMidi(page);
    await page.goto('/');

    const dialog = await openGenerateDialog(page);
    await constrainToSinglePitch(dialog);
    await dialog.getByLabel('Measures').fill('2');
    await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.locator('svg g.vf-stavenote').first()).toBeVisible();

    await connectFakeDevice(page);

    // A wrong note is reported and does not advance the cursor.
    const start = await cursorX(page);
    await playNote(page, 61);
    await expect(feedbackBadge(page)).toContainText('Wrong note');
    expect(await cursorX(page)).toBe(start);

    // 2 measures of 4/4 quarters on a one-note range = exactly 8 × C4.
    await playSequence(page, Array(7).fill(60));
    await expectCursorAdvanced(page, start);
    await playNote(page, 60);
    await expect(feedbackBadge(page)).toHaveText('Piece complete!');
  });

  test('tie continuations are held, not re-struck', async ({ page }) => {
    await installFakeMidi(page);
    await page.goto('/');

    const dialog = await openGenerateDialog(page);
    await constrainToSinglePitch(dialog);
    // Whole notes give one slot per measure, so every barline can carry a
    // tie; across 32 barlines at least one tie is statistically certain.
    await dialog.getByRole('button', { name: 'Whole' }).click();
    await dialog.getByRole('button', { name: 'Quarter' }).click();
    await dialog.getByLabel('Ties (held notes)').check();
    await dialog.getByLabel('Measures').fill('33');
    await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.locator('svg g.vf-stavenote').first()).toBeVisible();

    await connectFakeDevice(page);

    // If OSMD linked the generated ties, tie continuations are skipped and
    // the piece completes in fewer presses than its 33 notated whole notes.
    let presses = 0;
    while (presses < 33) {
      if ((await feedbackBadge(page).textContent()) === 'Piece complete!') {
        break;
      }
      await playNote(page, 60);
      presses += 1;
      await page.waitForTimeout(30);
    }
    await expect(feedbackBadge(page)).toHaveText('Piece complete!');
    expect(presses).toBeLessThan(33);
  });

  test('invalid options disable Generate with an inline error', async ({ page }) => {
    await installFakeMidi(page);
    await page.goto('/');

    const dialog = await openGenerateDialog(page);
    const generate = dialog.getByRole('button', { name: 'Generate', exact: true });

    // No durations selected.
    for (const chip of ['Half', 'Quarter', 'Eighth']) {
      await dialog.getByRole('button', { name: chip }).click();
    }
    await expect(generate).toBeDisabled();
    await expect(dialog.getByText(/at least one note duration/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Quarter' }).click();
    await expect(generate).toBeEnabled();

    // Inverted pitch range.
    await dialog.getByLabel('Lowest note').selectOption({ label: 'C6' });
    await dialog.getByLabel('Highest note').selectOption({ label: 'C4' });
    await expect(generate).toBeDisabled();
    await expect(dialog.getByText(/lowest note must not be above/)).toBeVisible();
    await dialog.getByLabel('Highest note').selectOption({ label: 'C7' });
    await expect(generate).toBeEnabled();
  });

  test('the last-used options survive a reload', async ({ page }) => {
    await installFakeMidi(page);
    await page.goto('/');

    let dialog = await openGenerateDialog(page);
    await dialog.getByLabel('Measures').fill('4');
    await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.locator('svg g.vf-stavenote').first()).toBeVisible();

    await page.reload();
    dialog = await openGenerateDialog(page);
    await expect(dialog.getByLabel('Measures')).toHaveValue('4');
  });
});
