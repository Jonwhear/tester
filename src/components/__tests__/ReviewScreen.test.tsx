import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Attempt } from '../../types/attempt';
import type { QuestionBank } from '../../types/question';
import { indexQuestions } from '../../data/normalize';
import { createAttempt } from '../../state/attemptFactory';
import { applyAction } from '../../state/attemptReducer';
import { ReviewScreen } from '../review/ReviewScreen';

const bank: QuestionBank = {
  schemaVersion: 1,
  bankId: 'review-bank',
  bankVersion: '1',
  title: 'Review bank',
  questions: [
    { id: 'R1', questionType: 'single', stem: 'First stem', options: [{ label: 'A', text: 'a' }, { label: 'B', text: 'b' }], correctAnswer: ['A'] },
    { id: 'R2', questionType: 'single', stem: 'Second stem', options: [{ label: 'A', text: 'a' }, { label: 'B', text: 'b' }], correctAnswer: ['A'] },
    { id: 'R3', questionType: 'single', stem: 'Third stem', options: [{ label: 'A', text: 'a' }, { label: 'B', text: 'b' }], correctAnswer: ['B'] },
    { id: 'R4', questionType: 'single', stem: 'Fourth stem', options: [{ label: 'A', text: 'a' }, { label: 'B', text: 'b' }] },
  ],
};

const questions = indexQuestions(bank);
const NOW = '2024-07-01T00:00:00.000Z';

function completedAttempt(): Attempt {
  let attempt = createAttempt(bank, { mode: 'exam' });
  const ctx = { questions, now: NOW };
  attempt = applyAction(attempt, { type: 'selectOption', questionId: 'R1', label: 'A' }, ctx).attempt;
  attempt = applyAction(attempt, { type: 'selectOption', questionId: 'R2', label: 'B' }, ctx).attempt;
  attempt = applyAction(attempt, { type: 'toggleMark', questionId: 'R3' }, ctx).attempt;
  attempt = applyAction(attempt, { type: 'selectOption', questionId: 'R4', label: 'A' }, ctx).attempt;
  return applyAction(attempt, { type: 'complete' }, ctx).attempt;
}

function renderReview(overrides: Partial<React.ComponentProps<typeof ReviewScreen>> = {}) {
  const props = {
    attempt: completedAttempt(),
    questions,
    onOpenQuestion: vi.fn(),
    onExit: vi.fn(),
    onNewAttempt: vi.fn(),
    onExportProgress: vi.fn(),
    ...overrides,
  };
  return { ...render(<ReviewScreen {...props} />), props };
}

describe('ReviewScreen', () => {
  it('reports the score over graded items only', () => {
    const { container } = renderReview();
    const values = [...container.querySelectorAll('.score-strip__value')].map((n) => n.textContent);
    // 1 correct, 1 incorrect, 1 unanswered, 1 answered-without-key.
    expect(values.slice(0, 5)).toEqual(['50%', '1', '1', '1', '1']);
  });

  it('lists every item with its result and answer key', () => {
    const { container } = renderReview();
    const body = container.querySelector('tbody') as HTMLElement;
    expect(within(body).getByText('R1')).toBeInTheDocument();
    expect(within(body).getAllByText('Correct')).toHaveLength(1);
    expect(within(body).getAllByText('Incorrect')).toHaveLength(1);
    expect(within(body).getByText('Answered — no answer key')).toBeInTheDocument();
    // Answer key column is populated from the bank, never inferred.
    expect(body.textContent).toContain('R4');
  });

  it('filters to incorrect items only', async () => {
    const user = userEvent.setup();
    const { container } = renderReview();

    await user.click(screen.getByRole('button', { name: /Incorrect/ }));
    const rows = container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('R2');
  });

  it('filters to marked items only', async () => {
    const user = userEvent.setup();
    const { container } = renderReview();

    await user.click(screen.getByRole('button', { name: /Marked/ }));
    const rows = container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('R3');
  });

  it('filters to unanswered items only', async () => {
    const user = userEvent.setup();
    const { container } = renderReview();

    await user.click(screen.getByRole('button', { name: /Unanswered/ }));
    const rows = container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('R3');
  });

  it('reopens a question from the review list', async () => {
    const user = userEvent.setup();
    const { props } = renderReview();

    await user.click(screen.getByRole('button', { name: /Incorrect/ }));
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(props.onOpenQuestion).toHaveBeenCalledWith('R2');
  });

  it('reports no percentage when the bank has no answer key at all', () => {
    const unkeyedBank: QuestionBank = {
      ...bank,
      questions: bank.questions.map(({ correctAnswer: _key, ...rest }) => rest),
    };
    const unkeyedQuestions = indexQuestions(unkeyedBank);
    let attempt = createAttempt(unkeyedBank, { mode: 'exam' });
    const ctx = { questions: unkeyedQuestions, now: NOW };
    attempt = applyAction(attempt, { type: 'selectOption', questionId: 'R1', label: 'A' }, ctx).attempt;
    attempt = applyAction(attempt, { type: 'complete' }, ctx).attempt;

    const { container } = renderReview({ attempt, questions: unkeyedQuestions });
    expect(container.querySelector('.score-strip__value')?.textContent).toBe('—');
    expect(screen.getByText(/No graded items/)).toBeInTheDocument();
  });
});
