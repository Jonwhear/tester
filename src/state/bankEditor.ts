/**
 * Question-bank authoring operations.
 *
 * Pure functions over a `QuestionBank`, mirroring how `attemptReducer` handles
 * attempts. Nothing here touches React or storage, so every edit is testable in
 * isolation and the editor UI stays a thin shell.
 *
 * Authoring is deliberately separate from taking an exam. A bank an attempt is
 * pointing at must stay immutable, so the editor works on a detached draft and
 * the caller decides when — and under which `bankVersion` — it becomes real.
 */
import type {
  AnswerOption,
  ContentBlock,
  Question,
  QuestionBank,
} from '../types/question';
import { CURRENT_BANK_SCHEMA_VERSION } from '../types/question';

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export type IssueLevel = 'error' | 'warning';

export interface EditorIssue {
  level: IssueLevel;
  questionId?: string;
  field?: 'stem' | 'options' | 'correctAnswer' | 'id' | 'selectCount' | 'meta';
  message: string;
}

/** Worst issue level for a question, or 'ok'. */
export type QuestionHealth = 'ok' | 'warning' | 'error';

export function validateQuestion(question: Question): EditorIssue[] {
  const issues: EditorIssue[] = [];
  const id = question.id;

  if (question.id.trim() === '') {
    issues.push({ level: 'error', questionId: id, field: 'id', message: 'Question id is empty.' });
  }

  const hasBlocks = (question.contentBlocks?.length ?? 0) > 0;
  if (!hasBlocks && question.stem.trim() === '') {
    issues.push({ level: 'error', questionId: id, field: 'stem', message: 'Question has no stem text.' });
  }

  if (question.options.length === 0) {
    issues.push({ level: 'error', questionId: id, field: 'options', message: 'Question has no options.' });
  }

  const labels = question.options.map((option) => option.label.trim());
  const blankLabels = labels.filter((label) => label === '').length;
  if (blankLabels > 0) {
    issues.push({
      level: 'error',
      questionId: id,
      field: 'options',
      message: `${blankLabels} option(s) have an empty label.`,
    });
  }
  const duplicates = [
    ...new Set(labels.filter((label, index) => label !== '' && labels.indexOf(label) !== index)),
  ];
  if (duplicates.length > 0) {
    issues.push({
      level: 'error',
      questionId: id,
      field: 'options',
      message: `Duplicate option label(s): ${duplicates.join(', ')}.`,
    });
  }
  const blankText = question.options.filter((option) => option.text.trim() === '').length;
  if (blankText > 0) {
    issues.push({
      level: 'warning',
      questionId: id,
      field: 'options',
      message: `${blankText} option(s) have no text.`,
    });
  }

  const key = question.correctAnswer ?? [];
  if (key.length === 0) {
    issues.push({
      level: 'warning',
      questionId: id,
      field: 'correctAnswer',
      message: 'No answer key — this question cannot be graded.',
    });
  } else {
    const known = new Set(labels.map((label) => label.toUpperCase()));
    const unknown = key.filter((label) => !known.has(label.trim().toUpperCase()));
    if (unknown.length > 0) {
      issues.push({
        level: 'error',
        questionId: id,
        field: 'correctAnswer',
        message: `Answer key names option(s) that do not exist: ${unknown.join(', ')}.`,
      });
    }
    if (question.questionType === 'single' && key.length > 1) {
      issues.push({
        level: 'error',
        questionId: id,
        field: 'correctAnswer',
        message: `Single-answer question has ${key.length} correct answers. Switch it to multiple-select.`,
      });
    }
  }

  if (question.questionType === 'multiple') {
    const count = question.selectCount;
    if (count === undefined) {
      issues.push({
        level: 'warning',
        questionId: id,
        field: 'selectCount',
        message: 'Multiple-select question does not say how many options to choose.',
      });
    } else {
      if (count > question.options.length) {
        issues.push({
          level: 'error',
          questionId: id,
          field: 'selectCount',
          message: `Asks for ${count} answers but only has ${question.options.length} options.`,
        });
      }
      if (key.length > 0 && key.length !== count) {
        issues.push({
          level: 'error',
          questionId: id,
          field: 'selectCount',
          message: `Asks for ${count} answers but the key names ${key.length}.`,
        });
      }
    }
  }

  return issues;
}

