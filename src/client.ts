/**
 * HTTP client for the Austrian RIS (Rechtsinformationssystem) API v2.6.
 *
 * This module provides a client for querying the Austrian legal information
 * system API, which includes federal law, state law, case law, and other legal
 * documents.
 *
 * API Documentation: https://data.bka.gv.at/ris/api/v2.6/
 */

import type {
  NormalizedSearchResults,
  RawApiResponse,
  RawDocumentReference,
  RawHitsInfo,
} from './types.js';

// =============================================================================
// Custom Errors
// =============================================================================

/**
 * Base exception for RIS API errors.
 */
export class RISAPIError extends Error {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'RISAPIError';
    this.statusCode = statusCode;
  }
}

/**
 * Raised when a request to the RIS API times out.
 */
export class RISTimeoutError extends RISAPIError {
  constructor(message = 'Request to RIS API timed out') {
    super(message);
    this.name = 'RISTimeoutError';
  }
}

/**
 * Raised when JSON parsing fails.
 */
export class RISParsingError extends RISAPIError {
  public readonly originalError?: Error;

  constructor(message: string, originalError?: Error) {
    super(message);
    this.name = 'RISParsingError';
    this.originalError = originalError;
  }
}

// =============================================================================
// RIS Client
// =============================================================================

const BASE_URL = 'https://data.bka.gv.at/ris/api/v2.6/';
const DEFAULT_TIMEOUT = 30000; // 30 seconds in milliseconds

/** HTTP status codes treated as transient and worth a single retry. */
const TRANSIENT_STATUS_CODES = new Set([502, 503, 504]);
/** Delay before the single retry of a transient failure. */
const RETRY_DELAY_MS = 500;

/**
 * Resolve after the given number of milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determine whether an error is transient (a gateway error or timeout) and
 * therefore worth retrying once.
 */
function isTransientError(error: unknown): boolean {
  if (error instanceof RISTimeoutError) {
    return true;
  }
  if (error instanceof RISAPIError && error.statusCode !== undefined) {
    return TRANSIENT_STATUS_CODES.has(error.statusCode);
  }
  return false;
}

/**
 * Allowed hostnames for document content fetching (SSRF protection).
 */
const ALLOWED_DOCUMENT_HOSTNAMES = ['data.bka.gv.at', 'www.ris.bka.gv.at', 'ris.bka.gv.at'];

/**
 * Validate that a URL points to an allowed RIS domain (HTTPS only).
 */
export function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_DOCUMENT_HOSTNAMES.includes(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Build query parameters for API request.
 * Converts all values to strings and filters out undefined/null values.
 */
function buildParams(params: Record<string, unknown>): URLSearchParams {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.set(key, String(value));
    }
  }
  return searchParams;
}

/**
 * Parse JSON response from the RIS API.
 */
function parseJsonResponse(jsonContent: string): RawApiResponse {
  try {
    return JSON.parse(jsonContent) as RawApiResponse;
  } catch (e) {
    throw new RISParsingError(
      `Failed to parse JSON response: ${e instanceof Error ? e.message : String(e)}`,
      e instanceof Error ? e : undefined,
    );
  }
}

/**
 * Extract and normalize search results from parsed API response.
 */
function extractSearchResults(parsedResponse: RawApiResponse): NormalizedSearchResults {
  const searchResult = parsedResponse.OgdSearchResult ?? {};
  const documentResults = searchResult.OgdDocumentResults ?? {};

  // Extract pagination info from Hits element
  const hitsInfo = documentResults.Hits;

  let totalHits = 0;
  let pageNumber = 1;
  let pageSize = 10;

  if (typeof hitsInfo === 'object' && hitsInfo !== null) {
    const hitsObj = hitsInfo as RawHitsInfo;
    totalHits = Number(hitsObj['#text'] ?? 0);
    pageNumber = Number(hitsObj['@pageNumber'] ?? 1);
    pageSize = Number(hitsObj['@pageSize'] ?? 10);
  } else if (hitsInfo !== undefined && hitsInfo !== null) {
    totalHits = Number(hitsInfo);
  }

  // Extract document references
  let docRefs = documentResults.OgdDocumentReference;

  // Ensure docRefs is always an array
  if (docRefs === undefined || docRefs === null) {
    docRefs = [];
  } else if (!Array.isArray(docRefs)) {
    docRefs = [docRefs];
  }

  return {
    hits: totalHits,
    page_number: pageNumber,
    page_size: pageSize,
    documents: docRefs as RawDocumentReference[],
  };
}

