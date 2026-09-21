import type { QuestionBank } from '../../types/question';
import { nextBankVersion, updateBankMeta, validateBank } from '../../state/bankEditor';
import { Modal } from '../common/Modal';

export interface BankDetailsDialogProps {
  open: boolean;
  bank: QuestionBank;
  onChange: (bank: QuestionBank) => void;
  onClose: () => void;
}

export function BankDetailsDialog({ open, bank, onChange, onClose }: BankDetailsDialogProps) {
  const metaIssues = validateBank(bank).filter((issue) => issue.field === 'meta');

  return (
    <Modal
      open={open}
      title="Bank details"
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <div style={{ display: 'grid', gap: 10 }}>
        <div className="editor-field">
          <label className="editor-field__label" htmlFor="bank-title">
            Title
          </label>
          <input
            id="bank-title"
            className="editor-input"
            value={bank.title}
            onChange={(event) => onChange(updateBankMeta(bank, { title: event.target.value }))}
          />
        </div>

        <div className="editor-field">
          <label className="editor-field__label" htmlFor="bank-id">
            Bank id — attempts reference this, so avoid changing it once in use
          </label>
          <input
            id="bank-id"
            className="editor-input editor-input--mono"
            value={bank.bankId}
            onChange={(event) => onChange(updateBankMeta(bank, { bankId: event.target.value }))}
          />
        </div>

        <div className="editor-field">
          <label className="editor-field__label" htmlFor="bank-version">
            Version — bump this whenever the content changes
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              id="bank-version"
              className="editor-input editor-input--mono"
              value={bank.bankVersion}
              onChange={(event) =>
                onChange(updateBankMeta(bank, { bankVersion: event.target.value }))
              }
            />
            <button
              type="button"
              className="btn btn--sm"
              title={`Set to ${nextBankVersion(bank.bankVersion)}`}
              onClick={() =>
                onChange(updateBankMeta(bank, { bankVersion: nextBankVersion(bank.bankVersion) }))
              }
            >
              Bump
            </button>
          </div>
        </div>

        <div className="editor-field">
          <label className="editor-field__label" htmlFor="bank-description">
            Description
          </label>
          <textarea
            id="bank-description"
            className="editor-text editor-text--short"
            value={bank.description ?? ''}
            onChange={(event) =>
              onChange(updateBankMeta(bank, { description: event.target.value }))
            }
          />
        </div>

        <dl className="kv">
          <dt>Questions</dt>
          <dd>{bank.questions.length}</dd>
          <dt>With an answer key</dt>
          <dd>
            {bank.questions.filter((q) => (q.correctAnswer?.length ?? 0) > 0).length} of{' '}
            {bank.questions.length}
          </dd>
          <dt>Schema version</dt>
          <dd>{bank.schemaVersion}</dd>
        </dl>

        {metaIssues.length > 0 ? (
          <div className="banner banner--error">
            {metaIssues.map((issue) => issue.message).join(' ')}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
