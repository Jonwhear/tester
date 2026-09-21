/**
 * Normalized question-bank model.
 *
 * This is the ONLY question representation the UI is allowed to know about.
 * Row-oriented spreadsheet exports, OCR intermediates and any future source
 * format are converted into this shape by `src/data/importers/*` before they
 * reach a React component.
 */

/** Bumped whenever the normalized bank shape changes incompatibly. */
export const CURRENT_BANK_SCHEMA_VERSION = 1;

/** Lowest `schemaVersion` this build knows how to read. */
export const MIN_SUPPORTED_BANK_SCHEMA_VERSION = 1;

export type QuestionType = 'single' | 'multiple';

export type StemFormat = 'plain' | 'markdown';

export interface AnswerOption {
  /** Source label exactly as authored: "A", "B", "iii", "1" ... Never rewritten. */
  label: string;
  /** Option body text exactly as authored. */
  text: string;
}

export type ContentBlock =
  | { type: 'paragraph'; text: string; emphasis?: boolean }
  | { type: 'table'; columns: string[]; rows: string[][]; caption?: string }
  | { type: 'image'; src: string; alt?: string; caption?: string };

export interface QuestionAsset {
  id: string;
  kind: 'image' | 'audio' | 'other';
  src: string;
  alt?: string;
  caption?: string;
}

/**
 * A phrase in the stem the upstream pipeline flagged as worth highlighting.
 * Purely data driven — the app never generates these itself.
 */
export interface SuggestedHighlight {
  /** Literal substring of the stem / block text to highlight. */
  text: string;
  /** Optional note shown as a tooltip. */
  note?: string;
}

export interface QuestionMetadata {
  subject?: string;
  system?: string;
  topic?: string;
  [key: string]: string | undefined;
}

export interface Question {
  /** Source question id, e.g. "2024-P1-Q006". Preserved verbatim. */
  id: string;
  sourceQuestionNumber?: number | string;
  year?: number;
  part?: number | string;

  questionType: QuestionType;

  /** Number of options the candidate must select. Only meaningful for `multiple`. */
  selectCount?: number;

  /** Plain stem text. Used when `contentBlocks` is absent. */
  stem: string;

  stemFormat?: StemFormat;

  /** Structured stem. When present it is rendered INSTEAD of `stem`. */
  contentBlocks?: ContentBlock[];

  options: AnswerOption[];

  /**
   * Answer key. Always an array, even for single-answer questions.
   * Optional: banks generated before the key was transcribed are still usable,
   * they simply cannot be graded. The app NEVER infers this value.
   */
  correctAnswer?: string[];

  explanation?: string;
  educationalObjective?: string;
  references?: string[];

  metadata?: QuestionMetadata;

  /** Upstream reviewer annotation. Hidden from the exam UI by default. */
  reviewNote?: string;

  /** Whether the upstream pipeline considers this row cleaned. */
  cleaned?: boolean;

  assets?: QuestionAsset[];

  suggestedHighlights?: SuggestedHighlight[];
}

export interface QuestionBankSource {
  exam?: string;
  years?: number[];
  [key: string]: unknown;
}

export interface QuestionBank {
  schemaVersion: number;
  bankId: string;
  bankVersion: string;
  title: string;
  description?: string;
  createdAt?: string;
  source?: QuestionBankSource;
  questions: Question[];
}

/** Bank plus the locally derived bookkeeping the app adds at import time. */
export interface StoredBank {
  bankId: string;
  bankVersion: string;
  title: string;
  /** Stable content hash used to detect "same version, different content". */
  checksum: string;
  importedAt: string;
  questionCount: number;
  /** True when at least one question carries a `correctAnswer`. */
  hasAnswerKey: boolean;
  /** True when EVERY question carries a `correctAnswer`. */
  fullAnswerKey: boolean;
  /** Bundled development fixture rather than a user import. */
  builtIn: boolean;
  bank: QuestionBank;
}