/**
 * Perform a single request attempt against the RIS API.
 */
async function requestOnce(
  url: string,
  endpoint: string,
  timeout: number,
): Promise<NormalizedSearchResults> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text();
      throw new RISAPIError(
        `HTTP error ${response.status} for ${endpoint}: ${text}`,
        response.status,
      );
    }

    const jsonText = await response.text();
    const parsed = parseJsonResponse(jsonText);
    return extractSearchResults(parsed);
  } catch (e) {
    clearTimeout(timeoutId);

    if (e instanceof RISAPIError || e instanceof RISParsingError) {
      throw e;
    }

    if (e instanceof Error) {
      if (e.name === 'AbortError') {
        throw new RISTimeoutError(`Request to ${endpoint} timed out after ${timeout}ms`);
      }
      throw new RISAPIError(`Request failed for ${endpoint}: ${e.message}`);
    }

    throw new RISAPIError(`Request failed for ${endpoint}: ${String(e)}`);
  }
}

/**
 * Make a request to the RIS API, retrying once on transient failures
 * (HTTP 502/503/504 and timeouts) after a short delay.
 */
async function request(
  endpoint: string,
  params: Record<string, unknown>,
  timeout = DEFAULT_TIMEOUT,
): Promise<NormalizedSearchResults> {
  const url = new URL(endpoint, BASE_URL);
  url.search = buildParams(params).toString();
  const urlString = url.toString();

  try {
    return await requestOnce(urlString, endpoint, timeout);
  } catch (e) {
    if (isTransientError(e)) {
      await delay(RETRY_DELAY_MS);
      return requestOnce(urlString, endpoint, timeout);
    }
    throw e;
  }
}

/**
 * Search federal law (Bundesrecht).
 */
export async function searchBundesrecht(
  params: Record<string, unknown>,
  timeout = DEFAULT_TIMEOUT,
): Promise<NormalizedSearchResults> {
  return request('Bundesrecht', params, timeout);
}

/**
 * Search state/provincial law (Landesrecht).
 */
export async function searchLandesrecht(
  params: Record<string, unknown>,
  timeout = DEFAULT_TIMEOUT,
): Promise<NormalizedSearchResults> {
  return request('Landesrecht', params, timeout);
}

/**
 * Search case law/jurisprudence (Judikatur).
 */
export async function searchJudikatur(
  params: Record<string, unknown>,
  timeout = DEFAULT_TIMEOUT,
): Promise<NormalizedSearchResults> {
  return request('Judikatur', params, timeout);
}

/**
 * Search district administrative authorities (Bezirke).
 */
export async function searchBezirke(
  params: Record<string, unknown>,
  timeout = DEFAULT_TIMEOUT,
): Promise<NormalizedSearchResults> {
  return request('Bezirke', params, timeout);
}

/**
 * Search municipal law (Gemeinden).
 */
export async function searchGemeinden(
  params: Record<string, unknown>,
  timeout = DEFAULT_TIMEOUT,
): Promise<NormalizedSearchResults> {
  return request('Gemeinden', params, timeout);
}

/**
 * Search miscellaneous legal collections (Sonstige).
 */
export async function searchSonstige(
  params: Record<string, unknown>,
  timeout = DEFAULT_TIMEOUT,
): Promise<NormalizedSearchResults> {
  return request('Sonstige', params, timeout);
}

