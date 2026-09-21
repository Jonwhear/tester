/**
 * Portable save files.
 *
 * Two deliberate formats:
 *
 *  - PROGRESS  (`qbank-progress`) — attempts only, plus bank identity so the
 *    import side can refuse to restore against the wrong bank. This is the
 *    default because banks are large and duplicating one into every save file
 *    would be wasteful.
 *  - PORTABLE SESSION (`qbank-portable-session`) — the same thing with the bank
 *    embedded, for moving to a machine that does not have the bank installed.
 *    Opt-in, never automatic.
 */
import type { Attempt } from '../types/attempt';
import type { QuestionBank, StoredBank } from '../types/question';
import { bankChecksum } from '../data/normalize';
import {
  PORTABLE_SESSION_KIND,
  PROGRESS_FILE_KIND,
  attemptSchema,
  portableSessionSchema,
  progressFileSchema,
  type PortableSession,
  type ProgressFile,
} from '../data/schema';
import { checkAttemptCompatibility, type CompatibilityReport } from '../state/attemptFactory';

export const PROGRESS_FILE_VERSION = 1;

export function buildProgressFile(bank: StoredBank, attempts: Attempt[]): ProgressFile {
  return {
    kind: PROGRESS_FILE_KIND,
    fileVersion: PROGRESS_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    bank: {
      bankId: bank.bankId,
      bankVersion: bank.bankVersion,
      checksum: bank.checksum,
      title: bank.title,
      questionCount: bank.questionCount,
    },
    attempts,
  };
}

export function buildPortableSession(bank: QuestionBank, attempts: Attempt[]): PortableSession {
  return {
    kind: PORTABLE_SESSION_KIND,
    fileVersion: PROGRESS_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    bank,
    bankChecksum: bankChecksum(bank),
    attempts,
  };
}

export interface ParsedImport {
  kind: 'progress' | 'portable-session';
  attempts: Attempt[];
  /** Present only for a portable session. */
  bank?: QuestionBank;
  bankId: string;
  bankVersion: string;
  bankChecksum?: string;
}

export type ImportProgressOutcome =
  | { ok: true; parsed: ParsedImport }
  | { ok: false; errors: string[] };

/** Validate an uploaded progress / portable-session file. Never throws. */
export function parseProgressFile(input: unknown): ImportProgressOutcome {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: ['File is not a JSON object.'] };
  }
  const kind = (input as { kind?: unknown }).kind;

  if (kind === PROGRESS_FILE_KIND) {
    const parsed = progressFileSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, errors: parsed.error.issues.map(formatIssue) };
    }
    const result: ParsedImport = {
      kind: 'progress',
      attempts: parsed.data.attempts as Attempt[],
      bankId: parsed.data.bank.bankId,
      bankVersion: parsed.data.bank.bankVersion,
    };
    if (parsed.data.bank.checksum) result.bankChecksum = parsed.data.bank.checksum;
    return { ok: true, parsed: result };
  }

  if (kind === PORTABLE_SESSION_KIND) {
    const parsed = portableSessionSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, errors: parsed.error.issues.map(formatIssue) };
    }
    const result: ParsedImport = {
      kind: 'portable-session',
      attempts: parsed.data.attempts as Attempt[],
      bank: parsed.data.bank as QuestionBank,
      bankId: parsed.data.bank.bankId,
      bankVersion: parsed.data.bank.bankVersion,
    };
    if (parsed.data.bankChecksum) result.bankChecksum = parsed.data.bankChecksum;
    return { ok: true, parsed: result };
  }

  // Tolerate a bare attempt object, which is what people tend to hand-edit.
  const bare = attemptSchema.safeParse(input);
  if (bare.success) {
    const attempt = bare.data as Attempt;
    const result: ParsedImport = {
      kind: 'progress',
      attempts: [attempt],
      bankId: attempt.bankId,
      bankVersion: attempt.bankVersion,
    };
    if (attempt.bankChecksum) result.bankChecksum = attempt.bankChecksum;
    return { ok: true, parsed: result };
  }

  return {
    ok: false,
    errors: [
      `Unrecognized file. Expected "kind": "${PROGRESS_FILE_KIND}" or "${PORTABLE_SESSION_KIND}".`,
    ],
  };
}

function formatIssue(issue: { path: (string | number)[]; message: string }): string {
  return `${issue.path.join('.') || 'file'}: ${issue.message}`;
}

/** Per-attempt compatibility check against the installed bank. */
export function checkImportedAttempts(
  parsed: ParsedImport,
  installedBank: StoredBank | undefined,
): Array<{ attempt: Attempt; report: CompatibilityReport }> {
  return parsed.attempts.map((attempt) => ({
    attempt,
    report: checkAttemptCompatibility(attempt, installedBank),
  }));
}
