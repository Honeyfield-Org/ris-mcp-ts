/**
 * Formatting utilities for RIS MCP Server responses.
 *
 * This module provides functions to format RIS API responses for optimal
 * LLM consumption, including proper Austrian legal citations, search results
 * formatting, and document content preparation.
 */

import * as cheerio from 'cheerio';

import type { Document, SearchResult } from './types.js';

// =============================================================================
// Constants
// =============================================================================

/** Hard limit for a single text response, in characters. */
export const CHARACTER_LIMIT = 25000;

/**
 * All RIS Judikatur applikationen (court systems). Documents from these are
 * formatted as court citations rather than law citations. Includes the courts
 * dissolved in 2014 (Verg/Uvs/Ubas/Umse/Bks) whose stock is still searchable.
 * Verified against the RIS API v2.6 Judikatur court list.
 */
const JUDIKATUR_APPLIKATIONEN = new Set([
  'Justiz',
  'Vfgh',
  'Vwgh',
  'Bvwg',
  'Lvwg',
  'Dsk',
  'Gbk',
  'Pvak',
  'Dok',
  'AsylGH',
  'Normenliste',
  'Verg',
  'Uvs',
  'Ubas',
  'Umse',
  'Bks',
]);

// =============================================================================
// Date Formatting
// =============================================================================

/**
 * Convert API date format to readable German format.
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) {
    return '';
  }

  try {
    // Handle ISO format (YYYY-MM-DD)
    const datePart = dateStr.slice(0, 10);
    const parts = datePart.split('-');
    if (parts.length === 3) {
      const [year, month, day] = parts;
      return `${day}.${month}.${year}`;
    }
    return dateStr;
  } catch {
    return dateStr;
  }
}

// =============================================================================
// HTML Processing
// =============================================================================

/**
 * Block-level elements, whose boundaries have to survive into the text output.
 * cheerio's `.text()` concatenates text nodes without any separator, so RIS
 * markup like `<h1>Kurztitel</h1><p>Allgemeines...</p>` would otherwise come out
 * as "KurztitelAllgemeines...".
 *
 * `td`/`th` and `br` are deliberately absent: they are separated by the cell and
 * line-break rules in `htmlToText()` instead, which keep a table row on one line
 * rather than exploding it into one paragraph per cell. Dropping them here
 * without those rules would bring back the gluing of issue #64.
 */
const BLOCK_LEVEL_ELEMENTS =
  'address, article, aside, blockquote, dd, div, dl, dt, fieldset, figcaption, figure, ' +
  'footer, form, h1, h2, h3, h4, h5, h6, header, hr, li, main, nav, ol, p, pre, section, ' +
  'table, tbody, tfoot, thead, tr, ul';

/** Table cells, which separate columns of a row rather than paragraphs. */
const TABLE_CELLS = 'td, th';

/**
 * Convert HTML to clean readable text using cheerio.
 */
