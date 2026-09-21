import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { QuestionResponse } from '../../types/attempt';
import {
  DISPLAY_STATUS_LABEL,
  displayStateFor,
  type RevealContext,
} from '../../state/statusModel';
import { cn } from '../../utils/cn';

const ROW_HEIGHT = 25;
const OVERSCAN = 12;

export interface QuestionRailProps {
  questionOrder: string[];
  responses: Record<string, QuestionResponse>;
  currentQuestionId: string;
  reveal: RevealContext;
  onSelect: (questionId: string) => void;
  open?: boolean;
  id?: string;
}

/**
 * Fixed left status navigator.
 *
 * Only the visible window of rows is mounted. A 1,000-question attempt renders
 * roughly 40 rows, so scrolling and status updates stay responsive regardless
 * of bank size.
 */
export function QuestionRail({
  questionOrder,
  responses,
  currentQuestionId,
  reveal,
  onSelect,
  open = false,
  id,
}: QuestionRailProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  useLayoutEffect(() => {
    const element = listRef.current;
    if (!element) return;
    const measure = () => setViewportHeight(element.clientHeight || 600);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const currentIndex = questionOrder.indexOf(currentQuestionId);

  /* Keep the current question inside the visible window as it moves. */
  useEffect(() => {
    const element = listRef.current;
    if (!element || currentIndex < 0) return;
    const top = currentIndex * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < element.scrollTop) {
      element.scrollTop = top;
    } else if (bottom > element.scrollTop + element.clientHeight) {
      element.scrollTop = bottom - element.clientHeight;
    }
  }, [currentIndex]);

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  const total = questionOrder.length;
  const firstVisible = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const lastVisible = Math.min(
    total,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  );
  const slice = questionOrder.slice(firstVisible, lastVisible);

  return (
    <nav
      className={cn('rail', open && 'rail--open')}
      aria-label="Question status"
      id={id}
    >
      <div className="rail__header" aria-hidden="true">
        Question
        <br />
        Status
      </div>
      <div className="rail__list" ref={listRef} onScroll={handleScroll}>
        {total === 0 ? (
          <p className="rail__empty">No questions</p>
        ) : (
          <div className="rail__spacer" style={{ height: total * ROW_HEIGHT }}>
            <div className="rail__window" style={{ transform: `translateY(${firstVisible * ROW_HEIGHT}px)` }}>
              {slice.map((questionId, offset) => {
                const index = firstVisible + offset;
                const state = displayStateFor(responses[questionId], reveal);
                const isCurrent = questionId === currentQuestionId;
                return (
                  <button
                    key={questionId}
                    type="button"
                    className={cn(
                      'rail__row',
                      index % 2 === 1 && 'rail__row--alt',
                      isCurrent && 'rail__row--current',
                    )}
                    aria-current={isCurrent ? 'true' : undefined}
                    onClick={() => onSelect(questionId)}
                    title={`Item ${index + 1} — ${DISPLAY_STATUS_LABEL[state.status]}${
                      state.marked ? ', marked for review' : ''
                    }`}
                  >
                    <span className={cn('rail__dot', `rail__dot--${state.status}`)} aria-hidden="true" />
                    <span
                      className={cn(
                        'rail__number',
                        state.marked && 'rail__number--marked',
                        state.status === 'unseen' && 'rail__number--unseen',
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className="sr-only">
                      Item {index + 1} of {total}. {DISPLAY_STATUS_LABEL[state.status]}.
                      {state.marked ? ' Marked for review.' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
