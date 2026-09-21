import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { TestingMode } from '../../types/attempt';
import type { QuestionBank } from '../../types/question';
import { DEFAULT_SETTINGS } from '../../types/settings';
import { createAttempt } from '../../state/attemptFactory';
import { useAttemptEngine } from '../../hooks/useAttemptEngine';
import { ExamScreen } from '../exam/ExamScreen';

const bank: QuestionBank = {
  schemaVersion: 1,
  bankId: 'ui-bank',
  bankVersion: '1',
  title: 'UI bank',
  questions: [
    {
      id: 'UI-Q1',
      questionType: 'single',
      stem: 'Which option is correct?',
      options: [
        { label: 'A', text: 'Alpha' },
        { label: 'B', text: 'Bravo' },
        { label: 'C', text: 'Charlie' },
      ],
      correctAnswer: ['B'],
      explanation: 'Because Bravo.',
    },
    {
      id: 'UI-Q2',
      questionType: 'single',
      stem: 'Second question stem.',
      options: [
        { label: 'A', text: 'Alpha' },
        { label: 'B', text: 'Bravo' },
      ],
      correctAnswer: ['A'],
    },
    {
      id: 'UI-Q3',
      questionType: 'multiple',
      selectCount: 2,
      stem: 'Pick two. (Select two.)',
      options: [
        { label: 'A', text: 'Alpha' },
        { label: 'B', text: 'Bravo' },
        { label: 'C', text: 'Charlie' },
        { label: 'D', text: 'Delta' },
      ],
      correctAnswer: ['A', 'C'],
    },
  ],
};

function Harness({ mode }: { mode: TestingMode }) {
  const engine = useAttemptEngine(createAttempt(bank, { mode }), bank, { persist: false });
  return (
    <ExamScreen
      engine={engine}
      bank={bank}
      settings={{ ...DEFAULT_SETTINGS, mode }}
      onSettingsChange={vi.fn()}
      onFinished={vi.fn()}
      onExit={vi.fn()}
      onOpenBanks={vi.fn()}
      onClearAttempt={vi.fn()}
      progress={{
        onExportProgress: vi.fn(),
        onExportPortable: vi.fn(),
        onImportProgress: vi.fn(),
        importMessage: null,
      }}
    />
  );
}

function optionRow(container: HTMLElement, label: string): HTMLElement {
  const input = container.querySelector<HTMLInputElement>(`#q-UI-Q1-${label}`);
  if (!input) throw new Error(`option ${label} not rendered`);
  return input.closest('.option') as HTMLElement;
}

function railRow(container: HTMLElement, index: number): HTMLElement {
  const rows = container.querySelectorAll<HTMLElement>('.rail__row');
  const row = rows[index];
  if (!row) throw new Error(`rail row ${index} not rendered`);
  return row;
}

describe('ExamScreen — shell', () => {
  it('shows the attempt position and the source question id separately', () => {
    render(<Harness mode="tutor" />);
    expect(screen.getByText('Item: 1 of 3')).toBeInTheDocument();
    expect(screen.getByText('Question Id: UI-Q1')).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('disables Previous on the first item and Next on the last', async () => {
    const user = userEvent.setup();
    render(<Harness mode="tutor" />);
    expect(screen.getByTitle(/Previous question/)).toBeDisabled();

    await user.click(screen.getByTitle(/Next question/));
    await user.click(screen.getByTitle(/Next question/));
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    expect(screen.getByTitle(/Next question/)).toBeDisabled();
  });

  it('navigates by clicking a number in the status rail', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness mode="tutor" />);
    await user.click(railRow(container, 1));
    expect(screen.getByText('Question Id: UI-Q2')).toBeInTheDocument();
    expect(screen.getByText('Second question stem.')).toBeInTheDocument();
  });
});

describe('ExamScreen — tutor mode', () => {
  it('turns a correct answer green in the options and in the rail', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness mode="tutor" />);

    await user.click(screen.getByLabelText('Bravo'));

    expect(optionRow(container, 'B')).toHaveClass('option--correct');
    expect(railRow(container, 0).querySelector('.rail__dot')).toHaveClass('rail__dot--correct');
    expect(container.querySelector('.feedback__verdict')).toHaveTextContent('Correct');
    expect(screen.getByText('Because Bravo.')).toBeInTheDocument();
  });

  it('turns a wrong answer red, reveals the correct option, and reddens the rail', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness mode="tutor" />);

    await user.click(screen.getByLabelText('Alpha'));

    expect(optionRow(container, 'A')).toHaveClass('option--incorrect');
    expect(optionRow(container, 'B')).toHaveClass('option--correct');
    expect(railRow(container, 0).querySelector('.rail__dot')).toHaveClass('rail__dot--incorrect');
    expect(screen.getByText(/Incorrect — correct answer: B/)).toBeInTheDocument();
  });

  it('locks the question once it has been graded', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness mode="tutor" />);

    await user.click(screen.getByLabelText('Alpha'));
    expect(screen.getByLabelText('Bravo')).toBeDisabled();
    await user.click(screen.getByLabelText('Bravo')).catch(() => undefined);
    expect(optionRow(container, 'A')).toHaveClass('option--incorrect');
  });

  it('waits for Check Answer on a multiple-select question', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness mode="tutor" />);

    await user.click(railRow(container, 2));
    expect(screen.getByText(/Select 2 options to continue/)).toBeInTheDocument();

    await user.click(screen.getByLabelText('Alpha'));
    await user.click(screen.getByLabelText('Charlie'));
    expect(container.querySelector('.option--correct')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Check Answer' }));
    expect(container.querySelector('.feedback__verdict')).toHaveTextContent('Correct');
  });
});

