import { describe, expect, it } from 'vitest';

import type { Attempt, TestingMode } from '../../types/attempt';
import type { Question, QuestionBank } from '../../types/question';
import { indexQuestions } from '../../data/normalize';
import { applyAction, isLocked, type AttemptAction } from '../attemptReducer';
import { createAttempt } from '../attemptFactory';
import { displayStateFor, revealContextFor } from '../statusModel';

const NOW = '2024-05-01T12:00:00.000Z';

const questions: Question[] = [
  {
    id: 'Q1',
    questionType: 'single',
    stem: 'one',
    options: ['A', 'B', 'C'].map((label) => ({ label, text: label })),
    correctAnswer: ['B'],
  },
  {
    id: 'Q2',
    questionType: 'single',
    stem: 'two',
    options: ['A', 'B', 'C'].map((label) => ({ label, text: label })),
    correctAnswer: ['A'],
  },
  {
    id: 'Q3',
    questionType: 'multiple',
    selectCount: 2,
    stem: 'three (Select two.)',
    options: ['A', 'B', 'C', 'D'].map((label) => ({ label, text: label })),
    correctAnswer: ['B', 'D'],
  },
  {
    id: 'Q4',
    questionType: 'single',
    stem: 'no key',
    options: ['A', 'B'].map((label) => ({ label, text: label })),
  },
];

const bank: QuestionBank = {
  schemaVersion: 1,
  bankId: 'test-bank',
  bankVersion: '1',
  title: 'Test bank',
  questions,
};

const index = indexQuestions(bank);

function start(mode: TestingMode): Attempt {
  return createAttempt(bank, { mode });
}

function run(attempt: Attempt, actions: AttemptAction[]): Attempt {
  return actions.reduce(
    (current, action) => applyAction(current, action, { questions: index, now: NOW }).attempt,
    attempt,
  );
}

describe('navigation', () => {
  it('moves forward and backward by one item', () => {
    let attempt = start('exam');
    attempt = run(attempt, [{ type: 'navigateBy', delta: 1 }]);
    expect(attempt.currentQuestionId).toBe('Q2');
    attempt = run(attempt, [{ type: 'navigateBy', delta: -1 }]);
    expect(attempt.currentQuestionId).toBe('Q1');
  });

  it('clamps at the first item instead of wrapping', () => {
    const attempt = start('exam');
    const next = run(attempt, [{ type: 'navigateBy', delta: -1 }]);
    expect(next.currentQuestionId).toBe('Q1');
    expect(next).toBe(attempt);
  });

  it('clamps at the last item and never completes the attempt', () => {
    let attempt = run(start('exam'), [{ type: 'navigate', questionId: 'Q4' }]);
    attempt = run(attempt, [{ type: 'navigateBy', delta: 1 }]);
    expect(attempt.currentQuestionId).toBe('Q4');
    expect(attempt.completedAt).toBeUndefined();
  });

  it('ignores a jump to a question outside the attempt', () => {
    const attempt = start('exam');
    expect(run(attempt, [{ type: 'navigate', questionId: 'NOT-IN-ATTEMPT' }])).toBe(attempt);
  });

  it('records a question as seen when it is viewed', () => {
    const attempt = run(start('exam'), [{ type: 'view', questionId: 'Q1' }]);
    expect(attempt.responses.Q1?.status).toBe('seen');
    expect(attempt.responses.Q1?.firstViewedAt).toBe(NOW);
  });
});

describe('exam mode', () => {
  it('records the selection without grading it', () => {
    const attempt = run(start('exam'), [
      { type: 'selectOption', questionId: 'Q1', label: 'A' },
    ]);
    const response = attempt.responses.Q1;
    expect(response?.selectedAnswers).toEqual(['A']);
    expect(response?.status).toBe('answered');
    expect(response?.gradedAt).toBeUndefined();
  });

  it('exposes no correctness through the display model before submission', () => {
    const attempt = run(start('exam'), [
      { type: 'selectOption', questionId: 'Q1', label: 'A' },
      { type: 'selectOption', questionId: 'Q2', label: 'A' },
    ]);
    const reveal = revealContextFor(attempt);
    expect(displayStateFor(attempt.responses.Q1, reveal)).toMatchObject({
      status: 'answered',
      revealed: false,
    });
    // Q2 is actually correct, and that still must not be revealed.
    expect(displayStateFor(attempt.responses.Q2, reveal)).toMatchObject({
      status: 'answered',
      revealed: false,
    });
  });

  it('allows the answer to be changed while the attempt is open', () => {
    const attempt = run(start('exam'), [
      { type: 'selectOption', questionId: 'Q1', label: 'A' },
      { type: 'selectOption', questionId: 'Q1', label: 'C' },
    ]);
    expect(attempt.responses.Q1?.selectedAnswers).toEqual(['C']);
    expect(isLocked(attempt, 'Q1')).toBe(false);
  });

  it('grades everything answered on submission and then reveals it', () => {
    let attempt = run(start('exam'), [
      { type: 'selectOption', questionId: 'Q1', label: 'A' },
      { type: 'selectOption', questionId: 'Q2', label: 'A' },
    ]);
    attempt = run(attempt, [{ type: 'complete' }]);

    expect(attempt.completedAt).toBe(NOW);
    const reveal = revealContextFor(attempt);
    expect(displayStateFor(attempt.responses.Q1, reveal)).toMatchObject({
      status: 'incorrect',
      revealed: true,
    });
    expect(displayStateFor(attempt.responses.Q2, reveal)).toMatchObject({
      status: 'correct',
      revealed: true,
    });
  });

  it('leaves unanswered questions unanswered after submission', () => {
    const attempt = run(start('exam'), [{ type: 'complete' }]);
    expect(attempt.responses.Q1?.status).toBe('unseen');
  });
});