export function questionHealth(question: Question): QuestionHealth {
  const issues = validateQuestion(question);
  if (issues.some((issue) => issue.level === 'error')) return 'error';
  if (issues.length > 0) return 'warning';
  return 'ok';
}

export function validateBank(bank: QuestionBank): EditorIssue[] {
  const issues: EditorIssue[] = [];

  if (bank.bankId.trim() === '') {
    issues.push({ level: 'error', field: 'meta', message: 'Bank id is required.' });
  }
  if (bank.bankVersion.trim() === '') {
    issues.push({ level: 'error', field: 'meta', message: 'Bank version is required.' });
  }
  if (bank.title.trim() === '') {
    issues.push({ level: 'error', field: 'meta', message: 'Bank title is required.' });
  }

  const ids = bank.questions.map((question) => question.id.trim());
  const duplicates = [...new Set(ids.filter((id, index) => id !== '' && ids.indexOf(id) !== index))];
  duplicates.forEach((id) => {
    issues.push({
      level: 'error',
      questionId: id,
      field: 'id',
      message: `Duplicate question id "${id}".`,
    });
  });

  bank.questions.forEach((question) => issues.push(...validateQuestion(question)));
  return issues;
}

/* ------------------------------------------------------------------ */
/* Bank-level edits                                                    */
/* ------------------------------------------------------------------ */

type BankMeta = Pick<QuestionBank, 'bankId' | 'bankVersion' | 'title' | 'description'>;

export function updateBankMeta(bank: QuestionBank, patch: Partial<BankMeta>): QuestionBank {
  const next: QuestionBank = { ...bank, ...patch };
  if (patch.description !== undefined && patch.description.trim() === '') delete next.description;
  return next;
}

export function createEmptyBank(): QuestionBank {
  return {
    schemaVersion: CURRENT_BANK_SCHEMA_VERSION,
    bankId: 'new-bank',
    bankVersion: '1',
    title: 'New question bank',
    createdAt: new Date().toISOString(),
    questions: [],
  };
}

/**
 * Suggest the next version string.
 * "2024.1" -> "2024.2", "3" -> "4", anything else gains a ".1" suffix.
 */
export function nextBankVersion(version: string): string {
  const match = /^(.*?)(\d+)$/.exec(version.trim());
  if (!match) return `${version}.1`;
  const [, prefix = '', digits = '0'] = match;
  return `${prefix}${Number.parseInt(digits, 10) + 1}`;
}

/**
 * Apply an updater to one question.
 *
 * Returns the ORIGINAL bank when the updater declined to change anything (by
 * returning the same question object) or when the id is unknown. Preserving
 * referential equality that way lets callers and React skip work on a no-op
 * edit — moving an option that is already at the top, for instance.
 */
function replaceQuestion(
  bank: QuestionBank,
  questionId: string,
  update: (question: Question) => Question,
): QuestionBank {
  const index = bank.questions.findIndex((question) => question.id === questionId);
  if (index === -1) return bank;

  const current = bank.questions[index] as Question;
  const updated = update(current);
  if (updated === current) return bank;

  const questions = [...bank.questions];
  questions[index] = updated;
  return { ...bank, questions };
}

/* ------------------------------------------------------------------ */
/* Question-level edits                                                */
/* ------------------------------------------------------------------ */

/** Fields that can be edited directly without extra bookkeeping. */
export type QuestionPatch = Partial<
  Pick<
    Question,
    | 'id'
    | 'stem'
    | 'sourceQuestionNumber'
    | 'year'
    | 'part'
    | 'explanation'
    | 'educationalObjective'
    | 'reviewNote'
    | 'cleaned'
    | 'references'
    | 'metadata'
    | 'contentBlocks'
  >
>;

