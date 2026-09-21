/**
 * Importer for JSON that is already in the normalized `QuestionBank` shape —
 * the output of the conversion script at the end of the upstream pipeline.
 *
 * Validation is strict: an incompatible `schemaVersion` or a structurally
 * broken question produces a readable error rather than a crash.
 */
import type { QuestionBank } from '../../types/question';
import {
  CURRENT_BANK_SCHEMA_VERSION,
  MIN_SUPPORTED_BANK_SCHEMA_VERSION,
} from '../../types/question';
import { questionBankSchema } from '../schema';
import type { ImportIssue, ImportResult } from '../normalize';

/**
 * Migration boundary. Older bank payloads are upgraded here before validation
 * so that adding fields to the format later does not orphan existing files.
 */
function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : undefined;
  if (version === undefined) {
    // Pre-versioned drafts are treated as v1; anything genuinely incompatible
    // will still fail validation below.
    return { ...raw, schemaVersion: MIN_SUPPORTED_BANK_SCHEMA_VERSION };
  }
  return raw;
}

export function importNormalizedBank(input: unknown): ImportResult {
  const issues: ImportIssue[] = [];

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {
      ok: false,
      issues: [
        {
          level: 'error',
          message:
            'Expected a question-bank object. A bare array looks like the row format — ' +
            'import it as "Excel row format" instead.',
        },
      ],
    };
  }

  const migrated = migrate(input as Record<string, unknown>);
  const declared = migrated.schemaVersion;
  if (typeof declared === 'number' && declared > CURRENT_BANK_SCHEMA_VERSION) {
    return {
      ok: false,
      issues: [
        {
          level: 'error',
          message:
            `This bank declares schemaVersion ${declared}, but this build of the application ` +
            `supports up to ${CURRENT_BANK_SCHEMA_VERSION}. Update the application.`,
        },
      ],
    };
  }

  const parsed = questionBankSchema.safeParse(migrated);
  if (!parsed.success) {
    const questions = Array.isArray(migrated.questions)
      ? (migrated.questions as Array<Record<string, unknown>>)
      : [];
    parsed.error.issues.forEach((issue) => {
      const path = issue.path;
      let questionId: string | undefined;
      if (path[0] === 'questions' && typeof path[1] === 'number') {
        const q = questions[path[1]];
        const id = q?.id;
        questionId = typeof id === 'string' ? id : `#${path[1] + 1}`;
      }
      issues.push({
        level: 'error',
        questionId,
        message: `${path.join('.') || 'bank'}: ${issue.message}`,
      });
    });
    return { ok: false, issues };
  }

  const bank = parsed.data as QuestionBank;

  if (bank.questions.length === 0) {
    issues.push({ level: 'warning', message: 'Bank validated but contains no questions.' });
  }
  const withoutKey = bank.questions.filter((q) => !q.correctAnswer || q.correctAnswer.length === 0);
  if (withoutKey.length > 0) {
    issues.push({
      level: 'warning',
      message:
        `${withoutKey.length} of ${bank.questions.length} question(s) have no answer key. ` +
        'Those questions can be answered but will not be graded.',
    });
  }

  return { ok: true, bank, issues };
}

/**
 * Convenience entry point for "the user handed us a JSON file and we do not
 * know which of the two supported shapes it is".
 */
export function detectAndImport(
  input: unknown,
  importRow: (value: unknown) => ImportResult,
): ImportResult {
  if (Array.isArray(input)) return importRow(input);
  if (typeof input === 'object' && input !== null && Array.isArray((input as { rows?: unknown }).rows)) {
    return importRow(input);
  }
  return importNormalizedBank(input);
}
