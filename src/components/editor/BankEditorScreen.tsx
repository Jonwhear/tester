import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Download,
  FileCog,
  KeyRound,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';

import type { QuestionBank } from '../../types/question';
import {
  addQuestion,
  duplicateQuestion,
  questionHealth,
  removeQuestion,
  validateBank,
  type QuestionHealth,
} from '../../state/bankEditor';
import { bankChecksum } from '../../data/normalize';
import { questionBankSchema } from '../../data/schema';
import { getBank, listAttemptMetas } from '../../storage/repositories';
import { downloadJson } from '../../utils/download';
import {
  chooseSaveFile,
  ensureWritePermission,
  supportsFileSystemAccess,
  writeToHandle,
  type FileHandleLike,
} from '../../utils/fileSystem';
import { cn } from '../../utils/cn';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { AnswerKeyDialog } from './AnswerKeyDialog';
import { BankDetailsDialog } from './BankDetailsDialog';
import { QuestionEditor } from './QuestionEditor';

export interface BankEditorScreenProps {
  initialBank: QuestionBank;
  /** Write handle for the file this bank came from, when the browser supports it. */
  initialHandle?: FileHandleLike | undefined;
  initialFileName?: string | undefined;
  onClose: () => void;
  /** Persist the edited bank into the application's own store. */
  onInstall: (bank: QuestionBank) => Promise<void> | void;
}

/** How the draft relates to the copy the application has stored. */
type AppSyncState = 'unknown' | 'absent' | 'in-sync' | 'stale';

type RailFilter = 'all' | 'errors' | 'warnings' | 'nokey' | 'notclean' | 'notes';

const FILTERS: Array<{ id: RailFilter; label: string; title: string }> = [
  { id: 'all', label: 'All', title: 'Every question' },
  { id: 'errors', label: 'Err', title: 'Questions with errors' },
  { id: 'warnings', label: 'Warn', title: 'Questions with warnings' },
  { id: 'nokey', label: 'No key', title: 'Questions with no answer key' },
  { id: 'notclean', label: 'Raw', title: 'Questions not marked cleaned' },
  { id: 'notes', label: 'Noted', title: 'Questions carrying a review note' },
];

function matchesFilter(
  filter: RailFilter,
  health: QuestionHealth,
  question: QuestionBank['questions'][number],
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'errors':
      return health === 'error';
    case 'warnings':
      return health === 'warning';
    case 'nokey':
      return (question.correctAnswer?.length ?? 0) === 0;
    case 'notclean':
      return question.cleaned !== true;
    case 'notes':
      return Boolean(question.reviewNote && question.reviewNote.trim() !== '');
    default:
      return true;
  }
}

/**
 * Question-bank authoring tool.
 *
 * Deliberately a back-office screen: it is reached from bank management, not
 * from anywhere in the exam flow, because most people never edit a bank. It
 * works on a detached draft and writes a file; installing the result into the
 * application is a separate, explicit step.
 */
