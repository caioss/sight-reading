import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MidiNoteEvent } from '../domain/midi/MidiNoteEvent';
import { midiToNoteName } from '../domain/midi/noteNames';
import { MatchingEngine } from '../domain/matching/MatchingEngine';
import { GESTURE_WINDOW_MS, GestureMatcher } from '../domain/matching/GestureMatcher';
import type { AdvanceMode, PlayMode, StepFeedback } from '../domain/score/types';
import { generateMusicXml } from '../domain/generation/generateMusicXml';
import { generateScaleMusicXml, type ScaleConfig } from '../domain/generation/scale';
import type { GeneratorConfig } from '../domain/generation/types';
import { createMidiInput, isTransportSupported } from '../input/MidiInputFactory';
import type { IMidiInput, MidiDeviceInfo, MidiTransport } from '../input/IMidiInput';
import { EMPTY_STEP, type IScoreRenderer, type ScoreStepInfo } from '../rendering/IScoreRenderer';
import { OsmdScoreRenderer } from '../rendering/OsmdScoreRenderer';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';

export interface SightReadingSession {
  // Score
  scoreContainerRef: React.RefObject<HTMLDivElement>;
  isScoreLoaded: boolean;
  loadFile: (file: File) => Promise<void>;
  generateScore: (config: GeneratorConfig) => Promise<void>;
  generateScale: (config: ScaleConfig) => Promise<void>;
  scoreError: string | null;

  // Cursor & matching
  currentStep: ScoreStepInfo;
  feedback: StepFeedback;
  isComplete: boolean;
  advanceMode: AdvanceMode;
  setAdvanceMode: (mode: AdvanceMode) => void;
  skip: number;
  setSkip: (value: number) => void;
  playMode: PlayMode;
  setPlayMode: (mode: PlayMode) => void;
  errorMarkCount: number;
  clearErrorMarks: () => void;
  goNext: () => void;
  goPrevious: () => void;
  resetCursor: () => void;
  wrongNoteName: string | null;
  lastPlayedNoteName: string | null;

