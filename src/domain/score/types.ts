/** How the cursor advances through the score. */
export type AdvanceMode = 'note' | 'beat' | 'measure';

/** How input drives the cursor: wait for a correct match, or always advance ("flow"). */
export type PlayMode = 'wait' | 'flow';

/** Visual feedback state for the current cursor position. */
export type StepFeedback = 'neutral' | 'correct' | 'wrong';
