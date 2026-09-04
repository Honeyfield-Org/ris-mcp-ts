/**
 * The search tools' `structuredContent`: a lean projection of the parsed
 * search result (#106).
 *
 * The text block is the complete rendering and stays untouched; this module
 * shapes only the structured payload, which is what the widget renders, what
 * claude.ai delivers to it, and what Claude Code shows the model instead of
 * the text whenever a tool returns both (measured 2026-09-04).
 */

import type { Document, StructuredDocument } from './types.js';

/**
 * Project a parsed document to the shape declared in `StructuredDocumentSchema`.
 *
 * Drops the three fields that repeat `titel` (`kurztitel`, `citation.kurztitel`)
 * and the two renditions nobody reads (`content_urls.xml`/`rtf`). The rest is
 * copied as is — including the court fields of a decision, whose *presence*
 * is what tells the widget a decision from a law, so a `null` there must
 * survive the projection.
 */
export function toStructuredDocument(doc: Document): StructuredDocument {
  const { kurztitel: _kurztitel, citation, content_urls, ...rest } = doc;
  const { kurztitel: _citationKurztitel, ...citationRest } = citation;

  return {
    ...rest,
    citation: citationRest,
    content_urls: { html: content_urls.html, pdf: content_urls.pdf },
  };
}
