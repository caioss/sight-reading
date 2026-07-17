import { expect, test } from '@playwright/test';
import { installFakeMidi } from './helpers';

test.describe('MIDI device management', () => {
  test('connects and disconnects through the device modal', async ({ page }) => {
    await installFakeMidi(page);
    await page.goto('/');

    // The status dot starts disconnected (its aria-label reflects the state).
    await expect(page.getByRole('button', { name: /MIDI disconnected/ })).toBeVisible();

    // Scan lists the fake device; connecting flips the dot to connected.
    await page.getByRole('button', { name: /open device settings/ }).click();
    await page.getByRole('button', { name: 'Scan' }).click();
    const deviceSelect = page.getByRole('combobox', { name: 'MIDI input device' });
    await expect(deviceSelect.locator('option', { hasText: 'Fake Test Keyboard' })).toHaveCount(1);
    await deviceSelect.selectOption('fake-1');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByRole('button', { name: /MIDI connected/ })).toBeVisible();

    // Disconnecting flips it back.
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByRole('button', { name: /MIDI disconnected/ })).toBeVisible();
  });

  test('USB / Web MIDI is the default transport', async ({ page }) => {
    await installFakeMidi(page);
    await page.goto('/');

    await page.getByRole('button', { name: /open device settings/ }).click();
    await expect(page.getByRole('button', { name: 'USB / Web MIDI' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
