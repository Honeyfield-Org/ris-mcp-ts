/**
 * Parser for RIS API responses.
 *
 * This module provides functions to parse raw API responses into
 * structured Document and SearchResult models.
 */

import type {
  Citation,
  ContentUrl,
  Document,
  NormalizedSearchResults,
  RawContentReference,
  RawContentUrl,
  RawDocumentReference,
  RawJudikaturCourtBlock,
  RawJudikaturMetadata,
  SearchResult,
} from './types.js';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract text from various API response formats.
 * Handles strings, objects with #text, and objects with item.
 */
export function extractText(elem: unknown): string | null {
  if (elem === null || elem === undefined) {
    return null;
  }
  if (typeof elem === 'string') {
    const trimmed = elem.trim();
    return trimmed || null;
  }
  if (typeof elem === 'object') {
    const obj = elem as Record<string, unknown>;
    const text = obj['#text'] ?? obj['item'];
    if (typeof text === 'string') {
      return text.trim() || null;
    }
    if (Array.isArray(text)) {
      return text.join(', ');
    }
  }
  return null;
}

/**
 * Judikatur metadata keys that carry a court-specific head-note block. The
 * remaining keys (Geschaeftszahl, Entscheidungsdatum) are not courts.
 */
const JUDIKATUR_COURT_KEYS = [
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
] as const;

type JudikaturCourtKey = (typeof JUDIKATUR_COURT_KEYS)[number];

function isCourtKey(key: string): key is JudikaturCourtKey {
  return (JUDIKATUR_COURT_KEYS as readonly string[]).includes(key);
}

/**
 * Extract the court-specific sub-block that carries the head-note. RIS nests
 * this block under the applikation name (e.g. Judikatur.Vfgh, Judikatur.Dsk).
 */
function getCourtHeadNote(
  judikatur: RawJudikaturMetadata | undefined,
  applikation: string | undefined,
): RawJudikaturCourtBlock | undefined {
  if (!judikatur || !applikation || !isCourtKey(applikation)) {
    return undefined;
  }
  return judikatur[applikation];
}

/**
 * Extract URL by DataType from content URL list.
 */
function getUrlByType(contentUrlList: RawContentUrl[], dataType: string): string | null {
  for (const item of contentUrlList) {
    if (item.DataType === dataType && item.Url) {
      return item.Url;
    }
  }
  return null;
}

/**
 * Extract content URLs from raw content reference.
 */
export function extractContentUrls(contentRef: RawContentReference | undefined): ContentUrl {
  if (!contentRef) {
    return { html: null, xml: null, pdf: null, rtf: null };
  }

  const urls = contentRef.Urls;
  if (!urls) {
    return { html: null, xml: null, pdf: null, rtf: null };
  }

  let contentUrlList = urls.ContentUrl;
  if (!contentUrlList) {
    return { html: null, xml: null, pdf: null, rtf: null };
  }

  // Ensure it's an array
  if (!Array.isArray(contentUrlList)) {
    contentUrlList = [contentUrlList];
  }

  return {
    html: getUrlByType(contentUrlList, 'Html'),
    xml: getUrlByType(contentUrlList, 'Xml'),
    pdf: getUrlByType(contentUrlList, 'Pdf'),
    rtf: getUrlByType(contentUrlList, 'Rtf'),
  };
}

// =============================================================================
// Document Parsing
// =============================================================================

/**
 * Parse a document reference from the API response into a Document model.
 */
