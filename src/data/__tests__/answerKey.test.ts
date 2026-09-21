import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Question, QuestionBank } from '../../types/question';
import { applyAnswerKeyList, parseAnswerKeyList } from '../answerKey';
import { expandAnswerKey } from '../importers/rowFormat';

function question(id: string, number: number, labels: string): Question {
  return {
    id,
    sourceQuestionNumber: number,
    questionType: 'single',
    stem: `stem ${id}`,
    options: labels.split('').map((label) => ({ label, text: `text ${label}` })),
  };
}

function bankOf(...questions: Question[]): QuestionBank {
  return {
    schemaVersion: 1,
    bankId: 'key-bank',
    bankVersion: '1',
    title: 'Key bank',
    questions,
  };
}

describe('expandAnswerKey', () => {
  it('keeps a token that matches an option label whole', () => {
    expect(expandAnswerKey(['B'], ['A', 'B', 'C'])).toEqual(['B']);
  });

  it('splits a run-together multi-answer key', () => {
    expect(expandAnswerKey(['EFH'], 'ABCDEFGH'.split(''))).toEqual(['E', 'F', 'H']);
  });

  it('does NOT split a multi-character label that genuinely exists', () => {
    expect(expandAnswerKey(['iii'], ['i', 'ii', 'iii'])).toEqual(['iii']);
  });

  it('leaves an unresolvable token alone so it is reported, not silently mangled', () => {
    expect(expandAnswerKey(['XY'], ['A', 'B'])).toEqual(['XY']);
  });

  it('de-duplicates repeated labels', () => {
    expect(expandAnswerKey(['AA'], ['A', 'B'])).toEqual(['A']);
  });
});

describe('parseAnswerKeyList', () => {
  it('reads one answer per line and ignores comments and blanks', () => {
    const parsed = parseAnswerKeyList('# header\n\nD\nA\n\nEFH\n');
    expect(parsed.entries).toEqual([['D'], ['A'], ['EFH']]);
    expect(parsed.ignoredLines).toBe(4); // comment, two blanks, trailing newline
  });

  it('accepts separated multi-answers', () => {
    expect(parseAnswerKeyList('E, F, H').entries).toEqual([['E', 'F', 'H']]);
    expect(parseAnswerKeyList('E F H').entries).toEqual([['E', 'F', 'H']]);
  });

  it('strips a leading question number', () => {
    expect(parseAnswerKeyList('1. D\n2) A\n3 C').entries).toEqual([['D'], ['A'], ['C']]);
  });

  it('parses the bundled 2023 Part 1 key', () => {
    const file = path.join(process.cwd(), 'answer-keys', '2023-part1.txt');
    const parsed = parseAnswerKeyList(fs.readFileSync(file, 'utf8'));
    expect(parsed.entries).toHaveLength(150);
    const multi = parsed.entries.filter((entry) => entry.join('').length > 1);
    expect(multi).toEqual([['EFH'], ['CGH'], ['ACE']]);
  });
});