export function htmlToText(htmlContent: string): string {
  if (!htmlContent) {
    return '';
  }

  const $ = cheerio.load(htmlContent);

  // Remove script, style, and head elements
  $('script, style, head').remove();

  // RIS renders every structural marker twice: a visible form carrying
  // aria-hidden="true" and a redundant spoken form in .sr-only, e.g.
  // `<span aria-hidden="true">(1)</span><span class="sr-only">Absatz eins,</span>`.
  // Both end up in .text(), so each marker is duplicated in the text handed to
  // the model. The pair is redundant by construction, so dropping the spoken
  // half loses no information.
  $('.sr-only').remove();

  // A `<br>` breaks the line inside its block, it does not open a new one.
  $('br').replaceWith('\n');

  // RIS sets the Absatz number as an inline span directly against its text
  // (`<span class="Absatzzahl">(1)</span><span>Jedermann ...</span>`), which
  // reads as "(1)Jedermann". The class always wraps the complete marker token,
  // so a trailing space cannot split a word.
  $('.Absatzzahl').after(' ');

  // A table cell is a column boundary, not a paragraph boundary: cells are
  // joined by spaces and `tr` (a block element above) carries the line break for
  // the row. RIS wraps the content of a cell in a block of its own —
  // `<td><p class="InhaltEintrag">152,60</p></td>` — so those nested blocks have
  // to yield a space as well, or the row falls apart into one paragraph per cell.
  const blocks = $(BLOCK_LEVEL_ELEMENTS);
  const cellBlocks = blocks.filter((_, element) => $(element).closest(TABLE_CELLS).length > 0);

  cellBlocks.before(' ').after(' ');
  blocks.not(cellBlocks).before('\n').after('\n');
  $(TABLE_CELLS).after(' ');

  // RIS pretty-prints its table markup, so the source itself carries newlines
  // between and inside the cells (`</td>\n<td>\n<p>...`). Those would survive
  // into the output and tear the row apart again, so line breaks inside a row
  // fold into a space; the runs of spaces this leaves are collapsed by the
  // general whitespace pass below. The line break for the row comes from the
  // `tr` boundary, which sits outside the row and is untouched by this. The
  // character class names the line breaks rather than using `\s`, which would
  // also fold the non-breaking spaces RIS holds citations together with — those
  // survive here as everywhere else in the output.
  $('tr')
    .find('*')
    .addBack()
    .contents()
    .each((_, node) => {
      if (node.type === 'text') {
        node.data = node.data.replace(/[\r\n]+/g, ' ');
      }
    });

  // Process the body or entire document
  let text = $('body').length > 0 ? $('body').text() : $.text();

  // Clean up whitespace. Lines are trimmed first: the inserted boundaries leave
  // whitespace-only lines behind, which would otherwise survive the newline
  // collapse below.
  text = text
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/[ \t]+/g, ' ') // Normalize multiple spaces
    .replace(/\n{3,}/g, '\n\n') // Normalize multiple newlines
    .trim();

  return text;
}

// =============================================================================
// Citation Formatting
// =============================================================================

/**
 * Document data for citation formatting.
 */
interface CitationData {
  applikation?: string;
  titel?: string;
  kurztitel?: string | null;
  dokumentnummer?: string;
  citation?: {
    kurztitel?: string | null;
    langtitel?: string | null;
    kundmachungsorgan?: string | null;
    paragraph?: string | null;
    inkrafttreten?: string | null;
  };
}

/**
 * Format a proper Austrian legal citation.
 */
export function formatCitation(doc: Document | CitationData): string {
  const data = doc as CitationData;
  const applikation = data.applikation ?? '';
  const citationData = data.citation ?? {};
  const titel = data.titel ?? '';
  const kurztitel = data.kurztitel ?? citationData.kurztitel ?? '';

  // Handle court decisions (Judikatur)
  if (JUDIKATUR_APPLIKATIONEN.has(applikation)) {
    return formatCourtCitation(data, applikation, titel);
  }

  // Handle federal law (Bundesrecht)
  return formatLawCitation(data, kurztitel, citationData);
}

/**
 * Format citation for court decisions.
 */
function formatCourtCitation(data: CitationData, applikation: string, titel: string): string {
  const courtPrefixes: Record<string, string> = {
    Justiz: '', // extracted from title (OGH/OLG/LG/BG)
    Vfgh: 'VfGH',
    Vwgh: 'VwGH',
    Bvwg: 'BVwG',
    Lvwg: 'LVwG',
    Dsk: 'DSK',
    Gbk: 'GBK',
    AsylGH: 'AsylGH',
    Uvs: 'UVS',
    Ubas: 'UBAS',
    Bks: 'BKS',
    // Pvak, Dok, Verg, Umse, Normenliste have no widely-used short form; they
    // fall back to the case number / Geschaeftszahl below.
  };

  const dokumentnummer = data.dokumentnummer ?? '';

  // For ordinary courts
  if (applikation === 'Justiz') {
    // Title often contains "OGH 5 Ob 123/23t" or similar
    const match = titel.match(/(OGH|OLG|LG|BG)\s*[,:]?\s*(\d+\s*\w+\s*\d+\/\d+\w?)/i);
    if (match) {
      return `${match[1]} ${match[2]}`;
    }

    // Try to extract from dokumentnummer
    const dokMatch = dokumentnummer.match(/(OGH|OLG|LG|BG)\d+/i);
    if (dokMatch) {
      const court = dokMatch[1].toUpperCase();
      const caseMatch = dokumentnummer.match(/_(\d+\w+)_(\d+)([A-Z])\d+_/);
      if (caseMatch) {
        return `${court} ${caseMatch[1]}/${caseMatch[2]}${caseMatch[3].toLowerCase()}`;
      }
    }
  }

  // For VfGH, VwGH etc.
  const prefix = courtPrefixes[applikation] ?? '';
  if (prefix) {
    const dateMatch = titel.match(/(\d{1,2}\.\d{1,2}\.\d{4})/);
    const caseMatch = titel.match(/([EGUBVW]\s*\d+\/\d+)/i);

    if (dateMatch && caseMatch) {
      return `${prefix} ${dateMatch[1]}, ${caseMatch[1]}`;
    }
    if (caseMatch) {
      return `${prefix} ${caseMatch[1]}`;
    }
  }

  // Fallback
  if (titel.length <= 60) {
    return titel;
  }
  return dokumentnummer;
}

