import { useEffect, useRef, useState } from 'react';

import { Modal } from '../common/Modal';

export interface NotesDialogProps {
  open: boolean;
  questionId: string;
  itemNumber: number;
  notes: string;
  onChange: (notes: string) => void;
  onClose: () => void;
}

/**
 * Per-question notes drawer. A plain textarea by design — notes are working
 * scratch, not a document, so no rich-text editor.
 *
 * Autosaves on a short idle delay and again on close, so nothing is lost
 * without the user pressing a Save button.
 */
export function NotesDialog({
  open,
  questionId,
  itemNumber,
  notes,
  onChange,
  onClose,
}: NotesDialogProps) {
  const [draft, setDraft] = useState(notes);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Re-seed when the dialog opens or the question changes underneath it.
  useEffect(() => {
    setDraft(notes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId, open]);

  useEffect(() => {
    if (!open) return;
    if (draft === notes) return;
    const timer = setTimeout(() => onChangeRef.current(draft), 350);
    return () => clearTimeout(timer);
  }, [draft, notes, open]);

  const close = () => {
    if (draft !== notes) onChangeRef.current(draft);
    onClose();
  };

  return (
    <Modal
      open={open}
      title={`Notes — Item ${itemNumber}`}
      onClose={close}
      variant="drawer"
      initialFocusRef={textareaRef}
      footer={
        <button type="button" className="btn" onClick={close}>
          Close
        </button>
      }
    >
      <p className="note">
        Notes are saved with this attempt and attached to question{' '}
        <span style={{ fontFamily: 'var(--font-mono)' }}>{questionId}</span>. They save
        automatically.
      </p>
      <label className="sr-only" htmlFor="question-notes">
        Notes for item {itemNumber}
      </label>
      <textarea
        id="question-notes"
        ref={textareaRef}
        className="textarea"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Working notes for this question…"
        spellCheck
      />
    </Modal>
  );
}
