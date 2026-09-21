/**
 * Applying a separate answer-key list to a bank.
 *
 * Answer keys usually arrive apart from the questions, as a flat ordered list:
 * one line per question, in question order, e.g.
 *
 *     D
 *     A
 *     EFH        <- a multi-answer question
 *
 * Joining that to the questions is positional, which is exactly the kind of
 * operation that fails silently and catastrophically: if OCR dropped one
 * question, every answer after it shifts by one and the whole bank is subtly
 * wrong with nothing visibly broken. So this module refuses to guess. It
 * verifies the join before applying anything, and reports precisely why it
 * cannot proceed rather than producing a plausible-looking wrong result.
 */
import type { Question, QuestionBank } from '../types/question';
import { expandAnswerKey } from './importers/rowFormat';
import type { ImportIssue } from './normalize';

export interface ParsedAnswerKey {
  /** One entry per question, in order. Each entry is the raw line's labels. */
  entries: string[][];
  /** Lines that were comments or blank. */
  ignoredLines: number;
}

/**
 * Parse a flat answer-key list.
 *
 * Accepts one answer per line. A line may name several options, separated
 * ("E, F, H") or run together ("EFH") — the two are not distinguished here,
 * because telling them apart needs the question's option labels. Lines starting
 * with `#` and blank lines are ignored, so a key file can carry a header.
 * An optional leading question number ("12. D" or "12 D") is stripped.
 */
export function parseAnswerKeyList(text: string): ParsedAnswerKey {
  const entries: string[][] = [];
  let ignoredLines = 0;

  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      ignoredLines += 1;
      return;
    }
    // Strip a leading question number so "12. D" and "12 D" both work.
    const withoutNumber = line.replace(/^\d+\s*[.):]?\s+/, '');
    const tokens = withoutNumber
      .split(/[\s,;|/]+|\s+and\s+/i)
      .map((token) => token.trim())
      .filter((token) => token !== '');
    entries.push(tokens.length > 0 ? tokens : [withoutNumber]);
  });

  return { entries, ignoredLines };
}

export type JoinStrategy = 'position' | 'source-number';

export interface ApplyAnswerKeyOptions {
  /**
   * `position` pairs key line N with question N of the bank.
   * `source-number` pairs key line N with the question whose
   * `sourceQuestionNumber` is N, which survives a reordered bank.
   */
  strategy?: JoinStrategy;
  /** Replace a key a question already has. Off by default. */
  overwriteExisting?: boolean;
}

export interface ApplyAnswerKeyResult {
  ok: boolean;
  /** A new bank. The input is never mutated. */
  bank?: QuestionBank;
  issues: ImportIssue[];
  applied: number;
  skipped: number;
}

/**
 * Attach a parsed answer-key list to a bank.
 *
 * Refuses the whole operation — applying nothing — when the join cannot be
 * trusted: a length mismatch, or (for `source-number`) numbers that are not a
 * complete contiguous run. A partial application would leave the bank in a
 * state where some answers are right and some are shifted, which is worse than
 * no answers at all.
 */