/**
 * Format citation for laws and regulations.
 */
function formatLawCitation(
  data: CitationData,
  kurztitel: string | null | undefined,
  citationData: CitationData['citation'],
): string {
  const paragraph = citationData?.paragraph ?? '';
  const kundmachungsorgan = citationData?.kundmachungsorgan ?? '';

  const parts: string[] = [];

  if (paragraph) {
    parts.push(paragraph);
  }

  if (kurztitel) {
    parts.push(kurztitel);
  }

  if (kundmachungsorgan && kundmachungsorgan.length < 30) {
    parts.push(`(${kundmachungsorgan})`);
  }

  if (parts.length > 0) {
    return parts.join(' ');
  }

  return data.titel ?? data.dokumentnummer ?? '';
}

// =============================================================================
// Search Results Formatting
// =============================================================================

/**
 * Document to dictionary representation.
 *
 * Deliberately a whitelist, not a spread: this feeds the rendered text output,
 * whose bytes are part of the tool contract. Fields added for structured
 * consumers (citation_display, the Judikatur court fields) reach clients through
 * `structuredContent` and are left out here — citation_display in particular is
 * already the markdown heading below.
 */
function documentToDict(doc: Document): Record<string, unknown> {
  return {
    dokumentnummer: doc.dokumentnummer,
    applikation: doc.applikation,
    titel: doc.titel,
    kurztitel: doc.kurztitel,
    citation: doc.citation,
    content_urls: doc.content_urls,
    dokument_url: doc.dokument_url,
    gesamte_rechtsvorschrift_url: doc.gesamte_rechtsvorschrift_url,
  };
}

/**
 * Format search results for display.
 */
export function formatSearchResults(
  results: SearchResult | Record<string, unknown>,
  format: 'markdown' | 'json' = 'markdown',
): string {
  let data: Record<string, unknown>;

  if ('documents' in results && Array.isArray(results.documents)) {
    // It's a SearchResult
    const sr = results as SearchResult;
    data = {
      total_hits: sr.total_hits,
      page: sr.page,
      page_size: sr.page_size,
      has_more: sr.has_more,
      documents: sr.documents.map(documentToDict),
    };
  } else {
    data = results as Record<string, unknown>;
  }

  if (format === 'json') {
    return JSON.stringify(data, null, 2);
  }

  return formatSearchResultsMarkdown(data);
}

/**
 * Format search results as markdown.
 */
