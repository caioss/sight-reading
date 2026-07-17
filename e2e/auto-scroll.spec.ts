import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import {
  cursorInView,
  installFakeMidi,
  scoreScrollTop,
  setGranularity,
  setSkip,
  waitForScrollSettle,
} from './helpers';

// A 48-measure score used only by these tests (not bundled with the app), long
// enough to overflow the score area so auto-scroll has something to do. Even
// measures hold A3+C6 chords, so every note there carries ledger lines above
// and below the staff — the measure extends well beyond the staff lines.
const LONG_SCALE = fileURLToPath(new URL('./fixtures/long-scale.musicxml', import.meta.url));

interface Rects {
  /** Score-area viewport (the scroll parent). */
  viewport: { top: number; bottom: number };
  /** Note cursor. */
  cursor: { top: number; bottom: number };
  /** Bounding box of the notes under the cursor, ledger lines included. */
  extent: { top: number; bottom: number };
}

/**
 * Screen rectangles of the scroll viewport, the cursor, and the stave-note
 * group under the cursor. In the fixture's even measures that group is an
 * A3+C6 chord, so its box spans the ledger lines above and below the staff.
 */
async function measureRects(page: Page): Promise<Rects> {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    const img = document.querySelector('img#cursorImg-0');
    if (!main || !img) {
      throw new Error('score viewport or cursor not found');
    }
    const viewport = main.getBoundingClientRect();
    const cursor = img.getBoundingClientRect();
    const cx = cursor.x + cursor.width / 2;
    let extentTop = Number.POSITIVE_INFINITY;
    let extentBottom = Number.NEGATIVE_INFINITY;
    for (const note of document.querySelectorAll('svg g.vf-stavenote')) {
      const rect = note.getBoundingClientRect();
      const horizontally = rect.left <= cx && cx <= rect.right;
      const vertically = rect.top < cursor.bottom && rect.bottom > cursor.top;
      if (horizontally && vertically) {
        extentTop = Math.min(extentTop, rect.top);
        extentBottom = Math.max(extentBottom, rect.bottom);
      }
    }
    if (!Number.isFinite(extentTop)) {
      throw new Error('no stave-note found under the cursor');
    }
    return {
      viewport: { top: viewport.top, bottom: viewport.bottom },
      cursor: { top: cursor.top, bottom: cursor.bottom },
      extent: { top: extentTop, bottom: extentBottom },
    };
  });
}

