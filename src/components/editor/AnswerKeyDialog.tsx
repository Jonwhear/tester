import { useMemo, useRef, useState } from 'react';

import type { QuestionBank } from '../../types/question';
import {
  applyAnswerKeyList,
  parseAnswerKeyList,
  type ApplyAnswerKeyResult,
  type JoinStrategy,
} from '../../data/answerKey';
import { readFileAsText } from '../../utils/download';
import { Modal } from '../common/Modal';

export interface AnswerKeyDialogProps {
  open: boolean;
  bank: QuestionBank;
  onApply: (bank: QuestionBank) => void;
  onClose: () => void;
}

/**
 * Apply a flat answer-key list to the whole bank at once.
 *
 * The join is validated and previewed before anything is written, because a
 * positional key that is off by one produces a bank that looks fine and is
 * wrong everywhere. Nothing is applied unless the preview says it is safe.
 */
export function AnswerKeyDialog({ open, bank, onApply, onClose }: AnswerKeyDialogProps) {
  const [text, setText] = useState('');
  const [strategy, setStrategy] = useState<JoinStrategy>('position');
  const [overwrite, setOverwrite] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseAnswerKeyList(text), [text]);

  const result: ApplyAnswerKeyResult | null = useMemo(() => {
    if (text.trim() === '') return null;
    return applyAnswerKeyList(bank, parsed, { strategy, overwriteExisting: overwrite });
  }, [bank, parsed, strategy, overwrite, text]);

  const errors = result?.issues.filter((issue) => issue.level === 'error') ?? [];
  const warnings = result?.issues.filter((issue) => issue.level === 'warning') ?? [];

  const previewPairs = useMemo(() => {
    if (!result?.ok || !result.bank) return [];
    return result.bank.questions.slice(0, 8).map((question, index) => ({
      index: index + 1,
      id: question.id,
      key: question.correctAnswer?.join(', ') ?? '—',
    }));
  }, [result]);

  const close = () => {
    setText('');
    setFileError(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      title="Apply an answer key"
      onClose={close}
      size="wide"
      footer={
        <>
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!result?.ok || (result?.applied ?? 0) === 0}
            onClick={() => {
              if (result?.ok && result.bank) {
                onApply(result.bank);
                close();
              }
            }}
          >
            {result?.ok ? `Apply ${result.applied} answer${result.applied === 1 ? '' : 's'}` : 'Apply'}
          </button>
        </>
      }
    >
      <p className="note" style={{ marginBottom: 10 }}>
        One answer per line, in question order. A line may name several options for a
        multiple-answer question, written together (<code>EFH</code>) or separated
        (<code>E, F, H</code>). Lines starting with <code>#</code> are ignored.
      </p>

      <div className="editor-meta" style={{ marginBottom: 10 }}>
        <div className="editor-field">
          <span className="editor-field__label">Match answers to questions by</span>
          <div className="segmented">
            {(
              [
                ['position', 'Position'],
                ['source-number', 'Question number'],
              ] as Array<[JoinStrategy, string]>
            ).map(([value, label]) => (
              <label className="segmented__option" key={value}>
                <input
                  type="radio"
                  name="key-strategy"
                  checked={strategy === value}
                  onChange={() => setStrategy(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="editor-field">
          <span className="editor-field__label">Existing keys</span>
          <label className="toggle" style={{ paddingTop: 4 }}>
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(event) => setOverwrite(event.target.checked)}
            />
            <span>{overwrite ? 'Replace them' : 'Keep them'}</span>
          </label>
        </div>
      </div>

      <div className="editor-field" style={{ marginBottom: 8 }}>
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}
        >
          <label className="editor-field__label" htmlFor="answer-key-text">
            Answer key ({parsed.entries.length} answer{parsed.entries.length === 1 ? '' : 's'} ·
            bank has {bank.questions.length} question{bank.questions.length === 1 ? '' : 's'})
          </label>
          <button type="button" className="btn btn--sm" onClick={() => fileRef.current?.click()}>
            Load from file…
          </button>
        </div>
        <textarea
          id="answer-key-text"
          className="editor-text"
          style={{ minHeight: 140, fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-small)' }}
          value={text}
          placeholder={'D\nA\nD\n…\nEFH'}
          onChange={(event) => {
            setText(event.target.value);
            setFileError(null);
          }}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.csv,text/plain"
          className="sr-only"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            try {
              setText(await readFileAsText(file));
              setFileError(null);
            } catch {
              setFileError(`Could not read ${file.name}.`);
            }
          }}
        />
      </div>

      {fileError ? <p className="banner banner--error">{fileError}</p> : null}

      {result && !result.ok ? (
        <div className="banner banner--error" style={{ marginTop: 8 }}>
          <strong>Nothing will be applied.</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {errors.slice(0, 8).map((issue, index) => (
              <li key={index}>
                {issue.questionId ? <code>{issue.questionId}</code> : null} {issue.message}
              </li>
            ))}
          </ul>
          {errors.length > 8 ? (
            <p style={{ margin: '6px 0 0' }}>…and {errors.length - 8} more.</p>
          ) : null}
        </div>
      ) : null}

      {result?.ok ? (
        <>
          <div className="banner banner--ok" style={{ marginTop: 8 }}>
            Ready: {result.applied} answer{result.applied === 1 ? '' : 's'} will be written
            {result.skipped > 0 ? `, ${result.skipped} left unchanged` : ''}.
          </div>
          {warnings.length > 0 ? (
            <ul className="issue-list" style={{ marginTop: 8 }}>
              {warnings.slice(0, 10).map((issue, index) => (
                <li key={index}>
                  <span className="issue-list__tag issue-list__tag--warning">WARN</span>
                  {issue.questionId ? (
                    <span className="issue-list__where">{issue.questionId}</span>
                  ) : null}
                  {issue.message}
                </li>
              ))}
            </ul>
          ) : null}

          <p className="editor-field__label" style={{ marginTop: 10 }}>
            Preview — check these line up before applying
          </p>
          <div className="key-preview">
            {previewPairs.map((pair) => `${pair.index}.  ${pair.id}  ->  ${pair.key}`).join('\n')}
            {result.bank && result.bank.questions.length > previewPairs.length
              ? `\n… ${result.bank.questions.length - previewPairs.length} more`
              : ''}
          </div>
        </>
      ) : null}
    </Modal>
  );
}
