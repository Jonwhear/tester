/**
 * Attempt / session model.
 *
 * Attempt state is stored completely separately from question-bank content:
 * a bank is immutable reference data, an attempt is mutable user progress.
 * Nothing in here ever writes back into a `QuestionBank`.
 */

export const CURRENT_ATTEMPT_SCHEMA_VERSION = 1;
export const MIN_SUPPORTED_ATTEMPT_SCHEMA_VERSION = 1;

export type TestingMode = 'exam' | 'tutor';

/**
 * Raw per-question state. `correct` / `incorrect` are only ever written once a
 * question has actually been graded (tutor mode immediately, exam mode on
 * submission).
 */
export type ResponseStatus =
  | 'unseen'
  | 'seen'
  | 'answered'
  | 'correct'
  | 'incorrect';

export interface QuestionResponse {
  selectedAnswers: string[];
  status: ResponseStatus;
  marked: boolean;
  notes?: string;
  firstViewedAt?: string;
  answeredAt?: string;
  gradedAt?: string;
  /** Set when a question was answered but has no answer key to grade against. */
  ungradable?: boolean;
  /**
   * Option labels the candidate has struck through with the per-option
   * cross-out control. Purely an elimination aid: struck options can still be
   * selected and never affect grading.
   */
  crossedOut?: string[];
}

export function emptyResponse(): QuestionResponse {
  return { selectedAnswers: [], status: 'unseen', marked: false };
}

/** Attempt header — everything except the per-question responses. */
export interface AttemptMeta {
  schemaVersion: number;
  attemptId: string;
  bankId: string;
  bankVersion: string;
  /** Checksum of the bank at attempt creation, for stricter compatibility checks. */
  bankChecksum?: string;
  bankTitle: string;

  startedAt: string;
  updatedAt: string;
  completedAt?: string;

  mode: TestingMode;

  /** Question ids in attempt order. May be a subset of the bank. */
  questionOrder: string[];

  currentQuestionId: string;
}

/** Attempt header + responses. This is the in-memory / exported shape. */
export interface Attempt extends AttemptMeta {
  responses: Record<string, QuestionResponse>;
}

export interface AttemptSummary {
  total: number;
  answered: number;
  unanswered: number;
  marked: number;
  correct: number;
  incorrect: number;
  /** Answered but no answer key available. */
  ungradable: number;
  /** Percentage over gradable questions, or null when nothing is gradable. */
  percentage: number | null;
}
