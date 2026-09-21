import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';

import { parseDelimited, parseDelimitedGrid, detectDelimiter } from '../../utils/csv';
import { readXlsx, columnIndex, listSheetNames } from '../../utils/xlsx';
import { mapColumns, mapHeader } from '../importers/tabular';

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

describe('delimited parser', () => {
  it('keeps commas inside quoted fields', () => {
    const grid = parseDelimitedGrid('a,"b,c",d', ',');
    expect(grid).toEqual([['a', 'b,c', 'd']]);
  });

  it('handles escaped quotes', () => {
    const grid = parseDelimitedGrid('a,"she said ""no""",c', ',');
    expect(grid[0]?.[1]).toBe('she said "no"');
  });

  it('handles newlines inside a quoted field', () => {
    const grid = parseDelimitedGrid('a,"line one\nline two",c\nx,y,z', ',');
    expect(grid).toHaveLength(2);
    expect(grid[0]?.[1]).toBe('line one\nline two');
    expect(grid[1]).toEqual(['x', 'y', 'z']);
  });

  it('handles CRLF line endings', () => {
    const grid = parseDelimitedGrid('a,b\r\nc,d\r\n', ',');
    expect(grid).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('strips a UTF-8 BOM so the first header is not corrupted', () => {
    const table = parseDelimited('﻿row_type,question_id\nquestion,Q1');
    expect(table.headers).toEqual(['row_type', 'question_id']);
  });

  it('detects tab and comma delimiters', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
  });

  it('skips fully blank rows but keeps rows with any content', () => {
    const table = parseDelimited('a,b\n1,2\n,\n3,4');
    expect(table.rows).toHaveLength(2);
    expect(table.skippedEmptyRows).toBe(1);
  });

  it('disambiguates duplicate headers rather than losing a column', () => {
    const table = parseDelimited('note,note\nx,y');
    expect(table.headers).toEqual(['note', 'note_2']);
    expect(table.rows[0]).toEqual({ note: 'x', note_2: 'y' });
  });
});

/* ------------------------------------------------------------------ */
/* XLSX                                                                */
/* ------------------------------------------------------------------ */

function buildXlsx(
  rows: string[][],
  options: { sheetName?: string; useSharedStrings?: boolean } = {},
): ArrayBuffer {
  const sheetName = options.sheetName ?? 'Sheet1';
  const useShared = options.useSharedStrings ?? true;

  const shared: string[] = [];
  const indexOf = (value: string) => {
    const existing = shared.indexOf(value);
    if (existing !== -1) return existing;
    shared.push(value);
    return shared.length - 1;
  };

  const letter = (i: number) => {
    let n = i + 1;
    let out = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  };

  const sheetRows = rows
    .map((cells, r) => {
      const body = cells
        .map((value, c) => {
          const ref = `${letter(c)}${r + 1}`;
          if (value === '') return '';
          if (useShared) return `<c r="${ref}" t="s"><v>${indexOf(value)}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${body}</row>`;
    })
    .join('');

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<?xml version="1.0"?><worksheet><sheetData>${sheetRows}</sheetData></worksheet>`,
    ),
  };
  if (useShared) {
    files['xl/sharedStrings.xml'] = strToU8(
      `<?xml version="1.0"?><sst>${shared.map((v) => `<si><t>${v}</t></si>`).join('')}</sst>`,
    );
  }

  const zipped = zipSync(files);
  return zipped.buffer.slice(
    zipped.byteOffset,
    zipped.byteOffset + zipped.byteLength,
  ) as ArrayBuffer;
}

describe('xlsx reader', () => {
  it('converts a sheet to header-keyed rows', () => {
    const buffer = buildXlsx([
      ['row_type', 'option_label', 'question_id'],
      ['question', '', '2024-P1-Q001'],
      ['option', 'A', '2024-P1-Q001'],
    ]);
    const sheet = readXlsx(buffer);
    expect(sheet.headers).toEqual(['row_type', 'option_label', 'question_id']);
    expect(sheet.rows).toEqual([
      { row_type: 'question', option_label: '', question_id: '2024-P1-Q001' },
      { row_type: 'option', option_label: 'A', question_id: '2024-P1-Q001' },
    ]);
  });

  it('reads inline strings as well as the shared string table', () => {
    const buffer = buildXlsx(
      [
        ['a', 'b'],
        ['1', '2'],
      ],
      { useSharedStrings: false },
    );
    expect(readXlsx(buffer).rows[0]).toEqual({ a: '1', b: '2' });
  });

  it('keeps columns aligned when Excel omits an empty cell', () => {
    // The middle cell of the data row is absent entirely, as Excel writes it.
    const buffer = buildXlsx([
      ['a', 'b', 'c'],
      ['x', '', 'z'],
    ]);
    expect(readXlsx(buffer).rows[0]).toEqual({ a: 'x', b: '', c: 'z' });
  });

  it('reports sheet names and reads a named sheet', () => {
    const buffer = buildXlsx([['h'], ['v']], { sheetName: 'PRITE 2023' });
    expect(listSheetNames(buffer)).toEqual(['PRITE 2023']);
    expect(readXlsx(buffer, 'PRITE 2023').rows[0]).toEqual({ h: 'v' });
  });

  it('names the available sheets when asked for one that does not exist', () => {
    const buffer = buildXlsx([['h'], ['v']], { sheetName: 'Real' });
    expect(() => readXlsx(buffer, 'Missing')).toThrow(/Available: Real/);
  });

  it('rejects a file that is not a workbook with actionable advice', () => {
    const notAZip = new TextEncoder().encode('just some text').buffer;
    expect(() => readXlsx(notAZip as ArrayBuffer)).toThrow(/export it as CSV/i);
  });

  it('converts spreadsheet column references to indexes', () => {
    expect(columnIndex('A1')).toBe(1);
    expect(columnIndex('Z9')).toBe(26);
    expect(columnIndex('AA1')).toBe(27);
    expect(columnIndex('BC12')).toBe(55);
  });
});

/* ------------------------------------------------------------------ */
/* Column aliasing                                                     */
/* ------------------------------------------------------------------ */

describe('column mapping', () => {
  it('maps spelling variants onto canonical names', () => {
    expect(mapHeader('Question ID')).toBe('question_id');
    expect(mapHeader('question-id')).toBe('question_id');
    expect(mapHeader('  ROW_TYPE ')).toBe('row_type');
    expect(mapHeader('Source Question Number')).toBe('source_question_number');
  });

  it('maps the common answer-key spellings', () => {
    for (const header of ['correct_answer', 'Answer', 'Answer Key', 'Correct', 'key', 'solution']) {
      expect(mapHeader(header)).toBe('correct_answer');
    }
  });

  it('renames row keys and reports unrecognized headers without dropping them', () => {
    const mapped = mapColumns(
      [{ 'Question ID': 'Q1', 'Answer Key': 'B', 'My Notes': 'keep me' }],
      ['Question ID', 'Answer Key', 'My Notes'],
    );
    expect(mapped.rows[0]).toEqual({
      question_id: 'Q1',
      correct_answer: 'B',
      'My Notes': 'keep me',
    });
    expect(mapped.unrecognizedHeaders).toEqual(['My Notes']);
  });
});
