/**
 * Grading engine.
 *
 * Pure functions only — no React, no storage, no clock. Everything that decides
 * whether an answer is right lives here so it can be tested exhaustively.
 */
import type { Question } from '../types/question';
import type { Attempt, AttemptSummary, QuestionResponse } from '../types/attempt';

/**
 * Result of grading one question.
 *
 * A discriminated union rather than a bag of optional fields: callers cannot
 * read `correct` without first proving `gradable`, which is what keeps exam
 * mode from accidentally leaking correctness for an unkeyed question.
 */
export type GradeResult =
  | {
      gradable: false;
      reason: 'no-answer-key';
      selected: string[];
    }
  | {
      gradable: true;
      correct: boolean;
      selected: string[];
      expected: string[];
    };

/**
 * Comparison-only label normalization.
 *
 * Source labels keep their exact original form everywhere they are displayed;
 * this collapses just the incidental differences ("b", " B ", "B.") that make
 * an otherwise-correct answer key fail to match.
 */
export function normalizeLabel(label: string): string {
  return label.trim().replace(/[.)\]]+$/, '').toUpperCase();
}

function toSet(labels: readonly string[]): Set<string> {
  const set = new Set<string>();
  labels.forEach((label) => {
    const normalized = normalizeLabel(label);
    if (normalized !== '') set.add(normalized);
  });
  return set;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

export function hasAnswerKey(question: Question): boolean {
  return Array.isArray(question.correctAnswer) && question.correctAnswer.length > 0;
}

/**
 * Grade a single question.
 *
 * Single- and multiple-select share the same rule: the set of selected labels
 * must exactly equal the answer-key set. Order never matters; a partial
 * multiple-select match is never correct.
 */
export function gradeQuestion(
  question: Question,
  selectedAnswers: readonly string[],
): GradeResult {
  const selected = [...selectedAnswers];

  if (!hasAnswerKey(question)) {
    return { gradable: false, reason: 'no-answer-key', selected };
  }

  const expected = question.correctAnswer as string[];
  const correct = sameSet(toSet(selected), toSet(expected));

  return { gradable: true, correct, selected, expected: [...expected] };
}

/**
 * How many options a question expects the candidate to select.
 * Single-select is always 1; multiple-select uses `selectCount` when present,
 * otherwise the size of the answer key, otherwise unknown (`undefined`).
 */
export function requiredSelectionCount(question: Question): number | undefined {
  if (question.questionType === 'single') return 1;
  if (typeof question.selectCount === 'number' && question.selectCount > 0) {
    return question.selectCount;
  }
  if (question.correctAnswer && question.correctAnswer.length > 0) {
    return question.correctAnswer.length;
  }
  return undefined;
}

/** True once the candidate has picked as many options as the question asks for. */
export function selectionIsComplete(
  question: Question,
  selectedAnswers: readonly string[],
): boolean {
  const required = requiredSelectionCount(question);
  if (required === undefined) return selectedAnswers.length > 0;
  return selectedAnswers.length === required;
}

/** Is the answer-key option `label` part of the correct answer? */
export function isCorrectOption(question: Question, label: string): boolean {
  if (!hasAnswerKey(question)) return false;
  return toSet(question.correctAnswer as string[]).has(normalizeLabel(label));
}

/* ------------------------------------------------------------------ */
/* Attempt-level grading                                               */
/* ------------------------------------------------------------------ */

/**
 * Grade every answered question in an attempt and return updated responses.
 *
 * Used when an exam-mode attempt is submitted. Unanswered questions are left
 * untouched — an unanswered question is reported as unanswered, not as wrong.
 * The input attempt is not mutated.
 */
export function gradeAttempt(
  attempt: Attempt,
  questions: ReadonlyMap<string, Question>,
  gradedAt: string,
): Record<string, QuestionResponse> {
  const next: Record<string, QuestionResponse> = {};

  attempt.questionOrder.forEach((questionId) => {
    const response = attempt.responses[questionId];
    if (!response) return;
    const question = questions.get(questionId);
    if (!question) {
      next[questionId] = response;
      return;
    }
    if (response.selectedAnswers.length === 0) {
      next[questionId] = response;
      return;
    }

    const result = gradeQuestion(question, response.selectedAnswers);
    if (!result.gradable) {
      next[questionId] = { ...response, status: 'answered', ungradable: true, gradedAt };
      return;
    }
    next[questionId] = {
      ...response,
      status: result.correct ? 'correct' : 'incorrect',
      ungradable: false,
      gradedAt,
    };
  });

  return next;
}

/** Counts used by the finish dialog, the review header and attempt history. */
export function summarizeAttempt(
  attempt: Attempt,
  questions: ReadonlyMap<string, Question>,
): AttemptSummary {
  let answered = 0;
  let marked = 0;
  let correct = 0;
  let incorrect = 0;
  let ungradable = 0;

  attempt.questionOrder.forEach((questionId) => {
    const response = attempt.responses[questionId];
    if (!response) return;
    if (response.marked) marked += 1;
    if (response.selectedAnswers.length === 0) return;
    answered += 1;

    const question = questions.get(questionId);
    if (!question || !hasAnswerKey(question)) {
      ungradable += 1;
      return;
    }
    if (response.status === 'correct') correct += 1;
    else if (response.status === 'incorrect') incorrect += 1;
  });

  const total = attempt.questionOrder.length;
  const graded = correct + incorrect;

  return {
    total,
    answered,
    unanswered: total - answered,
    marked,
    correct,
    incorrect,
    ungradable,
    percentage: graded > 0 ? Math.round((correct / graded) * 1000) / 10 : null,
  };
}

/**
 * Score denominator that counts unanswered-but-keyed questions as wrong.
 * Reported alongside the "of graded" percentage on the review screen.
 */
export function scoreOverBank(
  attempt: Attempt,
  questions: ReadonlyMap<string, Question>,
): { correct: number; keyed: number; percentage: number | null } {
  let keyed = 0;
  let correct = 0;
  attempt.questionOrder.forEach((questionId) => {
    const question = questions.get(questionId);
    if (!question || !hasAnswerKey(question)) return;
    keyed += 1;
    if (attempt.responses[questionId]?.status === 'correct') correct += 1;
  });
  return {
    correct,
    keyed,
    percentage: keyed > 0 ? Math.round((correct / keyed) * 1000) / 10 : null,
  };
}
