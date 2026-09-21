import type { QuestionResponse } from '../../types/attempt';
import type { Question } from '../../types/question';
import { isCorrectOption, requiredSelectionCount } from '../../grading/grade';
import { cn } from '../../utils/cn';
import { InlineText } from './richText';

export interface AnswerOptionsProps {
  question: Question;
  response: QuestionResponse;
  /**
   * Whether the answer key may be shown. Exam mode passes `false` until the
   * attempt is submitted; tutor mode passes `true` once the question is graded.
   */
  revealKey: boolean;
  /** No further selection allowed (graded in tutor mode, or attempt complete). */
  locked: boolean;
  onSelect: (label: string) => void;
  onToggleCrossOut: (label: string) => void;
}

type OptionState = 'neutral' | 'selected' | 'correct' | 'incorrect';

function optionState(
  question: Question,
  label: string,
  selected: boolean,
  revealKey: boolean,
): OptionState {
  if (!revealKey) return selected ? 'selected' : 'neutral';
  if (isCorrectOption(question, label)) return 'correct';
  if (selected) return 'incorrect';
  return 'neutral';
}

export function AnswerOptions({
  question,
  response,
  revealKey,
  locked,
  onSelect,
  onToggleCrossOut,
}: AnswerOptionsProps) {
  const multiple = question.questionType === 'multiple';
  const required = requiredSelectionCount(question);
  const crossedOut = response.crossedOut ?? [];
  const groupName = `q-${question.id}`;

  const body = question.options.map((option) => {
    const selected = response.selectedAnswers.includes(option.label);
    const state = optionState(question, option.label, selected, revealKey);
    const isCrossed = crossedOut.includes(option.label);
    const inputId = `${groupName}-${option.label}`;
    const atLimit =
      multiple && !selected && required !== undefined && response.selectedAnswers.length >= required;

    return (
      <div
        key={option.label}
        className={cn(
          'option',
          state !== 'neutral' && `option--${state}`,
          isCrossed && 'option--crossed',
          locked && 'option--locked',
        )}
      >
        <input
          id={inputId}
          className="option__control"
          type={multiple ? 'checkbox' : 'radio'}
          name={groupName}
          checked={selected}
          disabled={locked || atLimit}
          onChange={() => onSelect(option.label)}
        />
        <label className="option__label" htmlFor={inputId}>
          {option.label}.
        </label>
        <label className="option__text" htmlFor={inputId}>
          <InlineText text={option.text} format={question.stemFormat ?? 'plain'} />
        </label>

        {state === 'correct' || state === 'incorrect' ? (
          <span className="option__verdict">
            <span aria-hidden="true">{state === 'correct' ? '\u2713' : '\u2715'}</span>
            <span className="sr-only">
              {state === 'correct' ? 'Correct answer' : 'Your answer, incorrect'}
            </span>
          </span>
        ) : (
          <button
            type="button"
            className="option__strike"
            onClick={() => onToggleCrossOut(option.label)}
            aria-pressed={isCrossed}
            title={isCrossed ? `Restore option ${option.label}` : `Cross out option ${option.label}`}
          >
            <span aria-hidden="true">ab</span>
            <span className="sr-only">
              {isCrossed ? `Restore option ${option.label}` : `Cross out option ${option.label}`}
            </span>
          </button>
        )}
      </div>
    );
  });

  const instruction =
    multiple && required !== undefined
      ? `Select ${required}. Selected ${response.selectedAnswers.length} of ${required}.`
      : null;

  if (multiple) {
    return (
      <div
        className="options"
        role="group"
        aria-label={instruction ?? 'Answer options — select all that apply'}
      >
        {instruction ? <p className="options__instruction">{instruction}</p> : null}
        {body}
      </div>
    );
  }

  return (
    <div className="options" role="radiogroup" aria-label="Answer options">
      {body}
    </div>
  );
}
