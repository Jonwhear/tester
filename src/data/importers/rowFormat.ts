/**
 * Adapter for the row-oriented spreadsheet format produced by the upstream
 * OCR/cleanup pipeline.
 *
 * Source shape (one JSON object per spreadsheet row, in file order):
 *
 *   index | row_type | option_label | row_text | question_id |
 *   source_question_number | year | part | cleaned | question_text | review_note
 *
 * A question is a `question` row followed by its `option` rows:
 *
 *   { row_type: "question", question_id: "2024-P1-Q017", question_text: "..." }
 *   { row_type: "option",   question_id: "2024-P1-Q017", option_label: "A", row_text: "..." }
 *   { row_type: "option",   question_id: "2024-P1-Q017", option_label: "B", row_text: "..." }
 *
 * Guarantees, deliberately matching the upstream philosophy:
 *   - option order is the source row order, never re-sorted
 *   - option labels are preserved verbatim, never renumbered
 *   - there is no assumption of five options (A-D, A-E, A-H are all fine)
 *   - stems/options are never rewritten, paraphrased or "repaired"
 *   - missing material stays as whatever placeholder the pipeline wrote
 *   - a correct answer is only ever read from the source, never inferred
 */
import { z } from 'zod';

import type {
  AnswerOption,
  Question,
  QuestionBank,
  QuestionMetadata,
} from '../../types/question';
import { CURRENT_BANK_SCHEMA_VERSION } from '../../types/question';
import { questionBankSchema } from '../schema';
import { trimCell, type ImportIssue, type ImportResult } from '../normalize';

/** Row types this adapter understands. Anything else is reported, not dropped. */
const KNOWN_ROW_TYPES = [
  'question',
  'option',
  'explanation',
  'educational_objective',
  'reference',
  'correct_answer',
] as const;

const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]).optional();

const rowSchema = z
  .object({
    index: z.union([z.number(), z.string()]).optional(),
    row_type: z.union([z.string(), z.null()]).optional(),
    option_label: cellSchema,
    row_text: cellSchema,
    question_id: cellSchema,
    source_question_number: cellSchema,
    year: cellSchema,
    part: cellSchema,
    cleaned: cellSchema,
    question_text: cellSchema,
    review_note: cellSchema,
    /* Optional forward-compatible columns. Absent in the current spreadsheet. */
    question_type: cellSchema,
    select_count: cellSchema,
    correct_answer: cellSchema,
    explanation: cellSchema,
    educational_objective: cellSchema,
    subject: cellSchema,
    system: cellSchema,
    topic: cellSchema,
  })
  .passthrough();

export type SourceRow = z.infer<typeof rowSchema>;

/** Envelope accepted by {@link importRowFormat}: bare array or `{ meta, rows }`. */
const rowFileSchema = z.union([
  z.array(rowSchema),
  z
    .object({
      bankId: z.string().optional(),
      bankVersion: z.string().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      exam: z.string().optional(),
      rows: z.array(rowSchema),
    })
    .passthrough(),
]);

export interface RowImportOptions {
  bankId?: string;
  bankVersion?: string;
  title?: string;
  description?: string;
}

const SELECT_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/**
 * Read an explicit "(Select three.)"-style instruction out of the stem.
 *
 * This reads an instruction the source author wrote; it does not guess at
 * anything medical. When no instruction is present the question stays
 * single-select unless the source says otherwise.
 */
