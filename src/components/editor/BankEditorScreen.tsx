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
  /** Install the edited bank into the application's own store. */
  onInstall: (bank: QuestionBank) => Promise<void> | void;
}

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
  const railRef = useRef<HTMLDivElement>(null);

  const dirty = bankChecksum(bank) !== savedChecksum;

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

  const writeFile = useCallback(
    async (target?: FileHandleLike) => {
      const contents = serialize(bank);

      if (target) {
        const allowed = await ensureWritePermission(target);
        if (!allowed) {
          setMessage({
            level: 'error',
            text: 'Permission to write that file was declined. Use "Save as" to pick a location.',
          });
          return false;
        }
        await writeToHandle(target, contents);
        setHandle(target);
        setFileName(target.name);
      } else {
        // No File System Access API: fall back to a download.
        downloadJson(suggestedFileName(), bank);
      }

      setSavedChecksum(bankChecksum(bank));
      setMessage({
        level: 'ok',
        text: target
          ? `Saved to ${target.name}.`
          : `Downloaded ${suggestedFileName()} — your browser cannot write files in place, ` +
            'so this saved a copy to your downloads folder.',
      });
      return true;
    },
    [bank, serialize, suggestedFileName],
  );

  const doSave = useCallback(
    async (options: { saveAs?: boolean; force?: boolean } = {}) => {
      if (errorCount > 0 && !options.force) {
        setForceSave({ blockers: errorCount });
        return;
      }
      try {
        if (!options.saveAs && handle) {
          await writeFile(handle);
          return;
        }
        if (supportsFileSystemAccess()) {
          try {
            const chosen = await chooseSaveFile(suggestedFileName());
            if (!chosen) return; // user cancelled
            await writeFile(chosen);
            return;
          } catch {
            // The picker can fail for reasons that are not the user's doing —
            // no user gesture, a sandboxed frame, a headless browser. Never let
            // that strand the user's work: fall through to a download.
          }
        }
        await writeFile(undefined);
      } catch (error) {
        setMessage({
          level: 'error',
          text: error instanceof Error ? `Could not save: ${error.message}` : 'Could not save the file.',
        });
      }
    },
    [errorCount, handle, suggestedFileName, writeFile],
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

  const install = useCallback(async () => {
    const parsed = questionBankSchema.safeParse(bank);
    if (!parsed.success) {
      setMessage({
        level: 'error',
        text:
          'This bank cannot be installed until its problems are fixed: ' +
          parsed.error.issues
            .slice(0, 3)
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; '),
      });
      return;
    }
    try {
      await onInstall(bank);
      setMessage({
        level: 'ok',
        text: `Installed "${bank.title}" version ${bank.bankVersion} into the application.`,
      });
    } catch (error) {
      setMessage({
        level: 'error',
        text: error instanceof Error ? error.message : 'Could not install the bank.',
      });
    }
  }, [bank, onInstall]);

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
                {fileName ?? 'not saved to a file yet'} ·{' '}
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
              onClick={() => void doSave({ saveAs: true })}
              title="Save to a new file"
            >
              <Download size={19} aria-hidden="true" />
              <span className="toolitem__label">Save as</span>
            </button>
            <button
              type="button"
              className={cn('toolitem', dirty && 'toolitem--active')}
              onClick={() => void doSave()}
              title="Save to the current file (Ctrl+S)"
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

          <div style={{ maxWidth: 980, marginTop: 26, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn--primary" onClick={() => void install()}>
              Install into the application
            </button>
            <span className="note" style={{ alignSelf: 'center' }}>
              Saves the bank into this browser so you can start an attempt on it. Editing a file and
              installing it are separate steps.
            </span>
          </div>
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
          {forceSave?.blockers === 1 ? '' : 's'} that will stop the file being re-imported — for
          example a duplicate question id or an answer key pointing at a missing option.
        </p>
        <p className="note" style={{ marginTop: 8 }}>
          Saving anyway keeps your work in progress, but you will need to fix those before the file
          can be loaded again.
        </p>
      </ConfirmDialog>
    </div>
  );
}
