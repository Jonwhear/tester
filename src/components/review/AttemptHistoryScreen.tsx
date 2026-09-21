import { useCallback, useEffect, useState } from 'react';

import type { Attempt, AttemptMeta, AttemptSummary } from '../../types/attempt';
import type { StoredBank } from '../../types/question';
import { indexQuestions } from '../../data/normalize';
import { summarizeAttempt } from '../../grading/grade';
import { deleteAttempt, getBank, listAttemptMetas, loadAttempt } from '../../storage/repositories';
import { ConfirmDialog } from '../common/ConfirmDialog';

export interface AttemptHistoryScreenProps {
  onBack: () => void;
  onOpenReview: (attemptId: string) => void;
}

interface HistoryRow {
  meta: AttemptMeta;
  summary: AttemptSummary | null;
  bankInstalled: boolean;
}

/** Dense attempt log. Deliberately a table rather than a dashboard. */
export function AttemptHistoryScreen({ onBack, onOpenReview }: AttemptHistoryScreenProps) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AttemptMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const metas = await listAttemptMetas();
      const bankCache = new Map<string, StoredBank | undefined>();

      const result: HistoryRow[] = [];
      for (const meta of metas) {
        const key = `${meta.bankId}::${meta.bankVersion}`;
        if (!bankCache.has(key)) {
          bankCache.set(key, await getBank(meta.bankId, meta.bankVersion));
        }
        const stored = bankCache.get(key);
        let summary: AttemptSummary | null = null;
        if (stored) {
          const attempt: Attempt | undefined = await loadAttempt(meta.attemptId);
          if (attempt) summary = summarizeAttempt(attempt, indexQuestions(stored.bank));
        }
        result.push({ meta, summary, bankInstalled: Boolean(stored) });
      }
      setRows(result);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read attempt history.');
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="screen">
      <div className="screen__inner">
        <div className="screen__bar">
          <div>
            <h1 className="screen__title">Attempt history</h1>
            <p className="screen__subtitle">Stored locally in this browser.</p>
          </div>
          <div className="screen__actions">
            <button type="button" className="btn btn--primary" onClick={onBack}>
              Start screen
            </button>
          </div>
        </div>

        {error ? <p className="banner banner--error">{error}</p> : null}

        {rows === null ? (
          <p className="empty-state">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="empty-state">No attempts recorded yet.</p>
        ) : (
          <table className="table table--rows">
            <thead>
              <tr>
                <th scope="col" style={{ width: 150 }}>
                  Started
                </th>
                <th scope="col">Bank</th>
                <th scope="col" style={{ width: 70 }}>
                  Mode
                </th>
                <th scope="col" style={{ width: 82 }}>
                  State
                </th>
                <th scope="col" style={{ width: 70 }} className="table__num">
                  Score
                </th>
                <th scope="col" style={{ width: 140 }}>
                  Correct / Incorrect / Unanswered
                </th>
                <th scope="col" style={{ width: 150 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ meta, summary, bankInstalled }) => (
                <tr key={meta.attemptId}>
                  <td>{new Date(meta.startedAt).toLocaleString()}</td>
                  <td>
                    <div className="bank-row__title">{meta.bankTitle}</div>
                    <div className="bank-row__id">
                      {meta.bankId} · v{meta.bankVersion}
                      {bankInstalled ? '' : ' · bank not installed'}
                    </div>
                  </td>
                  <td>{meta.mode === 'exam' ? 'Exam' : 'Tutor'}</td>
                  <td>{meta.completedAt ? 'Complete' : 'In progress'}</td>
                  <td className="table__num">
                    {summary?.percentage === null || summary === null
                      ? '—'
                      : `${summary.percentage}%`}
                  </td>
                  <td>
                    {summary
                      ? `${summary.correct} / ${summary.incorrect} / ${summary.unanswered}`
                      : '—'}
                  </td>
                  <td>
                    <div className="bank-actions">
                      <button
                        type="button"
                        className="btn btn--sm"
                        disabled={!bankInstalled}
                        title={
                          bankInstalled
                            ? 'Open this attempt'
                            : 'Import the matching bank version to open this attempt'
                        }
                        onClick={() => onOpenReview(meta.attemptId)}
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm btn--danger"
                        onClick={() => setPendingDelete(meta)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete attempt?"
        confirmLabel="Delete attempt"
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (!target) return;
          void deleteAttempt(target.attemptId).then(load);
        }}
      >
        <p className="note">
          The attempt started {pendingDelete ? new Date(pendingDelete.startedAt).toLocaleString() : ''}{' '}
          and all of its answers, marks and notes are permanently removed. Question banks are not
          affected. This cannot be undone.
        </p>
      </ConfirmDialog>
    </div>
  );
}
