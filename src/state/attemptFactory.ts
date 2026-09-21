/**
 * Attempt creation and bank-compatibility checks.
 */
import type { Attempt, TestingMode } from '../types/attempt';
import { CURRENT_ATTEMPT_SCHEMA_VERSION, emptyResponse } from '../types/attempt';
import type { QuestionBank, StoredBank } from '../types/question';
import { bankChecksum } from '../data/normalize';
import { createId, nowIso } from '../utils/id';

export interface CreateAttemptOptions {
  mode: TestingMode;
  /**
   * Explicit question ids, in attempt order. Omit for "all questions,
   * sequential". A subset means the rail shows only those questions.
   */
  questionIds?: string[];
  /** 1-based inclusive range over the bank's question order. */
  range?: { from: number; to: number };
}

export function selectQuestionIds(bank: QuestionBank, options: CreateAttemptOptions): string[] {
  if (options.questionIds && options.questionIds.length > 0) {
    const known = new Set(bank.questions.map((q) => q.id));
    return options.questionIds.filter((id) => known.has(id));
  }
  const all = bank.questions.map((q) => q.id);
  if (options.range) {
    const from = Math.max(1, Math.min(options.range.from, all.length));
    const to = Math.max(from, Math.min(options.range.to, all.length));
    return all.slice(from - 1, to);
  }
  return all;
}

export function createAttempt(bank: QuestionBank, options: CreateAttemptOptions): Attempt {
  const questionOrder = selectQuestionIds(bank, options);
  if (questionOrder.length === 0) {
    throw new Error('Cannot start an attempt with no questions.');
  }
  const timestamp = nowIso();
  const responses: Attempt['responses'] = {};
  questionOrder.forEach((id) => {
    responses[id] = emptyResponse();
  });

  const first = questionOrder[0] as string;

  return {
    schemaVersion: CURRENT_ATTEMPT_SCHEMA_VERSION,
    attemptId: createId('attempt'),
    bankId: bank.bankId,
    bankVersion: bank.bankVersion,
    bankChecksum: bankChecksum(bank),
    bankTitle: bank.title,
    startedAt: timestamp,
    updatedAt: timestamp,
    mode: options.mode,
    questionOrder,
    currentQuestionId: first,
    responses,
  };
}

export type CompatibilityLevel = 'ok' | 'warning' | 'error';

export interface CompatibilityReport {
  level: CompatibilityLevel;
  messages: string[];
}

/**
 * Guard against restoring an attempt against the wrong bank.
 *
 * A different `bankId` is fatal. A different `bankVersion` is fatal too: the
 * question order the attempt recorded may no longer mean anything. A matching
 * version with a different checksum is a warning — same declared version, edited
 * content — because the user may legitimately have re-exported the same bank.
 */
export function checkAttemptCompatibility(
  attempt: Pick<Attempt, 'bankId' | 'bankVersion' | 'bankChecksum' | 'questionOrder'>,
  bank: StoredBank | undefined,
): CompatibilityReport {
  if (!bank) {
    return {
      level: 'error',
      messages: [
        `No question bank "${attempt.bankId}" version "${attempt.bankVersion}" is installed. ` +
          'Import that bank before restoring this attempt.',
      ],
    };
  }
  if (bank.bankId !== attempt.bankId) {
    return {
      level: 'error',
      messages: [`Bank id mismatch: attempt expects "${attempt.bankId}", found "${bank.bankId}".`],
    };
  }
  if (bank.bankVersion !== attempt.bankVersion) {
    return {
      level: 'error',
      messages: [
        `Bank version mismatch: attempt expects "${attempt.bankVersion}", ` +
          `installed bank is "${bank.bankVersion}".`,
      ],
    };
  }

  const messages: string[] = [];
  let level: CompatibilityLevel = 'ok';

  if (attempt.bankChecksum && bank.checksum !== attempt.bankChecksum) {
    level = 'warning';
    messages.push(
      'The installed bank declares the same version but its content checksum differs. ' +
        'Question text may have changed since this attempt was recorded.',
    );
  }

  const known = new Set(bank.bank.questions.map((q) => q.id));
  const missing = attempt.questionOrder.filter((id) => !known.has(id));
  if (missing.length > 0) {
    level = 'error';
    messages.push(
      `${missing.length} question(s) in the attempt are absent from the bank ` +
        `(first: ${missing.slice(0, 3).join(', ')}).`,
    );
  }

  return { level, messages };
}
