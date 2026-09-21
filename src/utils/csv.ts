/**
 * RFC 4180 delimited-text parser.
 *
 * Written by hand rather than split(',') because question text routinely
 * contains commas, quotation marks and — after OCR of a multi-line stem —
 * embedded newlines inside a quoted field. Any of those silently corrupts a
 * naive split.
 */

export interface DelimitedTable {
  headers: string[];
  rows: Array<Record<string, string>>;
  delimiter: string;
  skippedEmptyRows: number;
}

/** Guess the delimiter from the header line: whichever appears most. */
export function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, 5000).split(/\r?\n/)[0] ?? '';
  const candidates = [',', '\t', ';', '|'];
  let best = ',';
  let bestCount = -1;
  candidates.forEach((candidate) => {
    // Count only outside quotes, approximately — good enough for a header row.
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  });
  return bestCount > 0 ? best : ',';
}

/** Parse delimited text into a grid of raw cell strings. */
export function parseDelimitedGrid(input: string, delimiter: string): string[][] {
  // Strip a UTF-8 BOM, which Excel writes and which otherwise corrupts the
  // first header name.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const grid: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\r') {
      // Swallow CR; the following LF ends the record.
      if (text[i + 1] === '\n') continue;
      row.push(field);
      field = '';
      grid.push(row);
      row = [];
      continue;
    }
    if (char === '\n') {
      row.push(field);
      field = '';
      grid.push(row);
      row = [];
      continue;
    }
    field += char;
  }

  // Trailing record, unless the file ended on a clean newline.
  if (field !== '' || row.length > 0) {
    row.push(field);
    grid.push(row);
  }

  return grid;
}

function normalizeHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((value, index) => {
    const base = value.trim() === '' ? `column_${index + 1}` : value.trim();
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

/** Parse delimited text into header-keyed row objects. */
export function parseDelimited(input: string, delimiter?: string): DelimitedTable {
  const chosen = delimiter ?? detectDelimiter(input);
  const grid = parseDelimitedGrid(input, chosen);
  const headerRow = grid.shift() ?? [];
  const headers = normalizeHeaders(headerRow);

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

  return { headers, rows, delimiter: chosen, skippedEmptyRows };
}
