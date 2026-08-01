/**
 * Pure mapping from the search tools' `structuredContent` to what the
 * Trefferliste renders.
 *
 * No DOM, no host calls — the widget's display rules live here so they can be
 * tested without a browser, and so the rendering code stays a thin translation
 * of this model into elements.
 */

/** URLs of the renditions RIS offers for a document. */
export interface ContentUrls {
  xml?: string | null;
  html?: string | null;
  rtf?: string | null;
  pdf?: string | null;
}

/** Citation metadata as delivered by the server. */
export interface Citation {
  kurztitel?: string | null;
  langtitel?: string | null;
  kundmachungsorgan?: string | null;
  paragraph?: string | null;
  eli?: string | null;
  inkrafttreten?: string | null;
  ausserkrafttreten?: string | null;
}

/**
 * One document of a search result.
 *
 * Mirrors `DocumentSchema` in `src/types.ts`. The four court fields are present
 * on Judikatur documents and absent on laws, so their presence — not their
 * value — identifies a court decision; `null` means RIS supplied nothing.
 */
export interface SearchDocument {
  dokumentnummer: string;
  applikation: string;
  titel: string;
  kurztitel?: string | null;
  citation: Citation;
  citation_display: string;
  content_urls: ContentUrls;
  dokument_url?: string | null;
  gesamte_rechtsvorschrift_url?: string | null;
  gericht?: string | null;
  geschaeftszahl?: string | null;
  entscheidungsdatum?: string | null;
  rechtssatznummer?: string | null;
}

/** Echo of the call that produced the result — everything needed to page. */
export interface SearchQueryEcho {
  tool: string;
  [key: string]: unknown;
}

/** The `structuredContent` a search tool returns. */
export interface SearchResultPayload {
  total_hits: number;
  page: number;
  page_size: number;
  has_more: boolean;
  documents: SearchDocument[];
  query?: SearchQueryEcho;
}

/** A labelled detail shown when a row is expanded. */
export interface RowMeta {
  label: string;
  value: string;
}

/** One rendered result row. */
export interface DocumentRow {
  /** `dokumentnummer` — also the id of the row element. */
  id: string;
  title: string;
  /** Work title, empty when it would only repeat {@link title}. */
  subtitle: string;
  badge: string;
  isCourtDecision: boolean;
  meta: RowMeta[];
  /** Case numbers of a Judikatur document, in the order RIS lists them. */
  caseNumbers: string[];
  /** Where „Im RIS öffnen" points, `null` when the document carries no URL. */
  risUrl: string | null;
  pdfUrl: string | null;
}

/** Everything the Trefferliste needs to render one page of results. */
export interface ResultViewModel {
  toolLabel: string;
  queryLabel: string;
  hitsLabel: string;
  rangeLabel: string;
  page: number;
  isEmpty: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  rows: DocumentRow[];
}

/** Name and arguments for a `tools/call` the widget issues itself. */
export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * German display names for the search tools.
 *
 * A tool that is missing here still renders — see {@link toolLabelFor} — so
 * adding a tool server-side never leaves the header blank.
 */
const TOOL_LABELS: Record<string, string> = {
  ris_bundesrecht: 'Bundesrecht',
  ris_landesrecht: 'Landesrecht',
  ris_judikatur: 'Judikatur',
  ris_bundesgesetzblatt: 'Bundesgesetzblatt',
  ris_landesgesetzblatt: 'Landesgesetzblatt',
  ris_regierungsvorlagen: 'Regierungsvorlagen',
  ris_bezirke: 'Bezirksverwaltung',
  ris_gemeinden: 'Gemeinderecht',
  ris_sonstige: 'Sonstige',
  ris_history: 'Änderungshistorie',
  ris_verordnungen: 'Verordnungen',
};

/**
 * German badge text for the RIS applications the search tools return.
 *
 * Covers the applications users meet routinely; the long tail (one per
 * `ris_sonstige` collection, per historical jurisdiction, …) falls through to
 * the raw code, which is what RIS itself prints. A wrong-but-friendly label
 * would be worse than the code.
 */