export function applyAnswerKeyList(
  bank: QuestionBank,
  key: ParsedAnswerKey,
  options: ApplyAnswerKeyOptions = {},
): ApplyAnswerKeyResult {
  const strategy = options.strategy ?? 'position';
  const issues: ImportIssue[] = [];
  const { entries } = key;

  if (entries.length === 0) {
    return { ok: false, issues: [{ level: 'error', message: 'The answer-key file is empty.' }], applied: 0, skipped: 0 };
  }

  if (entries.length !== bank.questions.length) {
    return {
      ok: false,
      applied: 0,
      skipped: 0,
      issues: [
        {
          level: 'error',
          message:
            `The key has ${entries.length} answers but the bank has ${bank.questions.length} questions. ` +
            'A positional join is only safe when these match exactly — one missing question would shift ' +
            'every answer after it. Nothing was applied.',
        },
      ],
    };
  }

  /* Build the question ordering the key will be paired against. */
  let ordered: Question[];

  if (strategy === 'source-number') {
    const byNumber = new Map<number, Question>();
    const missingNumbers: string[] = [];
    bank.questions.forEach((question) => {
      const raw = question.sourceQuestionNumber;
      const numeric = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
      if (!Number.isFinite(numeric)) {
        missingNumbers.push(question.id);
        return;
      }
      if (byNumber.has(numeric)) {
        issues.push({
          level: 'error',
          questionId: question.id,
          message: `Duplicate sourceQuestionNumber ${numeric}; cannot join the key by question number.`,
        });
        return;
      }
      byNumber.set(numeric, question);
    });

    if (missingNumbers.length > 0) {
      issues.push({
        level: 'error',
        message:
          `${missingNumbers.length} question(s) have no usable sourceQuestionNumber ` +
          `(first: ${missingNumbers.slice(0, 3).join(', ')}). Join by position instead, or fix the numbers.`,
      });
    }
    if (issues.some((issue) => issue.level === 'error')) {
      return { ok: false, issues, applied: 0, skipped: 0 };
    }

    const gaps: number[] = [];
    ordered = [];
    for (let n = 1; n <= entries.length; n += 1) {
      const question = byNumber.get(n);
      if (!question) gaps.push(n);
      else ordered.push(question);
    }
    if (gaps.length > 0) {
      return {
        ok: false,
        applied: 0,
        skipped: 0,
        issues: [
          ...issues,
          {
            level: 'error',
            message:
              `No question is numbered ${gaps.slice(0, 5).join(', ')}${gaps.length > 5 ? ' …' : ''}. ` +
              'The key expects a complete run of question numbers. Nothing was applied.',
          },
        ],
      };
    }
  } else {
    ordered = [...bank.questions];
  }

  /* Validate every pairing BEFORE writing any of them. */
  const resolved: Array<{ question: Question; labels: string[] }> = [];
  let skipped = 0;

  ordered.forEach((question, index) => {
    const tokens = entries[index] as string[];
    const optionLabels = question.options.map((option) => option.label);
    const labels = expandAnswerKey(tokens, optionLabels);

    const known = new Set(optionLabels.map((label) => label.trim().toUpperCase()));
    const unknown = labels.filter((label) => !known.has(label.trim().toUpperCase()));
    if (unknown.length > 0) {
      issues.push({
        level: 'error',
        questionId: question.id,
        message:
          `Key line ${index + 1} is "${tokens.join(' ')}", but this question has no option ` +
          `${unknown.join(', ')} (it has ${optionLabels.join(', ') || 'no options'}).`,
      });
      return;
    }

    const existing = question.correctAnswer;
    if (existing && existing.length > 0) {
      const same =
        existing.length === labels.length &&
        existing.every((label, i) => label.toUpperCase() === (labels[i] ?? '').toUpperCase());
      if (same) {
        skipped += 1;
        return;
      }
      if (!options.overwriteExisting) {
        issues.push({
          level: 'warning',
          questionId: question.id,
          message:
            `Already has answer key ${existing.join(', ')}; the file says ${labels.join(', ')}. ` +
            'Left unchanged — enable overwrite to replace it.',
        });
        skipped += 1;
        return;
      }
      issues.push({
        level: 'warning',
        questionId: question.id,
        message: `Answer key replaced: ${existing.join(', ')} -> ${labels.join(', ')}.`,
      });
    }

    resolved.push({ question, labels });
  });

  if (issues.some((issue) => issue.level === 'error')) {
    return { ok: false, issues, applied: 0, skipped };
  }

  /* Apply. The input bank is not mutated. */
  const updates = new Map(resolved.map(({ question, labels }) => [question.id, labels]));
  const questions = bank.questions.map((question) => {
    const labels = updates.get(question.id);
    if (!labels) return question;

    const next: Question = { ...question, correctAnswer: labels };
    if (labels.length > 1) {
      next.questionType = 'multiple';
      if (next.selectCount === undefined) next.selectCount = labels.length;
    } else if (next.questionType === 'single') {
      delete next.selectCount;
    }
    return next;
  });

  return {
    ok: true,
    bank: { ...bank, questions },
    issues,
    applied: resolved.length,
    skipped,
  };
}