function formatSearchResultsMarkdown(data: Record<string, unknown>): string {
  const totalHits = (data.total_hits as number) ?? 0;
  const page = (data.page as number) ?? 1;
  const pageSize = (data.page_size as number) ?? 20;
  const hasMore = (data.has_more as boolean) ?? false;
  const documents = (data.documents as Record<string, unknown>[]) ?? [];

  const totalPages = pageSize > 0 ? Math.ceil(totalHits / pageSize) : 1;

  const lines: string[] = [];

  // Summary line
  lines.push(`**Gefunden: ${totalHits} Treffer** (Seite ${page} von ${totalPages})`);
  lines.push('');

  if (documents.length === 0) {
    lines.push('_Keine Dokumente gefunden._');
    return lines.join('\n');
  }

  // Format each document
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    const citation = formatCitation(doc as CitationData);
    lines.push(`### ${i + 1}. ${citation}`);

    // Title (if different from citation)
    const titel = (doc.titel as string) ?? '';
    if (titel && titel !== citation) {
      lines.push(`**${titel}**`);
    }

    // Metadata
    const citationData = (doc.citation as Record<string, unknown>) ?? {};
    const metadataParts: string[] = [];

    // Long title
    const langtitel = citationData.langtitel as string | undefined;
    if (langtitel) {
      metadataParts.push(`_${langtitel}_`);
    }

    // Inkrafttreten
    const inkrafttreten = citationData.inkrafttreten as string | undefined;
    if (inkrafttreten) {
      metadataParts.push(`In Kraft seit: ${formatDate(inkrafttreten)}`);
    }

    // Ausserkrafttreten
    const ausserkrafttreten = citationData.ausserkrafttreten as string | undefined;
    if (ausserkrafttreten && ausserkrafttreten !== '9999-12-31') {
      metadataParts.push(`Außer Kraft: ${formatDate(ausserkrafttreten)}`);
    }

    // Kundmachungsorgan
    const kundmachungsorgan = citationData.kundmachungsorgan as string | undefined;
    if (kundmachungsorgan) {
      metadataParts.push(`Fundstelle: ${kundmachungsorgan}`);
    }

    if (metadataParts.length > 0) {
      lines.push(metadataParts.join('  \n'));
    }

    // Document number for retrieval
    const dokumentnummer = (doc.dokumentnummer as string) ?? '';
    if (dokumentnummer) {
      lines.push(`\`Dokumentnummer: ${dokumentnummer}\``);
    }

    lines.push('');
  }

  // Pagination hint
  if (hasMore) {
    lines.push('---');
    lines.push(
      `_Weitere Treffer verfügbar. Verwende \`seite: ${page + 1}\` für die nächste Seite._`,
    );
  }

  return lines.join('\n');
}

// =============================================================================
// Document Formatting
// =============================================================================

/**
 * Metadata for document formatting.
 */
export interface DocumentMetadata {
  dokumentnummer?: string;
  applikation?: string;
  titel?: string;
  kurztitel?: string | null;
  citation?: {
    kurztitel?: string | null;
    langtitel?: string | null;
    kundmachungsorgan?: string | null;
    paragraph?: string | null;
    eli?: string | null;
    inkrafttreten?: string | null;
    ausserkrafttreten?: string | null;
  };
  dokument_url?: string | null;
  gesamte_rechtsvorschrift_url?: string | null;
}

/**
 * Format a full document for LLM context.
 */
export function formatDocument(
  content: string,
  metadata: DocumentMetadata,
  format: 'markdown' | 'json' = 'markdown',
): string {
  if (format === 'json') {
    return JSON.stringify(
      {
        metadata,
        content: htmlToText(content),
      },
      null,
      2,
    );
  }

  return formatDocumentMarkdown(content, metadata);
}

/**
 * Format document as markdown.
 */
function formatDocumentMarkdown(content: string, metadata: DocumentMetadata): string {
  const lines: string[] = [];

  // Citation header
  const citation = formatCitation(metadata as CitationData);
  lines.push(`# ${citation}`);
  lines.push('');

  // Metadata block
  lines.push('## Dokumentinformation');
  lines.push('');

  const citationData = metadata.citation ?? {};

  // Full title
  const langtitel = citationData.langtitel ?? metadata.titel ?? '';
  if (langtitel) {
    lines.push(`**Titel:** ${langtitel}`);
  }

  // Paragraph
  const paragraph = citationData.paragraph;
  if (paragraph) {
    lines.push(`**Paragraph:** ${paragraph}`);
  }

  // Kundmachungsorgan
  const kundmachungsorgan = citationData.kundmachungsorgan;
  if (kundmachungsorgan) {
    lines.push(`**Kundmachungsorgan:** ${kundmachungsorgan}`);
  }

  // Dates
  const inkrafttreten = citationData.inkrafttreten;
  if (inkrafttreten) {
    lines.push(`**In Kraft seit:** ${formatDate(inkrafttreten)}`);
  }

  const ausserkrafttreten = citationData.ausserkrafttreten;
  if (ausserkrafttreten && ausserkrafttreten !== '9999-12-31') {
    lines.push(`**Außer Kraft:** ${formatDate(ausserkrafttreten)}`);
  }

  // ELI
  const eli = citationData.eli;
  if (eli) {
    lines.push(`**ELI:** ${eli}`);
  }

  // Document number
  const dokumentnummer = metadata.dokumentnummer ?? '';
  if (dokumentnummer) {
    lines.push(`**Dokumentnummer:** \`${dokumentnummer}\``);
  }

  // URLs
  const dokumentUrl = metadata.dokument_url;
  if (dokumentUrl) {
    lines.push(`**Quelle:** [${dokumentUrl}](${dokumentUrl})`);
  }

  const gesamteUrl = metadata.gesamte_rechtsvorschrift_url;
  if (gesamteUrl) {
    lines.push(`**Gesamte Rechtsvorschrift:** [${gesamteUrl}](${gesamteUrl})`);
  }

  lines.push('');

  // Content
  lines.push('## Inhalt');
  lines.push('');

  const cleanContent = htmlToText(content);
  lines.push(cleanContent);

  return lines.join('\n');
}

