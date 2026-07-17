# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A MIDI-driven, browser-only sight-reading trainer: load a MusicXML score, connect a MIDI
keyboard, and a cursor advances as the correct notes are played. Target platform is
**Android Chrome**; works in any Chromium browser with Web MIDI. No backend.

`README.md` is the authoritative contributor guide (data flow, contracts, "where does this
change go"). Read it before non-trivial work — this file only adds the operational details
and constraints that aren't obvious from the source.

## Commands

```bash
npm run dev            # Vite dev server over HTTPS (see below)
npm run build          # tsc --noEmit && vite build
npm test               # Vitest unit tests, single run
npm run test:watch     # Vitest watch mode
npm run test:e2e       # Playwright e2e tests (starts the dev server itself)
npm run typecheck      # tsc --noEmit (app)
npm run typecheck:e2e  # tsc --noEmit -p e2e
npm run lint           # eslint .
```

Run a single test file or by name:

```bash
npx vitest run src/domain/matching/MatchingEngine.test.ts
npx vitest run -t "advances on chord"
npx playwright test e2e/flow-mode.spec.ts
npx playwright test -g "leaves a mark"
```

Playwright needs its browser once per machine: `npx playwright install chromium`.

## Key constraints (non-obvious)

- **Dev server is HTTPS with a self-signed cert** (`@vitejs/plugin-basic-ssl`). Web MIDI and
  Web Bluetooth require a *secure context*. `localhost` is secure; testing on a real phone
  needs the `https://<LAN-IP>:5173/` URL with the cert warning accepted. `server.host: true`
  exposes it on the LAN.
- **Only `domain/` is unit-tested.** It is framework-free (no React, DOM, MIDI APIs, or the
  notation engine) precisely so it can be. Renderer and MIDI adapters depend on browser APIs
  — do not add jsdom tests for them. Vitest runs in `jsdom` and only picks up
  `src/**/*.{test,spec}.{ts,tsx}`.
- **Integrated behavior is covered by the Playwright suite in `e2e/`.** It fakes only the
  Web MIDI API (`installFakeMidi` in `e2e/helpers.ts` injects a fake input device before page
  load), then sends raw MIDI bytes through the real adapter → parser → session → renderer
  pipeline and asserts on the rendered sheet (cursor x-position, inline SVG fill colors for
  feedback/marks, toolbar state). New behavior that reaches the sheet or toolbar belongs
  there; reuse the helpers. Real-hardware quirks (Bluetooth pairing, latency feel) still
  need a manual device pass.
- **Web MIDI is requested without SysEx** to keep the permission scope minimal — preserve
  this when touching `WebMidiInputAdapter`.
- TypeScript is strict with `noUnusedLocals`/`noUnusedParameters`; prefix intentionally
  unused vars/args with `_` (ESLint is configured to allow that pattern).
- Prettier: single quotes, semicolons, trailing commas everywhere, 100-col width, 2 spaces.
- **Always verify UI changes visually with screenshots.** Whenever you modify anything the
  user can see — components, CSS modules, renderer feedback/marks/cursor behavior — do not
  stop at passing tests: drive the app headless with Playwright, take screenshots of the
  affected states, and actually Read/view the images to confirm the result looks right
  (layout, colors, nothing clipped or overlapping). Reuse the fakes and helpers in
  `e2e/helpers.ts` (`installFakeMidi`, `setupApp`, …) in a throwaway script against
  `npm run dev` (HTTPS — ignore certificate errors), or add a screenshot step to a spec.

## Architecture

The design principle is **thin interfaces with swappable implementations**. Three
collaborators sit behind small contracts, and one hook wires them together; UI and pure
logic never import a concrete technology (Web MIDI, OSMD, VexFlow).

- `domain/` — pure logic: `MatchingEngine` (when a position is correctly played),
  MIDI/BLE-MIDI byte parsing, note names, shared enums (`AdvanceMode`, `StepFeedback`).
- `input/` — MIDI transport behind `IMidiInput`; adapters (`WebMidiInputAdapter`,
  `WebBluetoothMidiAdapter`, both extending `AbstractMidiInput`) normalize raw data into
  `MidiNoteEvent`. `MidiInputFactory` picks the adapter for a chosen `MidiTransport`.
- `rendering/` — notation engine behind `IScoreRenderer`; `OsmdScoreRenderer` is the only
  OSMD/VexFlow-aware file (load, cursor stepping, feedback coloring, auto-scroll).
- `session/useSightReadingSession.ts` — **the single orchestrator** that owns input + engine
  + renderer and all app state, exposing plain state + callbacks to the UI.
- `components/` — thin, presentational React (CSS Modules); render the hook's state and call
  its callbacks. Nothing else.

Note flow: device → `IMidiInput` adapter → hook → `MatchingEngine`; on completion the hook
tells the renderer to advance the cursor; wrong notes go to the renderer as feedback.

### Where changes go (see README "Adding a feature" for detail)

- New MIDI transport → new `IMidiInput` impl + `MidiTransport` union + factory + panel toggle.
- New notation engine → new `IScoreRenderer` impl, constructed in the session hook; no UI or
  domain changes.
- New cursor granularity → extend `AdvanceMode` in `domain/score/types.ts`, handle it in
  `OsmdScoreRenderer`, surface it in the toolbar.
- Change matching rules (octave, timing tolerance) → `MatchingEngine` + its tests only.
- New app state → add to `useSightReadingSession`, render in a component.
