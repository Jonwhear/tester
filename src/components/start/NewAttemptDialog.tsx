import { useEffect, useMemo, useState } from 'react';

import type { TestingMode } from '../../types/attempt';
import type { StoredBank } from '../../types/question';
import { Modal } from '../common/Modal';

export interface NewAttemptDialogProps {
  open: boolean;
  banks: StoredBank[];
  defaultMode: TestingMode;
  onCancel: () => void;
  onStart: (options: {
    bank: StoredBank;
    mode: TestingMode;
    range?: { from: number; to: number };
  }) => void;
  onOpenBanks: () => void;
}

type Scope = 'all' | 'range';

export function NewAttemptDialog({
  open,
  banks,
  defaultMode,
  onCancel,
  onStart,
  onOpenBanks,
}: NewAttemptDialogProps) {
  const [bankKey, setBankKey] = useState<string>('');
  const [mode, setMode] = useState<TestingMode>(defaultMode);
  const [scope, setScope] = useState<Scope>('all');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);

  const selected = useMemo(
    () => banks.find((bank) => `${bank.bankId}::${bank.bankVersion}` === bankKey),
    [bankKey, banks],
  );

  useEffect(() => {
    if (!open) return;
    setMode(defaultMode);
    const first = banks[0];
    if (first && !banks.some((b) => `${b.bankId}::${b.bankVersion}` === bankKey)) {
      setBankKey(`${first.bankId}::${first.bankVersion}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, banks, defaultMode]);

  useEffect(() => {
    if (!selected) return;
    setFrom(1);
    setTo(selected.questionCount);
  }, [selected]);

  const count = selected?.questionCount ?? 0;
  const clampedFrom = Math.min(Math.max(1, from), Math.max(1, count));
  const clampedTo = Math.min(Math.max(clampedFrom, to), Math.max(1, count));
  const selectedCount = scope === 'all' ? count : clampedTo - clampedFrom + 1;

  return (
    <Modal
      open={open}
      title="Start new attempt"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!selected || selectedCount < 1}
            onClick={() => {
              if (!selected) return;
              onStart({
                bank: selected,
                mode,
                ...(scope === 'range' ? { range: { from: clampedFrom, to: clampedTo } } : {}),
              });
            }}
          >
            Start attempt
          </button>
        </>
      }
    >
      {banks.length === 0 ? (
        <>
          <p className="banner banner--warn">No question banks are installed.</p>
          <button type="button" className="btn btn--block" onClick={onOpenBanks} style={{ marginTop: 10 }}>
            Go to question banks
          </button>
        </>
      ) : (
        <>
          <section className="dialog__section">
            <h3 className="dialog__section-title">Question bank</h3>
            <div className="field">
              <label className="field__label" htmlFor="attempt-bank">
                Bank
              </label>
              <select
                id="attempt-bank"
                className="select"
                value={bankKey}
                onChange={(event) => setBankKey(event.target.value)}
              >
                {banks.map((bank) => (
                  <option
                    key={`${bank.bankId}::${bank.bankVersion}`}
                    value={`${bank.bankId}::${bank.bankVersion}`}
                  >
                    {bank.title} — v{bank.bankVersion} ({bank.questionCount} questions)
                  </option>
                ))}
              </select>
            </div>
            {selected && !selected.hasAnswerKey ? (
              <p className="note note--warn" style={{ marginTop: 8 }}>
                This bank has no answer key. Answers are recorded but nothing is graded.
              </p>
            ) : null}
            {selected && selected.hasAnswerKey && !selected.fullAnswerKey ? (
              <p className="note note--warn" style={{ marginTop: 8 }}>
                Some questions in this bank have no answer key and will be reported as ungraded.
              </p>
            ) : null}
          </section>

          <section className="dialog__section">
            <h3 className="dialog__section-title">Mode</h3>
            <div className="segmented">
              {(['exam', 'tutor'] as const).map((value) => (
                <label className="segmented__option" key={value}>
                  <input
                    type="radio"
                    name="new-attempt-mode"
                    checked={mode === value}
                    onChange={() => setMode(value)}
                  />
                  <span>{value === 'exam' ? 'Exam' : 'Tutor'}</span>
                </label>
              ))}
            </div>
            <p className="note" style={{ marginTop: 8 }}>
              {mode === 'exam'
                ? 'Exam: nothing about correctness is shown until you submit.'
                : 'Tutor: single-answer items are graded as soon as you answer them.'}
            </p>
          </section>

          <section className="dialog__section">
            <h3 className="dialog__section-title">Questions</h3>
            <div className="segmented">
              {(
                [
                  ['all', 'All questions'],
                  ['range', 'Range'],
                ] as Array<[Scope, string]>
              ).map(([value, label]) => (
                <label className="segmented__option" key={value}>
                  <input
                    type="radio"
                    name="new-attempt-scope"
                    checked={scope === value}
                    onChange={() => setScope(value)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            {scope === 'range' ? (
              <div style={{ display: 'flex', gap: 10, marginTop: 10, maxWidth: 260 }}>
                <div className="field">
                  <label className="field__label" htmlFor="range-from">
                    From
                  </label>
                  <input
                    id="range-from"
                    className="input"
                    type="number"
                    min={1}
                    max={count}
                    value={from}
                    onChange={(event) => setFrom(Number(event.target.value))}
                  />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="range-to">
                    To
                  </label>
                  <input
                    id="range-to"
                    className="input"
                    type="number"
                    min={1}
                    max={count}
                    value={to}
                    onChange={(event) => setTo(Number(event.target.value))}
                  />
                </div>
              </div>
            ) : null}

            <p className="note" style={{ marginTop: 8 }}>
              {selectedCount} question{selectedCount === 1 ? '' : 's'} in attempt order. Items are
              numbered by position; each item keeps its source Question Id.
            </p>
          </section>
        </>
      )}
    </Modal>
  );
}