/**
 * Search document change history (History).
 */
export async function searchHistory(
  params: Record<string, unknown>,
  timeout = DEFAULT_TIMEOUT,
): Promise<NormalizedSearchResults> {
  return request('History', params, timeout);
}

/**
 * Fetch HTML content from a document URL.
 */
export async function getDocumentContent(url: string, timeout = DEFAULT_TIMEOUT): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text();
      throw new RISAPIError(
        `HTTP error ${response.status} fetching document: ${text}`,
        response.status,
      );
    }

    return await response.text();
  } catch (e) {
    clearTimeout(timeoutId);

    if (e instanceof RISAPIError) {
      throw e;
    }

    if (e instanceof Error) {
      if (e.name === 'AbortError') {
        throw new RISTimeoutError(`Request to document URL timed out after ${timeout}ms`);
      }
      throw new RISAPIError(`Request failed fetching document: ${e.message}`);
    }

    throw new RISAPIError(`Request failed fetching document: ${String(e)}`);
  }
}

// =============================================================================
// Direct Document URL Construction
// =============================================================================

/**
 * Validate dokumentnummer contains only safe characters.
 * Defense-in-depth check in addition to Zod schema.
 *
 * Valid dokumentnummern:
 * - Start with uppercase letter
 * - Contain only uppercase letters, digits, and underscores
 * - Length between 5 and 50 characters
 *
 * Examples: NOR40052761, BVWG_W123_2000000_1_00
 */
export function isValidDokumentnummer(dokumentnummer: string): boolean {
  if (dokumentnummer.length < 5 || dokumentnummer.length > 50) {
    return false;
  }
  // Only uppercase letters, digits, underscores allowed
  // Must start with uppercase letter
  return /^[A-Z][A-Z0-9_]+$/.test(dokumentnummer);
}

/**
 * RIS search endpoint used for the fallback search when direct URL fetch fails.
 */
export type DocumentEndpoint = 'Bundesrecht' | 'Landesrecht' | 'Judikatur' | 'Sonstige' | 'Bezirke';

/**
 * Routing information for a Dokumentnummer prefix.
 */
export interface DocumentRoute {
  /** Folder segment in the ris.bka.gv.at/Dokumente/<folder>/ direct URL. */
  urlFolder: string;
  /** Search endpoint used for the fallback search. */
  endpoint: DocumentEndpoint;
  /** `Applikation` API parameter for the fallback search. */
  applikation: string;
}

/**
 * Single source of truth mapping Dokumentnummer prefixes to their direct-URL
 * folder and fallback-search routing. Used by both {@link constructDocumentUrl}
 * (direct URL) and the ris_dokument fallback search (via {@link getDocumentRoute}).
 * Prefixes are matched longest-first.
 *
 * The Judikatur document-ID scheme is `J<court><R|T>` where R = Rechtssatz and
 * T = Entscheidungstext: JJ = Justiz, JW = VwGH, JF = VfGH, JU = UVS.
 *
 * Folder segments and endpoints verified against RIS API v2.6
 * (data.bka.gv.at / ris.bka.gv.at) on 2026-07-03.
 */
