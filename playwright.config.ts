import { defineConfig, devices } from '@playwright/test';

// The dev server runs HTTPS with a self-signed certificate (Web MIDI requires a
// secure context), so both the web-server health check and the browser must
// ignore certificate errors. MIDI input itself is faked per test — see
// e2e/helpers.ts — so the suite runs headless without any hardware.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'https://localhost:5173/',
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'https://localhost:5173/',
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
  },
});
