import { useMemo, useState } from 'react';
import { Flag } from 'lucide-react';

import type { Attempt } from '../../types/attempt';
import type { Question } from '../../types/question';
import { scoreOverBank, summarizeAttempt } from '../../grading/grade';
import { DISPLAY_STATUS_LABEL, displayStateFor, type DisplayStatus } from '../../state/statusModel';
import { cn } from '../../utils/cn';

export type ReviewFilter = 'all' | 'incorrect' | 'correct' | 'unanswered' | 'marked';

export interface ReviewScreenProps {
  attempt: Attempt;
  questions: ReadonlyMap<string, Question>;
  onOpenQuestion: (questionId: string) => void;
  onExit: () => void;
  onNewAttempt: () => void;
  onExportProgress: () => void;
}

const FILTERS: Array<{ id: ReviewFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'incorrect', label: 'Incorrect' },
  { id: 'correct', label: 'Correct' },
  { id: 'unanswered', label: 'Unanswered' },
  { id: 'marked', label: 'Marked' },
];

function matches(filter: ReviewFilter, status: DisplayStatus, marked: boolean): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'incorrect':
      return status === 'incorrect';
    case 'correct':
      return status === 'correct';
    case 'unanswered':
      return status === 'unseen' || status === 'seen';
    case 'marked':
      return marked;
    default:
      return true;
  }
}

/** Short plain-text preview of a question, used in the review list. */
function preview(question: Question | undefined): string {
  if (!question) return '(question not found in bank)';
  if (question.contentBlocks?.length) {
    const paragraph = question.contentBlocks.find((block) => block.type === 'paragraph');
    if (paragraph && paragraph.type === 'paragraph') return paragraph.text;
  }
  return question.stem;
}

export function ReviewScreen({
  attempt,
  questions,
  onOpenQuestion,
  onExit,
  onNewAttempt,
  onExportProgress,
}: ReviewScreenProps) {
  const [filter, setFilter] = useState<ReviewFilter>('all');

  const reveal = { mode: attempt.mode, completed: Boolean(attempt.completedAt) };
  const summary = useMemo(() => summarizeAttempt(attempt, questions), [attempt, questions]);
  const overBank = useMemo(() => scoreOverBank(attempt, questions), [attempt, questions]);

  const rows = useMemo(
    () =>
      attempt.questionOrder.map((questionId, index) => {
        const question = questions.get(questionId);
        const state = displayStateFor(attempt.responses[questionId], reveal);
        return { questionId, index, question, state };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attempt, questions],
  );

  const counts = useMemo(() => {
    const result: Record<ReviewFilter, number> = {
      all: rows.length,
      incorrect: 0,
      correct: 0,
      unanswered: 0,
      marked: 0,
    };
    rows.forEach(({ state }) => {
      if (state.status === 'incorrect') result.incorrect += 1;
      if (state.status === 'correct') result.correct += 1;
      if (state.status === 'unseen' || state.status === 'seen') result.unanswered += 1;
      if (state.marked) result.marked += 1;
    });
    return result;
  }, [rows]);

  const visible = rows.filter(({ state }) => matches(filter, state.status, state.marked));

  return (
    <div className="screen">
      <div className="screen__inner">
        <div className="screen__bar">
          <div>
            <h1 className="screen__title">Attempt review</h1>
            <p className="screen__subtitle">
              {attempt.bankTitle} · {attempt.mode === 'exam' ? 'Exam mode' : 'Tutor mode'} ·{' '}
              {attempt.completedAt
                ? `Completed ${new Date(attempt.completedAt).toLocaleString()}`
                : 'In progress'}
            </p>
          </div>
          <div className="screen__actions">
            <button type="button" className="btn" onClick={onExportProgress}>
              Export progress
            </button>
            <button type="button" className="btn" onClick={onNewAttempt}>
              New attempt
            </button>
            <button type="button" className="btn btn--primary" onClick={onExit}>
              Start screen
            </button>
          </div>
        </div>

        <div className="score-strip">
          <div className="score-strip__cell">
            <div className="score-strip__label">Score</div>
            <div className="score-strip__value">
              {summary.percentage === null ? '—' : `${summary.percentage}%`}
            </div>
          </div>
          <div className="score-strip__cell">
            <div className="score-strip__label">Correct</div>
            <div className="score-strip__value score-strip__value--ok">{summary.correct}</div>
          </div>
          <div className="score-strip__cell">
            <div className="score-strip__label">Incorrect</div>
            <div className="score-strip__value score-strip__value--bad">{summary.incorrect}</div>
          </div>
          <div className="score-strip__cell">
            <div className="score-strip__label">Unanswered</div>
            <div className="score-strip__value">{summary.unanswered}</div>
          </div>
          <div className="score-strip__cell">
            <div className="score-strip__label">Not graded</div>
            <div
              className={cn(
                'score-strip__value',
                summary.ungradable > 0 && 'score-strip__value--warn',
              )}
            >
              {summary.ungradable}
            </div>
          </div>
          <div className="score-strip__cell score-strip__cell--wide">
            <div className="score-strip__label">Basis</div>
            <div className="note" style={{ paddingTop: 3 }}>
              {summary.percentage === null
                ? 'No graded items — this bank has no answer key for the items you answered.'
                : `${summary.correct} of ${summary.correct + summary.incorrect} graded items correct` +
                  (overBank.keyed > summary.correct + summary.incorrect
                    ? `; ${overBank.percentage}% of all ${overBank.keyed} items with an answer key.`
                    : '.')}
            </div>
          </div>
        </div>

        <div className="filters" role="group" aria-label="Filter review">
          {FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={cn('filter', filter === entry.id && 'filter--active')}
              aria-pressed={filter === entry.id}
              onClick={() => setFilter(entry.id)}
            >
              {entry.label}
              <span className="filter__count">{counts[entry.id]}</span>
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <p className="empty-state">No items match this filter.</p>
        ) : (
          <table className="table table--rows">
            <thead>
              <tr>
                <th scope="col" style={{ width: 54 }}>
                  Item
                </th>
                <th scope="col" style={{ width: 132 }}>
                  Question Id
                </th>
                <th scope="col">Stem</th>
                <th scope="col" style={{ width: 118 }}>
                  Result
                </th>
                <th scope="col" style={{ width: 92 }}>
                  Your answer
                </th>
                <th scope="col" style={{ width: 92 }}>
                  Answer key
                </th>
                <th scope="col" style={{ width: 38 }}>
                  <span className="sr-only">Marked</span>
                </th>
                <th scope="col" style={{ width: 70 }} />
              </tr>
            </thead>
            <tbody>
              {visible.map(({ questionId, index, question, state }) => (
                <tr key={questionId}>
                  <td className="review-row__item">{index + 1}</td>
                  <td className="bank-row__id">{questionId}</td>
                  <td>
                    <div className="review-row__stem">{preview(question)}</div>
                  </td>
                  <td>
                    <span className={cn('status-pill', `status-pill--${state.status}`)}>
                      {DISPLAY_STATUS_LABEL[state.status]}
                    </span>
                  </td>
                  <td>{attempt.responses[questionId]?.selectedAnswers.join(', ') || '—'}</td>
                  <td>{question?.correctAnswer?.join(', ') ?? '—'}</td>
                  <td className="flag-cell">
                    {state.marked ? (
                      <>
                        <Flag size={13} aria-hidden="true" />
                        <span className="sr-only">Marked</span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--sm review-row__open"
                      onClick={() => onOpenQuestion(questionId)}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
