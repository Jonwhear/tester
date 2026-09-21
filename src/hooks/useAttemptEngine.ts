import { useCallback, useMemo, useRef, useState } from 'react';

import type { Attempt } from '../types/attempt';
import type { Question, QuestionBank } from '../types/question';
import { indexQuestions } from '../data/normalize';
import { applyAction, isLocked, type AttemptAction } from '../state/attemptReducer';
import { saveAttemptMeta, saveResponse, saveResponses } from '../storage/repositories';
import { nowIso } from '../utils/id';

export interface AttemptEngine {
  attempt: Attempt;
  questions: ReadonlyMap<string, Question>;
  currentQuestion: Question | undefined;
  currentIndex: number;
  dispatch: (action: AttemptAction) => void;
  /** True when the current question can no longer be changed. */
  currentLocked: boolean;
  /** Last persistence failure, if any. Surfaced so saving is never silently lost. */
  saveError: string | null;
}

/**
 * Live attempt state.
 *
 * Writes are targeted: a single answer change persists exactly one response
 * record plus the attempt header, never the whole attempt. This keeps the cost
 * of answering a question independent of bank size.
 */
export function useAttemptEngine(
  initialAttempt: Attempt,
  bank: QuestionBank,
  options: { persist?: boolean } = {},
): AttemptEngine {
  const persist = options.persist !== false;
  const [attempt, setAttempt] = useState<Attempt>(initialAttempt);
  const [saveError, setSaveError] = useState<string | null>(null);
  const questions = useMemo(() => indexQuestions(bank), [bank]);

  // Held in a ref so `dispatch` stays referentially stable across renders.
  const attemptRef = useRef(attempt);
  attemptRef.current = attempt;

  const dispatch = useCallback(
    (action: AttemptAction) => {
      const current = attemptRef.current;
      const mutation = applyAction(current, action, { questions, now: nowIso() });
      if (mutation.attempt === current) return;

      attemptRef.current = mutation.attempt;
      setAttempt(mutation.attempt);

      if (!persist) return;

      const next = mutation.attempt;
      const writes: Array<Promise<void>> = [];

      if (mutation.changedQuestions.length === 1) {
        const questionId = mutation.changedQuestions[0] as string;
        const response = next.responses[questionId];
        if (response) writes.push(saveResponse(next.attemptId, questionId, response));
      } else if (mutation.changedQuestions.length > 1) {
        const subset: Attempt['responses'] = {};
        mutation.changedQuestions.forEach((questionId) => {
          const response = next.responses[questionId];
          if (response) subset[questionId] = response;
        });
        writes.push(saveResponses(next.attemptId, subset));
      }

      if (mutation.metaChanged) {
        const { responses: _responses, ...meta } = next;
        writes.push(saveAttemptMeta(meta));
      }

      Promise.all(writes)
        .then(() => setSaveError(null))
        .catch((error: unknown) =>
          setSaveError(error instanceof Error ? error.message : 'Could not save progress.'),
        );
    },
    [persist, questions],
  );

  const currentIndex = attempt.questionOrder.indexOf(attempt.currentQuestionId);
  const currentQuestion = questions.get(attempt.currentQuestionId);

  return {
    attempt,
    questions,
    currentQuestion,
    currentIndex,
    dispatch,
    currentLocked: isLocked(attempt, attempt.currentQuestionId),
    saveError,
  };
}
