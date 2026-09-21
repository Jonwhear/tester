import { describe, expect, it } from 'vitest';

import type { Attempt } from '../../types/attempt';
import type { Question } from '../../types/question';
import {
  gradeAttempt,
  gradeQuestion,
  isCorrectOption,
  normalizeLabel,
  requiredSelectionCount,
  scoreOverBank,
  selectionIsComplete,
  summarizeAttempt,
} from '../grade';

function single(correctAnswer?: string[]): Question {
  const question: Question = {
    id: 'Q1',
    questionType: 'single',
    stem: 'stem',
    options: [
      { label: 'A', text: 'a' },
      { label: 'B', text: 'b' },
      { label: 'C', text: 'c' },
      { label: 'D', text: 'd' },
      { label: 'E', text: 'e' },
    ],
  };
  if (correctAnswer) question.correctAnswer = correctAnswer;
  return question;
}

function multiple(correctAnswer: string[], selectCount: number): Question {
  return {
    id: 'Q2',
    questionType: 'multiple',
    selectCount,
    stem: 'Select three.',
    options: 'ABCDEFGH'.split('').map((label) => ({ label, text: label.toLowerCase() })),
    correctAnswer,
  };
}

describe('gradeQuestion — single select', () => {
  it('marks the exact correct answer correct', () => {
    const result = gradeQuestion(single(['B']), ['B']);
    expect(result).toEqual({ gradable: true, correct: true, selected: ['B'], expected: ['B'] });
  });

  it('marks a different answer incorrect and reports what was expected', () => {
    const result = gradeQuestion(single(['B']), ['A']);
    expect(result).toEqual({ gradable: true, correct: false, selected: ['A'], expected: ['B'] });
  });

  it('treats an unanswered question as incorrect rather than ungradable', () => {
    const result = gradeQuestion(single(['B']), []);
    expect(result).toMatchObject({ gradable: true, correct: false, selected: [] });
  });

  it('tolerates incidental label differences when comparing', () => {
    expect(gradeQuestion(single(['B']), [' b '])).toMatchObject({ correct: true });
    expect(gradeQuestion(single(['B.']), ['B'])).toMatchObject({ correct: true });
  });
});

describe('gradeQuestion — multiple select', () => {
  it('accepts the full set regardless of order', () => {
    expect(gradeQuestion(multiple(['A', 'C', 'F'], 3), ['F', 'A', 'C'])).toMatchObject({
      gradable: true,
      correct: true,
    });
  });

  it('rejects a wrong set of the right size', () => {
    expect(gradeQuestion(multiple(['A', 'C', 'F'], 3), ['A', 'C', 'G'])).toMatchObject({
      correct: false,
    });
  });

  it('never credits a partial match', () => {
    expect(gradeQuestion(multiple(['A', 'C', 'F'], 3), ['A', 'C'])).toMatchObject({
      correct: false,
    });
  });

  it('rejects a superset', () => {
    expect(gradeQuestion(multiple(['A', 'C', 'F'], 3), ['A', 'C', 'F', 'B'])).toMatchObject({
      correct: false,
    });
  });
});

describe('gradeQuestion — missing answer key', () => {
  it('reports the question as ungradable and never guesses', () => {
    const result = gradeQuestion(single(), ['A']);
    expect(result.gradable).toBe(false);
    expect(result).not.toHaveProperty('correct');
    expect(result).not.toHaveProperty('expected');
  });

  it('treats an empty answer-key array as no key', () => {
    expect(gradeQuestion(single([]), ['A']).gradable).toBe(false);
  });
});

describe('selection helpers', () => {
  it('normalizes labels only for comparison', () => {
    expect(normalizeLabel(' b) ')).toBe('B');
    expect(normalizeLabel('iii')).toBe('III');
  });

  it('derives the required selection count', () => {
    expect(requiredSelectionCount(single(['B']))).toBe(1);
    expect(requiredSelectionCount(multiple(['A', 'B', 'C'], 3))).toBe(3);
    const noCount: Question = { ...multiple(['A', 'B'], 2), selectCount: undefined };
    expect(requiredSelectionCount(noCount)).toBe(2);
  });

  it('knows when a selection is complete', () => {
    const question = multiple(['A', 'B', 'C'], 3);
    expect(selectionIsComplete(question, ['A', 'B'])).toBe(false);
    expect(selectionIsComplete(question, ['A', 'B', 'D'])).toBe(true);
  });

  it('identifies answer-key options', () => {
    expect(isCorrectOption(single(['B']), 'B')).toBe(true);
    expect(isCorrectOption(single(['B']), 'A')).toBe(false);
    expect(isCorrectOption(single(), 'A')).toBe(false);
  });
});

describe('attempt-level grading', () => {
  const questions = new Map<string, Question>([
    ['Q1', { ...single(['B']), id: 'Q1' }],
    ['Q2', { ...single(['C']), id: 'Q2' }],
    ['Q3', { ...single(), id: 'Q3' }],
    ['Q4', { ...single(['A']), id: 'Q4' }],
  ]);

  const attempt: Attempt = {
    schemaVersion: 1,
    attemptId: 'a1',
    bankId: 'bank',
    bankVersion: '1',
    bankTitle: 'Bank',
    startedAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    mode: 'exam',
    questionOrder: ['Q1', 'Q2', 'Q3', 'Q4'],
    currentQuestionId: 'Q1',
    responses: {
      Q1: { selectedAnswers: ['B'], status: 'answered', marked: false },
      Q2: { selectedAnswers: ['A'], status: 'answered', marked: true },
      Q3: { selectedAnswers: ['A'], status: 'answered', marked: false },
      Q4: { selectedAnswers: [], status: 'seen', marked: false },
    },
  };

  it('grades answered questions and leaves unanswered ones alone', () => {
    const graded = gradeAttempt(attempt, questions, '2024-01-02T00:00:00.000Z');
    expect(graded.Q1?.status).toBe('correct');
    expect(graded.Q2?.status).toBe('incorrect');
    expect(graded.Q3?.status).toBe('answered');
    expect(graded.Q3?.ungradable).toBe(true);
    expect(graded.Q4?.status).toBe('seen');
  });

  it('summarizes counts and a percentage over graded items only', () => {
    const graded = gradeAttempt(attempt, questions, '2024-01-02T00:00:00.000Z');
    const summary = summarizeAttempt({ ...attempt, responses: graded }, questions);
    expect(summary).toMatchObject({
      total: 4,
      answered: 3,
      unanswered: 1,
      marked: 1,
      correct: 1,
      incorrect: 1,
      ungradable: 1,
      percentage: 50,
    });
  });

  it('reports a second denominator over every keyed question', () => {
    const graded = gradeAttempt(attempt, questions, '2024-01-02T00:00:00.000Z');
    // Q1, Q2 and Q4 carry a key; only Q1 is correct.
    expect(scoreOverBank({ ...attempt, responses: graded }, questions)).toEqual({
      correct: 1,
      keyed: 3,
      percentage: 33.3,
    });
  });

  it('reports no percentage when nothing is gradable', () => {
    const unkeyed = new Map<string, Question>([['Q3', { ...single(), id: 'Q3' }]]);
    const summary = summarizeAttempt(
      {
        ...attempt,
        questionOrder: ['Q3'],
        currentQuestionId: 'Q3',
        responses: { Q3: { selectedAnswers: ['A'], status: 'answered', marked: false } },
      },
      unkeyed,
    );
    expect(summary.percentage).toBeNull();
    expect(summary.ungradable).toBe(1);
  });
});