/** Apply a patch, dropping keys the schema treats as absent when blank. */
export function updateQuestion(
  bank: QuestionBank,
  questionId: string,
  patch: QuestionPatch,
): QuestionBank {
  return replaceQuestion(bank, questionId, (question) => {
    const next: Question = { ...question, ...patch };
    (['explanation', 'educationalObjective', 'reviewNote'] as const).forEach((field) => {
      if (patch[field] !== undefined && String(patch[field]).trim() === '') delete next[field];
    });
    if (patch.contentBlocks !== undefined && patch.contentBlocks.length === 0) {
      delete next.contentBlocks;
    }
    if (patch.references !== undefined && patch.references.length === 0) delete next.references;
    if (patch.year !== undefined && !Number.isFinite(patch.year)) delete next.year;
    return next;
  });
}

/**
 * Change a question's type.
 * Switching to single collapses the key to one answer, because a single-select
 * question with two correct answers is not a coherent state to leave behind.
 */
export function setQuestionType(
  bank: QuestionBank,
  questionId: string,
  type: Question['questionType'],
): QuestionBank {
  return replaceQuestion(bank, questionId, (question) => {
    if (question.questionType === type) return question;
    const next: Question = { ...question, questionType: type };
    if (type === 'single') {
      delete next.selectCount;
      if (next.correctAnswer && next.correctAnswer.length > 1) {
        next.correctAnswer = next.correctAnswer.slice(0, 1);
      }
    } else {
      next.selectCount = next.correctAnswer?.length && next.correctAnswer.length > 1
        ? next.correctAnswer.length
        : Math.min(2, question.options.length || 2);
    }
    return next;
  });
}

export function setSelectCount(
  bank: QuestionBank,
  questionId: string,
  count: number | undefined,
): QuestionBank {
  return replaceQuestion(bank, questionId, (question) => {
    const next: Question = { ...question };
    if (count === undefined || !Number.isFinite(count) || count < 1) delete next.selectCount;
    else next.selectCount = Math.floor(count);
    return next;
  });
}

/* ---------------- options ---------------- */

/** Next unused label in the A, B, C… sequence. */
export function nextOptionLabel(options: readonly AnswerOption[]): string {
  const used = new Set(options.map((option) => option.label.trim().toUpperCase()));
  for (let i = 0; i < 26; i += 1) {
    const label = String.fromCharCode(65 + i);
    if (!used.has(label)) return label;
  }
  return `OPT${options.length + 1}`;
}

export function addOption(bank: QuestionBank, questionId: string, text = ''): QuestionBank {
  return replaceQuestion(bank, questionId, (question) => ({
    ...question,
    options: [...question.options, { label: nextOptionLabel(question.options), text }],
  }));
}

export function setOptionText(
  bank: QuestionBank,
  questionId: string,
  index: number,
  text: string,
): QuestionBank {
  return replaceQuestion(bank, questionId, (question) => {
    if (index < 0 || index >= question.options.length) return question;
    const options = question.options.map((option, i) => (i === index ? { ...option, text } : option));
    return { ...question, options };
  });
}

/**
 * Rename an option label, carrying the answer key with it so a rename never
 * silently invalidates the key.
 */
export function setOptionLabel(
  bank: QuestionBank,
  questionId: string,
  index: number,
  label: string,
): QuestionBank {
  return replaceQuestion(bank, questionId, (question) => {
    const current = question.options[index];
    if (!current) return question;
    const options = question.options.map((option, i) => (i === index ? { ...option, label } : option));
    const next: Question = { ...question, options };
    if (question.correctAnswer?.some((entry) => entry === current.label)) {
      next.correctAnswer = question.correctAnswer.map((entry) =>
        entry === current.label ? label : entry,
      );
    }
    return next;
  });
}

/** Remove an option, and drop it from the answer key if it was in it. */
export function removeOption(bank: QuestionBank, questionId: string, index: number): QuestionBank {
  return replaceQuestion(bank, questionId, (question) => {
    const target = question.options[index];
    if (!target) return question;
    const options = question.options.filter((_, i) => i !== index);
    const next: Question = { ...question, options };
    if (question.correctAnswer) {
      const key = question.correctAnswer.filter((label) => label !== target.label);
      if (key.length > 0) next.correctAnswer = key;
      else delete next.correctAnswer;
    }
    return next;
  });
}

/**
 * Reorder options.
 *
 * Labels stay attached to their text — moving option D above option B leaves
 * them labelled D and B, because the source labels are what the answer key and
 * the printed exam refer to. Use `relabelOptionsSequentially` to renumber
 * deliberately.
 */
