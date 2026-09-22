import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { QuestionBank } from '../../types/question';
import { clearAllData, saveBank } from '../../storage/repositories';
import { BankEditorScreen } from '../editor/BankEditorScreen';

function bank(): QuestionBank {
  return {
    schemaVersion: 1,
    bankId: 'edit-ui',
    bankVersion: '1',
    title: 'Edit UI bank',
    questions: [
      {
        id: 'E-Q1',
        sourceQuestionNumber: 1,
        questionType: 'single',
        stem: 'First stem',
        options: [
          { label: 'A', text: 'Alpha' },
          { label: 'B', text: 'Bravo' },
          { label: 'C', text: 'Charlie' },
        ],
        correctAnswer: ['B'],
      },
      {
        id: 'E-Q2',
        sourceQuestionNumber: 2,
        questionType: 'single',
        stem: 'Second stem',
        options: [
          { label: 'A', text: 'Alpha' },
          { label: 'B', text: 'Bravo' },
        ],
      },
    ],
  };
}

function renderEditor(overrides: Partial<React.ComponentProps<typeof BankEditorScreen>> = {}) {
  const props = {
    initialBank: bank(),
    onClose: vi.fn(),
    onInstall: vi.fn(),
    ...overrides,
  };
  return { ...render(<BankEditorScreen {...props} />), props };
}

beforeEach(async () => {
  await clearAllData();
});

