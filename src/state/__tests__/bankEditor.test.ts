import { describe, expect, it } from 'vitest';

import type { QuestionBank } from '../../types/question';
import {
  addContentBlock,
  addOption,
  addQuestion,
  clearCorrectAnswer,
  createEmptyBank,
  duplicateQuestion,
  moveContentBlock,
  moveOption,
  moveQuestion,
  nextBankVersion,
  nextOptionLabel,
  questionHealth,
  relabelOptionsSequentially,
  removeContentBlock,
  removeOption,
  removeQuestion,
  setOptionLabel,
  setOptionText,
  setQuestionType,
  setSelectCount,
  suggestQuestionId,
  toggleCorrectAnswer,
  updateBankMeta,
  updateQuestion,
  validateBank,
  validateQuestion,
} from '../bankEditor';

function bank(): QuestionBank {
  return {
    schemaVersion: 1,
    bankId: 'edit-bank',
    bankVersion: '2024.1',
    title: 'Edit bank',
    questions: [
      {
        id: '2024-P1-Q001',
        sourceQuestionNumber: 1,
        year: 2024,
        part: 1,
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
        id: '2024-P1-Q002',
        sourceQuestionNumber: 2,
        questionType: 'multiple',
        selectCount: 2,
        stem: 'Second stem',
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
}

const first = '2024-P1-Q001';
const second = '2024-P1-Q002';

describe('bank metadata', () => {
  it('updates identity fields', () => {
    const next = updateBankMeta(bank(), { title: 'Renamed', bankVersion: '2024.2' });
    expect(next.title).toBe('Renamed');
    expect(next.bankVersion).toBe('2024.2');
  });

  it('drops a description that was blanked out', () => {
    const withDescription = { ...bank(), description: 'something' };
    expect(updateBankMeta(withDescription, { description: '  ' }).description).toBeUndefined();
  });

  it('suggests the next version', () => {
    expect(nextBankVersion('2024.1')).toBe('2024.2');
    expect(nextBankVersion('3')).toBe('4');
    expect(nextBankVersion('2024.9')).toBe('2024.10');
    expect(nextBankVersion('draft')).toBe('draft.1');
  });

  it('creates a usable empty bank', () => {
    const empty = createEmptyBank();
    expect(empty.questions).toEqual([]);
    expect(validateBank(empty).filter((i) => i.level === 'error')).toEqual([]);
  });
});

describe('question edits', () => {
  it('edits the stem without touching anything else', () => {
    const next = updateQuestion(bank(), first, { stem: 'Rewritten stem' });
    expect(next.questions[0]?.stem).toBe('Rewritten stem');
    expect(next.questions[0]?.options).toHaveLength(3);
    expect(next.questions[1]).toEqual(bank().questions[1]);
  });

  it('does not mutate the input bank', () => {
    const original = bank();
    updateQuestion(original, first, { stem: 'changed' });
    expect(original.questions[0]?.stem).toBe('First stem');
  });

  it('drops optional text fields that are blanked out', () => {
    const withNote = updateQuestion(bank(), first, { reviewNote: 'check this' });
    expect(withNote.questions[0]?.reviewNote).toBe('check this');
    const cleared = updateQuestion(withNote, first, { reviewNote: '   ' });
    expect(cleared.questions[0]).not.toHaveProperty('reviewNote');
  });

  it('returns the same bank when the question id is unknown', () => {
    const original = bank();
    expect(updateQuestion(original, 'NOPE', { stem: 'x' })).toBe(original);
  });
});

describe('option edits', () => {
  it('adds an option with the next free label', () => {
    const next = addOption(bank(), first, 'Delta');
    expect(next.questions[0]?.options).toHaveLength(4);
    expect(next.questions[0]?.options[3]).toEqual({ label: 'D', text: 'Delta' });
  });

  it('picks the next unused label, not simply the next index', () => {
    expect(nextOptionLabel([{ label: 'A', text: '' }, { label: 'C', text: '' }])).toBe('B');
  });

  it('edits option text', () => {
    const next = setOptionText(bank(), first, 1, 'Changed');
    expect(next.questions[0]?.options[1]?.text).toBe('Changed');
  });

  it('carries the answer key along when a label is renamed', () => {
    const next = setOptionLabel(bank(), first, 1, 'X');
    expect(next.questions[0]?.options[1]?.label).toBe('X');
    expect(next.questions[0]?.correctAnswer).toEqual(['X']);
  });

  it('drops a removed option out of the answer key', () => {
    const next = removeOption(bank(), first, 1);
    expect(next.questions[0]?.options.map((o) => o.label)).toEqual(['A', 'C']);
    expect(next.questions[0]).not.toHaveProperty('correctAnswer');
  });

  it('keeps the rest of a multi-answer key when one option is removed', () => {
    const next = removeOption(bank(), second, 0);
    expect(next.questions[1]?.correctAnswer).toEqual(['C']);
  });

  it('reorders options without renaming them', () => {
    const next = moveOption(bank(), first, 2, -1);
    expect(next.questions[0]?.options.map((o) => o.label)).toEqual(['A', 'C', 'B']);
    expect(next.questions[0]?.correctAnswer).toEqual(['B']);
  });

  it('refuses to move an option past the ends', () => {
    const original = bank();
    expect(moveOption(original, first, 0, -1)).toBe(original);
    expect(moveOption(original, first, 2, 1)).toBe(original);
  });

  it('relabels sequentially and remaps the key', () => {
    const moved = moveOption(bank(), first, 2, -1); // A, C, B  (key B)
    const relabelled = relabelOptionsSequentially(moved, first);
    expect(relabelled.questions[0]?.options.map((o) => o.label)).toEqual(['A', 'B', 'C']);
    expect(relabelled.questions[0]?.options.map((o) => o.text)).toEqual([
      'Alpha',
      'Charlie',
      'Bravo',
    ]);
    // "Bravo" moved to position C, so the key follows it.
    expect(relabelled.questions[0]?.correctAnswer).toEqual(['C']);
  });
});

describe('answer key edits', () => {
  it('replaces the key on a single-select question', () => {
    const next = toggleCorrectAnswer(bank(), first, 'C');
    expect(next.questions[0]?.correctAnswer).toEqual(['C']);
  });

  it('clears the key when the same single answer is toggled off', () => {
    const next = toggleCorrectAnswer(bank(), first, 'B');
    expect(next.questions[0]).not.toHaveProperty('correctAnswer');
  });

  it('adds and removes on a multiple-select question, in option order', () => {
    const added = toggleCorrectAnswer(bank(), second, 'B');
    expect(added.questions[1]?.correctAnswer).toEqual(['A', 'B', 'C']);
    const removed = toggleCorrectAnswer(added, second, 'A');
    expect(removed.questions[1]?.correctAnswer).toEqual(['B', 'C']);
  });

  it('clears a key outright', () => {
    expect(clearCorrectAnswer(bank(), second).questions[1]).not.toHaveProperty('correctAnswer');
  });

  it('collapses a multi-answer key when switching to single-select', () => {
    const next = setQuestionType(bank(), second, 'single');
    expect(next.questions[1]?.correctAnswer).toEqual(['A']);
    expect(next.questions[1]).not.toHaveProperty('selectCount');
  });

  it('gives a select count when switching to multiple-select', () => {
    const next = setQuestionType(bank(), first, 'multiple');
    expect(next.questions[0]?.questionType).toBe('multiple');
    expect(next.questions[0]?.selectCount).toBeGreaterThanOrEqual(1);
  });

  it('sets and clears the select count', () => {
    expect(setSelectCount(bank(), second, 3).questions[1]?.selectCount).toBe(3);
    expect(setSelectCount(bank(), second, undefined).questions[1]).not.toHaveProperty('selectCount');
  });
});

describe('content blocks', () => {
  it('promotes a plain stem to blocks when the first block is added', () => {
    const next = addContentBlock(bank(), first, {
      type: 'image',
      src: 'data:image/png;base64,AAA',
      alt: 'figure',
    });
    const blocks = next.questions[0]?.contentBlocks;
    expect(blocks).toHaveLength(2);
    expect(blocks?.[0]).toEqual({ type: 'paragraph', text: 'First stem' });
    expect(blocks?.[1]?.type).toBe('image');
  });

  it('moves and removes blocks', () => {
    const withImage = addContentBlock(bank(), first, {
      type: 'image',
      src: 'data:image/png;base64,AAA',
    });
    const moved = moveContentBlock(withImage, first, 1, -1);
    expect(moved.questions[0]?.contentBlocks?.[0]?.type).toBe('image');

    const removed = removeContentBlock(moved, first, 0);
    expect(removed.questions[0]?.contentBlocks).toHaveLength(1);
  });

  it('drops the block list entirely when the last block goes', () => {
    const withImage = addContentBlock(bank(), first, { type: 'image', src: 'x' });
    let next = removeContentBlock(withImage, first, 0);
    next = removeContentBlock(next, first, 0);
    expect(next.questions[0]).not.toHaveProperty('contentBlocks');
  });
});

describe('question list', () => {
  it('suggests the next id following the existing pattern', () => {
    expect(suggestQuestionId(bank())).toBe('2024-P1-Q003');
  });

  it('adds a question after the current one, inheriting year and part', () => {
    const { bank: next, questionId } = addQuestion(bank(), first);
    expect(next.questions.map((q) => q.id)).toEqual([first, questionId, second]);
    expect(next.questions[1]?.year).toBe(2024);
    expect(next.questions[1]?.options).toHaveLength(4);
  });

  it('removes a question', () => {
    expect(removeQuestion(bank(), first).questions.map((q) => q.id)).toEqual([second]);
  });

  it('reorders questions and clamps at the ends', () => {
    expect(moveQuestion(bank(), second, -1).questions.map((q) => q.id)).toEqual([second, first]);
    const original = bank();
    expect(moveQuestion(original, first, -1)).toBe(original);
  });

  it('duplicates a question with a fresh id and an independent copy', () => {
    const { bank: next, questionId } = duplicateQuestion(bank(), first);
    expect(next.questions.map((q) => q.id)).toEqual([first, questionId, second]);
    expect(next.questions[1]?.stem).toBe('First stem');
    // Editing the copy must not reach back into the original.
    const edited = setOptionText(next, questionId, 0, 'changed');
    expect(edited.questions[0]?.options[0]?.text).toBe('Alpha');
  });
});

describe('validation', () => {
  it('passes a well-formed question', () => {
    expect(validateQuestion(bank().questions[0]!)).toEqual([]);
    expect(questionHealth(bank().questions[0]!)).toBe('ok');
  });

  it('warns rather than errors when there is no answer key', () => {
    const noKey = clearCorrectAnswer(bank(), first).questions[0]!;
    const issues = validateQuestion(noKey);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.level).toBe('warning');
    expect(questionHealth(noKey)).toBe('warning');
  });

  it('errors on an empty stem with no content blocks', () => {
    const blank = updateQuestion(bank(), first, { stem: '' }).questions[0]!;
    expect(validateQuestion(blank).some((i) => i.field === 'stem' && i.level === 'error')).toBe(true);
    expect(questionHealth(blank)).toBe('error');
  });

  it('accepts an empty stem when content blocks carry the question', () => {
    let next = addContentBlock(bank(), first, { type: 'paragraph', text: 'Block text' });
    next = updateQuestion(next, first, { stem: '' });
    expect(validateQuestion(next.questions[0]!).some((i) => i.field === 'stem')).toBe(false);
  });

  it('errors on duplicate option labels', () => {
    const dupe = setOptionLabel(bank(), first, 1, 'A').questions[0]!;
    expect(validateQuestion(dupe).some((i) => /Duplicate option label/.test(i.message))).toBe(true);
  });

  it('errors when the key names a missing option', () => {
    const broken = { ...bank().questions[0]!, correctAnswer: ['Z'] };
    expect(validateQuestion(broken).some((i) => /do not exist/.test(i.message))).toBe(true);
  });

  it('errors when a single-select question has several correct answers', () => {
    const broken = { ...bank().questions[0]!, correctAnswer: ['A', 'B'] };
    expect(validateQuestion(broken).some((i) => /Switch it to multiple-select/.test(i.message))).toBe(
      true,
    );
  });

  it('errors when the select count disagrees with the key', () => {
    const broken = setSelectCount(bank(), second, 3).questions[1]!;
    expect(validateQuestion(broken).some((i) => /key names 2/.test(i.message))).toBe(true);
  });

  it('errors on duplicate question ids at bank level', () => {
    const duped = { ...bank(), questions: [bank().questions[0]!, bank().questions[0]!] };
    expect(validateBank(duped).some((i) => /Duplicate question id/.test(i.message))).toBe(true);
  });

  it('errors on missing bank identity', () => {
    const broken = { ...bank(), bankId: '', title: '' };
    const issues = validateBank(broken);
    expect(issues.some((i) => /Bank id is required/.test(i.message))).toBe(true);
    expect(issues.some((i) => /Bank title is required/.test(i.message))).toBe(true);
  });
});
