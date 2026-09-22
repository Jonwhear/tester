import { useCallback, useEffect, useRef, useState } from 'react';
import { FilePlus2, FolderOpen, Pencil } from 'lucide-react';

import type { QuestionBank, StoredBank } from '../../types/question';
import type { ImportIssue, ImportResult } from '../../data/normalize';
import { bankParts, bankYears, describeBank } from '../../data/normalize';
import { importNormalizedBank } from '../../data/importers/normalizedJson';
import { importRowFormat } from '../../data/importers/rowFormat';
import {
  isJsonFilename,
  isTabularFilename,
  readTabularFile,
  TabularError,
  type TabularSource,
} from '../../data/importers/tabular';
import { deleteBank, listBanks, saveBank } from '../../storage/repositories';
import { SAMPLE_BANK, SAMPLE_ROWS } from '../../sample-data';
import { readFileAsText } from '../../utils/download';
import { createEmptyBank } from '../../state/bankEditor';
import { openJsonFile, supportsFileSystemAccess, type FileHandleLike } from '../../utils/fileSystem';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { BankEditorScreen } from '../editor/BankEditorScreen';
import { cn } from '../../utils/cn';

export interface BankManagerScreenProps {
  onBack: () => void;
  /** Called after a bank is stored, so the caller can refresh its list. */
  onBanksChanged?: () => void;
}

type Format = 'auto' | 'normalized' | 'rows';

interface Preview {
  bank: QuestionBank;
  described: StoredBank;
  issues: ImportIssue[];
  years: number[];
  parts: string[];
  /** Set when the preview came from a spreadsheet rather than JSON. */
  source?: TabularSource;
}

interface EditingTarget {
  bank: QuestionBank;
  handle?: FileHandleLike | undefined;
  fileName?: string | undefined;
}

/** Filename -> a stable, readable bank id. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Choose the importer. `auto` reads the shape rather than trusting a label. */
function runImport(payload: unknown, format: Format): ImportResult {
  if (format === 'rows') return importRowFormat(payload);
  if (format === 'normalized') return importNormalizedBank(payload);
  if (Array.isArray(payload)) return importRowFormat(payload);
  if (
    typeof payload === 'object' &&
    payload !== null &&
    Array.isArray((payload as { rows?: unknown }).rows)
  ) {
    return importRowFormat(payload);
  }
  return importNormalizedBank(payload);
}