test.describe('auto-scroll', () => {
  test.beforeEach(async ({ page }) => {
    // A short viewport guarantees the fixture overflows the score area.
    await page.setViewportSize({ width: 900, height: 500 });
    await installFakeMidi(page);
    await page.goto('/');
    await page.locator('input[type="file"]').setInputFiles(LONG_SCALE);
    await expect(page.locator('svg g.vf-stavenote').first()).toBeVisible();
  });

  test('does not scroll while the current measure is fully visible', async ({ page }) => {
    expect(await scoreScrollTop(page)).toBe(0);

    // A small step within the first (visible) system must not scroll, even
    // after the smooth-scroll animation window has fully elapsed.
    await page.getByRole('button', { name: 'Next note' }).click();
    await page.waitForTimeout(600);
    expect(await scoreScrollTop(page)).toBe(0);
    expect(await cursorInView(page)).toBe(true);
  });

  test('keeps the current measure in view when jumping ahead and back', async ({ page }) => {
    // Jump 30 measures in (measure mode, skip 10, three clicks).
    await setGranularity(page, 'Measure');
    await setSkip(page, 10);
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: 'Next note' }).click();
    }

    await expect.poll(() => scoreScrollTop(page)).toBeGreaterThan(0);
    await waitForScrollSettle(page);
    const scrolled = await scoreScrollTop(page);
    expect(await cursorInView(page)).toBe(true);

    // Restart scrolls back up to the first measure.
    await page.getByRole('button', { name: 'Restart from beginning' }).click();
    await expect.poll(() => scoreScrollTop(page)).toBeLessThan(scrolled);
    await waitForScrollSettle(page);
    expect(await cursorInView(page)).toBe(true);
  });

  test('scrolls smoothly through intermediate positions instead of jumping', async ({ page }) => {
    await setGranularity(page, 'Measure');
    await setSkip(page, 20);

    // Sample the scroll offset every frame while a long jump animates.
    const samplesPromise = page.evaluate(async () => {
      const main = document.querySelector('main');
      if (!main) {
        throw new Error('score viewport not found');
      }
      const samples: number[] = [];
      for (let i = 0; i < 70; i++) {
        samples.push(main.scrollTop);
        await new Promise(requestAnimationFrame);
      }
      return samples;
    });
    await page.getByRole('button', { name: 'Next note' }).click();
    const samples = await samplesPromise;

    const start = samples[0];
    const end = samples[samples.length - 1];
    const total = end - start;
    expect(total).toBeGreaterThan(50); // the jump did scroll a meaningful distance

    // Smooth: several distinct in-between positions, and no near-total jump
    // between consecutive frames.
    const intermediate = new Set(samples.filter((s) => s > start && s < end));
    expect(intermediate.size).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i] - samples[i - 1]).toBeLessThanOrEqual(total * 0.8);
    }
    await waitForScrollSettle(page);
    expect(await cursorInView(page)).toBe(true);
  });

  test('recenters the measure when only its ledger lines are clipped', async ({ page }) => {
    // Jump into measure 12 — an A3+C6 ledger-line measure mid-score, far from
    // the document edges so centring cannot be clamped by the scroll range.
    await setGranularity(page, 'Measure');
    await setSkip(page, 11);
    await page.getByRole('button', { name: 'Next note' }).click();
    await waitForScrollSettle(page);
    await setGranularity(page, 'Note');
    await setSkip(page, 1);

    // Scroll so the ledger lines above the staff are clipped while the staff
    // itself (the cursor) stays fully visible: only note SVGs are off-screen.
    await page.evaluate(() => {
      const main = document.querySelector('main');
      const img = document.querySelector('img#cursorImg-0');
      if (!main || !img) {
        throw new Error('score viewport or cursor not found');
      }
      const cursor = img.getBoundingClientRect();
      const cx = cursor.x + cursor.width / 2;
      let extentTop = Number.POSITIVE_INFINITY;
      for (const note of document.querySelectorAll('svg g.vf-stavenote')) {
        const rect = note.getBoundingClientRect();
        if (rect.left <= cx && cx <= rect.right && rect.top < cursor.bottom && rect.bottom > cursor.top) {
          extentTop = Math.min(extentTop, rect.top);
        }
      }
      const headroom = cursor.top - extentTop; // height of the ledger-line region
      const clipDepth = Math.max(5, Math.min(20, headroom / 2));
      main.scrollTop += extentTop - main.getBoundingClientRect().top + clipDepth;
    });

    const before = await measureRects(page);
    expect(before.extent.top).toBeLessThan(before.viewport.top); // ledger lines hidden…
    expect(before.cursor.top).toBeGreaterThanOrEqual(before.viewport.top); // …staff still visible

    // Stepping within the measure must notice the clipped notes and recenter.
    await page.getByRole('button', { name: 'Next note' }).click();
    await waitForScrollSettle(page);

    const after = await measureRects(page);
    expect(after.extent.top).toBeGreaterThanOrEqual(after.viewport.top);
    expect(after.extent.bottom).toBeLessThanOrEqual(after.viewport.bottom);
    const extentCenter = (after.extent.top + after.extent.bottom) / 2;
    const viewportCenter = (after.viewport.top + after.viewport.bottom) / 2;
    expect(Math.abs(extentCenter - viewportCenter)).toBeLessThanOrEqual(40);
  });
});
