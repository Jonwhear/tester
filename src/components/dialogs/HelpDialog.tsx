import { Modal } from '../common/Modal';

export interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
  shortcutsEnabled: boolean;
}

export function HelpDialog({ open, onClose, shortcutsEnabled }: HelpDialogProps) {
  return (
    <Modal open={open} title="Tutorial" onClose={onClose} size="wide">
      <div className="help">
        <h3>Navigation</h3>
        <ul>
          <li>Previous / Next move one item at a time and stop at the first and last item.</li>
          <li>Click any number in the left status list to jump straight to that item.</li>
          <li>
            <strong>Item</strong> is the position within this attempt; <strong>Question Id</strong>{' '}
            is the permanent identifier from the source bank. They are not the same thing.
          </li>
        </ul>

        <h3>Exam mode vs Tutor mode</h3>
        <ul>
          <li>
            <strong>Exam</strong> — selections are recorded but nothing is revealed. No option is
            coloured, no answer key is shown, and the status list shows only that an item was
            answered. Grading happens when you submit the attempt.
          </li>
          <li>
            <strong>Tutor</strong> — a single-answer item is graded the moment you choose an option:
            your choice turns green if correct, red if not, and the correct option turns green.
            The status list turns green or red to match. A multiple-answer item waits for{' '}
            <strong>Check Answer</strong> so you can change your mind first.
          </li>
          <li>
            An item with no answer key in the bank can still be answered, but is reported as
            ungraded. The application never guesses a correct answer.
          </li>
        </ul>

        <h3>Mark Question</h3>
        <p>
          The Mark Question checkbox flags an item for later. Marked items show a boxed number in
          the status list and can be filtered on the review screen.
        </p>

        <h3>Notes</h3>
        <p>
          Notes belong to one item within one attempt and save automatically as you type.
        </p>

        {shortcutsEnabled ? (
          <>
            <h3>Keyboard shortcuts</h3>
            <ul>
              <li>
                <kbd>←</kbd> / <kbd>→</kbd> — previous / next item
              </li>
              <li>
                <kbd>A</kbd>–<kbd>H</kbd> — choose the matching option
              </li>
              <li>
                <kbd>M</kbd> — mark / unmark the current item
              </li>
              <li>
                <kbd>N</kbd> — open notes
              </li>
              <li>
                <kbd>Esc</kbd> — close a dialog or drawer
              </li>
            </ul>
            <p className="note">
              Shortcuts stay inactive while you are typing in a text field. They can be turned off
              entirely in Settings.
            </p>
          </>
        ) : (
          <>
            <h3>Keyboard shortcuts</h3>
            <p className="note">Shortcuts are currently disabled in Settings.</p>
          </>
        )}

        <h3>Saving and resuming</h3>
        <p>
          Progress saves to this browser automatically after every answer, navigation, mark and
          note — there is no Save button. Closing the tab and returning later resumes the attempt
          where you left it. Settings → Progress can export a save file and import it back.
        </p>

        <h3>Finishing and reviewing</h3>
        <p>
          Finish submits the attempt after a confirmation showing how many items are answered,
          unanswered and marked. The review screen then lists every item with its result and can be
          filtered to incorrect, correct, unanswered or marked items. Selecting an item reopens it
          in review, showing your answer, the correct answer and any explanation the bank supplies.
        </p>
      </div>
    </Modal>
  );
}
