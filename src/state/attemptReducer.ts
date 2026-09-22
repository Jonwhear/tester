/**
 * Pure attempt state transitions.
 *
 * Every mutation of an attempt goes through `applyAction`. It returns the next
 * attempt plus which records actually changed, so the persistence layer can
 * write only those instead of rewriting the whole attempt on every keystroke.
 */
import type { Attempt, QuestionResponse, TestingMode } from '../types/attempt';
import { emptyResponse } from '../types/attempt';
import type { Question } from '../types/question';
import {
  gradeAttempt,
  gradeQuestion,
  requiredSelectionCount,
  selectionIsComplete,
} from '../grading/grade';

export type AttemptAction =
  | { type: 'view'; questionId: string }
  | { type: 'navigate'; questionId: string }
  | { type: 'navigateBy'; delta: number }
  | { type: 'selectOption'; questionId: string; label: string }
  | { type: 'clearSelection'; questionId: string }
  | { type: 'checkAnswer'; questionId: string }
  | { type: 'toggleMark'; questionId: string; marked?: boolean }
  | { type: 'setNotes'; questionId: string; notes: string }
  | { type: 'toggleCrossOut'; questionId: string; label: string }
  | { type: 'setMode'; mode: TestingMode }
  | { type: 'complete' }
  | { type: 'reopen' };

export interface AttemptMutation {
  attempt: Attempt;
  /** Question ids whose response record changed. */
  changedQuestions: string[];
  /** Whether the attempt header changed (current question, mode, completion). */
  metaChanged: boolean;
}

export interface ReducerContext {
  questions: ReadonlyMap<string, Question>;
  now: string;
}

function unchanged(attempt: Attempt): AttemptMutation {
  return { attempt, changedQuestions: [], metaChanged: false };
}

function responseFor(attempt: Attempt, questionId: string): QuestionResponse {
  return attempt.responses[questionId] ?? emptyResponse();
}

/** True once a tutor-mode question has been graded and must stay locked. */
export function isLocked(attempt: Attempt, questionId: string): boolean {
  if (attempt.completedAt) return true;
  if (attempt.mode !== 'tutor') return false;
  const response = attempt.responses[questionId];
  if (!response) return false;
  /*
   * Tutor mode locks a question once its result has been revealed, so an answer
   * cannot be changed after seeing whether it was right.
   *
   * A question with no answer key reveals nothing, so there is nothing to
   * protect and it stays editable. It also means that adding a key to the bank
   * later is not defeated by answers that were locked while the key was absent.
   */
  return response.status === 'correct' || response.status === 'incorrect';
}

function withResponse(
  attempt: Attempt,
  questionId: string,
  response: QuestionResponse,
  now: string,
): AttemptMutation {
  return {
    attempt: {
      ...attempt,
      updatedAt: now,
      responses: { ...attempt.responses, [questionId]: response },
    },
    changedQuestions: [questionId],
    metaChanged: true,
  };
}

/** Apply tutor-mode grading to a response that has just been submitted. */
function gradeResponse(
  question: Question,
  response: QuestionResponse,
  now: string,
): QuestionResponse {
  const result = gradeQuestion(question, response.selectedAnswers);
  if (!result.gradable) {
    return { ...response, status: 'answered', ungradable: true, gradedAt: now };
  }
  return {
    ...response,
    status: result.correct ? 'correct' : 'incorrect',
    ungradable: false,
    gradedAt: now,
  };
}