const APPLICATION_LABELS: Record<string, string> = {
  BrKons: 'Bundesrecht',
  LrKons: 'Landesrecht',
  Erv: 'Engl. Übersetzung',
  Justiz: 'Justiz',
  Vwgh: 'VwGH',
  Vfgh: 'VfGH',
  Bvwg: 'BVwG',
  Lvwg: 'LVwG',
  BgblAuth: 'BGBl. authentisch',
  BgblAlt: 'BGBl. 1945–2003',
  BgblPdf: 'BGBl. PDF',
  LgblAuth: 'LGBl. authentisch',
  Lgbl: 'LGBl.',
  RegV: 'Regierungsvorlage',
};

/**
 * Echo keys that describe what was searched for, most specific first.
 *
 * The header shows the first one present. Filters and plumbing (`seite`,
 * `limit`, `applikation`, …) stay out of it — they would crowd out the term the
 * user actually typed.
 */
const QUERY_TERM_KEYS = ['suchworte', 'titel', 'paragraph', 'geschaeftszahl', 'dokumentnummer'];

/** Arguments that must not be replayed as-is when paging. */
const PAGINATION_KEY = 'seite';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Group thousands with a dot, the Austrian convention.
 *
 * Hand-rolled rather than `toLocaleString`, whose output depends on the host's
 * locale — the rest of this widget's copy is German regardless of where it runs.
 */
