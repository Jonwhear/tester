/**
 * Deterministic display-status model.
 *
 * The single place that decides what the candidate is allowed to SEE about a
 * question's correctness. Exam mode must not leak grading before submission,
 * so every surface (rail, options, review list) derives its state from here
 * instead of reading `response.status` directly.
 */
import type { Attempt, QuestionResponse, TestingMode } from '../types/attempt';

export type DisplayStatus =
  /** Never opened. */
  | 'unseen'
  /** Opened, no answer recorded. */
  | 'seen'
  /** Answered; correctness deliberately withheld (exam mode, pre-submission). */
  | 'answered'
  /** Answered and graded correct. */
  | 'correct'
  /** Answered and graded incorrect. */
  | 'incorrect'
  /** Answered, but the bank carries no answer key for this question. */
  | 'ungradable';

export interface DisplayState {
  status: DisplayStatus;
  marked: boolean;
  /** True when correctness is knowable AND currently permitted to be shown. */
  revealed: boolean;
}

export interface RevealContext {
  mode: TestingMode;
  /** True once the attempt has been submitted (or is being reviewed). */
  completed: boolean;
}

/**
 * Whether correctness may be shown for this attempt right now.
 *
 * Tutor mode reveals as soon as a question is graded. Exam mode reveals
 * nothing at all until the attempt has been submitted.
 */
export function correctnessVisible(context: RevealContext): boolean {
  return context.mode === 'tutor' || context.completed;
}

export function displayStateFor(
  response: QuestionResponse | undefined,
  context: RevealContext,
): DisplayState {
  if (!response) return { status: 'unseen', marked: false, revealed: false };

  const marked = response.marked;
  const answered = response.selectedAnswers.length > 0;

  if (!answered) {
    return {
      status: response.status === 'unseen' ? 'unseen' : 'seen',
      marked,
      revealed: false,
    };
  }

  if (!correctnessVisible(context)) {
    return { status: 'answered', marked, revealed: false };
  }

  if (response.ungradable) return { status: 'ungradable', marked, revealed: false };
  if (response.status === 'correct') return { status: 'correct', marked, revealed: true };
  if (response.status === 'incorrect') return { status: 'incorrect', marked, revealed: true };

  // Answered but not yet graded (exam attempt reopened before submission, or a
  // tutor multiple-select still awaiting "Check Answer").
  return { status: 'answered', marked, revealed: false };
}

export function revealContextFor(attempt: Attempt): RevealContext {
  return { mode: attempt.mode, completed: Boolean(attempt.completedAt) };
}

export const DISPLAY_STATUS_LABEL: Record<DisplayStatus, string> = {
  unseen: 'Not seen',
  seen: 'Seen, unanswered',
  answered: 'Answered',
  correct: 'Correct',
  incorrect: 'Incorrect',
  ungradable: 'Answered — no answer key',
};