export function parseDocumentFromApiResponse(docRef: RawDocumentReference): Document {
  const data = docRef.Data ?? {};
  const metadaten = data.Metadaten ?? {};
  const dokumentliste = data.Dokumentliste ?? {};
  const technisch = metadaten.Technisch ?? {};
  const allgemein = metadaten.Allgemein ?? {};

  // Extract content reference - can be a dict or array of dicts
  const contentRefRaw = dokumentliste.ContentReference;
  let contentRef: RawContentReference | undefined;

  if (Array.isArray(contentRefRaw)) {
    // Find MainDocument or use first entry
    contentRef =
      contentRefRaw.find((ref) => ref.ContentType === 'MainDocument') ?? contentRefRaw[0];
  } else {
    contentRef = contentRefRaw;
  }

  // Extract content URLs
  const contentUrls = extractContentUrls(contentRef);

  // Extract metadata from Bundesrecht, Landesrecht, or Judikatur
  const bundesrecht = metadaten.Bundesrecht;
  const landesrecht = metadaten.Landesrecht;
  const judikatur = metadaten.Judikatur;

  // Initialize citation variables
  let kurztitelElem: unknown = '';
  let langtitelElem: unknown = '';
  let kundmachungsorgan: unknown = '';
  let paragraph: unknown = '';
  let inkrafttreten: unknown = '';
  let ausserkrafttreten: unknown = '';
  let eli: unknown = '';
  let gesamteRechtsvorschriftUrl = '';
  let geschaeftszahl = '';
  let entscheidungsdatum: unknown = '';

  if (bundesrecht) {
    // Handle Bundesrecht
    const nested = bundesrecht.BrKons ?? {};
    kurztitelElem = bundesrecht.Kurztitel ?? '';
    langtitelElem = bundesrecht.Langtitel ?? bundesrecht.Titel ?? '';
    kundmachungsorgan = nested.Kundmachungsorgan ?? '';
    paragraph = nested.ArtikelParagraphAnlage ?? '';
    inkrafttreten = nested.Inkrafttretensdatum ?? '';
    ausserkrafttreten = nested.Ausserkrafttretensdatum ?? '';
    eli = bundesrecht.Eli ?? '';
    gesamteRechtsvorschriftUrl = nested.GesamteRechtsvorschriftUrl ?? '';
  } else if (landesrecht) {
    // Handle Landesrecht
    const nested = landesrecht.LrKons ?? {};
    kurztitelElem = landesrecht.Kurztitel ?? '';
    langtitelElem = landesrecht.Langtitel ?? landesrecht.Titel ?? '';
    kundmachungsorgan = nested.Kundmachungsorgan ?? '';
    paragraph = nested.ArtikelParagraphAnlage ?? '';
    inkrafttreten = nested.Inkrafttretensdatum ?? '';
    ausserkrafttreten = nested.Ausserkrafttretensdatum ?? '';
    eli = landesrecht.Eli ?? '';
    gesamteRechtsvorschriftUrl = nested.GesamteRechtsvorschriftUrl ?? '';
  } else if (judikatur) {
    // Handle Judikatur (court decisions)
    const geschaeftszahlElem = judikatur.Geschaeftszahl;
    if (typeof geschaeftszahlElem === 'object' && geschaeftszahlElem !== null) {
      const item = (geschaeftszahlElem as { item?: string | string[] }).item;
      if (Array.isArray(item)) {
        geschaeftszahl = item.join(', ');
      } else if (typeof item === 'string') {
        geschaeftszahl = item;
      }
    } else if (typeof geschaeftszahlElem === 'string') {
      geschaeftszahl = geschaeftszahlElem;
    }

    entscheidungsdatum = judikatur.Entscheidungsdatum ?? '';

    // The head-note lives in a nested block keyed by the applikation name
    // (e.g. "Vfgh"). Only some courts expose one: Vfgh uses "Leitsatz", while
    // Dsk/Pvak/Dok use "Kurzinformation" (verified against RIS API v2.6). Others
    // (Lvwg, Gbk, Bks, ...) have no head-note and leave langtitel empty.
    const courtNested = getCourtHeadNote(judikatur, technisch.Applikation);

    kurztitelElem = geschaeftszahl; // Use Geschaeftszahl as kurztitel
    langtitelElem = extractText(courtNested?.Leitsatz) ?? extractText(courtNested?.Kurzinformation);
  }

  // Build Citation
  const citation: Citation = {
    kurztitel: extractText(kurztitelElem),
    langtitel: extractText(langtitelElem),
    kundmachungsorgan: extractText(kundmachungsorgan),
    paragraph: extractText(paragraph),
    eli: extractText(eli),
    inkrafttreten: extractText(inkrafttreten) ?? extractText(entscheidungsdatum),
    ausserkrafttreten: extractText(ausserkrafttreten),
  };

  // Extract document number and application from Technisch section
  const dokumentnummer = technisch.ID ?? '';
  const applikation = technisch.Applikation ?? '';

  // Extract title
  let titel = extractText(kurztitelElem) ?? '';
  if (!titel && geschaeftszahl) {
    titel = `GZ ${geschaeftszahl}`;
  }
  if (!titel && contentRef) {
    const name = contentRef.Name;
    if (typeof name === 'string') {
      titel = name;
    } else if (typeof name === 'object' && name !== null) {
      titel = name['#text'] ?? '';
    }
  }

  // Build document URLs
  const dokumentUrl = allgemein.DokumentUrl ?? null;

  return {
    dokumentnummer,
    applikation,
    titel,
    kurztitel: extractText(kurztitelElem),
    citation,
    content_urls: contentUrls,
    dokument_url: dokumentUrl,
    gesamte_rechtsvorschrift_url: gesamteRechtsvorschriftUrl || null,
  };
}

// =============================================================================
// Document Matching
// =============================================================================

/**
 * Result type for finding a document by dokumentnummer.
 */
export type FindDocumentResult =
  | { success: true; document: Document }
  | { success: false; error: 'no_documents' | 'not_found'; totalResults?: number };

/**
 * Find a document by dokumentnummer from a list of raw API document references.
 *
 * This function parses all documents and finds the one matching the requested
 * dokumentnummer rather than blindly taking the first result (which may not
 * be the correct document when the API returns multiple results).
 *
 * @param rawDocuments - Raw document references from the API response
 * @param dokumentnummer - The document number to find
 * @returns Result object indicating success with the document, or failure with error type
 */
export function findDocumentByDokumentnummer(
  rawDocuments: RawDocumentReference[],
  dokumentnummer: string,
): FindDocumentResult {
  if (!rawDocuments || rawDocuments.length === 0) {
    return { success: false, error: 'no_documents' };
  }

  const parsedDocs = rawDocuments.map(parseDocumentFromApiResponse);
  const doc = parsedDocs.find((d) => d.dokumentnummer === dokumentnummer);

  if (!doc) {
    return { success: false, error: 'not_found', totalResults: rawDocuments.length };
  }

  return { success: true, document: doc };
}

// =============================================================================
// Search Results Parsing
// =============================================================================

/**
 * Parse API response into a SearchResult model.
 */
export function parseSearchResults(apiResponse: NormalizedSearchResults): SearchResult {
  const totalHits = apiResponse.hits;
  const page = apiResponse.page_number;
  const pageSize = apiResponse.page_size;
  const rawDocuments = apiResponse.documents;

  const documents = rawDocuments.map(parseDocumentFromApiResponse);
  const hasMore = page * pageSize < totalHits;

  return {
    total_hits: totalHits,
    page,
    page_size: pageSize,
    has_more: hasMore,
    documents,
  };
}