const DOCUMENT_ROUTES: Record<string, DocumentRoute> = {
  // --- Bundesrecht (Federal Law) ---
  NOR: { urlFolder: 'Bundesnormen', endpoint: 'Bundesrecht', applikation: 'BrKons' },
  BGBLPDF: { urlFolder: 'BgblPdf', endpoint: 'Bundesrecht', applikation: 'BgblPdf' },
  BGBLA: { urlFolder: 'BgblAuth', endpoint: 'Bundesrecht', applikation: 'BgblAuth' },
  BGBL: { urlFolder: 'BgblAlt', endpoint: 'Bundesrecht', applikation: 'BgblAlt' },
  REGV: { urlFolder: 'RegV', endpoint: 'Bundesrecht', applikation: 'RegV' },

  // --- Landesrecht (State Law) — one prefix per state ---
  LBG: { urlFolder: 'LrBgld', endpoint: 'Landesrecht', applikation: 'LrKons' },
  LKT: { urlFolder: 'LrK', endpoint: 'Landesrecht', applikation: 'LrKons' },
  LNO: { urlFolder: 'LrNO', endpoint: 'Landesrecht', applikation: 'LrKons' },
  LOO: { urlFolder: 'LrOO', endpoint: 'Landesrecht', applikation: 'LrKons' },
  LSB: { urlFolder: 'LrSbg', endpoint: 'Landesrecht', applikation: 'LrKons' },
  LST: { urlFolder: 'LrStmk', endpoint: 'Landesrecht', applikation: 'LrKons' },
  LTI: { urlFolder: 'LrT', endpoint: 'Landesrecht', applikation: 'LrKons' },
  LVB: { urlFolder: 'LrVbg', endpoint: 'Landesrecht', applikation: 'LrKons' },
  LWI: { urlFolder: 'LrW', endpoint: 'Landesrecht', applikation: 'LrKons' },
  VBL: { urlFolder: 'Vbl', endpoint: 'Landesrecht', applikation: 'Vbl' },

  // --- Judikatur (Case Law) ---
  JWR: { urlFolder: 'Vwgh', endpoint: 'Judikatur', applikation: 'Vwgh' },
  JWT: { urlFolder: 'Vwgh', endpoint: 'Judikatur', applikation: 'Vwgh' },
  JFR: { urlFolder: 'Vfgh', endpoint: 'Judikatur', applikation: 'Vfgh' },
  JFT: { urlFolder: 'Vfgh', endpoint: 'Judikatur', applikation: 'Vfgh' },
  JJR: { urlFolder: 'Justiz', endpoint: 'Judikatur', applikation: 'Justiz' },
  JJT: { urlFolder: 'Justiz', endpoint: 'Judikatur', applikation: 'Justiz' },
  BVWG: { urlFolder: 'Bvwg', endpoint: 'Judikatur', applikation: 'Bvwg' },
  LVWG: { urlFolder: 'Lvwg', endpoint: 'Judikatur', applikation: 'Lvwg' },
  DSB: { urlFolder: 'Dsk', endpoint: 'Judikatur', applikation: 'Dsk' },
  PDK: { urlFolder: 'Dsk', endpoint: 'Judikatur', applikation: 'Dsk' },
  GBK: { urlFolder: 'Gbk', endpoint: 'Judikatur', applikation: 'Gbk' },
  PVAB: { urlFolder: 'Pvak', endpoint: 'Judikatur', applikation: 'Pvak' },
  DKT: { urlFolder: 'Dok', endpoint: 'Judikatur', applikation: 'Dok' },
  VERG: { urlFolder: 'Verg', endpoint: 'Judikatur', applikation: 'Verg' },
  JUR: { urlFolder: 'Uvs', endpoint: 'Judikatur', applikation: 'Uvs' },
  JUT: { urlFolder: 'Uvs', endpoint: 'Judikatur', applikation: 'Uvs' },
  UBAS: { urlFolder: 'Ubas', endpoint: 'Judikatur', applikation: 'Ubas' },
  UMSE: { urlFolder: 'Umse', endpoint: 'Judikatur', applikation: 'Umse' },
  BKS: { urlFolder: 'Bks', endpoint: 'Judikatur', applikation: 'Bks' },
  ASYLGH: { urlFolder: 'AsylGH', endpoint: 'Judikatur', applikation: 'AsylGH' },
  NL: { urlFolder: 'Normenliste', endpoint: 'Judikatur', applikation: 'Normenliste' },

  // --- Sonstige (Miscellaneous) ---
  MRP: { urlFolder: 'Mrp', endpoint: 'Sonstige', applikation: 'Mrp' },
  ERL: { urlFolder: 'Erlaesse', endpoint: 'Sonstige', applikation: 'Erlaesse' },
  PRUEF: { urlFolder: 'PruefGewO', endpoint: 'Sonstige', applikation: 'PruefGewO' },
  AVSV: { urlFolder: 'Avsv', endpoint: 'Sonstige', applikation: 'Avsv' },
  SPG: { urlFolder: 'Spg', endpoint: 'Sonstige', applikation: 'Spg' },
  KMGER: { urlFolder: 'KmGer', endpoint: 'Sonstige', applikation: 'KmGer' },

  // --- Bezirke (District Administrative Authorities) ---
  BVB: { urlFolder: 'Bvb', endpoint: 'Bezirke', applikation: 'Bvb' },
};

