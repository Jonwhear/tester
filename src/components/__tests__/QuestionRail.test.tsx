import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { QuestionResponse } from '../../types/attempt';
import { QuestionRail } from '../navigation/QuestionRail';

function build(count: number) {
  const questionOrder = Array.from({ length: count }, (_, i) => `Q${i + 1}`);
  const responses: Record<string, QuestionResponse> = {};
  questionOrder.forEach((id) => {
    responses[id] = { selectedAnswers: [], status: 'unseen', marked: false };
  });
  return { questionOrder, responses };
}

describe('QuestionRail', () => {
  it('mounts only a window of rows for a large attempt', () => {
    const { questionOrder, responses } = build(2000);
    const { container } = render(
      <QuestionRail
        questionOrder={questionOrder}
        responses={responses}
        currentQuestionId="Q1"
        reveal={{ mode: 'tutor', completed: false }}
        onSelect={vi.fn()}
      />,
    );

    const rendered = container.querySelectorAll('.rail__row').length;
    expect(rendered).toBeGreaterThan(0);
    // The scroll surface still reserves the full height, so the scrollbar is honest.
    expect(rendered).toBeLessThan(120);
    expect(container.querySelector<HTMLElement>('.rail__spacer')?.style.height).toBe('50000px');
  });

  it('renders each status with its own indicator', () => {
    const { questionOrder, responses } = build(6);
    responses.Q1 = { selectedAnswers: [], status: 'seen', marked: false };
    responses.Q2 = { selectedAnswers: ['A'], status: 'answered', marked: false };
    responses.Q3 = { selectedAnswers: ['A'], status: 'correct', marked: false };
    responses.Q4 = { selectedAnswers: ['A'], status: 'incorrect', marked: false };
    responses.Q5 = { selectedAnswers: ['A'], status: 'answered', marked: false, ungradable: true };
    responses.Q6 = { selectedAnswers: [], status: 'unseen', marked: true };

    const { container } = render(
      <QuestionRail
        questionOrder={questionOrder}
        responses={responses}
        currentQuestionId="Q3"
        reveal={{ mode: 'tutor', completed: false }}
        onSelect={vi.fn()}
      />,
    );

    const rows = container.querySelectorAll('.rail__row');
    const dot = (n: number) => rows[n]?.querySelector('.rail__dot')?.className ?? '';
    expect(dot(0)).toContain('rail__dot--seen');
    expect(dot(1)).toContain('rail__dot--answered');
    expect(dot(2)).toContain('rail__dot--correct');
    expect(dot(3)).toContain('rail__dot--incorrect');
    expect(dot(4)).toContain('rail__dot--ungradable');
    expect(rows[5]?.querySelector('.rail__number')?.className).toContain('rail__number--marked');

    // Current-question styling is independent of correctness.
    expect(rows[2]?.className).toContain('rail__row--current');
    expect(dot(2)).toContain('rail__dot--correct');
  });

  it('hides correctness in exam mode while the attempt is open', () => {
    const { questionOrder, responses } = build(2);
    responses.Q1 = { selectedAnswers: ['A'], status: 'correct', marked: false };
    responses.Q2 = { selectedAnswers: ['A'], status: 'incorrect', marked: false };

    const { container } = render(
      <QuestionRail
        questionOrder={questionOrder}
        responses={responses}
        currentQuestionId="Q1"
        reveal={{ mode: 'exam', completed: false }}
        onSelect={vi.fn()}
      />,
    );

    expect(container.querySelectorAll('.rail__dot--correct')).toHaveLength(0);
    expect(container.querySelectorAll('.rail__dot--incorrect')).toHaveLength(0);
    expect(container.querySelectorAll('.rail__dot--answered')).toHaveLength(2);
  });

  it('announces each row for assistive technology and reports the current item', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { questionOrder, responses } = build(3);
    render(
      <QuestionRail
        questionOrder={questionOrder}
        responses={responses}
        currentQuestionId="Q2"
        reveal={{ mode: 'tutor', completed: false }}
        onSelect={onSelect}
      />,
    );

    const current = screen.getByRole('button', { current: true });
    expect(current).toHaveTextContent('Item 2 of 3');

    await user.click(screen.getByRole('button', { name: /Item 3 of 3/ }));
    expect(onSelect).toHaveBeenCalledWith('Q3');
  });
});