describe('tutor mode', () => {
  it('grades a single-select immediately and reveals the result', () => {
    const attempt = run(start('tutor'), [
      { type: 'selectOption', questionId: 'Q1', label: 'B' },
    ]);
    expect(attempt.responses.Q1?.status).toBe('correct');
    expect(attempt.responses.Q1?.gradedAt).toBe(NOW);
    expect(displayStateFor(attempt.responses.Q1, revealContextFor(attempt))).toMatchObject({
      status: 'correct',
      revealed: true,
    });
  });

  it('marks a wrong single-select incorrect', () => {
    const attempt = run(start('tutor'), [
      { type: 'selectOption', questionId: 'Q1', label: 'A' },
    ]);
    expect(attempt.responses.Q1?.status).toBe('incorrect');
  });

  it('locks a graded question against further changes', () => {
    let attempt = run(start('tutor'), [{ type: 'selectOption', questionId: 'Q1', label: 'A' }]);
    expect(isLocked(attempt, 'Q1')).toBe(true);
    attempt = run(attempt, [{ type: 'selectOption', questionId: 'Q1', label: 'B' }]);
    expect(attempt.responses.Q1?.selectedAnswers).toEqual(['A']);
    expect(attempt.responses.Q1?.status).toBe('incorrect');
  });

  it('waits for Check Answer on a multiple-select question', () => {
    let attempt = run(start('tutor'), [
      { type: 'selectOption', questionId: 'Q3', label: 'B' },
      { type: 'selectOption', questionId: 'Q3', label: 'D' },
    ]);
    expect(attempt.responses.Q3?.status).toBe('answered');
    attempt = run(attempt, [{ type: 'checkAnswer', questionId: 'Q3' }]);
    expect(attempt.responses.Q3?.status).toBe('correct');
  });

  it('refuses to grade an incomplete multiple-select selection', () => {
    const attempt = run(start('tutor'), [
      { type: 'selectOption', questionId: 'Q3', label: 'B' },
      { type: 'checkAnswer', questionId: 'Q3' },
    ]);
    expect(attempt.responses.Q3?.status).toBe('answered');
  });

  it('stops selection at the required count and allows deselection', () => {
    let attempt = run(start('tutor'), [
      { type: 'selectOption', questionId: 'Q3', label: 'A' },
      { type: 'selectOption', questionId: 'Q3', label: 'B' },
      { type: 'selectOption', questionId: 'Q3', label: 'C' },
    ]);
    expect(attempt.responses.Q3?.selectedAnswers).toEqual(['A', 'B']);
    attempt = run(attempt, [{ type: 'selectOption', questionId: 'Q3', label: 'A' }]);
    expect(attempt.responses.Q3?.selectedAnswers).toEqual(['B']);
  });

  it('keeps multiple-select answers in source option order, not click order', () => {
    const attempt = run(start('tutor'), [
      { type: 'selectOption', questionId: 'Q3', label: 'D' },
      { type: 'selectOption', questionId: 'Q3', label: 'B' },
    ]);
    expect(attempt.responses.Q3?.selectedAnswers).toEqual(['B', 'D']);
  });

  it('records an unkeyed question as ungradable rather than guessing', () => {
    const attempt = run(start('tutor'), [
      { type: 'selectOption', questionId: 'Q4', label: 'A' },
    ]);
    expect(attempt.responses.Q4?.ungradable).toBe(true);
    expect(attempt.responses.Q4?.status).toBe('answered');
    expect(displayStateFor(attempt.responses.Q4, revealContextFor(attempt))).toMatchObject({
      status: 'ungradable',
      revealed: false,
    });
  });
});

