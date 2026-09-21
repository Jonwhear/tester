import { Fragment, type ReactNode } from 'react';

import type { SuggestedHighlight } from '../../types/question';

/**
 * Safe inline text rendering.
 *
 * Imported bank content is untrusted, so it is never passed to
 * `dangerouslySetInnerHTML` and no HTML/Markdown parser runs over it. Instead a
 * deliberately tiny inline formatter produces React elements directly:
 *
 *     **bold**   *italic*   `code`
 *
 * Anything else — including raw HTML in the source — is rendered as literal
 * text. This is a conscious trade against a full Markdown pipeline: it removes
 * the sanitizer from the trust path entirely. Extending it means adding cases
 * here, not enabling raw HTML.
 */

type Segment = { text: string; bold?: boolean; italic?: boolean; code?: boolean };

const INLINE_PATTERN = /(\*\*[^*]+\*\*|(?<!\*)\*[^*]+\*(?!\*)|`[^`]+`)/g;

export function parseInline(text: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) segments.push({ text: text.slice(lastIndex, index) });
    const token = match[0];
    if (token.startsWith('**')) segments.push({ text: token.slice(2, -2), bold: true });
    else if (token.startsWith('`')) segments.push({ text: token.slice(1, -1), code: true });
    else segments.push({ text: token.slice(1, -1), italic: true });
    lastIndex = index + token.length;
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex) });
  return segments.length > 0 ? segments : [{ text }];
}

function wrap(segment: Segment, key: number): ReactNode {
  let node: ReactNode = segment.text;
  if (segment.code) node = <code key={key}>{node}</code>;
  if (segment.italic) node = <em key={key}>{node}</em>;
  if (segment.bold) node = <strong key={key}>{node}</strong>;
  return <Fragment key={key}>{node}</Fragment>;
}

/**
 * Apply data-supplied highlights by splitting on literal substrings.
 * Highlights come from the bank; the application never generates them.
 */
function applyHighlights(text: string, highlights: SuggestedHighlight[]): ReactNode[] {
  const terms = highlights
    .map((h) => h.text)
    .filter((t) => t.length > 0)
    .sort((a, b) => b.length - a.length);
  if (terms.length === 0) return [text];

  const noteFor = new Map(highlights.map((h) => [h.text, h.note]));
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  while (cursor < text.length) {
    let bestIndex = -1;
    let bestTerm = '';
    for (const term of terms) {
      const index = text.indexOf(term, cursor);
      if (index !== -1 && (bestIndex === -1 || index < bestIndex)) {
        bestIndex = index;
        bestTerm = term;
      }
    }
    if (bestIndex === -1) {
      nodes.push(text.slice(cursor));
      break;
    }
    if (bestIndex > cursor) nodes.push(text.slice(cursor, bestIndex));
    nodes.push(
      <mark key={`hl-${key++}`} title={noteFor.get(bestTerm) || undefined}>
        {bestTerm}
      </mark>,
    );
    cursor = bestIndex + bestTerm.length;
  }
  return nodes;
}

export interface InlineTextProps {
  text: string;
  format?: 'plain' | 'markdown';
  highlights?: SuggestedHighlight[];
}

export function InlineText({ text, format = 'plain', highlights }: InlineTextProps) {
  if (highlights && highlights.length > 0) {
    // Highlighting works on literal source text, so inline formatting is not
    // applied at the same time — mixing the two would need offset mapping that
    // the current data does not justify.
    return <>{applyHighlights(text, highlights)}</>;
  }
  if (format !== 'markdown') return <>{text}</>;
  return <>{parseInline(text).map(wrap)}</>;
}