describe('applyAnswerKeyList', () => {
  const threeQuestions = bankOf(
    question('Q1', 1, 'ABCDE'),
    question('Q2', 2, 'ABCDE'),
    question('Q3', 3, 'ABCDEFGH'),
  );

  it('applies a key by position', () => {
    const result = applyAnswerKeyList(threeQuestions, parseAnswerKeyList('D\nA\nEFH'));
    expect(result.ok).toBe(true);
    expect(result.applied).toBe(3);
    expect(result.bank?.questions[0]?.correctAnswer).toEqual(['D']);
    expect(result.bank?.questions[1]?.correctAnswer).toEqual(['A']);
    expect(result.bank?.questions[2]?.correctAnswer).toEqual(['E', 'F', 'H']);
  });

  it('turns a multi-answer question into multiple-select with a select count', () => {
    const result = applyAnswerKeyList(threeQuestions, parseAnswerKeyList('D\nA\nEFH'));
    const third = result.bank?.questions[2];
    expect(third?.questionType).toBe('multiple');
    expect(third?.selectCount).toBe(3);
    expect(result.bank?.questions[0]?.questionType).toBe('single');
  });

  it('does not mutate the input bank', () => {
    applyAnswerKeyList(threeQuestions, parseAnswerKeyList('D\nA\nEFH'));
    expect(threeQuestions.questions[0]?.correctAnswer).toBeUndefined();
  });

  it('refuses the whole join when the counts differ', () => {
    const result = applyAnswerKeyList(threeQuestions, parseAnswerKeyList('D\nA'));
    expect(result.ok).toBe(false);
    expect(result.applied).toBe(0);
    expect(result.issues[0]?.message).toMatch(/2 answers but the bank has 3 questions/);
    expect(result.issues[0]?.message).toMatch(/Nothing was applied/);
  });

  it('refuses when a key line names an option the question does not have', () => {
    // Q1 only has A-E, so "F" cannot be right.
    const result = applyAnswerKeyList(threeQuestions, parseAnswerKeyList('F\nA\nEFH'));
    expect(result.ok).toBe(false);
    expect(result.applied).toBe(0);
    expect(result.issues.some((i) => i.questionId === 'Q1' && /no option F/.test(i.message))).toBe(
      true,
    );
  });

  it('leaves an existing different key alone and warns, unless overwrite is set', () => {
    const withKey = bankOf(
      { ...question('Q1', 1, 'ABCDE'), correctAnswer: ['B'] },
      question('Q2', 2, 'ABCDE'),
      question('Q3', 3, 'ABCDEFGH'),
    );

    const kept = applyAnswerKeyList(withKey, parseAnswerKeyList('D\nA\nEFH'));
    expect(kept.ok).toBe(true);
    expect(kept.bank?.questions[0]?.correctAnswer).toEqual(['B']);
    expect(kept.skipped).toBe(1);
    expect(kept.issues.some((i) => /Left unchanged/.test(i.message))).toBe(true);

    const replaced = applyAnswerKeyList(withKey, parseAnswerKeyList('D\nA\nEFH'), {
      overwriteExisting: true,
    });
    expect(replaced.bank?.questions[0]?.correctAnswer).toEqual(['D']);
  });

  it('treats an identical existing key as already applied', () => {
    const withKey = bankOf(
      { ...question('Q1', 1, 'ABCDE'), correctAnswer: ['D'] },
      question('Q2', 2, 'ABCDE'),
      question('Q3', 3, 'ABCDEFGH'),
    );
    const result = applyAnswerKeyList(withKey, parseAnswerKeyList('D\nA\nEFH'));
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(1);
    expect(result.issues.filter((i) => i.level === 'warning')).toHaveLength(0);
  });

  it('joins by source question number when asked', () => {
    const shuffled = bankOf(
      question('Q3', 3, 'ABCDEFGH'),
      question('Q1', 1, 'ABCDE'),
      question('Q2', 2, 'ABCDE'),
    );
    const result = applyAnswerKeyList(shuffled, parseAnswerKeyList('D\nA\nEFH'), {
      strategy: 'source-number',
    });
    expect(result.ok).toBe(true);
    const byId = new Map(result.bank?.questions.map((q) => [q.id, q.correctAnswer]));
    expect(byId.get('Q1')).toEqual(['D']);
    expect(byId.get('Q2')).toEqual(['A']);
    expect(byId.get('Q3')).toEqual(['E', 'F', 'H']);
  });

  it('refuses a number join when the run of question numbers has a gap', () => {
    const gapped = bankOf(
      question('Q1', 1, 'ABCDE'),
      question('Q2', 2, 'ABCDE'),
      question('Q9', 9, 'ABCDE'),
    );
    const result = applyAnswerKeyList(gapped, parseAnswerKeyList('D\nA\nC'), {
      strategy: 'source-number',
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /No question is numbered 3/.test(i.message))).toBe(true);
  });

  it('rejects an empty key file', () => {
    const result = applyAnswerKeyList(threeQuestions, parseAnswerKeyList('# only a comment'));
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.message).toMatch(/empty/);
  });
});