// =============================================================================
// Document Outline
// =============================================================================

/** One jump target in a document, as offered by the viewer's outline. */
export interface OutlineEntry {
  /**
   * Heading level 1–6, taken from the RIS source markup. Level 1 is the RIS
   * record layer (field labels plus, in gazettes, the masthead); levels 2 and
   * below are structure inside the document text.
   */
  level: number;
  /** Heading text, whitespace-normalised exactly as the document text is. */
  label: string;
  /** Character offset of the heading's line in the document text. */
  offset: number;
  /**
   * Characters up to the next heading, or to the end of the text for the last
   * entry. The only reliable way to tell a one-line metadata field from a real
   * section: RIS gives both the same element and the same class.
   */
  span: number;
}

/** A heading as read from the markup, before it is located in the text. */
interface SourceHeading {
  level: number;
  /** Display text: every line of the heading, joined by spaces. */
  label: string;
  /** Search key: the heading's first line, which is a line of its own in the text. */
  key: string;
}

/**
 * Normalise a heading segment to the whitespace contract of {@link htmlToText}.
 *
 * Only spaces and tabs collapse — U+00A0 survives, because it does in the text
 * as well: RIS writes `§&#160;1295.`, and folding it here would make the label
 * `§ 1295.` and stop it matching its own line forever.
 */
function normaliseHeadingSegment(segment: string): string {
  return segment.replace(/[ \t]+/g, ' ').trim();
}

/**
 * Read the `h1`–`h6` elements of a RIS document in document order.
 *
 * The three preparation steps are the ones {@link htmlToText} performs, and all
 * three are load-bearing: without `.sr-only` removal a heading reads as its
 * visible and its spoken form glued together, and without `br` → `\n` the two
 * lines of the gazette masthead come out as one word.
 */
function readSourceHeadings(html: string): SourceHeading[] {
  const $ = cheerio.load(html);

  $('script, style, head').remove();
  $('.sr-only').remove();
  $('br').replaceWith('\n');

  const headings: SourceHeading[] = [];

  $('h1, h2, h3, h4, h5, h6').each((_, element) => {
    const segments = $(element)
      .text()
      .split('\n')
      .map(normaliseHeadingSegment)
      .filter((segment) => segment.length > 0);

    if (segments.length === 0) {
      return;
    }

    headings.push({
      level: Number(element.tagName.slice(1)),
      label: segments.join(' '),
      key: segments[0],
    });
  });

  return headings;
}

/** Offsets of every line of `text`, keyed by the line's trimmed content. */
function indexLines(text: string): Map<string, number[]> {
  const index = new Map<string, number[]>();
  let offset = 0;

  for (const line of text.split('\n')) {
    const key = line.trim();
    const offsets = index.get(key);
    if (offsets) {
      offsets.push(offset);
    } else {
      index.set(key, [offset]);
    }
    offset += line.length + 1; // the '\n' that split() consumed
  }

  return index;
}

/**
 * Extract the jump targets of a document.
 *
 * `html` is the RIS source, `text` the markdown rendering it produced. The
 * headings are read from the markup — the rendered text carries no structure
 * beyond the three headings formatDocument() writes itself — and then located in
 * `text` by their own line.
 *
 * A document without headings yields `[]`. That is a valid outline, not an
 * error: the viewer stays navigable through plain offset paging.
 */
