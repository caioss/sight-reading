import { expect, type Locator, type Page } from '@playwright/test';

/** Inline fill used for transient wrong-note feedback (see FEEDBACK_COLORS). */
export const TRANSIENT_WRONG_RED = 'rgb(220, 38, 38)';
/** Inline fill used for persistent error marks (see ERROR_MARK_COLOR). */
export const ERROR_MARK_ORANGE = 'rgb(234, 88, 12)';

/**
 * The flow-mode gesture window is 100 ms plus a 10 ms timer slack; waiting this
 * long guarantees a pending gesture has been judged.
 */
export const GESTURE_SETTLE_MS = 400;

declare global {
  interface Window {
    /** Installed by installFakeMidi: feed raw MIDI bytes to the connected input. */
    __sendMidi: (bytes: number[]) => void;
  }
}

/**
 * Replace the Web MIDI API with a single fake input device before any page
 * script runs. Tests then drive the app by sending raw MIDI bytes through
 * `window.__sendMidi`, exercising the real adapter → parser → session path.
 */
export async function installFakeMidi(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const holder: { handler: ((event: { data: Uint8Array; timeStamp: number }) => void) | null } =
      { handler: null };
    const fakeInput = {
      id: 'fake-1',
      name: 'Fake Test Keyboard',
      state: 'connected',
      connection: 'open',
      get onmidimessage() {
        return holder.handler;
      },
      set onmidimessage(fn) {
        holder.handler = fn;
      },
    };
    const access = {
      inputs: new Map([['fake-1', fakeInput]]),
      outputs: new Map(),
      sysexEnabled: false,
      onstatechange: null,
    };
    (navigator as { requestMIDIAccess: () => Promise<unknown> }).requestMIDIAccess = () =>
      Promise.resolve(access);
    window.__sendMidi = (bytes: number[]) => {
      if (!holder.handler) {
        throw new Error('no onmidimessage handler attached');
      }
      holder.handler({ data: new Uint8Array(bytes), timeStamp: performance.now() });
    };
  });
}

/** Connect the fake MIDI device through the device settings dialog. */
export async function connectFakeDevice(page: Page): Promise<void> {
  await page.getByRole('button', { name: /open device settings/ }).click();
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByRole('combobox', { name: 'MIDI input device' }).selectOption('fake-1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.waitForSelector('[data-state="connected"]');
  await page.getByRole('button', { name: 'Close' }).click();
}

/**
 * Generate a scale through the "Generate scale…" dialog. With no interaction
 * in `configure`, a fresh browser context generates the default scale — the
 * classic 8-note C major run (C4 D4 E4 F4 | G4 A4 B4 C5) the specs assume.
 */
export async function generateScale(
  page: Page,
  configure?: (page: Page) => Promise<void>,
): Promise<void> {
  await page.getByText('Load', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Generate scale…' }).click();
  await configure?.(page);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await page.waitForSelector('svg g.vf-stavenote', { timeout: 15000 });
}

/** Load the app, generate the default scale, and connect the fake device. */
export async function setupApp(page: Page): Promise<void> {
  await installFakeMidi(page);
  await page.goto('/');
  await generateScale(page);
  await connectFakeDevice(page);
}

/** Press and release a MIDI note (noteon + noteoff). */
export async function playNote(page: Page, note: number): Promise<void> {
  await page.evaluate((n) => {
    window.__sendMidi([0x90, n, 100]);
    window.__sendMidi([0x80, n, 0]);
  }, note);
}

/** Press several notes back-to-back, well inside one gesture window. */
export async function playChord(page: Page, notes: number[]): Promise<void> {
  await page.evaluate((ns) => {
    for (const n of ns) {
      window.__sendMidi([0x90, n, 100]);
    }
    for (const n of ns) {
      window.__sendMidi([0x80, n, 0]);
    }
  }, notes);
}

/**
 * Roll a chord: press the notes one by one with `gapMs` between them and keep
 * them all held (no note-offs). Models a real hand landing a chord unevenly.
 */
export async function rollChordHeld(page: Page, notes: number[], gapMs: number): Promise<void> {
  for (const [index, note] of notes.entries()) {
    if (index > 0) {
      await page.waitForTimeout(gapMs);
    }
    await page.evaluate((n) => window.__sendMidi([0x90, n, 100]), note);
  }
}

/** Release notes previously held by rollChordHeld. */
export async function releaseNotes(page: Page, notes: number[]): Promise<void> {
  await page.evaluate((ns) => {
    for (const n of ns) {
      window.__sendMidi([0x80, n, 0]);
    }
  }, notes);
}

/** Horizontal position of the OSMD note cursor (advancing moves it right). */
export async function cursorX(page: Page): Promise<number> {
  return page.evaluate(() => {
    const img =
      document.querySelector('img#cursorImg-0') ?? document.querySelector('img[id^="cursorImg"]');
    return img ? img.getBoundingClientRect().x : -1;
  });
}

/** Whether the translucent measure-highlight cursor (index 1) is visible. */
export async function measureHighlightVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const img = document.querySelector<HTMLImageElement>('img#cursorImg-1');
    if (!img) {
      return false;
    }
    const rect = img.getBoundingClientRect();
    return getComputedStyle(img).display !== 'none' && rect.width > 0 && rect.height > 0;
  });
}