describe('BankEditorScreen', () => {
  it('opens on the first question and lists them all in the rail', () => {
    const { container } = renderEditor();
    expect(container.querySelectorAll('.rail__row')).toHaveLength(2);
    expect(screen.getByLabelText('Question id')).toHaveValue('E-Q1');
    expect(screen.getByLabelText('Question stem')).toHaveValue('First stem');
  });

  it('shows no unsaved-changes marker until something is edited', async () => {
    const user = userEvent.setup();
    const { container } = renderEditor();
    expect(container.querySelector('.dirty-dot')).toBeNull();

    await user.type(screen.getByLabelText('Question stem'), ' edited');
    expect(container.querySelector('.dirty-dot')).not.toBeNull();
  });

  it('edits option text and the answer key', async () => {
    const user = userEvent.setup();
    renderEditor();

    const optionC = screen.getByLabelText('Option C text');
    await user.clear(optionC);
    await user.type(optionC, 'Changed charlie');
    expect(optionC).toHaveValue('Changed charlie');

    // B starts as the key; move it to C.
    expect(screen.getByLabelText('Mark option B correct')).toBeChecked();
    await user.click(screen.getByLabelText('Mark option C correct'));
    expect(screen.getByLabelText('Mark option C correct')).toBeChecked();
    expect(screen.getByLabelText('Mark option B correct')).not.toBeChecked();
  });

  it('keeps the caret while a multi-character option label is typed', async () => {
    const user = userEvent.setup();
    renderEditor();

    const label = screen.getByLabelText('Option 3 label');
    await user.clear(label);
    await user.type(label, 'iii');

    // A label-derived React key would remount this input per keystroke and
    // leave only the last character behind.
    expect(label).toHaveValue('iii');
  });

  it('carries the answer key with a renamed label', async () => {
    const user = userEvent.setup();
    renderEditor();

    const label = screen.getByLabelText('Option 2 label'); // B, the current key
    await user.clear(label);
    await user.type(label, 'X');

    expect(screen.getByLabelText('Mark option X correct')).toBeChecked();
  });

  it('navigates between questions from the rail', async () => {
    const user = userEvent.setup();
    const { container } = renderEditor();
    const rows = container.querySelectorAll('.rail__row');
    await user.click(rows[1] as HTMLElement);
    expect(screen.getByLabelText('Question id')).toHaveValue('E-Q2');
  });

  it('marks a question with no answer key as a warning in the rail', () => {
    const { container } = renderEditor();
    const dots = container.querySelectorAll('.rail__dot');
    expect(dots[0]?.className).toContain('rail__dot--health-ok');
    expect(dots[1]?.className).toContain('rail__dot--health-warning');
  });

  it('filters the rail to questions with no answer key', async () => {
    const user = userEvent.setup();
    const { container } = renderEditor();
    await user.click(screen.getByTitle('Questions with no answer key'));
    expect(container.querySelectorAll('.rail__row')).toHaveLength(1);
  });

  it('surfaces a validation error and clears it when fixed', async () => {
    const user = userEvent.setup();
    renderEditor();

    // Duplicate an option label to create an error.
    const labelB = screen.getByLabelText('Option 2 label');
    await user.clear(labelB);
    await user.type(labelB, 'A');

    expect(await screen.findByText(/Duplicate option label/)).toBeInTheDocument();
    expect(screen.getByText(/would stop it being installed/)).toBeInTheDocument();

    await user.clear(labelB);
    await user.type(labelB, 'B');
    expect(screen.queryByText(/Duplicate option label/)).not.toBeInTheDocument();
  });

  it('adds and deletes a question', async () => {
    const user = userEvent.setup();
    const { container } = renderEditor();

    await user.click(screen.getByTitle('Add a new question after this one'));
    expect(container.querySelectorAll('.rail__row')).toHaveLength(3);

    await user.click(screen.getByTitle('Delete this question'));
    await user.click(screen.getByRole('button', { name: 'Delete question' }));
    expect(container.querySelectorAll('.rail__row')).toHaveLength(2);
  });

  it('Save updates the copy the app uses, not just a file', async () => {
    const user = userEvent.setup();
    const onInstall = vi.fn();
    renderEditor({ onInstall });

    await user.click(screen.getByLabelText('Mark option C correct'));
    await user.click(screen.getByTitle(/Save the bank/));

    // The whole point of the fix: saving reaches the application's own store.
    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(onInstall.mock.calls[0]?.[0]).toMatchObject({
      bankId: 'edit-ui',
      questions: expect.arrayContaining([expect.objectContaining({ correctAnswer: ['C'] })]),
    });
    expect(await screen.findByText(/the app now uses this version/)).toBeInTheDocument();
  });

  it('writes the file but refuses to update the app when the bank is invalid', async () => {
    const user = userEvent.setup();
    const onInstall = vi.fn();
    renderEditor({ onInstall });

    const labelB = screen.getByLabelText('Option 2 label');
    await user.clear(labelB); // an empty label is invalid

    await user.click(screen.getByTitle(/Save the bank/));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/will still be written/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save anyway' }));

    expect(onInstall).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/the copy inside the app was NOT updated/),
    ).toBeInTheDocument();
  });

  it('tells you whether the app is running this version', async () => {
    renderEditor();
    // getBank() finds nothing for this draft in the test database.
    expect(await screen.findByText(/In this app: not added yet/)).toBeInTheDocument();
  });

  it('reports the app as out of date once an edit diverges from the stored copy', async () => {
    const user = userEvent.setup();
    await saveBank(bank());
    renderEditor();

    expect(await screen.findByText(/In this app: up to date/)).toBeInTheDocument();

    await user.click(screen.getByLabelText('Mark option C correct'));
    expect(await screen.findByText(/In this app: out of date/)).toBeInTheDocument();
  });

  it('refreshes the sync banner after saving, not just after editing', async () => {
    const user = userEvent.setup();
    await saveBank(bank());
    // A real install, so the stored checksum actually moves.
    renderEditor({ onInstall: async (next) => void (await saveBank(next)) });

    await user.click(screen.getByLabelText('Mark option C correct'));
    expect(await screen.findByText(/In this app: out of date/)).toBeInTheDocument();

    await user.click(screen.getByTitle(/Save the bank/));

    // Saving does not change the bank's content, so the banner only updates if
    // the check is explicitly re-run after a save.
    await waitFor(() =>
      expect(screen.getByText(/In this app: up to date/)).toBeInTheDocument(),
    );
  });

  it('closes immediately when nothing has changed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderEditor({ onClose });
    await user.click(screen.getByTitle('Close the editor'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks before discarding unsaved changes, and closes on confirm', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderEditor({ onClose });

    await user.type(screen.getByLabelText('Question stem'), '!');
    await user.click(screen.getByTitle('Close the editor'));
    expect(onClose).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/have not been written to a file/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Discard and close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('applies a whole answer key through the key dialog', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByTitle('Apply a whole answer key at once'));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Answer key/), 'C\nA');

    expect(await within(dialog).findByText(/Ready: 1 answer will be written/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /Apply 1 answer/ }));

    // Q1 already had B and is left alone; Q2 gains A.
    expect(screen.getByLabelText('Mark option B correct')).toBeChecked();
  });

  it('refuses an answer key whose length does not match the bank', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByTitle('Apply a whole answer key at once'));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Answer key/), 'C');

    expect(await within(dialog).findByText(/Nothing will be applied/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Apply' })).toBeDisabled();
  });
});