export function moveOption(
  bank: QuestionBank,
  questionId: string,
  index: number,
  delta: number,
): QuestionBank {
  return replaceQuestion(bank, questionId, (question) => {
    const target = index + delta;
    if (index < 0 || index >= question.options.length) return question;
    if (target < 0 || target >= question.options.length) return question;
    const options = [...question.options];
    const [moved] = options.splice(index, 1);
    if (!moved) return question;
    options.splice(target, 0, moved);
    return { ...question, options };
  });
}

/** Relabel every option A, B, C… in their current order, remapping the key. */
export function relabelOptionsSequentially(
  bank: QuestionBank,
  questionId: string,
): QuestionBank {
  return replaceQuestion(bank, questionId, (question) => {
    const mapping = new Map<string, string>();
    const options = question.options.map((option, index) => {
      const label = String.fromCharCode(65 + index);
      mapping.set(option.label, label);
      return { ...option, label };
    });
    const next: Question = { ...question, options };
    if (question.correctAnswer) {
      next.correctAnswer = question.correctAnswer.map((label) => mapping.get(label) ?? label);
    }
    return next;
  });
}

/* ---------------- answer key ---------------- */

/**
 * Toggle an option in the answer key.
 * Single-select replaces the key; multiple-select adds or removes, keeping the
 * key in source option order rather than click order.
 */
export function toggleCorrectAnswer(
  bank: QuestionBank,
  questionId: string,
  label: string,
): QuestionBank {
  return replaceQuestion(bank, questionId, (question) => {
    const current = question.correctAnswer ?? [];
    const next: Question = { ...question };

    if (question.questionType === 'single') {
      if (current.length === 1 && current[0] === label) delete next.correctAnswer;
      else next.correctAnswer = [label];
      return next;
    }

    const order = question.options.map((option) => option.label);
    const updated = current.includes(label)
      ? current.filter((entry) => entry !== label)
      : [...current, label].sort((a, b) => order.indexOf(a) - order.indexOf(b));

    if (updated.length > 0) next.correctAnswer = updated;
    else delete next.correctAnswer;
    return next;
  });
}

export function clearCorrectAnswer(bank: QuestionBank, questionId: string): QuestionBank {
  return replaceQuestion(bank, questionId, (question) => {
    if (!question.correctAnswer) return question;
    const next = { ...question };
    delete next.correctAnswer;
    return next;
  });
}

/* ---------------- content blocks ---------------- */

/**
 * Promote a plain stem to structured blocks.
 *
 * Needed before an image or table can be inserted, since those only exist as
 * blocks. The plain stem is split on blank lines so nothing is lost.
 */
export function ensureContentBlocks(question: Question): ContentBlock[] {
  if (question.contentBlocks && question.contentBlocks.length > 0) return question.contentBlocks;
  return question.stem
    .split(/\n{2,}/)
    .map((text) => ({ type: 'paragraph' as const, text }))
    .filter((block) => block.text.trim() !== '');
}

export function setContentBlocks(
  bank: QuestionBank,
  questionId: string,
  blocks: ContentBlock[],
): QuestionBank {
  return replaceQuestion(bank, questionId, (question) => {
    const next: Question = { ...question };
    if (blocks.length === 0) delete next.contentBlocks;
    else next.contentBlocks = blocks;
    return next;
  });
}

export function addContentBlock(
  bank: QuestionBank,
  questionId: string,
  block: ContentBlock,
  atIndex?: number,
): QuestionBank {
  return replaceQuestion(bank, questionId, (question) => {
    const blocks = [...ensureContentBlocks(question)];
    const index = atIndex ?? blocks.length;
    blocks.splice(Math.max(0, Math.min(index, blocks.length)), 0, block);
    return { ...question, contentBlocks: blocks };
  });
}

export function updateContentBlock(
  bank: QuestionBank,
  questionId: string,
  index: number,
  block: ContentBlock,
): QuestionBank {
  return replaceQuestion(bank, questionId, (question) => {
    const blocks = [...ensureContentBlocks(question)];
    if (index < 0 || index >= blocks.length) return question;
    blocks[index] = block;
    return { ...question, contentBlocks: blocks };
  });
}

