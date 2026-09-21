/**
 * Bank-level normalization helpers shared by every importer.
 *
 * "Normalize" here means STRUCTURAL normalization only: shaping rows into the
 * `QuestionBank` model, trimming incidental whitespace introduced by
 * spreadsheet export, and deriving bookkeeping such as checksums.
 *
 * It explicitly does NOT mean editorial normalization. Stems, option text and
 * option labels are never rewritten, reordered, renumbered, repaired or
 * inferred — the upstream OCR/cleanup pipeline owns that, and this application
 * must faithfully display whatever it is given, placeholders included.
 */
import type { Question, QuestionBank, StoredBank } from '../types/question';
import { contentHash, stableStringify } from '../utils/hash';
import { nowIso } from '../utils/id';

export interface ImportIssue {
  level: 'error' | 'warning';
  /** Question id when the issue is attributable to one, otherwise undefined. */
  questionId?: string;
  /** Source row index when known — lets the user find it in the spreadsheet. */
  rowIndex?: number;
  message: string;
}

export interface ImportResult {
  ok: boolean;
  bank?: QuestionBank;
  issues: ImportIssue[];
}

/** Content checksum over the semantic payload of a bank. */
export function bankChecksum(bank: QuestionBank): string {
  return contentHash(
    stableStringify({
      schemaVersion: bank.schemaVersion,
      bankId: bank.bankId,
      bankVersion: bank.bankVersion,
      questions: bank.questions,
    }),
  );
}

export function hasAnswerKey(question: Question): boolean {
  return Array.isArray(question.correctAnswer) && question.correctAnswer.length > 0;
}

export function describeBank(bank: QuestionBank, builtIn = false): StoredBank {
  const withKey = bank.questions.filter(hasAnswerKey).length;
  return {
    bankId: bank.bankId,
    bankVersion: bank.bankVersion,
    title: bank.title,
    checksum: bankChecksum(bank),
    importedAt: nowIso(),
    questionCount: bank.questions.length,
    hasAnswerKey: withKey > 0,
    fullAnswerKey: withKey === bank.questions.length && bank.questions.length > 0,
    builtIn,
    bank,
  };
}

/** Years present across the bank, ascending. Used for the bank summary UI. */
export function bankYears(bank: QuestionBank): number[] {
  const set = new Set<number>();
  if (bank.source?.years) bank.source.years.forEach((y) => set.add(y));
  bank.questions.forEach((q) => {
    if (typeof q.year === 'number') set.add(q.year);
  });
  return [...set].sort((a, b) => a - b);
}

/** Distinct `part` values across the bank, in first-seen order. */
export function bankParts(bank: QuestionBank): string[] {
  const seen: string[] = [];
  bank.questions.forEach((q) => {
    if (q.part === undefined || q.part === null || q.part === '') return;
    const value = String(q.part);
    if (!seen.includes(value)) seen.push(value);
  });
  return seen;
}

/**
 * Index for O(1) question lookup. Attempts reference questions by id, and a
 * bank may hold thousands of them, so callers must never scan the array.
 */
export function indexQuestions(bank: QuestionBank): Map<string, Question> {
  const map = new Map<string, Question>();
  bank.questions.forEach((q) => map.set(q.id, q));
  return map;
}

/**
 * Trim only leading/trailing whitespace that spreadsheet exports add. Interior
 * text, including deliberate placeholder markers, is untouched.
 */
export function trimCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/^[\s ]+|[\s ]+$/g, '');
}
