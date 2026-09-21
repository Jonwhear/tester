/**
 * Runtime validation for everything that crosses the trust boundary:
 * imported question banks, imported progress files and persisted records.
 *
 * Imported JSON is untrusted. It is validated here and nowhere else; the rest
 * of the application may assume the parsed types are accurate.
 */
import { z } from 'zod';

import {
  CURRENT_ATTEMPT_SCHEMA_VERSION,
  MIN_SUPPORTED_ATTEMPT_SCHEMA_VERSION,
} from '../types/attempt';
import type { Attempt, QuestionResponse } from '../types/attempt';
import {
  CURRENT_BANK_SCHEMA_VERSION,
  MIN_SUPPORTED_BANK_SCHEMA_VERSION,
} from '../types/question';
import type { ContentBlock, Question, QuestionBank } from '../types/question';
import type { AppSettings } from '../types/settings';

/* ------------------------------------------------------------------ */
/* Question bank                                                       */
/* ------------------------------------------------------------------ */

export const answerOptionSchema = z.object({
  label: z.string().min(1, 'option label must not be empty'),
  text: z.string(),
});

export const contentBlockSchema: z.ZodType<ContentBlock> = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('paragraph'),
    text: z.string(),
    emphasis: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('table'),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.string())),
    caption: z.string().optional(),
  }),
  z.object({
    type: z.literal('image'),
    src: z.string(),
    alt: z.string().optional(),
    caption: z.string().optional(),
  }),
]);

export const questionAssetSchema = z.object({
  id: z.string(),
  kind: z.enum(['image', 'audio', 'other']),
  src: z.string(),
  alt: z.string().optional(),
  caption: z.string().optional(),
});

export const suggestedHighlightSchema = z.object({
  text: z.string().min(1),
  note: z.string().optional(),
});

export const questionSchema = z
  .object({
    id: z.string().min(1, 'question id is required'),
    sourceQuestionNumber: z.union([z.number(), z.string()]).optional(),
    year: z.number().optional(),
    part: z.union([z.number(), z.string()]).optional(),
    questionType: z.enum(['single', 'multiple']),
    selectCount: z.number().int().positive().optional(),
    stem: z.string(),
    stemFormat: z.enum(['plain', 'markdown']).optional(),
    contentBlocks: z.array(contentBlockSchema).optional(),
    options: z.array(answerOptionSchema),
    correctAnswer: z.array(z.string()).optional(),
    explanation: z.string().optional(),
    educationalObjective: z.string().optional(),
    references: z.array(z.string()).optional(),
    metadata: z.record(z.string().optional()).optional(),
    reviewNote: z.string().optional(),
    cleaned: z.boolean().optional(),
    assets: z.array(questionAssetSchema).optional(),
    suggestedHighlights: z.array(suggestedHighlightSchema).optional(),
  })
  .superRefine((q, ctx) => {
    const labels = q.options.map((o) => o.label);
    const dupes = labels.filter((l, i) => labels.indexOf(l) !== i);
    if (dupes.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate option label(s): ${[...new Set(dupes)].join(', ')}`,
        path: ['options'],
      });
    }
    if (q.correctAnswer) {
      const unknown = q.correctAnswer.filter(
        (label) => !labels.some((l) => l.trim().toUpperCase() === label.trim().toUpperCase()),
      );
      if (unknown.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `correctAnswer references unknown option label(s): ${unknown.join(', ')}`,
          path: ['correctAnswer'],
        });
      }
    }
    if (q.questionType === 'single' && q.correctAnswer && q.correctAnswer.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'single-select question declares more than one correct answer',
        path: ['correctAnswer'],
      });
    }
    if (q.selectCount !== undefined && q.selectCount > q.options.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `selectCount (${q.selectCount}) exceeds the number of options (${q.options.length})`,
        path: ['selectCount'],
      });
    }
  });

export const questionBankSchema = z
  .object({
    schemaVersion: z.number().int(),
    bankId: z.string().min(1),
    bankVersion: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    createdAt: z.string().optional(),
    source: z
      .object({
        exam: z.string().optional(),
        years: z.array(z.number()).optional(),
      })
      .passthrough()
      .optional(),
    questions: z.array(questionSchema),
  })
  .superRefine((bank, ctx) => {
    if (
      bank.schemaVersion < MIN_SUPPORTED_BANK_SCHEMA_VERSION ||
      bank.schemaVersion > CURRENT_BANK_SCHEMA_VERSION
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `unsupported bank schemaVersion ${bank.schemaVersion}; ` +
          `this build reads ${MIN_SUPPORTED_BANK_SCHEMA_VERSION}-${CURRENT_BANK_SCHEMA_VERSION}`,
        path: ['schemaVersion'],
      });
    }
    const ids = bank.questions.map((q) => q.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate question id(s): ${[...new Set(dupes)].slice(0, 5).join(', ')}`,
        path: ['questions'],
      });
    }
  });

