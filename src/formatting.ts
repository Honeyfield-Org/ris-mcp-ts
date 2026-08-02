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

const CHARACTER_LIMIT = 25000;

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
  // `<td><p class="TabText">152,60</p></td>` — so those nested blocks have to
  // yield a space as well, or the row falls apart into one paragraph per cell.
  const blocks = $(BLOCK_LEVEL_ELEMENTS);
  const cellBlocks = blocks.filter((_, element) => $(element).closest(TABLE_CELLS).length > 0);

  cellBlocks.before(' ').after(' ');
  blocks.not(cellBlocks).before('\n').after('\n');
  $(TABLE_CELLS).after(' ');

  // RIS pretty-prints its table markup, so the source itself carries newlines
  // between and inside the cells (`</td>\n<td>\n<p>...`). Those would survive
  // into the output and tear the row apart again, so layout whitespace inside a
  // row collapses to a single space. The line break for the row comes from the
  // `tr` boundary, which sits outside the row and is untouched by this. The
  // character class spells out the layout characters rather than using `\s`,
  // which would also fold the non-breaking spaces RIS holds citations together
  // with — those survive here as everywhere else in the output.
  $('tr')
    .find('*')
    .addBack()
    .contents()
    .each((_, node) => {
      if (node.type === 'text') {
        node.data = node.data.replace(/[ \t\r\n]+/g, ' ');
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
// Response Truncation
// =============================================================================

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

  // Try to truncate at a paragraph boundary
  let truncated = text.slice(0, truncateAt);

  // Find last paragraph break
  const lastPara = truncated.lastIndexOf('\n\n');
  if (lastPara > truncateAt * 0.7) {
    truncated = truncated.slice(0, lastPara);
  } else {
    // Try sentence boundary
    const lastSentence = Math.max(
      truncated.lastIndexOf('. '),
      truncated.lastIndexOf('.\n'),
      truncated.lastIndexOf('? '),
      truncated.lastIndexOf('! '),
    );
    if (lastSentence > truncateAt * 0.8) {
      truncated = truncated.slice(0, lastSentence + 1);
    }
  }

  const newLen = truncated.length;

  const warning =
    `\n\n---\n` +
    `Antwort gekuerzt (${originalLen} -> ${newLen} Zeichen). ` +
    `Verwende spezifischere Suchparameter oder ris_dokument fuer Einzeldokumente.`;

  return truncated + warning;
}
