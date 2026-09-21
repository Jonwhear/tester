/**
 * Spreadsheet entry point: .xlsx / .csv / .tsv straight off disk.
 *
 * Produces the same row objects `importRowFormat` already consumes, so a
 * spreadsheet and a hand-written JSON row file follow one code path from here
 * on. Header names are mapped onto the canonical column names first, because
 * real spreadsheets spell them inconsistently ("Question ID", "correct answer",
 * "Answer Key") and failing on capitalisation would be pointless friction.
 */
import { parseDelimited } from '../../utils/csv';
import { readXlsx, XlsxError, listSheetNames } from '../../utils/xlsx';

export type TabularFormat = 'xlsx' | 'delimited' | 'json';

export interface TabularSource {
  format: TabularFormat;
  /** Header names exactly as they appeared in the file. */
  originalHeaders: string[];
  /** Canonical column names after alias mapping. */
  headers: string[];
  rows: Array<Record<string, string>>;
  sheetName?: string;
  sheetNames?: string[];
  skippedEmptyRows: number;
  /** Headers that were not recognized; passed through untouched. */
  unrecognizedHeaders: string[];
}

/**
 * Accepted spellings for each canonical column. Compared after lowercasing and
 * collapsing spaces, hyphens and underscores, so "Question ID", "question-id"
 * and "question_id" all match.
 */
const COLUMN_ALIASES: Record<string, string[]> = {
  index: ['index', 'idx', 'row', 'rownumber', 'rowindex', 'no'],
  row_type: ['rowtype', 'type', 'kind', 'recordtype'],
  option_label: ['optionlabel', 'label', 'option', 'choice', 'choiceletter', 'optionletter'],
  row_text: ['rowtext', 'text', 'optiontext', 'choicetext', 'content'],
  question_id: ['questionid', 'qid', 'id', 'itemid'],
  source_question_number: [
    'sourcequestionnumber',
    'questionnumber',
    'qnumber',
    'qno',
    'number',
    'itemnumber',
  ],
  year: ['year', 'examyear'],
  part: ['part', 'section', 'paper'],
  cleaned: ['cleaned', 'isclean', 'clean', 'verified'],
  question_text: ['questiontext', 'stem', 'question', 'questionstem', 'vignette'],
  review_note: ['reviewnote', 'note', 'notes', 'comment', 'comments', 'reviewnotes', 'flag'],
  question_type: ['questiontype', 'qtype', 'answertype', 'selecttype'],
  select_count: ['selectcount', 'numanswers', 'numberofanswers', 'nanswers', 'selectn'],
  correct_answer: [
    'correctanswer',
    'correctanswers',
    'answer',
    'answers',
    'answerkey',
    'key',
    'correct',
    'correctoption',
    'correctlabel',
    'correctchoice',
    'ans',
    'solution',
  ],
  explanation: ['explanation', 'rationale', 'discussion', 'teachingpoint'],
  educational_objective: ['educationalobjective', 'objective', 'learningobjective', 'eo'],
  subject: ['subject', 'discipline'],
  system: ['system', 'organsystem'],
  topic: ['topic', 'subtopic', 'category'],
};

function canonicalKey(header: string): string {
  return header.toLowerCase().replace(/[\s_\-.]+/g, '');
}

const ALIAS_LOOKUP = new Map<string, string>();
Object.entries(COLUMN_ALIASES).forEach(([canonical, aliases]) => {
  ALIAS_LOOKUP.set(canonicalKey(canonical), canonical);
  aliases.forEach((alias) => ALIAS_LOOKUP.set(canonicalKey(alias), canonical));
});

/** Canonical name for a spreadsheet header, or undefined when unrecognized. */
export function mapHeader(header: string): string | undefined {
  return ALIAS_LOOKUP.get(canonicalKey(header));
}

export interface MappedRows {
  headers: string[];
  rows: Array<Record<string, string>>;
  unrecognizedHeaders: string[];
}

/**
 * Rename headers to canonical column names.
 *
 * An unrecognized header is kept under its original name rather than dropped —
 * the row importer ignores columns it does not know, and silently discarding a
 * column the user deliberately added would be worse than carrying it.
 */
export function mapColumns(
  rows: Array<Record<string, string>>,
  originalHeaders: string[],
): MappedRows {
  const unrecognizedHeaders: string[] = [];
  const rename = new Map<string, string>();

  originalHeaders.forEach((header) => {
    const canonical = mapHeader(header);
    if (canonical && !rename.has(header)) {
      rename.set(header, canonical);
    } else if (!canonical) {
      unrecognizedHeaders.push(header);
    }
  });

  const mapped = rows.map((row) => {
    const next: Record<string, string> = {};
    Object.entries(row).forEach(([key, value]) => {
      next[rename.get(key) ?? key] = value;
    });
    return next;
  });

  const headers = originalHeaders.map((header) => rename.get(header) ?? header);
  return { headers, rows: mapped, unrecognizedHeaders };
}

function extensionOf(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return (match?.[1] ?? '').toLowerCase();
}

export class TabularError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TabularError';
  }
}

/**
 * Read a spreadsheet or delimited file into canonical row objects.
 *
 * JSON is not handled here — it already has structure and goes to the JSON
 * importers directly.
 */
export async function readTabularFile(file: File, sheetName?: string): Promise<TabularSource> {
  const extension = extensionOf(file.name);

  if (extension === 'xls') {
    throw new TabularError(
      'Old-style .xls files are not supported. Open it in Excel and use ' +
        '“Save As → Excel Workbook (.xlsx)”, or export it as CSV.',
    );
  }

  if (extension === 'xlsx' || extension === 'xlsm') {
    const buffer = await file.arrayBuffer();
    let sheetNames: string[] = [];
    try {
      sheetNames = listSheetNames(buffer);
    } catch {
      /* readXlsx reports the real problem below. */
    }
    try {
      const sheet = readXlsx(buffer, sheetName);
      const mapped = mapColumns(sheet.rows, sheet.headers);
      return {
        format: 'xlsx',
        originalHeaders: sheet.headers,
        headers: mapped.headers,
        rows: mapped.rows,
        sheetName: sheet.name,
        sheetNames,
        skippedEmptyRows: sheet.skippedEmptyRows,
        unrecognizedHeaders: mapped.unrecognizedHeaders,
      };
    } catch (error) {
      if (error instanceof XlsxError) throw new TabularError(error.message);
      throw new TabularError(`Could not read ${file.name} as a workbook.`);
    }
  }

  if (extension === 'csv' || extension === 'tsv' || extension === 'txt') {
    const text = await file.text();
    const table = parseDelimited(text, extension === 'tsv' ? '\t' : undefined);
    const mapped = mapColumns(table.rows, table.headers);
    return {
      format: 'delimited',
      originalHeaders: table.headers,
      headers: mapped.headers,
      rows: mapped.rows,
      skippedEmptyRows: table.skippedEmptyRows,
      unrecognizedHeaders: mapped.unrecognizedHeaders,
    };
  }

  throw new TabularError(
    `Unsupported file type ".${extension || '?'}". Use .xlsx, .csv, .tsv or .json.`,
  );
}

/** True when the filename looks like something `readTabularFile` can read. */
export function isTabularFilename(filename: string): boolean {
  return ['xlsx', 'xlsm', 'csv', 'tsv', 'txt'].includes(extensionOf(filename));
}

export function isJsonFilename(filename: string): boolean {
  return extensionOf(filename) === 'json';
}
