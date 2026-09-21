import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { QuestionContent } from '../exam/QuestionContent';
import { InlineText, parseInline } from '../exam/richText';
import type { Question } from '../../types/question';

const base: Question = {
  id: 'C1',
  questionType: 'single',
  stem: 'Plain stem',
  options: [],
};

describe('safe inline text', () => {
  it('renders imported HTML as literal text, never as markup', () => {
    const { container } = render(
      <InlineText text={'<img src=x onerror="alert(1)"> <script>bad()</script>'} format="markdown" />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>bad()</script>');
  });

  it('applies only the small inline vocabulary it advertises', () => {
    expect(parseInline('a **b** c *d* `e`')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' c ' },
      { text: 'd', italic: true },
      { text: ' ' },
      { text: 'e', code: true },
    ]);
  });

  it('leaves markdown syntax alone in plain mode', () => {
    const { container } = render(<InlineText text="**not bold**" />);
    expect(container.querySelector('strong')).toBeNull();
    expect(container.textContent).toBe('**not bold**');
  });
});

describe('QuestionContent', () => {
  it('splits a plain stem on blank lines', () => {
    const { container } = render(
      <QuestionContent
        question={{ ...base, stem: 'First paragraph.\n\nSecond paragraph.' }}
        showHighlights={false}
        showReviewNote={false}
      />,
    );
    expect(container.querySelectorAll('p')).toHaveLength(2);
  });

  it('renders content blocks instead of the stem when present', () => {
    render(
      <QuestionContent
        question={{
          ...base,
          stem: 'ignored stem',
          contentBlocks: [
            { type: 'paragraph', text: 'Block paragraph.' },
            { type: 'table', columns: ['Study', 'Result'], rows: [['Hemoglobin', '5.0 g/dL']] },
            { type: 'image', src: 'data:image/svg+xml,<svg/>', alt: 'a figure', caption: 'Figure 1.' },
          ],
        }}
        showHighlights={false}
        showReviewNote={false}
      />,
    );
    expect(screen.getByText('Block paragraph.')).toBeInTheDocument();
    expect(screen.queryByText('ignored stem')).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Study' })).toBeInTheDocument();
    expect(screen.getByText('5.0 g/dL')).toBeInTheDocument();
    expect(screen.getByAltText('a figure')).toBeInTheDocument();
    expect(screen.getByText('Figure 1.')).toBeInTheDocument();
  });

  it('applies bank-supplied highlights only when enabled', () => {
    const question: Question = {
      ...base,
      stem: 'A 30-pack-year smoking history is reported.',
      suggestedHighlights: [{ text: '30-pack-year smoking history', note: 'risk factor' }],
    };

    const off = render(
      <QuestionContent question={question} showHighlights={false} showReviewNote={false} />,
    );
    expect(off.container.querySelector('mark')).toBeNull();
    off.unmount();

    const on = render(
      <QuestionContent question={question} showHighlights showReviewNote={false} />,
    );
    expect(on.container.querySelector('mark')?.textContent).toBe('30-pack-year smoking history');
  });

  it('hides the upstream review note unless it is explicitly enabled', () => {
    const question: Question = { ...base, reviewNote: 'page 12 illegible' };

    const hidden = render(
      <QuestionContent question={question} showHighlights={false} showReviewNote={false} />,
    );
    expect(hidden.queryByText(/page 12 illegible/)).not.toBeInTheDocument();
    hidden.unmount();

    const shown = render(
      <QuestionContent question={question} showHighlights={false} showReviewNote />,
    );
    expect(shown.getByText(/page 12 illegible/)).toBeInTheDocument();
  });

  it('shows placeholder source text verbatim', () => {
    const placeholder = '[SOURCE PAGE MISSING — stem not recovered from the scan]';
    render(
      <QuestionContent
        question={{ ...base, stem: placeholder }}
        showHighlights={false}
        showReviewNote={false}
      />,
    );
    expect(screen.getByText(placeholder)).toBeInTheDocument();
  });
});
