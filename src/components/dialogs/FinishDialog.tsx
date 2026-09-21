import type { AttemptSummary } from '../../types/attempt';
import { Modal } from '../common/Modal';

export interface FinishDialogProps {
  open: boolean;
  summary: AttemptSummary;
  mode: 'exam' | 'tutor';
  onClose: () => void;
  onSubmit: () => void;
}

/** Restrained confirmation before an attempt is submitted and graded. */
export function FinishDialog({ open, summary, mode, onClose, onSubmit }: FinishDialogProps) {
  return (
    <Modal
      open={open}
      title="Finish attempt"
      onClose={onClose}
      size="narrow"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Return to Questions
          </button>
          <button type="button" className="btn btn--primary" onClick={onSubmit}>
            Submit Attempt
          </button>
        </>
      }
    >
      <table className="table" style={{ marginBottom: 12 }}>
        <tbody>
          <tr>
            <td>Total</td>
            <td className="table__num">{summary.total}</td>
          </tr>
          <tr>
            <td>Answered</td>
            <td className="table__num">{summary.answered}</td>
          </tr>
          <tr>
            <td>Unanswered</td>
            <td className="table__num">{summary.unanswered}</td>
          </tr>
          <tr>
            <td>Marked</td>
            <td className="table__num">{summary.marked}</td>
          </tr>
        </tbody>
      </table>

      <p className="note">
        {mode === 'exam'
          ? 'Submitting grades every answered item and opens the review screen. Unanswered items are reported as unanswered, not as incorrect.'
          : 'Items already graded keep their result. Any remaining answered items are graded on submission.'}
      </p>
      {summary.unanswered > 0 ? (
        <p className="note note--warn" style={{ marginTop: 8 }}>
          {summary.unanswered} item{summary.unanswered === 1 ? ' is' : 's are'} still unanswered.
        </p>
      ) : null}
    </Modal>
  );
}