  // MIDI
  transport: MidiTransport;
  setTransport: (transport: MidiTransport) => void;
  midiSupported: Record<MidiTransport, boolean>;
  devices: MidiDeviceInfo[];
  selectedDeviceId: string | null;
  setSelectedDeviceId: (id: string | null) => void;
  refreshDevices: () => Promise<void>;
  connect: (deviceId?: string) => Promise<void>;
  disconnect: () => void;
  connectionState: ConnectionState;
  connectedDeviceId: string | null;
  midiError: string | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Orchestrates the whole practice session: it owns the score renderer, the MIDI
 * input adapter and the matching engine, and exposes plain state + callbacks for
 * the UI. All three collaborators are accessed through their interfaces, so the
 * hook is unaffected if any single implementation is replaced.
 */
export function useSightReadingSession(): SightReadingSession {
  const rendererRef = useRef<IScoreRenderer>(new OsmdScoreRenderer());
  const engineRef = useRef(new MatchingEngine());
  const gestureRef = useRef(new GestureMatcher());
  const inputRef = useRef<IMidiInput | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const advanceModeRef = useRef<AdvanceMode>('note');
  const skipRef = useRef(1);
  const playModeRef = useRef<PlayMode>('wait');
  const gestureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentStepRef = useRef<ScoreStepInfo>(EMPTY_STEP);
  const noteHandlerRef = useRef<(event: MidiNoteEvent) => void>(() => undefined);

  const [isScoreLoaded, setScoreLoaded] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<ScoreStepInfo>(EMPTY_STEP);
  const [feedback, setFeedback] = useState<StepFeedback>('neutral');
  const [isComplete, setIsComplete] = useState(false);
  const [advanceMode, setAdvanceModeState] = useState<AdvanceMode>('note');
  const [skip, setSkipState] = useState(1);
  const [playMode, setPlayModeState] = useState<PlayMode>('wait');
  const [errorMarkCount, setErrorMarkCount] = useState(0);
  const [wrongNote, setWrongNote] = useState<number | null>(null);
  const [lastPlayedNote, setLastPlayedNote] = useState<number | null>(null);

  const [transport, setTransportState] = useState<MidiTransport>('webmidi');
  const [devices, setDevices] = useState<MidiDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [connectedDeviceId, setConnectedDeviceId] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [midiError, setMidiError] = useState<string | null>(null);

  const midiSupported = useMemo(
    () => ({
      webmidi: isTransportSupported('webmidi'),
      bluetooth: isTransportSupported('bluetooth'),
    }),
    [],
  );

  const cancelGestureTimer = useCallback(() => {
    if (gestureTimerRef.current !== null) {
      clearTimeout(gestureTimerRef.current);
      gestureTimerRef.current = null;
    }
  }, []);

  const syncMarkCount = useCallback(() => {
    setErrorMarkCount(rendererRef.current.errorMarkCount);
  }, []);

  const applyStep = useCallback(
    (step: ScoreStepInfo) => {
      cancelGestureTimer();
      gestureRef.current.setExpected(step.expectedMidiNotes);
      currentStepRef.current = step;
      setCurrentStep(step);
      engineRef.current.setExpected(step.expectedMidiNotes);
      rendererRef.current.setFeedback('neutral');
      setFeedback('neutral');
      setWrongNote(null);
      setIsComplete(step.atEnd);
      syncMarkCount();
    },
    [cancelGestureTimer, syncMarkCount],
  );

  const advanceAuto = useCallback(() => {
    // Advance by the selected granularity and skip count when the current step
    // is played correctly (skip 1 in note mode keeps the classic note-by-note flow).
    applyStep(rendererRef.current.next(advanceModeRef.current, skipRef.current));
  }, [applyStep]);

  /**
   * Judge and discard the pending flow-mode gesture: a correct gesture clears
   * any old mark at the position, an incorrect one marks it; either way the
   * cursor advances. The wrong-note badge is set after advancing (applyStep
   * resets it), so the indicator reports the error while the sheet shows the
   * persistent mark at the judged position rather than transient red.
   */
  const closeGestureNow = useCallback(() => {
    cancelGestureTimer();
    if (!gestureRef.current.isGestureOpen) {
      return;
    }
    const judgment = gestureRef.current.close();
    if (judgment.correct) {
      rendererRef.current.clearErrorMarkAtCursor();
      advanceAuto();
    } else {
      rendererRef.current.markErrorAtCursor();
      const badgeNote = judgment.extra[0] ?? null;
      advanceAuto();
      setFeedback('wrong');
      setWrongNote(badgeNote);
    }
  }, [advanceAuto, cancelGestureTimer]);

  // Keep the note handler fresh on every render without re-subscribing.
  noteHandlerRef.current = (event: MidiNoteEvent) => {
    if (event.type !== 'noteon') {
      engineRef.current.releaseNote(event.note);
      return;
    }
    setLastPlayedNote(event.note);

    if (playModeRef.current === 'flow') {
      // A batched/late event past the window closes the previous gesture first;
      // closing advances the cursor, so this note is judged at the new position.
      if (gestureRef.current.isGestureOpen && gestureRef.current.isExpired(event.timestamp)) {
        closeGestureNow();
      }
      if (currentStepRef.current.atEnd) {
        return;
      }
      if (gestureRef.current.press(event.note, event.timestamp) === 'complete') {
        // Fast path: exact match — no need to wait for the window to close.
        cancelGestureTimer();
        gestureRef.current.close();
        rendererRef.current.clearErrorMarkAtCursor();
        advanceAuto();
      } else {
        // The timer judges the gesture when no further input arrives; it is
        // re-armed on every press so the window is debounced from the last
        // press (a rolled/held chord stays in one gesture). The event-timestamp
        // expiry check above handles batched delivery precisely.
        cancelGestureTimer();
        gestureTimerRef.current = setTimeout(closeGestureNow, GESTURE_WINDOW_MS + 10);
      }
      return;
    }

    if (currentStepRef.current.atEnd) {
      return;
    }
    const result = engineRef.current.pressNote(event.note);
    if (result.complete) {
      // A correct replay of a previously marked position clears its mark.
      rendererRef.current.clearErrorMarkAtCursor();
      advanceAuto();
    } else if (result.wrong) {
      rendererRef.current.setFeedback('wrong');
      setFeedback('wrong');
      setWrongNote(event.note);
    } else {
      rendererRef.current.setFeedback('neutral');
      setFeedback('neutral');
      setWrongNote(null);
    }
  };

  // Mount the renderer to its container once.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const renderer = rendererRef.current;
    renderer.mount(element);
    return () => {
      cancelGestureTimer();
      renderer.dispose();
    };
  }, [cancelGestureTimer]);

  // (Re)create the MIDI input adapter whenever the transport changes.
  useEffect(() => {
    const input = createMidiInput(transport);
    inputRef.current = input;
    const offNote = input.onNote((event) => noteHandlerRef.current(event));
    const offConnection = input.onConnectionChange((deviceId) => {
      setConnectedDeviceId(deviceId);
      setConnectionState(deviceId ? 'connected' : 'disconnected');
    });

    setDevices([]);
    setSelectedDeviceId(null);
    setConnectedDeviceId(null);
    setConnectionState('disconnected');
    setMidiError(null);

    return () => {
      offNote();
      offConnection();
      input.disconnect();
      inputRef.current = null;
    };
  }, [transport]);

  const finishLoad = useCallback(
    async (content: string | ArrayBuffer) => {
      await rendererRef.current.load(content);
      rendererRef.current.setAdvanceMode(advanceModeRef.current);
      applyStep(rendererRef.current.getCurrentStep());
      setScoreLoaded(true);
    },
    [applyStep],
  );

  const loadFile = useCallback(
    async (file: File) => {
      setScoreError(null);
      try {
        const isCompressed = /\.mxl$/i.test(file.name);
        const content = isCompressed ? await file.arrayBuffer() : await file.text();
        await finishLoad(content);
      } catch (error) {
        setScoreLoaded(false);
        setScoreError(errorMessage(error));
      }
    },
    [finishLoad],
  );

  const generateScore = useCallback(
    async (config: GeneratorConfig) => {
      setScoreError(null);
      try {
        await finishLoad(generateMusicXml(config));
      } catch (error) {
        setScoreLoaded(false);
        setScoreError(errorMessage(error));
      }
    },
    [finishLoad],
  );

  const generateScale = useCallback(
    async (config: ScaleConfig) => {
      setScoreError(null);
      try {
        await finishLoad(generateScaleMusicXml(config));
      } catch (error) {
        setScoreLoaded(false);
        setScoreError(errorMessage(error));
      }
    },
    [finishLoad],
  );

  const setAdvanceMode = useCallback((mode: AdvanceMode) => {
    advanceModeRef.current = mode;
    setAdvanceModeState(mode);
    rendererRef.current.setAdvanceMode(mode);
  }, []);

  const setSkip = useCallback((value: number) => {
    const clamped = Math.max(1, Math.floor(value) || 1);
    skipRef.current = clamped;
    setSkipState(clamped);
  }, []);

  const setPlayMode = useCallback(
    (mode: PlayMode) => {
      // Start the new mode from a clean slate: no pending gesture, no partial
      // chord progress, no stale wrong-note feedback.
      cancelGestureTimer();
      gestureRef.current.abort();
      engineRef.current.reset();
      playModeRef.current = mode;
      setPlayModeState(mode);
      rendererRef.current.setFeedback('neutral');
      setFeedback('neutral');
      setWrongNote(null);
    },
    [cancelGestureTimer],
  );

  const clearErrorMarks = useCallback(() => {
    rendererRef.current.clearAllErrorMarks();
    syncMarkCount();
  }, [syncMarkCount]);

  const goNext = useCallback(() => {
    if (!rendererRef.current.isLoaded) {
      return;
    }
    applyStep(rendererRef.current.next(advanceModeRef.current, skipRef.current));
  }, [applyStep]);

  const goPrevious = useCallback(() => {
    if (!rendererRef.current.isLoaded) {
      return;
    }
    applyStep(rendererRef.current.previous(advanceModeRef.current, skipRef.current));
  }, [applyStep]);

  const resetCursor = useCallback(() => {
    if (!rendererRef.current.isLoaded) {
      return;
    }
    applyStep(rendererRef.current.resetCursor());
  }, [applyStep]);

  const connect = useCallback(async (deviceId?: string) => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    setConnectionState('connecting');
    setMidiError(null);
    try {
      await input.connect(deviceId);
    } catch (error) {
      setConnectionState('disconnected');
      setMidiError(errorMessage(error));
    }
  }, []);

  const refreshDevices = useCallback(async () => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    setMidiError(null);
    try {
      const found = await input.listDevices();
      setDevices(found);
      if (input.transport === 'bluetooth') {
        // The pairing chooser has already returned a device: connect to it.
        const chosen = found[0];
        if (chosen) {
          setSelectedDeviceId(chosen.id);
          await connect(chosen.id);
        }
      } else {
        setSelectedDeviceId((previous) => previous ?? found[0]?.id ?? null);
      }
    } catch (error) {
      setMidiError(errorMessage(error));
    }
  }, [connect]);

  const disconnect = useCallback(() => {
    inputRef.current?.disconnect();
  }, []);

  const setTransport = useCallback((next: MidiTransport) => {
    setTransportState(next);
  }, []);

  const wrongNoteName = wrongNote === null ? null : midiToNoteName(wrongNote);
  const lastPlayedNoteName = lastPlayedNote === null ? null : midiToNoteName(lastPlayedNote);

  return {
    scoreContainerRef: containerRef,
    isScoreLoaded,
    loadFile,
    generateScore,
    generateScale,
    scoreError,

    currentStep,
    feedback,
    isComplete,
    advanceMode,
    setAdvanceMode,
    skip,
    setSkip,
    playMode,
    setPlayMode,
    errorMarkCount,
    clearErrorMarks,
    goNext,
    goPrevious,
    resetCursor,
    wrongNoteName,
    lastPlayedNoteName,

    transport,
    setTransport,
    midiSupported,
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    refreshDevices,
    connect,
    disconnect,
    connectionState,
    connectedDeviceId,
    midiError,
  };
}