function formatCount(value: number): string {
  return Math.trunc(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Render an ISO date as `TT.MM.JJJJ`.
 *
 * Anything that is not exactly `YYYY-MM-DD` is passed through untouched: RIS
 * occasionally carries free text in date fields, and showing it verbatim beats
 * showing an invented date or nothing.
 */
function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
}

/**
 * Split a `geschaeftszahl` into its individual case numbers.
 *
 * Justiz Rechtssätze carry a semicolon-separated chain of every case that
 * applied the same principle — sometimes dozens.
 */
export function splitCaseNumbers(value: string | null | undefined): string[] {
  return text(value)
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** The chat message that asks the model to load a document's full text. */
export function fullTextPrompt(dokumentnummer: string): string {
  return `Bitte lade das Dokument ${dokumentnummer} mit ris_dokument.`;
}

/**
 * Validate that a host-delivered payload is a search result.
 *
 * Checks the fields the widget renders and nothing else: the payload may reach
 * us from a host global rather than the tool result (see `shared/bridge.ts`),
 * so it is untrusted input, but a server that adds a field must not be rejected.
 */
export function parseSearchResult(value: unknown): SearchResultPayload | null {
  if (!isRecord(value)) return null;

  const { total_hits, page, page_size, has_more, documents } = value;

  if (!isFiniteNumber(total_hits) || !isFiniteNumber(page) || !isFiniteNumber(page_size)) {
    return null;
  }
  if (typeof has_more !== 'boolean' || !Array.isArray(documents)) return null;

  const identifiable = documents.every(
    (doc) =>
      isRecord(doc) &&
      typeof doc.dokumentnummer === 'string' &&
      typeof doc.applikation === 'string',
  );

  return identifiable ? (value as unknown as SearchResultPayload) : null;
}

function toolLabelFor(tool: string): string {
  return TOOL_LABELS[tool] ?? tool.replace(/^ris_/, '');
}

function queryLabelFor(query: SearchQueryEcho | undefined): string {
  if (!query) return '';

  for (const key of QUERY_TERM_KEYS) {
    const value = text(query[key]);
    if (value) return value;
  }
  return '';
}

function metaFor(doc: SearchDocument): RowMeta[] {
  const meta: RowMeta[] = [];
  const identity = (raw: string): string => raw;
  const add = (
    label: string,
    value: string | null | undefined,
    format: (raw: string) => string = identity,
  ): void => {
    const trimmed = text(value);
    if (trimmed) meta.push({ label, value: format(trimmed) });
  };

  if ('gericht' in doc) {
    add('Gericht', doc.gericht);
    add('Entscheidungsdatum', doc.entscheidungsdatum, formatDate);
    add('Geschäftszahl', doc.geschaeftszahl);
    // Displayed exactly as delivered: VwGH numbers them with bare ordinals
    // while Justiz uses RS-prefixed ids, so any normalisation would be wrong
    // for one of them.
    add('Rechtssatznummer', doc.rechtssatznummer);
  } else {
    add('In Kraft seit', doc.citation.inkrafttreten, formatDate);
    add('Außer Kraft seit', doc.citation.ausserkrafttreten, formatDate);
  }

  add('Dokumentnummer', doc.dokumentnummer);
  return meta;
}

/**
 * Pick the row headline.
 *
 * A decision is cited by its case number, so that wins for court documents.
 * `citation_display` is the server's short citation and is the right headline
 * for laws — but for Judikatur it is derived from the document id whenever the
 * server cannot parse a case number out of the title, and then reads as machine
 * output (`OGH 20011022_OGH0002_0010OB00049/01i`) next to a perfectly good
 * `1Ob49/01i` in the very same record.
 */
function titleFor(doc: SearchDocument, caseNumbers: string[]): string {
  if ('gericht' in doc && caseNumbers.length > 0) return caseNumbers[0];

  const citation = text(doc.citation_display);
  if (citation && citation !== doc.dokumentnummer) return citation;

  return caseNumbers[0] || text(doc.titel) || text(doc.kurztitel) || doc.dokumentnummer;
}

/**
 * Pick the line under the headline, or nothing.
 *
 * RIS sets `titel` and `kurztitel` of a Judikatur document to its
 * `geschaeftszahl` verbatim (confirmed across a live `ris_judikatur` page), so
 * on those the subtitle would only restate the case chain — which the row
 * already advertises with „+N weitere" and shows in full once expanded.
 */
function subtitleFor(doc: SearchDocument, title: string): string {
  const subtitle = text(doc.kurztitel) || text(doc.titel);

  if (subtitle === title || subtitle === text(doc.geschaeftszahl)) return '';
  return subtitle;
}

function toRow(doc: SearchDocument): DocumentRow {
  const caseNumbers = splitCaseNumbers(doc.geschaeftszahl);
  const title = titleFor(doc, caseNumbers);

  return {
    id: doc.dokumentnummer,
    title,
    subtitle: subtitleFor(doc, title),
    badge: APPLICATION_LABELS[doc.applikation] ?? doc.applikation,
    isCourtDecision: 'gericht' in doc,
    meta: metaFor(doc),
    caseNumbers,
    risUrl: text(doc.content_urls.html) || text(doc.dokument_url) || null,
    pdfUrl: text(doc.content_urls.pdf) || null,
  };
}

/**
 * Build the call that fetches the page `delta` steps away.
 *
 * Returns `null` when the widget cannot re-issue the search — no echo, no tool
 * name, or a target before the first page — which is also how the view model
 * decides whether to offer the pagination buttons at all.
 */
export function nextQuery(query: SearchQueryEcho | undefined, delta: number): ToolCall | null {
  if (!query) return null;

  const name = text(query.tool);
  if (!name) return null;

  const current = isFiniteNumber(query[PAGINATION_KEY]) ? query[PAGINATION_KEY] : 1;
  const target = current + delta;
  if (target < 1) return null;

  const { tool: _tool, ...rest } = query;
  return { name, arguments: { ...rest, [PAGINATION_KEY]: target } };
}

/** Map one page of search results onto the view model the DOM renders. */
export function toViewModel(result: SearchResultPayload): ResultViewModel {
  const rows = result.documents.map(toRow);
  const first = Math.max(0, result.page - 1) * Math.max(0, result.page_size) + 1;
  const last = first + rows.length - 1;

  return {
    toolLabel: result.query ? toolLabelFor(text(result.query.tool)) : '',
    queryLabel: queryLabelFor(result.query),
    hitsLabel: `${formatCount(result.total_hits)} Treffer`,
    rangeLabel:
      rows.length === 0
        ? ''
        : `${formatCount(first)}–${formatCount(last)} von ${formatCount(result.total_hits)}`,
    page: result.page,
    isEmpty: rows.length === 0,
    hasPrev: nextQuery(result.query, -1) !== null,
    hasNext: result.has_more && nextQuery(result.query, 1) !== null,
    rows,
  };
}