export function extractOutline(html: string, text: string): OutlineEntry[] {
  if (!html || !text) {
    return [];
  }

  const headings = readSourceHeadings(html);
  if (headings.length === 0) {
    return [];
  }

  const lines = indexLines(text);
  const entries: OutlineEntry[] = [];

  // Headings appear in the text in the order they appear in the markup, so each
  // one is looked up behind its predecessor — that is what tells two occurrences
  // of the same wording apart. A heading that cannot be located is dropped
  // *without* moving the cursor: otherwise one miss would swallow every
  // following entry.
  let cursor = -1;
  for (const heading of headings) {
    const offset = lines.get(heading.key)?.find((candidate) => candidate > cursor);
    if (offset === undefined) {
      continue;
    }
    cursor = offset;
    entries.push({ level: heading.level, label: heading.label, offset, span: 0 });
  }

  for (let i = 0; i < entries.length; i++) {
    const end = i + 1 < entries.length ? entries[i + 1].offset : text.length;
    entries[i].span = end - entries[i].offset;
  }

  return entries;
}

// =============================================================================
// Response Truncation and Chunking
// =============================================================================

/**
 * Index to cut `slice` at, so the cut lands on a paragraph or sentence boundary.
 *
 * Returns `slice.length` when neither boundary sits late enough to be worth
 * keeping — the caller then cuts hard. `budget` is the space the caller had
 * available, which is what the two thresholds are measured against; it differs
 * from `slice.length` for callers that reserve part of their budget.
 */
function boundaryCut(slice: string, budget: number): number {
  const lastPara = slice.lastIndexOf('\n\n');
  if (lastPara > budget * 0.7) {
    return lastPara;
  }

  const lastSentence = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('.\n'),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('! '),
  );
  if (lastSentence > budget * 0.8) {
    return lastSentence + 1;
  }

  return slice.length;
}

/** True for a lone high surrogate, which would render as U+FFFD on its own. */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** One slice of a document text, addressed by character offset. */
export interface ResponseChunk {
  /** The slice starting at the requested offset, at most `limit` characters. */
  text: string;
  /** Length of the complete text this chunk was cut from. */
  total_length: number;
  /** Offset for the following chunk, or null when this chunk ends the text. */
  next_offset: number | null;
}

/**
 * Cut one chunk out of `text`, starting at `offset`.
 *
 * Chunk boundaries follow the same paragraph-then-sentence rule as
 * {@link truncateResponse}; unlike that function nothing is appended and nothing
 * is dropped — consecutive chunks concatenate back to `text`.
 *
 * Offsets are character offsets into the complete text, i.e. the unit of
 * `String.length` and `String.slice`. They stay valid as long as the same text
 * does, which is why every chunk carries `total_length`: a caller whose text was
 * re-fetched in between sees the length change and restarts at offset 0.
 */
export function chunkResponse(text: string, offset = 0, limit = CHARACTER_LIMIT): ResponseChunk {
  const totalLength = text.length;

  // Defense in depth — the tool's schema already enforces a non-negative
  // integer, so anything else is a programming error and reading from the start
  // is the answer that cannot lose text.
  const start = Number.isInteger(offset) && offset > 0 ? offset : 0;

  if (start >= totalLength) {
    // Reading past the end is the natural end of a paging loop, not an error.
    return { text: '', total_length: totalLength, next_offset: null };
  }

  if (totalLength - start <= limit) {
    return { text: text.slice(start), total_length: totalLength, next_offset: null };
  }

  const slice = text.slice(start, start + limit);
  let cut = boundaryCut(slice, limit);

  if (cut > 1 && isHighSurrogate(slice.charCodeAt(cut - 1))) {
    cut -= 1;
  }

  return {
    text: slice.slice(0, cut),
    total_length: totalLength,
    next_offset: start + cut,
  };
}

/**
 * Truncate response if too long.
 */
export function truncateResponse(text: string, limit = CHARACTER_LIMIT): string {
  if (text.length <= limit) {
    return text;
  }

  const originalLen = text.length;

  // Reserve space for the warning message
  const truncateAt = limit - 200;

  // Try to truncate at a paragraph or sentence boundary
  const budgeted = text.slice(0, truncateAt);
  const truncated = budgeted.slice(0, boundaryCut(budgeted, truncateAt));

  const newLen = truncated.length;

  const warning =
    `\n\n---\n` +
    `Antwort gekuerzt (${originalLen} -> ${newLen} Zeichen). ` +
    `Verwende spezifischere Suchparameter oder ris_dokument fuer Einzeldokumente.`;

  return truncated + warning;
}
