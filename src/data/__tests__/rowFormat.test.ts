import { describe, expect, it } from 'vitest';

import { detectSelectCount, importRowFormat } from '../importers/rowFormat';
import { SAMPLE_ROWS } from '../../sample-data';

interface Row {
  index: number;
  row_type: string;
  option_label?: string;
  row_text?: string;
  question_id: string;
  source_question_number?: number | string;
  year?: number;
  part?: number | string;
  cleaned?: string | boolean;
  question_text?: string;
  review_note?: string;
  [key: string]: unknown;
}

function questionRow(index: number, id: string, overrides: Partial<Row> = {}): Row {
  return {
    index,
    row_type: 'question',
    option_label: '',
    row_text: '',
    question_id: id,
    source_question_number: 17,
    year: 2024,
    part: 1,
    cleaned: 'TRUE',
    question_text: 'A 45-year-old man...',
    review_note: '',
    ...overrides,
  };
}

function optionRow(index: number, id: string, label: string, text: string): Row {
  return {
    index,
    row_type: 'option',
    option_label: label,
    row_text: text,
    question_id: id,
    question_text: '',
    review_note: '',
  };
}

describe('row-format importer', () => {
  it('builds one question from a question row followed by its option rows', () => {
    const result = importRowFormat([
      questionRow(1, '2024-P1-Q017'),
      optionRow(2, '2024-P1-Q017', 'A', 'Option A text'),
      optionRow(3, '2024-P1-Q017', 'B', 'Option B text'),
      optionRow(4, '2024-P1-Q017', 'C', 'Option C text'),
    ]);

    expect(result.ok).toBe(true);
    const question = result.bank?.questions[0];
    expect(question).toBeDefined();
    expect(question?.id).toBe('2024-P1-Q017');
    expect(question?.sourceQuestionNumber).toBe(17);
    expect(question?.year).toBe(2024);
    expect(question?.part).toBe(1);
    expect(question?.cleaned).toBe(true);
    expect(question?.stem).toBe('A 45-year-old man...');
    expect(question?.questionType).toBe('single');
    expect(question?.correctAnswer).toBeUndefined();
  });

  it('preserves option order and labels exactly as authored', () => {
    const result = importRowFormat([
      questionRow(1, 'Q'),
      optionRow(2, 'Q', 'C', 'third in the alphabet, first in the source'),
      optionRow(3, 'Q', 'A', 'second in the source'),
      optionRow(4, 'Q', 'B', 'third in the source'),
    ]);

    expect(result.ok).toBe(true);
    expect(result.bank?.questions[0]?.options.map((o) => o.label)).toEqual(['C', 'A', 'B']);
    expect(result.bank?.questions[0]?.options[0]?.text).toBe(
      'third in the alphabet, first in the source',
    );
  });

  it.each([4, 5, 8])('handles a question with %i options', (count) => {
    const labels = 'ABCDEFGH'.slice(0, count).split('');
    const result = importRowFormat([
      questionRow(1, 'Q'),
      ...labels.map((label, i) => optionRow(i + 2, 'Q', label, `text ${label}`)),
    ]);
    expect(result.ok).toBe(true);
    expect(result.bank?.questions[0]?.options).toHaveLength(count);
    expect(result.bank?.questions[0]?.options.map((o) => o.label)).toEqual(labels);
  });

  it('preserves the question id across many questions', () => {
    const rows: Row[] = [];
    const ids = ['2024-P1-Q001', '2024-P1-Q002', '2023-P2-Q150'];
    let index = 1;
    ids.forEach((id) => {
      rows.push(questionRow(index++, id));
      rows.push(optionRow(index++, id, 'A', 'a'));
      rows.push(optionRow(index++, id, 'B', 'b'));
    });
    const result = importRowFormat(rows);
    expect(result.bank?.questions.map((q) => q.id)).toEqual(ids);
  });

  it('never rewrites deliberate placeholders in the source', () => {
    const placeholder = '[SOURCE PAGE MISSING — stem not recovered from the scan]';
    const result = importRowFormat([
      questionRow(1, 'Q', { question_text: placeholder, cleaned: 'FALSE', review_note: 'page 12 illegible' }),
      optionRow(2, 'Q', 'A', '[OPTION TEXT MISSING]'),
      optionRow(3, 'Q', 'B', 'Real option'),
    ]);
    expect(result.bank?.questions[0]?.stem).toBe(placeholder);
    expect(result.bank?.questions[0]?.options[0]?.text).toBe('[OPTION TEXT MISSING]');
    expect(result.bank?.questions[0]?.cleaned).toBe(false);
    expect(result.bank?.questions[0]?.reviewNote).toBe('page 12 illegible');
  });

  it('reads an explicit "(Select three.)" instruction as a multiple-select question', () => {
    const result = importRowFormat([
      questionRow(1, 'Q', { question_text: 'Which apply? (Select three.)' }),
      ...'ABCDEF'.split('').map((label, i) => optionRow(i + 2, 'Q', label, label)),
    ]);
    const question = result.bank?.questions[0];
    expect(question?.questionType).toBe('multiple');
    expect(question?.selectCount).toBe(3);
    expect(result.issues.some((issue) => issue.level === 'warning')).toBe(true);
  });

  it('detects select counts written as words or digits', () => {
    expect(detectSelectCount('(Select two.)')).toBe(2);
    expect(detectSelectCount('Select 4 answers')).toBe(4);
    expect(detectSelectCount('No instruction here')).toBeUndefined();
  });

  it('reports a question with no options instead of inventing any', () => {
    const result = importRowFormat([questionRow(1, '2024-P1-Q042')]);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ level: 'error', questionId: '2024-P1-Q042' }),
    );
    expect(result.bank?.questions[0]?.options).toEqual([]);
  });

  it('reports an option row that precedes its question row, naming the row', () => {
    const result = importRowFormat([
      optionRow(1, 'Q-ORPHAN', 'A', 'a'),
      questionRow(2, 'Q-ORPHAN'),
      optionRow(3, 'Q-ORPHAN', 'A', 'a'),
    ]);
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toMatchObject({ level: 'error', rowIndex: 1, questionId: 'Q-ORPHAN' });
  });

  it('reports an unknown row_type rather than dropping the row silently', () => {
    const result = importRowFormat([
      questionRow(1, 'Q'),
      optionRow(2, 'Q', 'A', 'a'),
      { index: 3, row_type: 'footnote', question_id: 'Q', row_text: 'something' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('footnote'))).toBe(true);
  });

  it('reports duplicate option labels', () => {
    const result = importRowFormat([
      questionRow(1, 'Q'),
      optionRow(2, 'Q', 'A', 'a'),
      optionRow(3, 'Q', 'A', 'a again'),
    ]);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('Duplicate option label'))).toBe(true);
  });

  it('rejects an answer key that names an option that is not present', () => {
    const result = importRowFormat([
      questionRow(1, 'Q', { correct_answer: 'F' }),
      optionRow(2, 'Q', 'A', 'a'),
      optionRow(3, 'Q', 'B', 'b'),
    ]);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('not present'))).toBe(true);
  });

  it('reads a multi-valued answer-key cell', () => {
    const result = importRowFormat([
      questionRow(1, 'Q', { correct_answer: 'B, D, F', question_type: 'multiple', select_count: 3 }),
      ...'ABCDEF'.split('').map((label, i) => optionRow(i + 2, 'Q', label, label)),
    ]);
    expect(result.ok).toBe(true);
    expect(result.bank?.questions[0]?.correctAnswer).toEqual(['B', 'D', 'F']);
  });

  it('accepts the bundled row-format sample', () => {
    const result = importRowFormat(SAMPLE_ROWS);
    expect(result.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.bank?.bankId).toBe('sample-row-import');
    expect(result.bank?.questions).toHaveLength(3);
  });

  it('rejects a file that is not a row array', () => {
    expect(importRowFormat({ nonsense: true }).ok).toBe(false);
    expect(importRowFormat([]).ok).toBe(false);
  });
});