/** Prefixes sorted longest-first so specific prefixes win over shorter ones. */
const DOCUMENT_ROUTE_PREFIXES = Object.keys(DOCUMENT_ROUTES).sort((a, b) => b.length - a.length);

/**
 * Look up the routing information for a Dokumentnummer by its prefix.
 *
 * @param dokumentnummer - The RIS document number (e.g., "NOR12019037")
 * @returns The matching route, or null if the prefix is unknown
 */
export function getDocumentRoute(dokumentnummer: string): DocumentRoute | null {
  for (const prefix of DOCUMENT_ROUTE_PREFIXES) {
    if (dokumentnummer.startsWith(prefix)) {
      return DOCUMENT_ROUTES[prefix];
    }
  }
  return null;
}

/**
 * Construct a direct document URL based on the Dokumentnummer prefix.
 *
 * @param dokumentnummer - The RIS document number (e.g., "NOR12019037")
 * @returns The constructed URL or null if prefix is unknown or dokumentnummer is invalid
 */
export function constructDocumentUrl(dokumentnummer: string): string | null {
  // Validate before URL construction (defense-in-depth)
  if (!isValidDokumentnummer(dokumentnummer)) {
    return null;
  }

  const route = getDocumentRoute(dokumentnummer);
  if (!route) {
    return null;
  }

  return `https://ris.bka.gv.at/Dokumente/${route.urlFolder}/${dokumentnummer}/${dokumentnummer}.html`;
}

/**
 * Result type for direct document fetch.
 */
export type DirectDocumentResult =
  | { success: true; html: string; url: string }
  | { success: false; error: string; statusCode?: number };

/**
 * Attempt to fetch a document directly by its Dokumentnummer using URL construction.
 *
 * This bypasses the search API and fetches the document directly if the
 * Dokumentnummer prefix is known.
 *
 * @param dokumentnummer - The RIS document number (e.g., "NOR12019037")
 * @param timeout - Request timeout in milliseconds
 * @returns Result object with HTML content on success, or error details on failure
 */
export async function getDocumentByNumber(
  dokumentnummer: string,
  timeout = DEFAULT_TIMEOUT,
): Promise<DirectDocumentResult> {
  // Validate dokumentnummer before any URL operations
  if (!isValidDokumentnummer(dokumentnummer)) {
    return {
      success: false,
      error: `Ungueltige Dokumentnummer: "${dokumentnummer}". Nur Grossbuchstaben, Ziffern und Unterstriche erlaubt (5-50 Zeichen, muss mit Buchstabe beginnen).`,
    };
  }

  const url = constructDocumentUrl(dokumentnummer);

  if (!url) {
    return {
      success: false,
      error: `Unbekanntes Dokumentnummer-Prefix: ${dokumentnummer.slice(0, 4)}`,
    };
  }

  try {
    const html = await getDocumentContent(url, timeout);
    return { success: true, html, url };
  } catch (e) {
    if (e instanceof RISAPIError) {
      return {
        success: false,
        error: e.message,
        statusCode: e.statusCode,
      };
    }
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