export function applyAction(
  attempt: Attempt,
  action: AttemptAction,
  ctx: ReducerContext,
): AttemptMutation {
  const { now, questions } = ctx;

  switch (action.type) {
    case 'view': {
      const existing = responseFor(attempt, action.questionId);
      if (existing.status !== 'unseen') return unchanged(attempt);
      return withResponse(
        attempt,
        action.questionId,
        { ...existing, status: 'seen', firstViewedAt: existing.firstViewedAt ?? now },
        now,
      );
    }

    case 'navigate': {
      if (!attempt.questionOrder.includes(action.questionId)) return unchanged(attempt);
      if (attempt.currentQuestionId === action.questionId) return unchanged(attempt);
      return {
        attempt: { ...attempt, currentQuestionId: action.questionId, updatedAt: now },
        changedQuestions: [],
        metaChanged: true,
      };
    }

    case 'navigateBy': {
      const index = attempt.questionOrder.indexOf(attempt.currentQuestionId);
      if (index < 0) return unchanged(attempt);
      const nextIndex = index + action.delta;
      // Boundaries clamp: first/last never wrap and never end the attempt.
      if (nextIndex < 0 || nextIndex >= attempt.questionOrder.length) return unchanged(attempt);
      const nextId = attempt.questionOrder[nextIndex] as string;
      return {
        attempt: { ...attempt, currentQuestionId: nextId, updatedAt: now },
        changedQuestions: [],
        metaChanged: true,
      };
    }

    case 'selectOption': {
      const question = questions.get(action.questionId);
      if (!question) return unchanged(attempt);
      if (isLocked(attempt, action.questionId)) return unchanged(attempt);

      const existing = responseFor(attempt, action.questionId);
      let selected: string[];

      if (question.questionType === 'single') {
        if (existing.selectedAnswers[0] === action.label) return unchanged(attempt);
        selected = [action.label];
      } else {
        const already = existing.selectedAnswers.includes(action.label);
        if (already) {
          selected = existing.selectedAnswers.filter((l) => l !== action.label);
        } else {
          const limit = requiredSelectionCount(question);
          if (limit !== undefined && existing.selectedAnswers.length >= limit) {
            // At the limit: the candidate must deselect before choosing another.
            return unchanged(attempt);
          }
          // Preserve source option order rather than click order.
          const order = question.options.map((o) => o.label);
          selected = [...existing.selectedAnswers, action.label].sort(
            (a, b) => order.indexOf(a) - order.indexOf(b),
          );
        }
      }

      let next: QuestionResponse = {
        ...existing,
        selectedAnswers: selected,
        status: selected.length > 0 ? 'answered' : existing.firstViewedAt ? 'seen' : 'unseen',
        answeredAt: selected.length > 0 ? now : undefined,
        gradedAt: undefined,
        ungradable: undefined,
        firstViewedAt: existing.firstViewedAt ?? now,
      };

      // Tutor mode grades a single-select immediately; multiple-select waits
      // for the explicit Check Answer control so the candidate can revise.
      if (
        attempt.mode === 'tutor' &&
        question.questionType === 'single' &&
        selected.length > 0
      ) {
        next = gradeResponse(question, next, now);
      }

      return withResponse(attempt, action.questionId, next, now);
    }

    case 'clearSelection': {
      if (isLocked(attempt, action.questionId)) return unchanged(attempt);
      const existing = responseFor(attempt, action.questionId);
      if (existing.selectedAnswers.length === 0) return unchanged(attempt);
      return withResponse(
        attempt,
        action.questionId,
        {
          ...existing,
          selectedAnswers: [],
          status: 'seen',
          answeredAt: undefined,
          gradedAt: undefined,
          ungradable: undefined,
        },
        now,
      );
    }

    case 'checkAnswer': {
      const question = questions.get(action.questionId);
      if (!question) return unchanged(attempt);
      if (attempt.mode !== 'tutor' || attempt.completedAt) return unchanged(attempt);
      if (isLocked(attempt, action.questionId)) return unchanged(attempt);
      const existing = responseFor(attempt, action.questionId);
      if (!selectionIsComplete(question, existing.selectedAnswers)) return unchanged(attempt);
      return withResponse(attempt, action.questionId, gradeResponse(question, existing, now), now);
    }

    case 'toggleMark': {
      const existing = responseFor(attempt, action.questionId);
      const marked = action.marked ?? !existing.marked;
      if (marked === existing.marked) return unchanged(attempt);
      return withResponse(attempt, action.questionId, { ...existing, marked }, now);
    }

    case 'setNotes': {
      const existing = responseFor(attempt, action.questionId);
      if ((existing.notes ?? '') === action.notes) return unchanged(attempt);
      const next: QuestionResponse = { ...existing };
      if (action.notes === '') delete next.notes;
      else next.notes = action.notes;
      return withResponse(attempt, action.questionId, next, now);
    }

    case 'toggleCrossOut': {
      const existing = responseFor(attempt, action.questionId);
      const current = existing.crossedOut ?? [];
      const crossedOut = current.includes(action.label)
        ? current.filter((l) => l !== action.label)
        : [...current, action.label];
      return withResponse(attempt, action.questionId, { ...existing, crossedOut }, now);
    }

    case 'setMode': {
      if (attempt.mode === action.mode || attempt.completedAt) return unchanged(attempt);
      return {
        attempt: { ...attempt, mode: action.mode, updatedAt: now },
        changedQuestions: [],
        metaChanged: true,
      };
    }

    case 'complete': {
      if (attempt.completedAt) return unchanged(attempt);
      const graded = gradeAttempt(attempt, questions, now);
      const responses = { ...attempt.responses, ...graded };
      return {
        attempt: { ...attempt, responses, completedAt: now, updatedAt: now },
        changedQuestions: Object.keys(graded),
        metaChanged: true,
      };
    }

    case 'reopen': {
      if (!attempt.completedAt) return unchanged(attempt);
      const { completedAt: _completedAt, ...rest } = attempt;
      return {
        attempt: { ...rest, updatedAt: now },
        changedQuestions: [],
        metaChanged: true,
      };
    }

    default:
      return unchanged(attempt);
  }
}
