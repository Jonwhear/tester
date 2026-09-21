import { ChevronDown, ChevronUp, ListRestart, Plus, Trash2 } from 'lucide-react';

import type { Question, QuestionBank } from '../../types/question';
import {
  addOption,
  ensureContentBlocks,
  moveOption,
  relabelOptionsSequentially,
  removeOption,
  setContentBlocks,
  setOptionLabel,
  setOptionText,
  setQuestionType,
  setSelectCount,
  toggleCorrectAnswer,
  updateQuestion,
  validateQuestion,
} from '../../state/bankEditor';
import { cn } from '../../utils/cn';
import { ContentBlocksEditor } from './ContentBlocksEditor';

export interface QuestionEditorProps {
  bank: QuestionBank;
  question: Question;
  onChange: (bank: QuestionBank) => void;
  onError: (message: string) => void;
}

export function QuestionEditor({ bank, question, onChange, onError }: QuestionEditorProps) {
  const id = question.id;
  const issues = validateQuestion(question);
  const usesBlocks = (question.contentBlocks?.length ?? 0) > 0;
  const multiple = question.questionType === 'multiple';
  const key = question.correctAnswer ?? [];

  const fieldHasError = (field: string) =>
    issues.some((issue) => issue.level === 'error' && issue.field === field);

  return (
    <div className="editor-pane__inner">
      {/* ---------------- identity ---------------- */}
      <section className="editor-section">
        <h2 className="editor-section__title">Identity</h2>
        <div className="editor-meta">
          <div className="editor-field">
            <label className="editor-field__label" htmlFor="q-id">
              Question id
            </label>
            <input
              id="q-id"
              className={cn('editor-input', 'editor-input--mono', fieldHasError('id') && 'editor-input--invalid')}
              value={question.id}
              onChange={(event) => onChange(updateQuestion(bank, id, { id: event.target.value }))}
            />
          </div>
          <div className="editor-field">
            <label className="editor-field__label" htmlFor="q-number">
              Source number
            </label>
            <input
              id="q-number"
              className="editor-input"
              value={question.sourceQuestionNumber ?? ''}
              onChange={(event) => {
                const raw = event.target.value.trim();
                const numeric = Number(raw);
                onChange(
                  updateQuestion(bank, id, {
                    sourceQuestionNumber:
                      raw === '' ? undefined : Number.isFinite(numeric) && raw !== '' ? numeric : raw,
                  }),
                );
              }}
            />
          </div>
          <div className="editor-field">
            <label className="editor-field__label" htmlFor="q-year">
              Year
            </label>
            <input
              id="q-year"
              className="editor-input"
              inputMode="numeric"
              value={question.year ?? ''}
              onChange={(event) => {
                const raw = event.target.value.trim();
                onChange(
                  updateQuestion(bank, id, {
                    year: raw === '' ? undefined : Number.parseInt(raw, 10),
                  }),
                );
              }}
            />
          </div>
          <div className="editor-field">
            <label className="editor-field__label" htmlFor="q-part">
              Part
            </label>
            <input
              id="q-part"
              className="editor-input"
              value={question.part ?? ''}
              onChange={(event) => {
                const raw = event.target.value.trim();
                const numeric = Number(raw);
                onChange(
                  updateQuestion(bank, id, {
                    part: raw === '' ? undefined : Number.isFinite(numeric) && raw !== '' ? numeric : raw,
                  }),
                );
              }}
            />
          </div>
          <div className="editor-field">
            <span className="editor-field__label">Cleaned</span>
            <label className="toggle" style={{ paddingTop: 4 }}>
              <input
                type="checkbox"
                checked={question.cleaned ?? false}
                onChange={(event) =>
                  onChange(updateQuestion(bank, id, { cleaned: event.target.checked }))
                }
              />
              <span>{question.cleaned ? 'Yes' : 'No'}</span>
            </label>
          </div>
        </div>
      </section>

      {/* ---------------- stem ---------------- */}
      <section className="editor-section">
        <h2 className="editor-section__title">
          Question stem
          <span className="editor-section__actions">
            {usesBlocks ? (
              <button
                type="button"
                className="btn btn--sm"
                title="Discard the block structure and keep the text as one plain stem"
                onClick={() => {
                  const text = (question.contentBlocks ?? [])
                    .map((block) => (block.type === 'paragraph' ? block.text : ''))
                    .filter((value) => value !== '')
                    .join('\n\n');
                  const dropped = (question.contentBlocks ?? []).filter(
                    (block) => block.type !== 'paragraph',
                  ).length;
                  if (dropped > 0) {
                    onError(
                      `Converting to a plain stem would discard ${dropped} non-text block(s). ` +
                        'Delete them first if that is what you want.',
                    );
                    return;
                  }
                  onChange(updateQuestion(setContentBlocks(bank, id, []), id, { stem: text }));
                }}
              >
                Use plain text
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--sm"
                title="Split this stem into blocks so a table or image can be added"
                onClick={() =>
                  onChange(
                    setContentBlocks(bank, id, ensureContentBlocks(question)),
                  )
                }
              >
                Use blocks (tables / images)
              </button>
            )}
          </span>
        </h2>

        {usesBlocks ? (
          <ContentBlocksEditor
            blocks={question.contentBlocks ?? []}
            onChange={(blocks) => onChange(setContentBlocks(bank, id, blocks))}
            onError={onError}
          />
        ) : (
          <>
            <label className="sr-only" htmlFor="q-stem">
              Question stem
            </label>
            <textarea
              id="q-stem"
              className={cn('editor-text', 'editor-text--stem')}
              value={question.stem}
              placeholder="The question as it should appear to the candidate…"
              onChange={(event) => onChange(updateQuestion(bank, id, { stem: event.target.value }))}
            />
            <p className="note" style={{ marginTop: 5 }}>
              Blank lines separate paragraphs. To add a lab table or a figure, switch to blocks.
            </p>
          </>
        )}
      </section>

      {/* ---------------- answer type ---------------- */}
      <section className="editor-section">
        <h2 className="editor-section__title">Answer type</h2>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="segmented">
            {(['single', 'multiple'] as const).map((value) => (
              <label className="segmented__option" key={value}>
                <input
                  type="radio"
                  name="question-type"
                  checked={question.questionType === value}
                  onChange={() => onChange(setQuestionType(bank, id, value))}
                />
                <span>{value === 'single' ? 'Single answer' : 'Multiple answers'}</span>
              </label>
            ))}
          </div>

          {multiple ? (
            <div className="editor-field" style={{ width: 130 }}>
              <label className="editor-field__label" htmlFor="q-select-count">
                Options to choose
              </label>
              <input
                id="q-select-count"
                className={cn('editor-input', fieldHasError('selectCount') && 'editor-input--invalid')}
                inputMode="numeric"
                value={question.selectCount ?? ''}
                onChange={(event) => {
                  const raw = event.target.value.trim();
                  onChange(
                    setSelectCount(bank, id, raw === '' ? undefined : Number.parseInt(raw, 10)),
                  );
                }}
              />
            </div>
          ) : null}
        </div>
      </section>

      {/* ---------------- options ---------------- */}
      <section className="editor-section">
        <h2 className="editor-section__title">
          Options — tick the correct {multiple ? 'answers' : 'answer'}
          <span className="editor-section__actions">
            <button
              type="button"
              className="btn btn--sm"
              title="Relabel every option A, B, C… in their current order and remap the answer key"
              onClick={() => onChange(relabelOptionsSequentially(bank, id))}
            >
              <ListRestart size={13} aria-hidden="true" /> Relabel A–Z
            </button>
            <button type="button" className="btn btn--sm" onClick={() => onChange(addOption(bank, id))}>
              <Plus size={13} aria-hidden="true" /> Option
            </button>
          </span>
        </h2>

        {question.options.length === 0 ? (
          <p className="note note--error">
            This question has no options. Add at least two.
          </p>
        ) : null}

        {question.options.map((option, index) => {
          const checked = key.includes(option.label);
          return (
            /*
             * Keyed by position, NOT by label: the label is itself editable, and
             * a label-derived key would remount the input on every keystroke and
             * throw away the caret.
             */
            <div className="opt-row" key={index}>
              <div className="opt-row__key">
                <input
                  type={multiple ? 'checkbox' : 'radio'}
                  name="correct-answer"
                  checked={checked}
                  aria-label={`Mark option ${option.label} correct`}
                  onChange={() => onChange(toggleCorrectAnswer(bank, id, option.label))}
                />
              </div>

              <input
                className={cn('editor-input', 'editor-input--mono')}
                value={option.label}
                aria-label={`Option ${index + 1} label`}
                onChange={(event) => onChange(setOptionLabel(bank, id, index, event.target.value))}
              />

              <textarea
                className="editor-text editor-text--short"
                value={option.text}
                aria-label={`Option ${option.label} text`}
                onChange={(event) => onChange(setOptionText(bank, id, index, event.target.value))}
              />

              <div className="opt-row__actions">
                <button
                  type="button"
                  className="icon-btn"
                  disabled={index === 0}
                  onClick={() => onChange(moveOption(bank, id, index, -1))}
                  title="Move option up"
                >
                  <ChevronUp size={14} aria-hidden="true" />
                  <span className="sr-only">Move option {option.label} up</span>
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  disabled={index === question.options.length - 1}
                  onClick={() => onChange(moveOption(bank, id, index, 1))}
                  title="Move option down"
                >
                  <ChevronDown size={14} aria-hidden="true" />
                  <span className="sr-only">Move option {option.label} down</span>
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn--danger"
                  onClick={() => onChange(removeOption(bank, id, index))}
                  title="Delete option"
                >
                  <Trash2 size={14} aria-hidden="true" />
                  <span className="sr-only">Delete option {option.label}</span>
                </button>
              </div>
            </div>
          );
        })}
      </section>

      {/* ---------------- teaching content ---------------- */}
      <section className="editor-section">
        <h2 className="editor-section__title">Explanation and objective</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="editor-field">
            <label className="editor-field__label" htmlFor="q-explanation">
              Explanation (shown in tutor mode and review; omitted when blank)
            </label>
            <textarea
              id="q-explanation"
              className="editor-text editor-text--short"
              value={question.explanation ?? ''}
              onChange={(event) =>
                onChange(updateQuestion(bank, id, { explanation: event.target.value }))
              }
            />
          </div>
          <div className="editor-field">
            <label className="editor-field__label" htmlFor="q-objective">
              Educational objective
            </label>
            <textarea
              id="q-objective"
              className="editor-text editor-text--short"
              value={question.educationalObjective ?? ''}
              onChange={(event) =>
                onChange(updateQuestion(bank, id, { educationalObjective: event.target.value }))
              }
            />
          </div>
          <div className="editor-field">
            <label className="editor-field__label" htmlFor="q-review-note">
              Review note (never shown during an exam)
            </label>
            <textarea
              id="q-review-note"
              className="editor-text editor-text--short"
              value={question.reviewNote ?? ''}
              onChange={(event) =>
                onChange(updateQuestion(bank, id, { reviewNote: event.target.value }))
              }
            />
          </div>
        </div>
      </section>

      {/* ---------------- issues ---------------- */}
      <section className="editor-section">
        <h2 className="editor-section__title">Checks</h2>
        {issues.length === 0 ? (
          <p className="note">No problems found with this question.</p>
        ) : (
          issues.map((issue, index) => (
            <div className="issue-line" key={index}>
              <span className={`issue-line__level issue-line__level--${issue.level}`}>
                {issue.level}
              </span>
              <span>{issue.message}</span>
            </div>
          ))
        )}
      </section>

    </div>
  );
}
