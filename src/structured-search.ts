/**
 * The search tools' `structuredContent`: a lean projection of the parsed
 * search result (#106).
 *
 * The text block is the complete rendering and stays untouched; this module
 * shapes only the structured payload, which is what the widget renders, what
 * claude.ai delivers to it, and what Claude Code shows the model instead of
 * the text whenever a tool returns both (measured 2026-09-04).
 */

import type { Document, SearchResult, StructuredDocument } from './types.js';

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

/**
 * Default character budget for a search tool's serialized `structuredContent`.
 *
 * The binding limit is Claude Code, which measures exactly this serialized
 * payload against `MAX_MCP_OUTPUT_TOKENS` (25 000 tokens by default) and
 * replaces the whole result with a file pointer when it is over. Measured
 * live on 2026-09-08 against production: 58 659 and 59 362 characters
 * (Judikatur pages of 50) were rejected, 46 311 and 41 515 were accepted —
 * so the previous default of 60 000 let pages through that the client then
 * dropped (#106). 45 000 sits below every accepted size with a margin for
 * content that tokenizes worse than court decisions. claude.ai has no
 * observed size limit: its widget rendered 138 050 characters completely,
 * and the model there reads the text block rather than this payload
 * (reporter measurement, 2026-09-04). The widget's 64 000-character
 * snapshot cap (`ui/shared/widget-state.ts`) and the text block's own
 * 25 000-character cap are separate.
 */
export const DEFAULT_STRUCTURED_CONTENT_BUDGET = 45_000;

const BUDGET_ENV = 'RIS_STRUCTURED_CONTENT_BUDGET';

/** Page sizes the RIS API accepts (`DokumenteProSeite`), ascending. */
const PAGE_SIZES = [10, 20, 50, 100] as const;
type PageSize = (typeof PAGE_SIZES)[number];

/**
 * The budget in effect: `RIS_STRUCTURED_CONTENT_BUDGET` when it is a positive
 * integer, else the default. Read per call so a test can stub it.
 */
export function structuredContentBudget(): number {
  const raw = process.env[BUDGET_ENV];
  if (raw === undefined || raw === '') {
    return DEFAULT_STRUCTURED_CONTENT_BUDGET;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_STRUCTURED_CONTENT_BUDGET;
}

/** A search page as it is delivered: text source, structured payload, and what happened. */
export interface StructuredSearchPage {
  /** The page for the text renderer — sliced to the delivered size on a downgrade. */
  result: SearchResult;
  /** The `structuredContent` payload, within budget wherever a smaller page size exists. */
  structured: Record<string, unknown>;
  /** Requested and delivered page size, or null when the page went out as requested. */
  downgrade: { from: number; to: number } | null;
  /** German notice describing the downgrade; also carried as `structured.notice`. */
  notice: string | null;
}

function isPageSize(value: unknown): value is PageSize {
  return typeof value === 'number' && (PAGE_SIZES as readonly number[]).includes(value);
}

function payloadOf(
  result: SearchResult,
  queryEcho: Record<string, unknown>,
  notice: string | null,
): Record<string, unknown> {
  return {
    ...result,
    documents: result.documents.map(toStructuredDocument),
    query: queryEcho,
    ...(notice === null ? {} : { notice }),
  };
}

function downgradeNotice(from: number, to: number, page: number, totalHits: number): string {
  const head = `Seitengröße von ${from} auf ${to} reduziert, damit die Antwort in den Client passt.`;
  if (page * to >= totalHits) {
    return head;
  }
  const first = page * to + 1;
  const last = Math.min((page + 1) * to, totalHits);
  return `${head} Nächste Seite: seite=${page + 1}, limit=${to} (Treffer ${first}–${last}).`;
}

/**
 * Fit a parsed search page into the structured-content budget.
 *
 * A page within budget goes out as it is. One over budget is delivered at the
 * largest smaller RIS page size whose offset arithmetic stays exact — the hit
 * the page starts at, `(seite − 1) · limit`, must be a multiple of the new size,
 * or the next page would skip or repeat hits — with `page`, `page_size`,
 * `has_more`, `documents` and the `query` echo rewritten to that size and a
 * German notice added. Page 1 therefore accepts any smaller size; deeper pages
 * fall back to a divisor, and 10 always is one.
 *
 * This is deliberately not a cut of `documents[]`: clients page with
 * `query.limit`, RIS pages with `DokumenteProSeite`, and a page cut to an
 * arbitrary count would make the next page start past the hits it dropped
 * (#106). The price is the upstream fetch of the hits that are not delivered.
 *
 * Without a usable `limit`/`seite` in the echo there is nothing to re-page
 * with, and the page is projected but not fitted.
 */
export function fitStructuredSearchPage(
  result: SearchResult,
  queryEcho: Record<string, unknown>,
  budget = structuredContentBudget(),
): StructuredSearchPage {
  const untouched: StructuredSearchPage = {
    result,
    structured: payloadOf(result, queryEcho, null),
    downgrade: null,
    notice: null,
  };
  if (JSON.stringify(untouched.structured).length <= budget) {
    return untouched;
  }

  const requested = queryEcho.limit;
  const seite = queryEcho.seite ?? 1;
  if (
    !isPageSize(requested) ||
    typeof seite !== 'number' ||
    !Number.isInteger(seite) ||
    seite < 1
  ) {
    return untouched;
  }

  const offset = (seite - 1) * requested;
  const candidates = PAGE_SIZES.filter((size) => size < requested && offset % size === 0).reverse();

  let smallest: StructuredSearchPage | null = null;
  for (const size of candidates) {
    const page = offset / size + 1;
    const sliced: SearchResult = {
      total_hits: result.total_hits,
      page,
      page_size: size,
      has_more: page * size < result.total_hits,
      documents: result.documents.slice(0, size),
    };
    const notice = downgradeNotice(requested, size, page, result.total_hits);
    const candidate: StructuredSearchPage = {
      result: sliced,
      structured: payloadOf(sliced, { ...queryEcho, limit: size, seite: page }, notice),
      downgrade: { from: requested, to: size },
      notice,
    };
    if (JSON.stringify(candidate.structured).length <= budget) {
      return candidate;
    }
    smallest = candidate;
  }

  return smallest ?? untouched;
}