describe('ExamScreen — exam mode', () => {
  it('reveals nothing about correctness before submission', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness mode="exam" />);

    await user.click(screen.getByLabelText('Alpha'));

    expect(optionRow(container, 'A')).toHaveClass('option--selected');
    expect(container.querySelector('.option--correct')).toBeNull();
    expect(container.querySelector('.option--incorrect')).toBeNull();
    expect(container.querySelector('.feedback')).toBeNull();
    expect(screen.queryByText('Because Bravo.')).not.toBeInTheDocument();
    expect(railRow(container, 0).querySelector('.rail__dot')).toHaveClass('rail__dot--answered');
  });

  it('allows the answer to be changed while the attempt is open', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness mode="exam" />);

    await user.click(screen.getByLabelText('Alpha'));
    await user.click(screen.getByLabelText('Charlie'));

    expect(optionRow(container, 'C')).toHaveClass('option--selected');
    expect(optionRow(container, 'A')).not.toHaveClass('option--selected');
  });

  it('reveals correctness only after the attempt is submitted', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness mode="exam" />);

    await user.click(screen.getByLabelText('Alpha'));
    await user.click(screen.getByTitle(/Finish and submit/));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('2')).toBeInTheDocument(); // 2 unanswered
    await user.click(within(dialog).getByRole('button', { name: 'Submit Attempt' }));

    expect(optionRow(container, 'A')).toHaveClass('option--incorrect');
    expect(optionRow(container, 'B')).toHaveClass('option--correct');
    expect(railRow(container, 0).querySelector('.rail__dot')).toHaveClass('rail__dot--incorrect');
  });
});

describe('ExamScreen — marking and notes', () => {
  it('marks a question and shows it in the rail', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness mode="exam" />);

    const checkbox = screen.getByRole('checkbox', { name: /Mark Question/ });
    await user.click(checkbox);

    expect(checkbox).toBeChecked();
    expect(railRow(container, 0).querySelector('.rail__number')).toHaveClass(
      'rail__number--marked',
    );
  });

  it('keeps a mark when navigating away and back', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness mode="exam" />);

    await user.click(screen.getByRole('checkbox', { name: /Mark Question/ }));
    await user.click(screen.getByTitle(/Next question/));
    expect(screen.getByRole('checkbox', { name: /Mark Question/ })).not.toBeChecked();

    await user.click(railRow(container, 0));
    expect(screen.getByRole('checkbox', { name: /Mark Question/ })).toBeChecked();
  });

  it('stores a note against the current question', async () => {
    const user = userEvent.setup();
    render(<Harness mode="exam" />);

    await user.click(screen.getByTitle(/Notes for this question/));
    const textarea = await screen.findByLabelText(/Notes for item 1/);
    await user.type(textarea, 'check reticulocytes');

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByTitle(/Notes for this question/));
    expect(await screen.findByLabelText(/Notes for item 1/)).toHaveValue('check reticulocytes');
  });
});

describe('ExamScreen — keyboard', () => {
  it('moves between questions with the arrow keys and answers with a letter', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness mode="tutor" />);

    await user.keyboard('{ArrowRight}');
    expect(screen.getByText('Question Id: UI-Q2')).toBeInTheDocument();

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByText('Question Id: UI-Q1')).toBeInTheDocument();

    await user.keyboard('b');
    expect(optionRow(container, 'B')).toHaveClass('option--correct');
  });

  it('marks a question with M', async () => {
    const user = userEvent.setup();
    render(<Harness mode="exam" />);
    await user.keyboard('m');
    expect(screen.getByRole('checkbox', { name: /Mark Question/ })).toBeChecked();
  });

  it('does not fire shortcuts while typing in the notes field', async () => {
    const user = userEvent.setup();
    render(<Harness mode="exam" />);

    await user.click(screen.getByTitle(/Notes for this question/));
    const textarea = await screen.findByLabelText(/Notes for item 1/);
    await user.type(textarea, 'mm');

    expect(textarea).toHaveValue('mm');
    expect(screen.getByRole('checkbox', { name: /Mark Question/ })).not.toBeChecked();
  });
});
