import { useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ImagePlus, Plus, Table2, Trash2, Type } from 'lucide-react';

import type { ContentBlock } from '../../types/question';
import { formatBytes, prepareImage, ImageError, dataUrlBytes } from '../../utils/image';

export interface ContentBlocksEditorProps {
  blocks: ContentBlock[];
  onChange: (blocks: ContentBlock[]) => void;
  /** Called when a block operation fails, e.g. an unreadable image. */
  onError: (message: string) => void;
}

const BLOCK_LABEL: Record<ContentBlock['type'], string> = {
  paragraph: 'Paragraph',
  table: 'Table',
  image: 'Image',
};

/**
 * Structured stem editor.
 *
 * Content blocks are what let a question carry a lab table or a figure
 * alongside its prose. Images are embedded as data URLs (see utils/image) so a
 * bank stays a single portable file.
 */
export function ContentBlocksEditor({ blocks, onChange, onError }: ContentBlocksEditorProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [insertAt, setInsertAt] = useState<number | null>(null);

  const replace = (index: number, block: ContentBlock) =>
    onChange(blocks.map((entry, i) => (i === index ? block : entry)));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    onChange(next);
  };

  const remove = (index: number) => onChange(blocks.filter((_, i) => i !== index));

  const insert = (block: ContentBlock, at: number | null) => {
    const next = [...blocks];
    next.splice(at ?? next.length, 0, block);
    onChange(next);
  };

  const handleImageFile = async (file: File) => {
    setBusy(true);
    try {
      const prepared = await prepareImage(file);
      insert(
        {
          type: 'image',
          src: prepared.dataUrl,
          alt: '',
          caption: '',
        },
        insertAt,
      );
    } catch (error) {
      onError(
        error instanceof ImageError ? error.message : `Could not read "${file.name}" as an image.`,
      );
    } finally {
      setBusy(false);
      setInsertAt(null);
    }
  };

  return (
    <div>
      {blocks.length === 0 ? (
        <p className="note" style={{ marginBottom: 8 }}>
          No content blocks. Add a paragraph, table or image below.
        </p>
      ) : null}

      {blocks.map((block, index) => (
        <div className="block" key={index}>
          <div className="block__head">
            <span className="block__type">{BLOCK_LABEL[block.type]}</span>
            <div className="opt-row__actions">
              <button
                type="button"
                className="icon-btn"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                title="Move block up"
              >
                <ChevronUp size={14} aria-hidden="true" />
                <span className="sr-only">Move block up</span>
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => move(index, 1)}
                disabled={index === blocks.length - 1}
                title="Move block down"
              >
                <ChevronDown size={14} aria-hidden="true" />
                <span className="sr-only">Move block down</span>
              </button>
              <button
                type="button"
                className="icon-btn icon-btn--danger"
                onClick={() => remove(index)}
                title="Delete block"
              >
                <Trash2 size={14} aria-hidden="true" />
                <span className="sr-only">Delete block</span>
              </button>
            </div>
          </div>

          {block.type === 'paragraph' ? (
            <>
              <label className="sr-only" htmlFor={`block-${index}-text`}>
                Paragraph text
              </label>
              <textarea
                id={`block-${index}-text`}
                className="editor-text"
                value={block.text}
                onChange={(event) => replace(index, { ...block, text: event.target.value })}
              />
            </>
          ) : null}

          {block.type === 'image' ? (
            <>
              <img className="block__preview" src={block.src} alt={block.alt ?? ''} />
              <p className="block__meta">Embedded in the bank file · {formatBytes(dataUrlBytes(block.src))}</p>
              <div className="editor-meta">
                <div className="editor-field">
                  <label className="editor-field__label" htmlFor={`block-${index}-alt`}>
                    Alt text (for screen readers)
                  </label>
                  <input
                    id={`block-${index}-alt`}
                    className="editor-input"
                    value={block.alt ?? ''}
                    onChange={(event) => replace(index, { ...block, alt: event.target.value })}
                  />
                </div>
                <div className="editor-field">
                  <label className="editor-field__label" htmlFor={`block-${index}-caption`}>
                    Caption (shown under the image)
                  </label>
                  <input
                    id={`block-${index}-caption`}
                    className="editor-input"
                    value={block.caption ?? ''}
                    onChange={(event) => replace(index, { ...block, caption: event.target.value })}
                  />
                </div>
              </div>
            </>
          ) : null}

          {block.type === 'table' ? (
            <TableBlockEditor block={block} onChange={(next) => replace(index, next)} />
          ) : null}
        </div>
      ))}

      <div className="opt-row__actions" style={{ paddingTop: 4 }}>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => insert({ type: 'paragraph', text: '' }, null)}
        >
          <Type size={13} aria-hidden="true" /> Paragraph
        </button>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() =>
            insert({ type: 'table', columns: ['', ''], rows: [['', '']] }, null)
          }
        >
          <Table2 size={13} aria-hidden="true" /> Table
        </button>
        <button
          type="button"
          className="btn btn--sm"
          disabled={busy}
          onClick={() => {
            setInsertAt(null);
            fileRef.current?.click();
          }}
        >
          <ImagePlus size={13} aria-hidden="true" /> {busy ? 'Reading…' : 'Image'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleImageFile(file);
            event.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

function TableBlockEditor({
  block,
  onChange,
}: {
  block: Extract<ContentBlock, { type: 'table' }>;
  onChange: (block: ContentBlock) => void;
}) {
  const columnCount = Math.max(block.columns.length, 1);
  const template = `repeat(${columnCount}, minmax(90px, 1fr)) 26px`;

  const setCell = (rowIndex: number, columnIndex: number, value: string) => {
    const rows = block.rows.map((row, r) =>
      r === rowIndex ? row.map((cell, c) => (c === columnIndex ? value : cell)) : row,
    );
    onChange({ ...block, rows });
  };

  const setColumn = (columnIndex: number, value: string) => {
    const columns = block.columns.map((column, c) => (c === columnIndex ? value : column));
    onChange({ ...block, columns });
  };

  const addRow = () => onChange({ ...block, rows: [...block.rows, block.columns.map(() => '')] });
  const removeRow = (rowIndex: number) =>
    onChange({ ...block, rows: block.rows.filter((_, r) => r !== rowIndex) });

  const addColumn = () =>
    onChange({
      ...block,
      columns: [...block.columns, ''],
      rows: block.rows.map((row) => [...row, '']),
    });
  const removeColumn = () => {
    if (block.columns.length <= 1) return;
    onChange({
      ...block,
      columns: block.columns.slice(0, -1),
      rows: block.rows.map((row) => row.slice(0, -1)),
    });
  };

  return (
    <div>
      <p className="block__meta">
        Leave every column heading blank for a plain label/value lab table with no heading row.
      </p>
      <div className="table-grid">
        <div className="table-grid__row" style={{ gridTemplateColumns: template }}>
          {block.columns.map((column, c) => (
            <input
              key={`col-${c}`}
              className="editor-input"
              value={column}
              placeholder={`Heading ${c + 1}`}
              aria-label={`Column ${c + 1} heading`}
              onChange={(event) => setColumn(c, event.target.value)}
            />
          ))}
          <span />
        </div>

        {block.rows.map((row, r) => (
          <div className="table-grid__row" key={`row-${r}`} style={{ gridTemplateColumns: template }}>
            {block.columns.map((_, c) => (
              <input
                key={`cell-${r}-${c}`}
                className="editor-input"
                value={row[c] ?? ''}
                aria-label={`Row ${r + 1}, column ${c + 1}`}
                onChange={(event) => setCell(r, c, event.target.value)}
              />
            ))}
            <button
              type="button"
              className="icon-btn icon-btn--danger"
              onClick={() => removeRow(r)}
              title={`Delete row ${r + 1}`}
            >
              <Trash2 size={13} aria-hidden="true" />
              <span className="sr-only">Delete row {r + 1}</span>
            </button>
          </div>
        ))}
      </div>

      <div className="opt-row__actions" style={{ paddingTop: 6 }}>
        <button type="button" className="btn btn--sm" onClick={addRow}>
          <Plus size={12} aria-hidden="true" /> Row
        </button>
        <button type="button" className="btn btn--sm" onClick={addColumn}>
          <Plus size={12} aria-hidden="true" /> Column
        </button>
        <button
          type="button"
          className="btn btn--sm"
          onClick={removeColumn}
          disabled={block.columns.length <= 1}
        >
          Remove column
        </button>
      </div>
    </div>
  );
}