export function detectSelectCount(stem: string): number | undefined {
  const match = /\bselect\s+(?:the\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.exec(
    stem,
  );
  if (!match) return undefined;
  const token = (match[1] ?? '').toLowerCase();
  const numeric = Number.parseInt(token, 10);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  return SELECT_WORDS[token];
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  const text = trimCell(value).toLowerCase();
  if (text === '') return undefined;
  if (['true', 'yes', 'y', '1'].includes(text)) return true;
  if (['false', 'no', 'n', '0'].includes(text)) return false;
  return undefined;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = trimCell(value);
  if (text === '') return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Split a multi-valued answer-key cell such as "B, D, F" or "B|D|F". */
function parseAnswerKey(value: unknown): string[] | undefined {
  const text = trimCell(value);
  if (text === '') return undefined;
  const parts = text
    .split(/[,;|/]+|\s+and\s+/i)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return parts.length > 0 ? parts : undefined;
}

interface Draft {
  question: Question;
  rowIndex: number;
  optionRowIndexes: number[];
  explicitType: boolean;
  explicitSelectCount: boolean;
}

/**
 * Convert row-format JSON into a normalized `QuestionBank`.
 *
 * Never throws for bad data: problems come back as `issues` naming the exact
 * question id and source row.
 */
export function importRowFormat(input: unknown, options: RowImportOptions = {}): ImportResult {
  const issues: ImportIssue[] = [];

  const parsedFile = rowFileSchema.safeParse(input);
  if (!parsedFile.success) {
    return {
      ok: false,
      issues: parsedFile.error.issues.map((issue) => ({
        level: 'error' as const,
        message: `${issue.path.join('.') || 'file'}: ${issue.message}`,
      })),
    };
  }

  const file = parsedFile.data;
  const rows: SourceRow[] = Array.isArray(file) ? file : file.rows;
  const envelope: {
    bankId?: string;
    bankVersion?: string;
    title?: string;
    description?: string;
    exam?: string;
  } = Array.isArray(file) ? {} : file;

  if (rows.length === 0) {
    return { ok: false, issues: [{ level: 'error', message: 'No rows found in source file.' }] };
  }

  const drafts: Draft[] = [];
  const byId = new Map<string, Draft>();

  rows.forEach((row, arrayIndex) => {
    const rowIndex = parseNumber(row.index) ?? arrayIndex + 1;
    const rowType = trimCell(row.row_type).toLowerCase();
    const questionId = trimCell(row.question_id);

    if (rowType === '') {
      issues.push({ level: 'error', rowIndex, message: 'Row is missing `row_type`.' });
      return;
    }
    if (!(KNOWN_ROW_TYPES as readonly string[]).includes(rowType)) {
      issues.push({
        level: 'error',
        rowIndex,
        questionId: questionId || undefined,
        message:
          `Unrecognized row_type "${rowType}". Known values: ${KNOWN_ROW_TYPES.join(', ')}. ` +
          'The row was not imported — extend the adapter rather than dropping source data.',
      });
      return;
    }
    if (questionId === '') {
      issues.push({ level: 'error', rowIndex, message: `Row of type "${rowType}" has no question_id.` });
      return;
    }

    if (rowType === 'question') {
      if (byId.has(questionId)) {
        issues.push({
          level: 'error',
          rowIndex,
          questionId,
          message: `Duplicate question row for "${questionId}".`,
        });
        return;
      }

      const stem = trimCell(row.question_text) || trimCell(row.row_text);
      if (stem === '') {
        issues.push({
          level: 'warning',
          rowIndex,
          questionId,
          message: 'Question row has empty question_text. Imported as-is; nothing was substituted.',
        });
      }

      const declaredType = trimCell(row.question_type).toLowerCase();
      const explicitType = declaredType === 'single' || declaredType === 'multiple';
      const declaredSelectCount = parseNumber(row.select_count);
      const detected = detectSelectCount(stem);

      const selectCount = declaredSelectCount ?? detected;
      const questionType: Question['questionType'] = explicitType
        ? (declaredType as Question['questionType'])
        : selectCount !== undefined && selectCount > 1
          ? 'multiple'
          : 'single';

      const metadata: QuestionMetadata = {};
      const subject = trimCell(row.subject);
      const system = trimCell(row.system);
      const topic = trimCell(row.topic);
      if (subject) metadata.subject = subject;
      if (system) metadata.system = system;
      if (topic) metadata.topic = topic;

      const question: Question = {
        id: questionId,
        questionType,
        stem,
        options: [],
      };

      const sourceNumber = trimCell(row.source_question_number);
      if (sourceNumber !== '') {
        question.sourceQuestionNumber = parseNumber(sourceNumber) ?? sourceNumber;
      }
      const year = parseNumber(row.year);
      if (year !== undefined) question.year = year;
      const part = trimCell(row.part);
      if (part !== '') question.part = parseNumber(part) ?? part;

      if (questionType === 'multiple' && selectCount !== undefined) {
        question.selectCount = selectCount;
      }

      const key = parseAnswerKey(row.correct_answer);
      if (key) question.correctAnswer = key;

      const explanation = trimCell(row.explanation);
      if (explanation !== '') question.explanation = explanation;
      const objective = trimCell(row.educational_objective);
      if (objective !== '') question.educationalObjective = objective;

      const cleaned = parseBoolean(row.cleaned);
      if (cleaned !== undefined) question.cleaned = cleaned;

      const reviewNote = trimCell(row.review_note);
      if (reviewNote !== '') question.reviewNote = reviewNote;

      if (Object.keys(metadata).length > 0) question.metadata = metadata;

      const draft: Draft = {
        question,
        rowIndex,
        optionRowIndexes: [],
        explicitType,
        explicitSelectCount: declaredSelectCount !== undefined,
      };
      drafts.push(draft);
      byId.set(questionId, draft);
      return;
    }

    const draft = byId.get(questionId);
    if (!draft) {
      issues.push({
        level: 'error',
        rowIndex,
        questionId,
        message:
          `Row of type "${rowType}" references question "${questionId}", ` +
          'but no question row for that id appeared before it.',
      });
      return;
    }

    switch (rowType) {
      case 'option': {
        const label = trimCell(row.option_label);
        if (label === '') {
          issues.push({
            level: 'error',
            rowIndex,
            questionId,
            message: 'Option row has an empty option_label.',
          });
          return;
        }
        if (draft.question.options.some((o) => o.label === label)) {
          issues.push({
            level: 'error',
            rowIndex,
            questionId,
            message: `Duplicate option label "${label}".`,
          });
          return;
        }
        const option: AnswerOption = { label, text: trimCell(row.row_text) };
        draft.question.options.push(option);
        draft.optionRowIndexes.push(rowIndex);
        return;
      }
      case 'correct_answer': {
        const key = parseAnswerKey(row.row_text) ?? parseAnswerKey(row.correct_answer);
        if (!key) {
          issues.push({
            level: 'error',
            rowIndex,
            questionId,
            message: 'correct_answer row has no answer labels in row_text.',
          });
          return;
        }
        draft.question.correctAnswer = key;
        return;
      }
      case 'explanation': {
        const text = trimCell(row.row_text);
        draft.question.explanation = draft.question.explanation
          ? `${draft.question.explanation}\n\n${text}`
          : text;
        return;
      }
      case 'educational_objective': {
        draft.question.educationalObjective = trimCell(row.row_text);
        return;
      }
      case 'reference': {
        const text = trimCell(row.row_text);
        if (text === '') return;
        draft.question.references = [...(draft.question.references ?? []), text];
        return;
      }
      default:
        return;
    }
  });

  /* Per-question structural checks. */
  drafts.forEach((draft) => {
    const { question } = draft;
    if (question.options.length === 0) {
      issues.push({
        level: 'error',
        rowIndex: draft.rowIndex,
        questionId: question.id,
        message: 'Question has no option rows. No options were invented to fill the gap.',
      });
    }
    if (
      question.questionType === 'multiple' &&
      question.selectCount !== undefined &&
      question.selectCount > question.options.length
    ) {
      issues.push({
        level: 'error',
        rowIndex: draft.rowIndex,
        questionId: question.id,
        message: `selectCount ${question.selectCount} exceeds the ${question.options.length} option(s) present.`,
      });
    }
    if (question.correctAnswer) {
      const labels = question.options.map((o) => o.label.trim().toUpperCase());
      const unknown = question.correctAnswer.filter(
        (label) => !labels.includes(label.trim().toUpperCase()),
      );
      if (unknown.length > 0) {
        issues.push({
          level: 'error',
          rowIndex: draft.rowIndex,
          questionId: question.id,
          message: `Answer key references option label(s) not present: ${unknown.join(', ')}.`,
        });
      }
    }
    if (
      !draft.explicitType &&
      !draft.explicitSelectCount &&
      question.questionType === 'multiple'
    ) {
      issues.push({
        level: 'warning',
        rowIndex: draft.rowIndex,
        questionId: question.id,
        message:
          `Treated as multiple-select (selectCount ${question.selectCount}) because the stem contains ` +
          'an explicit "select N" instruction. Add a question_type column to state this in the source.',
      });
    }
  });

  const years = [
    ...new Set(drafts.map((d) => d.question.year).filter((y): y is number => typeof y === 'number')),
  ].sort((a, b) => a - b);

  const bank: QuestionBank = {
    schemaVersion: CURRENT_BANK_SCHEMA_VERSION,
    bankId: options.bankId ?? envelope.bankId ?? 'imported-row-bank',
    bankVersion: options.bankVersion ?? envelope.bankVersion ?? '1',
    title: options.title ?? envelope.title ?? 'Imported question bank',
    questions: drafts.map((d) => d.question),
  };
  const description = options.description ?? envelope.description;
  if (description) bank.description = description;
  if (envelope.exam || years.length > 0) {
    bank.source = {};
    if (envelope.exam) bank.source.exam = envelope.exam;
    if (years.length > 0) bank.source.years = years;
  }

  const hasErrors = issues.some((issue) => issue.level === 'error');
  if (hasErrors) return { ok: false, bank, issues };

  /* Final gate: the produced bank must satisfy the normalized schema. */
  const validated = questionBankSchema.safeParse(bank);
  if (!validated.success) {
    validated.error.issues.forEach((issue) => {
      const questionIndex = issue.path[0] === 'questions' ? Number(issue.path[1]) : NaN;
      const draft = Number.isFinite(questionIndex) ? drafts[questionIndex] : undefined;
      issues.push({
        level: 'error',
        questionId: draft?.question.id,
        rowIndex: draft?.rowIndex,
        message: `${issue.path.join('.')}: ${issue.message}`,
      });
    });
    return { ok: false, bank, issues };
  }

  return { ok: true, bank, issues };
}
