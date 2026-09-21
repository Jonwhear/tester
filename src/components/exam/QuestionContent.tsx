import type { ContentBlock, Question } from '../../types/question';
import { InlineText } from './richText';

export interface QuestionContentProps {
  question: Question;
  /** Settings -> "Suggested Highlights" (also toggled from the question bar). */
  showHighlights: boolean;
  /** Settings -> developer aid; hidden from the exam interface by default. */
  showReviewNote: boolean;
}

function Block({ block, question, showHighlights }: {
  block: ContentBlock;
  question: Question;
  showHighlights: boolean;
}) {
  switch (block.type) {
    case 'paragraph':
      return (
        <p className={block.emphasis ? 'stem__emphasis' : undefined}>
          <InlineText
            text={block.text}
            format={question.stemFormat ?? 'plain'}
            highlights={showHighlights ? question.suggestedHighlights : undefined}
          />
        </p>
      );

    case 'table': {
      /*
       * Laboratory tables in the source material are label/value lists with no
       * column headings. When every column label is blank the heading row is
       * omitted and the first cell of each row becomes a row header instead —
       * that keeps the table navigable by assistive technology without
       * inventing a heading row the source does not have.
       */
      const hasHeader = block.columns.some((column) => column.trim() !== '');
      return (
        <table className="stem-table">
          {block.caption ? <caption>{block.caption}</caption> : null}
          {hasHeader ? (
            <thead>
              <tr>
                {block.columns.map((column, index) => (
                  <th key={`${column}-${index}`} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) =>
                  !hasHeader && cellIndex === 0 ? (
                    <th key={cellIndex} scope="row" className="stem-table__rowhead">
                      {cell}
                    </th>
                  ) : (
                    <td key={cellIndex}>{cell}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    case 'image':
      return (
        <figure className="stem-figure">
          <img src={block.src} alt={block.alt ?? ''} />
          {block.caption ? <figcaption>{block.caption}</figcaption> : null}
        </figure>
      );

    default:
      return null;
  }
}

/**
 * Renders a question stem.
 *
 * `contentBlocks` wins when present; otherwise the plain `stem` string is split
 * on blank lines into paragraphs. Source text is displayed exactly as received
 * — no rewriting, no repair of placeholders.
 */
export function QuestionContent({ question, showHighlights, showReviewNote }: QuestionContentProps) {
  const blocks: ContentBlock[] =
    question.contentBlocks && question.contentBlocks.length > 0
      ? question.contentBlocks
      : question.stem
            .split(/\n{2,}/)
            .map((text) => ({ type: 'paragraph' as const, text }))
            .filter((block) => block.text.trim() !== '');

  return (
    <div className="stem">
      {blocks.length === 0 ? (
        <p className="note note--warn">This question has no stem text in the source bank.</p>
      ) : (
        blocks.map((block, index) => (
          <Block
            key={index}
            block={block}
            question={question}
            showHighlights={showHighlights}
          />
        ))
      )}

      {question.assets?.map((asset) =>
        asset.kind === 'image' ? (
          <figure className="stem-figure" key={asset.id}>
            <img src={asset.src} alt={asset.alt ?? ''} />
            {asset.caption ? <figcaption>{asset.caption}</figcaption> : null}
          </figure>
        ) : null,
      )}

      {showReviewNote && question.reviewNote ? (
        <p className="review-note">
          <span className="review-note__label">Review note</span>
          {question.reviewNote}
        </p>
      ) : null}
    </div>
  );
}