export function BankManagerScreen({ onBack, onBanksChanged }: BankManagerScreenProps) {
  const [banks, setBanks] = useState<StoredBank[]>([]);
  const [format, setFormat] = useState<Format>('auto');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<StoredBank | null>(null);
  const [editing, setEditing] = useState<EditingTarget | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    setBanks(await listBanks());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* Bring the import result into view — it is the next thing to act on. */
  useEffect(() => {
    if (preview) previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [preview]);

  const accept = useCallback(
    (payload: unknown, chosenFormat: Format, source?: TabularSource) => {
      const result = runImport(payload, chosenFormat);
      setIssues(result.issues);
      if (!result.ok || !result.bank) {
        setPreview(null);
        setError('The file could not be imported. Nothing was stored.');
        return;
      }
      setError(null);
      setStatus(null);
      setPreview({
        bank: result.bank,
        described: describeBank(result.bank),
        years: bankYears(result.bank),
        parts: bankParts(result.bank),
        issues: result.issues,
        ...(source ? { source } : {}),
      });
    },
    [],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setStatus(null);
      setError(null);

      if (isTabularFilename(file.name)) {
        try {
          const source = await readTabularFile(file);
          if (source.rows.length === 0) {
            setPreview(null);
            setIssues([]);
            setError(`${file.name} has a header row but no data rows.`);
            return;
          }
          /*
           * A spreadsheet is always the row format; the JSON selector does not
           * apply. It also carries no bank identity, so derive a readable one
           * from the file and sheet rather than leaving a generic default the
           * user then has to notice and fix.
           */
          const baseName = file.name.replace(/\.[^.]+$/, '').trim();
          const title = source.sheetName && source.sheetName !== 'Sheet1'
            ? `${baseName} — ${source.sheetName}`
            : baseName;
          accept(
            {
              rows: source.rows,
              bankId: slugify(baseName) || 'imported-bank',
              title: title || 'Imported question bank',
            },
            'rows',
            source,
          );
        } catch (caught) {
          setPreview(null);
          setIssues([]);
          setError(
            caught instanceof TabularError ? caught.message : `Could not read ${file.name}.`,
          );
        }
        return;
      }

      if (!isJsonFilename(file.name)) {
        setPreview(null);
        setIssues([]);
        setError(
          `${file.name} is not a supported file. Use .xlsx, .csv, .tsv or .json — ` +
            'an Excel workbook can be dropped here directly.',
        );
        return;
      }

      try {
        const text = await readFileAsText(file);
        accept(JSON.parse(text), format);
      } catch (caught) {
        setPreview(null);
        setIssues([]);
        setError(
          caught instanceof SyntaxError
            ? `${file.name} is not valid JSON: ${caught.message}`
            : `Could not read ${file.name}.`,
        );
      }
    },
    [accept, format],
  );

  const install = useCallback(
    async (bank: QuestionBank, builtIn = false) => {
      await saveBank(bank, builtIn);
      setPreview(null);
      setIssues([]);
      setStatus(`Installed “${bank.title}” (version ${bank.bankVersion}).`);
      await refresh();
      onBanksChanged?.();
    },
    [onBanksChanged, refresh],
  );

  /** Open a bank JSON from disk, keeping a write handle where possible. */
  const openForEditing = useCallback(async () => {
    setError(null);
    setStatus(null);
    try {
      const opened = await openJsonFile();
      if (!opened) return;
      const text = await opened.file.text();
      const result = importNormalizedBank(JSON.parse(text));
      if (!result.ok || !result.bank) {
        setIssues(result.issues);
        setError(`${opened.file.name} is not a valid question bank, so it was not opened.`);
        return;
      }
      setIssues([]);
      setEditing({
        bank: result.bank,
        handle: opened.handle,
        fileName: opened.file.name,
      });
    } catch (caught) {
      setError(
        caught instanceof SyntaxError
          ? 'That file is not valid JSON.'
          : caught instanceof Error
            ? caught.message
            : 'Could not open that file.',
      );
    }
  }, []);

  if (editing) {
    return (
      <BankEditorScreen
        initialBank={editing.bank}
        initialHandle={editing.handle}
        initialFileName={editing.fileName}
        onClose={() => {
          setEditing(null);
          void refresh();
        }}
        onInstall={async (bank) => {
          await saveBank(bank);
          await refresh();
          onBanksChanged?.();
        }}
      />
    );
  }

  return (
    <div className="screen">
      <div className="screen__inner">
        <div className="screen__bar">
          <div>
            <h1 className="screen__title">Question banks</h1>
            <p className="screen__subtitle">
              Banks are stored in this browser. Attempts reference a bank by id and version.
            </p>
          </div>
          <div className="screen__actions">
            <button type="button" className="btn btn--primary" onClick={onBack}>
              Start screen
            </button>
          </div>
        </div>

        <section style={{ marginBottom: 26 }}>
          <h2 className="dialog__section-title">Installed</h2>
          {banks.length === 0 ? (
            <p className="empty-state">
              No banks installed. Load the bundled fixture below to try the application.
            </p>
          ) : (
            <table className="table table--rows">
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col" style={{ width: 92 }}>
                    Version
                  </th>
                  <th scope="col" style={{ width: 82 }} className="table__num">
                    Questions
                  </th>
                  <th scope="col" style={{ width: 130 }}>
                    Answer key
                  </th>
                  <th scope="col" style={{ width: 150 }}>
                    Imported
                  </th>
                  <th scope="col" style={{ width: 150 }} />
                </tr>
              </thead>
              <tbody>
                {banks.map((bank) => (
                  <tr key={`${bank.bankId}::${bank.bankVersion}`}>
                    <td>
                      <div className="bank-row__title">{bank.title}</div>
                      <div className="bank-row__id">
                        {bank.bankId}
                        {bank.builtIn ? ' · bundled fixture' : ''} · checksum {bank.checksum}
                      </div>
                    </td>
                    <td>{bank.bankVersion}</td>
                    <td className="table__num">{bank.questionCount}</td>
                    <td>
                      {bank.fullAnswerKey
                        ? 'Complete'
                        : bank.hasAnswerKey
                          ? 'Partial'
                          : 'None — ungraded'}
                    </td>
                    <td>{new Date(bank.importedAt).toLocaleString()}</td>
                    <td>
                      <div className="bank-actions">
                        <button
                          type="button"
                          className="btn btn--sm"
                          title="Open this bank in the editor"
                          onClick={() => {
                            setEditing({ bank: bank.bank });
                            setPreview(null);
                            setIssues([]);
                          }}
                        >
                          <Pencil size={12} aria-hidden="true" /> Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn--sm btn--danger"
                          onClick={() => setPendingDelete(bank)}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section style={{ marginBottom: 22 }}>
          <h2 className="dialog__section-title">Import</h2>

          <div className="setting-row" style={{ maxWidth: 620, paddingBottom: 10 }}>
            <div className="setting-row__label">
              JSON format
              <span className="setting-row__hint">
                Only applies to .json files. Auto-detect reads the shape: an array or a{' '}
                <code>rows</code> property is treated as the row export. Spreadsheets are always
                read as rows.
              </span>
            </div>
            <div className="segmented">
              {(
                [
                  ['auto', 'Auto'],
                  ['normalized', 'Normalized'],
                  ['rows', 'Rows'],
                ] as Array<[Format, string]>
              ).map(([value, label]) => (
                <label className="segmented__option" key={value}>
                  <input
                    type="radio"
                    name="import-format"
                    checked={format === value}
                    onChange={() => setFormat(value)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div
            className={cn('dropzone', dragging && 'dropzone--active')}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files?.[0];
              if (file) void handleFile(file);
            }}
          >
            Drop an Excel workbook (.xlsx), a .csv/.tsv export or a question-bank .json here — including
            a bank file saved from the editor — or{' '}
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => fileRef.current?.click()}
              style={{ verticalAlign: 'baseline' }}
            >
              choose a file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xlsm,.csv,.tsv,.json,application/json"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
                event.target.value = '';
              }}
            />
          </div>

          <div className="screen__actions" style={{ marginTop: 10 }}>
            <button type="button" className="btn" onClick={() => void install(SAMPLE_BANK, true)}>
              Install bundled fixture bank
            </button>
            <button type="button" className="btn" onClick={() => accept(SAMPLE_ROWS, 'rows')}>
              Preview bundled row-format sample
            </button>
          </div>

          {error ? (
            <p className="banner banner--error" style={{ marginTop: 10 }}>
              {error}
            </p>
          ) : null}
          {status ? (
            <p className="banner banner--ok" style={{ marginTop: 10 }}>
              {status}
            </p>
          ) : null}

          {issues.length > 0 ? (
            <ul className="issue-list">
              {issues.map((issue, index) => (
                <li key={index}>
                  <span className={`issue-list__tag issue-list__tag--${issue.level}`}>
                    {issue.level === 'error' ? 'ERROR' : 'WARN'}
                  </span>
                  {issue.questionId ? (
                    <span className="issue-list__where">{issue.questionId}</span>
                  ) : null}
                  {issue.rowIndex !== undefined ? (
                    <span className="issue-list__where">row {issue.rowIndex}</span>
                  ) : null}
                  {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section style={{ marginBottom: 22 }}>
          <h2 className="dialog__section-title">Edit</h2>
          <div className="screen__actions" style={{ marginBottom: 8 }}>
            <button type="button" className="btn" onClick={() => void openForEditing()}>
              <FolderOpen size={13} aria-hidden="true" /> Open a bank file to edit…
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setEditing({ bank: createEmptyBank() })}
            >
              <FilePlus2 size={13} aria-hidden="true" /> Create a new bank
            </button>
          </div>
          <p className="note">
            Saving in the editor does both halves: it writes a question-bank JSON file you can keep,
            share or re-open later, <strong>and</strong> updates the copy this app uses for attempts.
            {supportsFileSystemAccess()
              ? ' Saving writes back to the same file on your disk.'
              : ' This browser cannot write files in place, so saving downloads a copy — Chrome or Edge can save directly.'}
          </p>
        </section>

        {preview ? (
          <section ref={previewRef}>
            <h2 className="dialog__section-title">Ready to install</h2>

            {preview.source ? (
              <p className="note" style={{ marginBottom: 10 }}>
                Read {preview.source.rows.length} rows
                {preview.source.sheetName ? ` from sheet “${preview.source.sheetName}”` : ''}
                {preview.source.skippedEmptyRows > 0
                  ? `, skipping ${preview.source.skippedEmptyRows} blank row(s)`
                  : ''}
                .
                {preview.source.unrecognizedHeaders.length > 0
                  ? ` Columns ignored: ${preview.source.unrecognizedHeaders.join(', ')}.`
                  : ''}
                {preview.source.sheetNames && preview.source.sheetNames.length > 1
                  ? ` Other sheets in this workbook: ${preview.source.sheetNames
                      .filter((name) => name !== preview.source?.sheetName)
                      .join(', ')}.`
                  : ''}
              </p>
            ) : null}

            <dl className="kv" style={{ marginBottom: 12 }}>
              <dt>Title</dt>
              <dd>{preview.bank.title}</dd>
              <dt>Bank id / version</dt>
              <dd>
                {preview.bank.bankId} · {preview.bank.bankVersion}
              </dd>
              <dt>Questions</dt>
              <dd>{preview.described.questionCount}</dd>
              <dt>Years</dt>
              <dd>{preview.years.length > 0 ? preview.years.join(', ') : '—'}</dd>
              <dt>Parts</dt>
              <dd>{preview.parts.length > 0 ? preview.parts.join(', ') : '—'}</dd>
              <dt>Answer key</dt>
              <dd>
                {preview.described.fullAnswerKey
                  ? 'Present for every question'
                  : preview.described.hasAnswerKey
                    ? 'Present for some questions — the rest cannot be graded'
                    : 'Absent — this bank cannot be graded'}
              </dd>
              <dt>Checksum</dt>
              <dd style={{ fontFamily: 'var(--font-mono)' }}>{preview.described.checksum}</dd>
            </dl>

            <div className="screen__actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void install(preview.bank)}
              >
                Install bank
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  // Drop the preview: it holds the PRE-edit bank, and leaving it
                  // behind would offer to install the old version over the new.
                  setEditing({ bank: preview.bank });
                  setPreview(null);
                  setIssues([]);
                }}
              >
                <Pencil size={13} aria-hidden="true" /> Open in editor
              </button>
              <button type="button" className="btn" onClick={() => setPreview(null)}>
                Discard
              </button>
            </div>
            {!preview.described.hasAnswerKey ? (
              <p className="note note--warn" style={{ marginTop: 8 }}>
                No answer key was found in this file. Open it in the editor and use{' '}
                <strong>Key</strong> to apply one.
              </p>
            ) : null}
          </section>
        ) : null}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Remove question bank?"
        confirmLabel="Remove bank"
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (!target) return;
          void deleteBank(target.bankId, target.bankVersion).then(() => {
            void refresh();
            onBanksChanged?.();
          });
        }}
      >
        <p className="note">
          “{pendingDelete?.title}” version {pendingDelete?.bankVersion} is removed from this
          browser. Attempts that reference it are kept but cannot be opened until the same bank
          version is imported again.
        </p>
      </ConfirmDialog>
    </div>
  );
}
