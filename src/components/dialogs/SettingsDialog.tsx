import { useRef, useState } from 'react';

import type { AppSettings, ContentWidth, FontSize } from '../../types/settings';
import type { TestingMode } from '../../types/attempt';
import { Modal } from '../common/Modal';
import { ConfirmDialog } from '../common/ConfirmDialog';

export interface SettingsDialogProps {
  open: boolean;
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  onClose: () => void;
  /** Present while an attempt is open; absent on the start screen. */
  attempt?: {
    mode: TestingMode;
    completed: boolean;
    onModeChange: (mode: TestingMode) => void;
    onClear: () => void;
    onExit: () => void;
  };
  onOpenBanks: () => void;
  onExportProgress: () => void;
  onExportPortable: () => void;
  onImportProgress: (file: File) => void;
  importMessage?: { level: 'ok' | 'error' | 'warn'; text: string } | null;
}

export function SettingsDialog({
  open,
  settings,
  onChange,
  onClose,
  attempt,
  onOpenBanks,
  onExportProgress,
  onExportPortable,
  onImportProgress,
  importMessage,
}: SettingsDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const mode = attempt ? attempt.mode : settings.mode;
  const modeLocked = Boolean(attempt?.completed);

  return (
    <>
      <Modal
        open={open}
        title="Settings"
        onClose={onClose}
        footer={
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        }
      >
        <section className="dialog__section">
          <h3 className="dialog__section-title">Testing mode</h3>
          <div className="setting-row">
            <div className="setting-row__label">
              Mode
              <span className="setting-row__hint">
                {mode === 'exam'
                  ? 'No correctness is shown until the attempt is submitted.'
                  : 'Single-answer items are graded immediately.'}
              </span>
            </div>
            <div className="segmented">
              {(['exam', 'tutor'] as const).map((value) => (
                <label className="segmented__option" key={value}>
                  <input
                    type="radio"
                    name="testing-mode"
                    value={value}
                    checked={mode === value}
                    disabled={modeLocked}
                    onChange={() => {
                      if (attempt) attempt.onModeChange(value);
                      else onChange({ mode: value });
                    }}
                  />
                  <span>{value === 'exam' ? 'Exam' : 'Tutor'}</span>
                </label>
              ))}
            </div>
          </div>
          {attempt ? (
            <p className="note">
              {modeLocked
                ? 'This attempt is complete, so its mode can no longer change.'
                : 'Changing mode applies to this attempt. Items already graded keep their result.'}
            </p>
          ) : (
            <p className="note">This is the mode the next attempt will start in.</p>
          )}
        </section>

        <section className="dialog__section">
          <h3 className="dialog__section-title">Question navigation</h3>
          <div className="setting-row">
            <div className="setting-row__label">
              Auto-advance after answering
              <span className="setting-row__hint">
                Moves to the next item once an answer is recorded and graded.
              </span>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.autoAdvance}
                onChange={(event) => onChange({ autoAdvance: event.target.checked })}
              />
              <span>{settings.autoAdvance ? 'On' : 'Off'}</span>
            </label>
          </div>
          <div className="setting-row">
            <div className="setting-row__label">
              Keyboard shortcuts
              <span className="setting-row__hint">Arrow keys, A–H, M, N.</span>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.keyboardShortcuts}
                onChange={(event) => onChange({ keyboardShortcuts: event.target.checked })}
              />
              <span>{settings.keyboardShortcuts ? 'Enabled' : 'Disabled'}</span>
            </label>
          </div>
        </section>

        <section className="dialog__section">
          <h3 className="dialog__section-title">Display</h3>
          <div className="setting-row">
            <div className="setting-row__label">Font size</div>
            <div className="segmented">
              {(['small', 'default', 'large'] as FontSize[]).map((value) => (
                <label className="segmented__option" key={value}>
                  <input
                    type="radio"
                    name="font-size"
                    value={value}
                    checked={settings.fontSize === value}
                    onChange={() => onChange({ fontSize: value })}
                  />
                  <span>{value[0]?.toUpperCase() + value.slice(1)}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-row__label">Content width</div>
            <div className="segmented">
              {(['default', 'wide'] as ContentWidth[]).map((value) => (
                <label className="segmented__option" key={value}>
                  <input
                    type="radio"
                    name="content-width"
                    value={value}
                    checked={settings.contentWidth === value}
                    onChange={() => onChange({ contentWidth: value })}
                  />
                  <span>{value[0]?.toUpperCase() + value.slice(1)}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-row__label">
              Suggested highlights
              <span className="setting-row__hint">
                Highlights phrases supplied by the question bank. No text is generated.
              </span>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.suggestedHighlights}
                onChange={(event) => onChange({ suggestedHighlights: event.target.checked })}
              />
              <span>{settings.suggestedHighlights ? 'On' : 'Off'}</span>
            </label>
          </div>
          <div className="setting-row">
            <div className="setting-row__label">
              Show source review notes
              <span className="setting-row__hint">
                Development aid: displays the upstream reviewer annotation inline.
              </span>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.showReviewNotes}
                onChange={(event) => onChange({ showReviewNotes: event.target.checked })}
              />
              <span>{settings.showReviewNotes ? 'On' : 'Off'}</span>
            </label>
          </div>
        </section>

        <section className="dialog__section">
          <h3 className="dialog__section-title">Question banks</h3>
          <button type="button" className="btn btn--block" onClick={onOpenBanks}>
            Manage question banks
          </button>
        </section>

        <section className="dialog__section">
          <h3 className="dialog__section-title">Progress</h3>
          <div style={{ display: 'grid', gap: 6 }}>
            <button type="button" className="btn btn--block" onClick={onExportProgress}>
              Export progress (attempts only)
            </button>
            <button type="button" className="btn btn--block" onClick={onExportPortable}>
              Export portable session (embeds the bank)
            </button>
            <button
              type="button"
              className="btn btn--block"
              onClick={() => fileRef.current?.click()}
            >
              Import progress…
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onImportProgress(file);
                event.target.value = '';
              }}
            />
            {attempt && !attempt.completed ? (
              <button
                type="button"
                className="btn btn--block btn--danger"
                onClick={() => setConfirmClear(true)}
              >
                Clear answers in this attempt
              </button>
            ) : null}
          </div>
          {importMessage ? (
            <p
              className={`banner banner--${
                importMessage.level === 'ok' ? 'ok' : importMessage.level === 'warn' ? 'warn' : 'error'
              }`}
              style={{ marginTop: 8 }}
            >
              {importMessage.text}
            </p>
          ) : null}
          <p className="note" style={{ marginTop: 8 }}>
            A portable session embeds the whole question bank and is much larger. Use the
            attempts-only export for routine backups.
          </p>
        </section>

        {attempt ? (
          <section className="dialog__section">
            <h3 className="dialog__section-title">Session</h3>
            <button type="button" className="btn btn--block" onClick={attempt.onExit}>
              Leave attempt and return to the start screen
            </button>
            <p className="note" style={{ marginTop: 6 }}>
              The attempt stays saved and can be resumed.
            </p>
          </section>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={confirmClear}
        title="Clear this attempt?"
        confirmLabel="Clear answers"
        destructive
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false);
          attempt?.onClear();
        }}
      >
        <p className="note">
          Every answer, mark and note in the current attempt is discarded and the attempt restarts
          from the first item. Previously completed attempts are not affected. This cannot be
          undone.
        </p>
      </ConfirmDialog>
    </>
  );
}