/* ------------------------------------------------------------------ */
/* Attempt                                                             */
/* ------------------------------------------------------------------ */

export const questionResponseSchema = z.object({
  selectedAnswers: z.array(z.string()),
  status: z.enum(['unseen', 'seen', 'answered', 'correct', 'incorrect']),
  marked: z.boolean(),
  notes: z.string().optional(),
  firstViewedAt: z.string().optional(),
  answeredAt: z.string().optional(),
  gradedAt: z.string().optional(),
  ungradable: z.boolean().optional(),
  crossedOut: z.array(z.string()).optional(),
});

export const attemptSchema = z
  .object({
    schemaVersion: z.number().int(),
    attemptId: z.string().min(1),
    bankId: z.string().min(1),
    bankVersion: z.string(),
    bankChecksum: z.string().optional(),
    bankTitle: z.string(),
    startedAt: z.string(),
    updatedAt: z.string(),
    completedAt: z.string().optional(),
    mode: z.enum(['exam', 'tutor']),
    questionOrder: z.array(z.string()).min(1),
    currentQuestionId: z.string(),
    responses: z.record(questionResponseSchema),
  })
  .superRefine((attempt, ctx) => {
    if (
      attempt.schemaVersion < MIN_SUPPORTED_ATTEMPT_SCHEMA_VERSION ||
      attempt.schemaVersion > CURRENT_ATTEMPT_SCHEMA_VERSION
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `unsupported attempt schemaVersion ${attempt.schemaVersion}; ` +
          `this build reads ${MIN_SUPPORTED_ATTEMPT_SCHEMA_VERSION}-${CURRENT_ATTEMPT_SCHEMA_VERSION}`,
        path: ['schemaVersion'],
      });
    }
    if (!attempt.questionOrder.includes(attempt.currentQuestionId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'currentQuestionId is not part of questionOrder',
        path: ['currentQuestionId'],
      });
    }
  });

/* ------------------------------------------------------------------ */
/* Portable save files                                                 */
/* ------------------------------------------------------------------ */

export const PROGRESS_FILE_KIND = 'qbank-progress';
export const PORTABLE_SESSION_KIND = 'qbank-portable-session';
export const BUNDLE_FILE_KIND = 'qbank-bundle';

/** Lightweight export: attempts only, plus enough bank identity to verify. */
export const progressFileSchema = z.object({
  kind: z.literal(PROGRESS_FILE_KIND),
  fileVersion: z.number().int(),
  exportedAt: z.string(),
  bank: z.object({
    bankId: z.string(),
    bankVersion: z.string(),
    checksum: z.string().optional(),
    title: z.string().optional(),
    questionCount: z.number().optional(),
  }),
  attempts: z.array(attemptSchema),
});

/** Same as a progress file, but with the bank embedded. Deliberately opt-in. */
export const portableSessionSchema = z.object({
  kind: z.literal(PORTABLE_SESSION_KIND),
  fileVersion: z.number().int(),
  exportedAt: z.string(),
  bank: questionBankSchema,
  bankChecksum: z.string().optional(),
  attempts: z.array(attemptSchema),
});

export const settingsSchema = z.object({
  schemaVersion: z.number().int(),
  mode: z.enum(['exam', 'tutor']),
  autoAdvance: z.boolean(),
  fontSize: z.enum(['small', 'default', 'large']),
  contentWidth: z.enum(['default', 'wide']),
  keyboardShortcuts: z.boolean(),
  showReviewNotes: z.boolean(),
  suggestedHighlights: z.boolean(),
});

/* ------------------------------------------------------------------ */
/* Compile-time parity guards                                          */
/* ------------------------------------------------------------------ */

type AssertAssignable<_A extends _B, _B> = true;

export type _BankParity = AssertAssignable<z.infer<typeof questionBankSchema>, QuestionBank>;
export type _QuestionParity = AssertAssignable<z.infer<typeof questionSchema>, Question>;
export type _AttemptParity = AssertAssignable<z.infer<typeof attemptSchema>, Attempt>;
export type _ResponseParity = AssertAssignable<
  z.infer<typeof questionResponseSchema>,
  QuestionResponse
>;
export type _SettingsParity = AssertAssignable<z.infer<typeof settingsSchema>, AppSettings>;

export type ProgressFile = z.infer<typeof progressFileSchema>;
export type PortableSession = z.infer<typeof portableSessionSchema>;