export function removeContentBlock(
  bank: QuestionBank,
  questionId: string,
  index: number,
): QuestionBank {
  return replaceQuestion(bank, questionId, (question) => {
    const blocks = ensureContentBlocks(question).filter((_, i) => i !== index);
    const next: Question = { ...question };
    if (blocks.length === 0) delete next.contentBlocks;
    else next.contentBlocks = blocks;
    return next;
  });
}

export function moveContentBlock(
  bank: QuestionBank,
  questionId: string,
  index: number,
  delta: number,
): QuestionBank {
  return replaceQuestion(bank, questionId, (question) => {
    const blocks = [...ensureContentBlocks(question)];
    const target = index + delta;
    if (index < 0 || index >= blocks.length || target < 0 || target >= blocks.length) {
      return question;
    }
    const [moved] = blocks.splice(index, 1);
    if (!moved) return question;
    blocks.splice(target, 0, moved);
    return { ...question, contentBlocks: blocks };
  });
}

/* ---------------- question list ---------------- */

/** Unused id following the pattern of an existing one, e.g. 2024-P1-Q007. */
export function suggestQuestionId(bank: QuestionBank): string {
  const last = bank.questions[bank.questions.length - 1]?.id ?? '';
  const match = /^(.*?)(\d+)$/.exec(last);
  const existing = new Set(bank.questions.map((question) => question.id));

  if (match) {
    const [, prefix = '', digits = '0'] = match;
    let n = Number.parseInt(digits, 10);
    for (let attempt = 0; attempt < 10000; attempt += 1) {
      n += 1;
      const candidate = `${prefix}${String(n).padStart(digits.length, '0')}`;
      if (!existing.has(candidate)) return candidate;
    }
  }
  let n = bank.questions.length + 1;
  while (existing.has(`Q${n}`)) n += 1;
  return `Q${n}`;
}

export function addQuestion(bank: QuestionBank, afterQuestionId?: string): {
  bank: QuestionBank;
  questionId: string;
} {
  const id = suggestQuestionId(bank);
  const previous = afterQuestionId
    ? bank.questions.find((question) => question.id === afterQuestionId)
    : bank.questions[bank.questions.length - 1];

  const question: Question = {
    id,
    questionType: 'single',
    stem: '',
    options: [
      { label: 'A', text: '' },
      { label: 'B', text: '' },
      { label: 'C', text: '' },
      { label: 'D', text: '' },
    ],
  };
  if (previous?.year !== undefined) question.year = previous.year;
  if (previous?.part !== undefined) question.part = previous.part;

  const questions = [...bank.questions];
  const index = afterQuestionId
    ? questions.findIndex((entry) => entry.id === afterQuestionId) + 1
    : questions.length;
  questions.splice(index < 1 ? questions.length : index, 0, question);

  return { bank: { ...bank, questions }, questionId: id };
}

export function removeQuestion(bank: QuestionBank, questionId: string): QuestionBank {
  const questions = bank.questions.filter((question) => question.id !== questionId);
  if (questions.length === bank.questions.length) return bank;
  return { ...bank, questions };
}

export function moveQuestion(bank: QuestionBank, questionId: string, delta: number): QuestionBank {
  const index = bank.questions.findIndex((question) => question.id === questionId);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= bank.questions.length) return bank;
  const questions = [...bank.questions];
  const [moved] = questions.splice(index, 1);
  if (!moved) return bank;
  questions.splice(target, 0, moved);
  return { ...bank, questions };
}

export function duplicateQuestion(
  bank: QuestionBank,
  questionId: string,
): { bank: QuestionBank; questionId: string } {
  const source = bank.questions.find((question) => question.id === questionId);
  if (!source) return { bank, questionId };
  const id = suggestQuestionId(bank);
  const copy: Question = {
    ...structuredCloneish(source),
    id,
  };
  const questions = [...bank.questions];
  questions.splice(questions.findIndex((entry) => entry.id === questionId) + 1, 0, copy);
  return { bank: { ...bank, questions }, questionId: id };
}

/** Deep copy without relying on `structuredClone` being present. */
function structuredCloneish<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
