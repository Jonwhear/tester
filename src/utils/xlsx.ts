/**
 * Minimal .xlsx reader.
 *
 * An .xlsx file is a ZIP of XML parts. Reading a flat table of cell values out
 * of one needs only a few of them, so this unzips with `fflate` and walks the
 * XML with the platform `DOMParser` rather than pulling in a full spreadsheet
 * library. That keeps the dependency surface small and, because this parses
 * files the user picked off disk, keeps the amount of third-party code in the
 * untrusted-input path small too.
 *
 * Scope: cell VALUES only — text, numbers, booleans, inline and shared strings.
 * Formulas contribute their cached result. Styles, dates-as-styles, merged
 * cells, charts and images are ignored; a date-formatted cell therefore reads
 * back as its underlying serial number. For a question-bank table that is the
 * right trade, and the CSV path exists for anything this cannot handle.
 */
import { unzipSync } from 'fflate';

export interface SheetData {
  name: string;
  /** Row 1 of the sheet, used as object keys. */
  headers: string[];
  /** One object per row below the header, keyed by header text. */
  rows: Array<Record<string, string>>;
  /** Rows that were entirely empty and therefore skipped. */
  skippedEmptyRows: number;
}

export class XlsxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XlsxError';
  }
}

const decoder = new TextDecoder('utf-8');

function parseXml(text: string, what: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const failure = doc.querySelector('parsererror');
  if (failure) throw new XlsxError(`Could not parse ${what} inside the workbook.`);
  return doc;
}

/** "BC12" -> 54 (1-based column index). */
export function columnIndex(cellRef: string): number {
  const letters = /^([A-Z]+)/.exec(cellRef.toUpperCase())?.[1] ?? '';
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index;
}

/**
 * Shared strings table. Each <si> may be a single <t> or a series of formatted
 * runs, which are concatenated — a stem split into runs by a stray bold word
 * must still come back as one string.
 */
function readSharedStrings(files: Record<string, Uint8Array>): string[] {
  const part = files['xl/sharedStrings.xml'];
  if (!part) return [];
  const doc = parseXml(decoder.decode(part), 'the shared string table');
  return [...doc.getElementsByTagName('si')].map((si) =>
    [...si.getElementsByTagName('t')].map((t) => t.textContent ?? '').join(''),
  );
}

function cellText(cell: Element, sharedStrings: string[]): string {
  const type = cell.getAttribute('t');

  if (type === 'inlineStr') {
    const is = cell.getElementsByTagName('is')[0];
    if (!is) return '';
    return [...is.getElementsByTagName('t')].map((t) => t.textContent ?? '').join('');
  }

  const value = cell.getElementsByTagName('v')[0]?.textContent ?? '';
  if (value === '') return '';

  if (type === 's') {
    const index = Number.parseInt(value, 10);
    return sharedStrings[index] ?? '';
  }
  if (type === 'b') return value === '1' ? 'TRUE' : 'FALSE';
  if (type === 'e') return '';
  return value;
}

/** Sheet names in workbook order, so a caller can offer a choice. */
function readSheetOrder(files: Record<string, Uint8Array>): Array<{ name: string; path: string }> {
  const workbookPart = files['xl/workbook.xml'];
  if (!workbookPart) {
    throw new XlsxError('This file is not a valid .xlsx workbook (no xl/workbook.xml inside).');
  }
  const workbook = parseXml(decoder.decode(workbookPart), 'the workbook');

  const relsPart = files['xl/_rels/workbook.xml.rels'];
  const relationships = new Map<string, string>();
  if (relsPart) {
    const rels = parseXml(decoder.decode(relsPart), 'the workbook relationships');
    [...rels.getElementsByTagName('Relationship')].forEach((rel) => {
      const id = rel.getAttribute('Id');
      const target = rel.getAttribute('Target');
      if (id && target) relationships.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''));
    });
  }

  const sheets = [...workbook.getElementsByTagName('sheet')].map((sheet, index) => {
    const name = sheet.getAttribute('name') ?? `Sheet${index + 1}`;
    const relId =
      sheet.getAttribute('r:id') ??
      sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = relId ? relationships.get(relId) : undefined;
    return { name, path: `xl/${target ?? `worksheets/sheet${index + 1}.xml`}` };
  });

  if (sheets.length === 0) throw new XlsxError('The workbook contains no sheets.');
  return sheets;
}

/** Make header names usable as object keys, and keep duplicates distinguishable. */
function normalizeHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((value, index) => {
    const base = value.trim() === '' ? `column_${index + 1}` : value.trim();
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

/**
 * Read one sheet of a workbook into header-keyed row objects.
 *
 * @param buffer raw bytes of the .xlsx file
 * @param sheetName sheet to read; defaults to the first sheet
 */
export function readXlsx(buffer: ArrayBuffer, sheetName?: string): SheetData {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new XlsxError(
      'This file could not be opened as an .xlsx workbook. Older .xls files are not supported — ' +
        're-save it as .xlsx, or export it as CSV.',
    );
  }

  const sheets = readSheetOrder(files);
  const chosen = sheetName ? sheets.find((s) => s.name === sheetName) : sheets[0];
  if (!chosen) {
    throw new XlsxError(
      `The workbook has no sheet named "${sheetName}". Available: ${sheets
        .map((s) => s.name)
        .join(', ')}.`,
    );
  }
  const sheetPart = files[chosen.path];
  if (!sheetPart) throw new XlsxError(`Sheet "${chosen.name}" is missing from the workbook.`);

  const sharedStrings = readSharedStrings(files);
  const sheet = parseXml(decoder.decode(sheetPart), `sheet "${chosen.name}"`);

  const grid: string[][] = [];
  [...sheet.getElementsByTagName('row')].forEach((row) => {
    const cells: string[] = [];
    [...row.getElementsByTagName('c')].forEach((cell) => {
      const ref = cell.getAttribute('r');
      // A cell with no reference is positional; otherwise honour the column so
      // that blank cells Excel omitted do not shift later columns left.
      const index = ref ? columnIndex(ref) - 1 : cells.length;
      while (cells.length < index) cells.push('');
      cells[index] = cellText(cell, sharedStrings);
    });
    grid.push(cells);
  });

  const headerRow = grid.shift() ?? [];
  const headers = normalizeHeaders(headerRow);
  if (headers.length === 0) {
    throw new XlsxError(`Sheet "${chosen.name}" appears to be empty — no header row found.`);
  }

  let skippedEmptyRows = 0;
  const rows: Array<Record<string, string>> = [];
  grid.forEach((cells) => {
    if (cells.every((value) => (value ?? '').trim() === '')) {
      skippedEmptyRows += 1;
      return;
    }
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = cells[index] ?? '';
    });
    rows.push(record);
  });

  return { name: chosen.name, headers, rows, skippedEmptyRows };
}

/** Sheet names only, without reading any cell data. */
export function listSheetNames(buffer: ArrayBuffer): string[] {
  const files = unzipSync(new Uint8Array(buffer));
  return readSheetOrder(files).map((sheet) => sheet.name);
}