describe('marks, notes and cross-outs', () => {
  it('toggles a mark and reports it through the display model', () => {
    let attempt = run(start('exam'), [{ type: 'toggleMark', questionId: 'Q1' }]);
    expect(attempt.responses.Q1?.marked).toBe(true);
    expect(displayStateFor(attempt.responses.Q1, revealContextFor(attempt)).marked).toBe(true);
    attempt = run(attempt, [{ type: 'toggleMark', questionId: 'Q1' }]);
    expect(attempt.responses.Q1?.marked).toBe(false);
  });

  it('keeps a mark when the question is answered and graded', () => {
    const attempt = run(start('tutor'), [
      { type: 'toggleMark', questionId: 'Q1' },
      { type: 'selectOption', questionId: 'Q1', label: 'B' },
    ]);
    expect(attempt.responses.Q1?.marked).toBe(true);
    expect(attempt.responses.Q1?.status).toBe('correct');
  });

  it('stores and clears notes', () => {
    let attempt = run(start('exam'), [
      { type: 'setNotes', questionId: 'Q1', notes: 'think about reticulocytes' },
    ]);
    expect(attempt.responses.Q1?.notes).toBe('think about reticulocytes');
    attempt = run(attempt, [{ type: 'setNotes', questionId: 'Q1', notes: '' }]);
    expect(attempt.responses.Q1?.notes).toBeUndefined();
  });

  it('toggles cross-outs without affecting the answer', () => {
    let attempt = run(start('exam'), [{ type: 'toggleCrossOut', questionId: 'Q1', label: 'C' }]);
    expect(attempt.responses.Q1?.crossedOut).toEqual(['C']);
    expect(attempt.responses.Q1?.selectedAnswers).toEqual([]);
    attempt = run(attempt, [{ type: 'toggleCrossOut', questionId: 'Q1', label: 'C' }]);
    expect(attempt.responses.Q1?.crossedOut).toEqual([]);
  });
});

describe('mode changes and completion', () => {
  it('switching to tutor mode does not retroactively grade earlier answers', () => {
    const attempt = run(start('exam'), [
      { type: 'selectOption', questionId: 'Q1', label: 'A' },
      { type: 'setMode', mode: 'tutor' },
    ]);
    expect(attempt.mode).toBe('tutor');
    expect(attempt.responses.Q1?.status).toBe('answered');
  });

  it('refuses to change mode once the attempt is complete', () => {
    const completed = run(start('exam'), [{ type: 'complete' }]);
    expect(run(completed, [{ type: 'setMode', mode: 'tutor' }]).mode).toBe('exam');
  });

  it('locks every question once the attempt is complete', () => {
    const completed = run(start('exam'), [{ type: 'complete' }]);
    expect(isLocked(completed, 'Q1')).toBe(true);
    expect(
      run(completed, [{ type: 'selectOption', questionId: 'Q1', label: 'A' }]).responses.Q1
        ?.selectedAnswers,
    ).toEqual([]);
  });

  it('reports which records changed so persistence stays targeted', () => {
    const attempt = start('tutor');
    const mutation = applyAction(
      attempt,
      { type: 'selectOption', questionId: 'Q1', label: 'B' },
      { questions: index, now: NOW },
    );
    expect(mutation.changedQuestions).toEqual(['Q1']);
    expect(mutation.metaChanged).toBe(true);
  });

  it('returns the identical attempt object when nothing changes', () => {
    const attempt = start('exam');
    const mutation = applyAction(
      attempt,
      { type: 'navigate', questionId: 'Q1' },
      { questions: index, now: NOW },
    );
    expect(mutation.attempt).toBe(attempt);
    expect(mutation.changedQuestions).toEqual([]);
  });
});

describe('attempt creation', () => {
  it('creates a sequential attempt over the whole bank', () => {
    const attempt = createAttempt(bank, { mode: 'exam' });
    expect(attempt.questionOrder).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    expect(attempt.currentQuestionId).toBe('Q1');
    expect(attempt.bankChecksum).toBeTruthy();
  });

  it('restricts an attempt to a 1-based inclusive range', () => {
    const attempt = createAttempt(bank, { mode: 'exam', range: { from: 2, to: 3 } });
    expect(attempt.questionOrder).toEqual(['Q2', 'Q3']);
    expect(attempt.currentQuestionId).toBe('Q2');
  });

  it('clamps an out-of-bounds range rather than throwing', () => {
    const attempt = createAttempt(bank, { mode: 'exam', range: { from: 0, to: 99 } });
    expect(attempt.questionOrder).toHaveLength(4);
  });

  it('accepts an explicit subset and ignores unknown ids', () => {
    const attempt = createAttempt(bank, { mode: 'tutor', questionIds: ['Q3', 'NOPE', 'Q1'] });
    expect(attempt.questionOrder).toEqual(['Q3', 'Q1']);
  });
});