export function BankEditorScreen({
  initialBank,
  initialHandle,
  initialFileName,
  onClose,
  onInstall,
}: BankEditorScreenProps) {
  const [bank, setBank] = useState<QuestionBank>(initialBank);
  const [handle, setHandle] = useState<FileHandleLike | undefined>(initialHandle);
  const [fileName, setFileName] = useState<string | undefined>(initialFileName);
  const [savedChecksum, setSavedChecksum] = useState(() => bankChecksum(initialBank));
  const [currentId, setCurrentId] = useState<string>(initialBank.questions[0]?.id ?? '');
  const [filter, setFilter] = useState<RailFilter>('all');
  const [message, setMessage] = useState<{ level: 'ok' | 'warn' | 'error'; text: string } | null>(
    null,
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [forceSave, setForceSave] = useState<{ blockers: number } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [appSync, setAppSync] = useState<AppSyncState>('unknown');
  const [affectedAttempts, setAffectedAttempts] = useState(0);
  /** Bumped after a save so the app-sync check re-runs even though the content did not change. */
  const [syncNonce, setSyncNonce] = useState(0);
  const railRef = useRef<HTMLDivElement>(null);

  const dirty = bankChecksum(bank) !== savedChecksum;
  const currentChecksum = bankChecksum(bank);

  /*
   * Compare the draft against the copy the application has stored, so the
   * editor can always say plainly whether the app is up to date. Without this
   * it is far too easy to edit, save a file, and be left wondering why the exam
   * still shows the old content.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await getBank(bank.bankId, bank.bankVersion);
        if (cancelled) return;
        if (!stored) {
          setAppSync('absent');
          setAffectedAttempts(0);
          return;
        }
        setAppSync(stored.checksum === currentChecksum ? 'in-sync' : 'stale');
        const attempts = await listAttemptMetas();
        if (cancelled) return;
        setAffectedAttempts(
          attempts.filter(
            (attempt) =>
              attempt.bankId === bank.bankId && attempt.bankVersion === bank.bankVersion,
          ).length,
        );
      } catch {
        if (!cancelled) setAppSync('unknown');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bank.bankId, bank.bankVersion, currentChecksum, syncNonce]);

  const issues = useMemo(() => validateBank(bank), [bank]);
  const errorCount = issues.filter((issue) => issue.level === 'error').length;

  const health = useMemo(() => {
    const map = new Map<string, QuestionHealth>();
    bank.questions.forEach((question) => map.set(question.id, questionHealth(question)));
    return map;
  }, [bank]);

  const visible = useMemo(
    () =>
      bank.questions
        .map((question, index) => ({ question, index }))
        .filter(({ question }) =>
          matchesFilter(filter, health.get(question.id) ?? 'ok', question),
        ),
    [bank.questions, filter, health],
  );

  const currentIndex = bank.questions.findIndex((question) => question.id === currentId);
  const current = currentIndex >= 0 ? bank.questions[currentIndex] : undefined;

  /* Keep a valid selection as questions are added, removed or renamed. */
  useEffect(() => {
    if (bank.questions.length === 0) {
      if (currentId !== '') setCurrentId('');
      return;
    }
    if (!bank.questions.some((question) => question.id === currentId)) {
      setCurrentId(bank.questions[Math.min(currentIndex < 0 ? 0 : currentIndex, bank.questions.length - 1)]?.id ?? '');
    }
  }, [bank.questions, currentId, currentIndex]);

  /* Warn before losing unsaved edits to a tab close or reload. */
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const step = useCallback(
    (delta: number) => {
      const position = visible.findIndex((entry) => entry.question.id === currentId);
      const fallback = delta > 0 ? 0 : visible.length - 1;
      const next = visible[position === -1 ? fallback : position + delta];
      if (next) setCurrentId(next.question.id);
    },
    [currentId, visible],
  );

  /* ---------------- saving ---------------- */

  const serialize = useCallback((value: QuestionBank) => `${JSON.stringify(value, null, 2)}\n`, []);

  const suggestedFileName = useCallback(
    () => `${bank.bankId || 'question-bank'}-${bank.bankVersion || '1'}.json`,
    [bank.bankId, bank.bankVersion],
  );

  /**
   * Update the copy the application uses for attempts.
   *
   * Refuses an invalid bank, because installing one would break the exam side.
   * Returns a short description of what happened so the caller can build one
   * combined message instead of flashing two.
   */
  const persistToApp = useCallback(async (): Promise<{ ok: boolean; detail: string }> => {
    const parsed = questionBankSchema.safeParse(bank);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return {
        ok: false,
        detail:
          'the copy inside the app was NOT updated, because the bank still has problems' +
          (first ? ` (${first.path.join('.')}: ${first.message})` : '') +
          '.',
      };
    }
    try {
      await onInstall(bank);
      return { ok: true, detail: 'the app now uses this version.' };
    } catch (error) {
      return {
        ok: false,
        detail:
          'the copy inside the app could not be updated: ' +
          (error instanceof Error ? error.message : 'unknown error') +
          '.',
      };
    }
  }, [bank, onInstall]);

  /** Write the bank to disk. Returns how it was written, or null if cancelled. */
  const writeFile = useCallback(
    async (mode: 'current' | 'choose'): Promise<string | null> => {
      const contents = serialize(bank);

      if (mode === 'current' && handle) {
        const allowed = await ensureWritePermission(handle);
        if (!allowed) {
          setMessage({
            level: 'error',
            text: 'Permission to write that file was declined. Use "Save to file" to pick a location.',
          });
          return null;
        }
        await writeToHandle(handle, contents);
        return `Saved to ${handle.name}`;
      }

      if (supportsFileSystemAccess()) {
        try {
          const chosen = await chooseSaveFile(suggestedFileName());
          if (!chosen) return null; // the user cancelled the dialog
          await writeToHandle(chosen, contents);
          setHandle(chosen);
          setFileName(chosen.name);
          return `Saved to ${chosen.name}`;
        } catch {
          // The picker can fail for reasons that are not the user's doing — no
          // user gesture, a sandboxed frame, a headless browser. Never strand
          // the work: fall through to a download.
        }
      }

      const name = suggestedFileName();
      downloadJson(name, bank);
      setFileName(name);
      return `Downloaded ${name} (this browser cannot write files in place)`;
    },
    [bank, handle, serialize, suggestedFileName],
  );

  /**
   * Save.
   *
   * Deliberately does BOTH halves of what "save" means here: it writes the file
   * AND updates the copy the application uses for attempts. Keeping those as
   * two separate buttons was a mistake — editing a bank, pressing Save and
   * finding the exam still showing the old content is not a reasonable thing to
   * ask of anyone.
   */
  const doSave = useCallback(
    async (options: { chooseFile?: boolean; force?: boolean } = {}) => {
      if (errorCount > 0 && !options.force) {
        setForceSave({ blockers: errorCount });
        return;
      }
      /*
       * The two halves are independent on purpose. Cancelling the file dialog
       * means "never mind" and stops everything, but a file write that FAILS
       * must not also block the app copy from updating — the user asked to
       * save, and getting neither is the worst outcome.
       */
      let fileResult: string;
      let fileFailed = false;
      try {
        const written = await writeFile(options.chooseFile ? 'choose' : 'current');
        if (written === null) return; // cancelled, or already reported
        fileResult = written;
      } catch (error) {
        fileFailed = true;
        fileResult =
          'The file could NOT be written' +
          (error instanceof Error ? ` (${error.message})` : '') +
          ', but';
      }

      const appResult = await persistToApp();
      if (!fileFailed) setSavedChecksum(bankChecksum(bank));
      setSyncNonce((nonce) => nonce + 1);
      setMessage({
        level: fileFailed || !appResult.ok ? (fileFailed && !appResult.ok ? 'error' : 'warn') : 'ok',
        text: `${fileResult} — ${appResult.detail}`,
      });
    },
    [bank, errorCount, persistToApp, writeFile],
  );

  /* Ctrl/Cmd+S saves; Alt+Arrow moves between questions without disturbing text entry. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void doSave();
        return;
      }
      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        step(-1);
      }
      if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault();
        step(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doSave, step]);

  const requestClose = () => {
    if (!dirty) {
      onClose();
      return;
    }
    setConfirmClose(true);
  };

  return (
    <div className="editor-shell">
      {/* ---------------- rail ---------------- */}
      <nav className="rail" aria-label="Questions">
        <div className="rail__header">
          Question
          <br />
          Editor
        </div>

        <div className="editor-rail__filters">
          {FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={cn('editor-rail__filter', filter === entry.id && 'editor-rail__filter--active')}
              title={entry.title}
              aria-pressed={filter === entry.id}
              onClick={() => setFilter(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="rail__list" ref={railRef}>
          {visible.length === 0 ? (
            <p className="rail__empty">No questions match</p>
          ) : (
            visible.map(({ question, index }) => (
              <button
                key={question.id}
                type="button"
                className={cn(
                  'rail__row',
                  index % 2 === 1 && 'rail__row--alt',
                  question.id === currentId && 'rail__row--current',
                )}
                aria-current={question.id === currentId ? 'true' : undefined}
                title={`${index + 1} — ${question.id}`}
                onClick={() => setCurrentId(question.id)}
              >
                <span
                  className={cn('rail__dot', `rail__dot--health-${health.get(question.id) ?? 'ok'}`)}
                  aria-hidden="true"
                />
                <span className="rail__number">{index + 1}</span>
                <span className="sr-only">
                  Question {index + 1}, {question.id}, {health.get(question.id)}
                </span>
              </button>
            ))
          )}
        </div>
      </nav>

      {/* ---------------- main ---------------- */}
      <div className="editor-main">
        <header className="editor-toolbar">
          <div className="editor-identity">
            <button
              type="button"
              className="toolitem"
              onClick={requestClose}
              title="Close the editor"
            >
              <X size={18} aria-hidden="true" />
              <span className="toolitem__label">Close</span>
            </button>
            <div className="editor-identity__box">
              <div>
                {dirty ? <span className="dirty-dot" aria-hidden="true" /> : null}
                {bank.title} · v{bank.bankVersion}
                <span className="sr-only">{dirty ? ' (unsaved changes)' : ''}</span>
              </div>
              <div className="editor-identity__file">
                {fileName ? (handle ? fileName : `${fileName} (downloads a copy)`) : 'no file yet'} ·{' '}
                {current ? `${currentIndex + 1} of ${bank.questions.length}` : 'no question'}
                {current ? ` · ${current.id}` : ''}
              </div>
            </div>
          </div>

          <div className="toolbar__center">
            <button
              type="button"
              className="navbtn"
              onClick={() => step(-1)}
              disabled={visible.length === 0}
              title="Previous question (Alt+Left)"
            >
              <span className="navbtn__icon">
                <ArrowLeft size={18} aria-hidden="true" />
              </span>
              <span className="navbtn__label">Previous</span>
              <span className="sr-only">Previous question</span>
            </button>
            <button
              type="button"
              className="navbtn"
              onClick={() => step(1)}
              disabled={visible.length === 0}
              title="Next question (Alt+Right)"
            >
              <span className="navbtn__icon">
                <ArrowRight size={18} aria-hidden="true" />
              </span>
              <span className="navbtn__label">Next</span>
              <span className="sr-only">Next question</span>
            </button>
          </div>

          <div className="toolbar__right">
            <button
              type="button"
              className="toolitem"
              onClick={() => {
                const { bank: next, questionId } = addQuestion(bank, currentId || undefined);
                setBank(next);
                setCurrentId(questionId);
              }}
              title="Add a new question after this one"
            >
              <Plus size={19} aria-hidden="true" />
              <span className="toolitem__label">Add</span>
            </button>
            <button
              type="button"
              className="toolitem"
              disabled={!current}
              onClick={() => {
                if (!current) return;
                const { bank: next, questionId } = duplicateQuestion(bank, current.id);
                setBank(next);
                setCurrentId(questionId);
              }}
              title="Duplicate this question"
            >
              <Copy size={19} aria-hidden="true" />
              <span className="toolitem__label">Copy</span>
            </button>
            <button
              type="button"
              className="toolitem"
              disabled={!current}
              onClick={() => setConfirmDelete(true)}
              title="Delete this question"
            >
              <Trash2 size={19} aria-hidden="true" />
              <span className="toolitem__label">Delete</span>
            </button>
            <button
              type="button"
              className="toolitem"
              onClick={() => setKeyOpen(true)}
              title="Apply a whole answer key at once"
            >
              <KeyRound size={19} aria-hidden="true" />
              <span className="toolitem__label">Key</span>
            </button>
            <button
              type="button"
              className="toolitem"
              onClick={() => setDetailsOpen(true)}
              title="Bank title, id and version"
            >
              <FileCog size={19} aria-hidden="true" />
              <span className="toolitem__label">Bank</span>
            </button>
            <button
              type="button"
              className="toolitem"
              onClick={() => void doSave({ chooseFile: true })}
              title="Write to a different file, and update the app"
            >
              <Download size={19} aria-hidden="true" />
              <span className="toolitem__label">Save to file</span>
            </button>
            <button
              type="button"
              className={cn('toolitem', dirty && 'toolitem--active')}
              onClick={() => void doSave()}
              title="Save the bank: writes the file and updates the app (Ctrl+S)"
            >
              <Save size={19} aria-hidden="true" />
              <span className="toolitem__label">Save</span>
            </button>
          </div>
        </header>

        <main className="editor-pane">
          {message ? (
            <div
              className={cn(
                'banner',
                message.level === 'ok' && 'banner--ok',
                message.level === 'warn' && 'banner--warn',
                message.level === 'error' && 'banner--error',
              )}
              style={{ marginBottom: 14, maxWidth: 980 }}
            >
              {message.text}{' '}
              <button
                type="button"
                className="btn btn--sm btn--quiet"
                onClick={() => setMessage(null)}
                style={{ marginLeft: 6 }}
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {/*
            * Always say plainly whether the app is running this version. The
            * single most confusing thing about an editor like this is not
            * knowing whether your change reached the thing you are testing.
            */}
          <div
            className={cn(
              'banner',
              'editor-sync',
              appSync === 'in-sync' && 'banner--ok',
              appSync === 'stale' && 'banner--warn',
              (appSync === 'absent' || appSync === 'unknown') && 'banner--info',
            )}
            style={{ marginBottom: 14, maxWidth: 980 }}
          >
            {appSync === 'in-sync' ? (
              <>
                <strong>In this app: up to date.</strong> Attempts started now use this version.
              </>
            ) : appSync === 'stale' ? (
              <>
                <strong>In this app: out of date.</strong> The app still has an older copy of{' '}
                <code>{bank.bankId}</code> v{bank.bankVersion} — press <strong>Save</strong> to
                update it.
              </>
            ) : appSync === 'absent' ? (
              <>
                <strong>In this app: not added yet.</strong> <code>{bank.bankId}</code> v
                {bank.bankVersion} is not installed — <strong>Save</strong> writes the file and adds
                it so you can start an attempt on it.
              </>
            ) : (
              <>Checking whether the app has this bank…</>
            )}
            {affectedAttempts > 0 && appSync === 'stale' ? (
              <>
                {' '}
                {affectedAttempts} existing attempt{affectedAttempts === 1 ? '' : 's'} were started
                against the older content; start a new attempt to use the updated questions.
              </>
            ) : null}
          </div>

          {errorCount > 0 ? (
            <div className="banner banner--warn" style={{ marginBottom: 14, maxWidth: 980 }}>
              {errorCount} problem{errorCount === 1 ? '' : 's'} across this bank would stop it being
              installed or re-imported. Use the <strong>Err</strong> filter in the list to find them.
            </div>
          ) : null}

          {!current ? (
            <div className="editor-empty">
              <div>
                <p>This bank has no questions.</p>
                <button
                  type="button"
                  className="btn btn--primary"
                  style={{ marginTop: 10 }}
                  onClick={() => {
                    const { bank: next, questionId } = addQuestion(bank);
                    setBank(next);
                    setCurrentId(questionId);
                  }}
                >
                  Add the first question
                </button>
              </div>
            </div>
          ) : (
            <QuestionEditor
              bank={bank}
              question={current}
              onChange={setBank}
              onError={(text) => setMessage({ level: 'error', text })}
            />
          )}

        </main>
      </div>

      <BankDetailsDialog
        open={detailsOpen}
        bank={bank}
        onChange={setBank}
        onClose={() => setDetailsOpen(false)}
      />

      <AnswerKeyDialog
        open={keyOpen}
        bank={bank}
        onApply={(next) => {
          setBank(next);
          setMessage({ level: 'ok', text: 'Answer key applied. Review it, then save.' });
        }}
        onClose={() => setKeyOpen(false)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete question?"
        confirmLabel="Delete question"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          if (!current) return;
          const fallback =
            bank.questions[currentIndex + 1]?.id ?? bank.questions[currentIndex - 1]?.id ?? '';
          setBank(removeQuestion(bank, current.id));
          setCurrentId(fallback);
        }}
      >
        <p className="note">
          <code>{current?.id}</code> and all of its options are removed from this draft. The change
          is not written to disk until you save.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmClose}
        title="Discard unsaved changes?"
        confirmLabel="Discard and close"
        destructive
        cancelLabel="Keep editing"
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false);
          onClose();
        }}
      >
        <p className="note">
          This draft has changes that have not been written to a file. Closing now loses them.
        </p>
        <p className="note" style={{ marginTop: 8 }}>
          Cancel and use <strong>Save</strong> first if you want to keep them.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={forceSave !== null}
        title="Save with problems?"
        confirmLabel="Save anyway"
        onCancel={() => setForceSave(null)}
        onConfirm={() => {
          setForceSave(null);
          void doSave({ force: true });
        }}
      >
        <p className="note">
          This bank has {forceSave?.blockers} problem
          {forceSave?.blockers === 1 ? '' : 's'} — for example a duplicate question id or an answer
          key pointing at a missing option.
        </p>
        <p className="note" style={{ marginTop: 8 }}>
          The <strong>file</strong> will still be written, so your work in progress is kept. The
          copy the app uses for attempts will <strong>not</strong> be updated until the problems are
          fixed, because an invalid bank would break the exam screen.
        </p>
      </ConfirmDialog>
    </div>
  );
}