/** The feedback badge in the header ("Waiting for notes…", "Wrong note", …). */
export function feedbackBadge(page: Page): Locator {
  return page.locator('[data-state]').filter({ hasText: /notes|Correct|Wrong|complete/ });
}

/** Play a sequence of single notes, letting the app settle between presses. */
export async function playSequence(page: Page, notes: number[]): Promise<void> {
  for (const note of notes) {
    await playNote(page, note);
    await page.waitForTimeout(30);
  }
}

/** Number of SVG elements carrying the given inline fill colour. */
export async function countFill(page: Page, color: string): Promise<number> {
  return page.evaluate((c) => {
    let count = 0;
    for (const el of document.querySelectorAll<SVGElement>('svg [style*="fill"]')) {
      if (el.style.fill === c) {
        count++;
      }
    }
    return count;
  }, color);
}

/** Wait until the cursor has advanced past a previously captured x position. */
export async function expectCursorAdvanced(page: Page, from: number): Promise<number> {
  await expect.poll(() => cursorX(page)).toBeGreaterThan(from);
  return cursorX(page);
}

/** Open the toolbar's advance menu (mode / granularity / skip / clear marks). */
export async function openAdvanceMenu(page: Page): Promise<void> {
  const menu = page.locator('details', { has: page.locator('div[aria-label="Play mode"]') });
  if (!(await menu.evaluate((el: HTMLDetailsElement) => el.open))) {
    await menu.locator('summary').click();
  }
}

/** Close any open toolbar menus so they don't cover the sheet. */
export async function closeMenus(page: Page): Promise<void> {
  await page.evaluate(() => {
    document
      .querySelectorAll<HTMLDetailsElement>('details[open]')
      .forEach((details) => (details.open = false));
  });
}

/** Switch the play mode via the toolbar menu. */
export async function setPlayMode(page: Page, mode: 'Wait' | 'Flow'): Promise<void> {
  await openAdvanceMenu(page);
  await page.getByRole('button', { name: mode, exact: true }).click();
  await closeMenus(page);
}

/** Switch the cursor advance granularity via the toolbar menu. */
export async function setGranularity(page: Page, mode: 'Note' | 'Beat' | 'Measure'): Promise<void> {
  await openAdvanceMenu(page);
  await page
    .locator('div[aria-label="Cursor advance mode"]')
    .getByRole('button', { name: mode, exact: true })
    .click();
  await closeMenus(page);
}

/** Set the skip multiplier via the toolbar menu. */
export async function setSkip(page: Page, value: number): Promise<void> {
  await openAdvanceMenu(page);
  await page.getByLabel('Skip').fill(String(value));
  await closeMenus(page);
}

/** Scroll offset of the score area (the auto-scroll viewport). */
export async function scoreScrollTop(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelector('main')?.scrollTop ?? -1);
}

/** Wait until the score area's smooth scroll animation has finished. */
export async function waitForScrollSettle(page: Page): Promise<void> {
  let previous = await scoreScrollTop(page);
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(150);
    const current = await scoreScrollTop(page);
    if (current === previous) {
      return;
    }
    previous = current;
  }
  throw new Error('score scroll did not settle');
}

/** Whether the note cursor is vertically inside the score area's viewport. */
export async function cursorInView(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    const img =
      document.querySelector('img#cursorImg-0') ?? document.querySelector('img[id^="cursorImg"]');
    if (!main || !img) {
      return false;
    }
    const viewport = main.getBoundingClientRect();
    const cursor = img.getBoundingClientRect();
    return cursor.top >= viewport.top && cursor.bottom <= viewport.bottom;
  });
}

/** The "Clear marks" button inside the (open) advance menu. */
export function clearMarksButton(page: Page): Locator {
  return page.getByRole('button', { name: /Clear marks/ });
}
