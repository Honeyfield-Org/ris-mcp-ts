/**
 * Shared load path for a single RIS document.
 *
 * `ris_dokument` and `ris_dokument_abschnitt` both need the full text of a
 * document, and they need the *same* text: the chunk tool hands out character
 * offsets into it, and the two resolution strategies below produce different
 * metadata headers, so a document loaded one way is several thousand characters
 * offset against the same document loaded the other way. Sharing the path is
 * what keeps a chunk pointing at what the reader was shown.
 *
 * Everything here — the validation, both SSRF checks, the direct/search
 * strategy and the German error prose — was lifted out of `tools/dokument.ts`
 * unchanged; the strings are part of that tool's response contract.
 */

import {
  getDocumentByNumber,
  getDocumentContent,
  getDocumentRoute,
  isAllowedUrl,
  searchBezirke,
  searchBundesrecht,
  searchJudikatur,
  searchLandesrecht,
  searchSonstige,
} from './client.js';
import { formatDocument, type DocumentMetadata } from './formatting.js';
import { findDocumentByDokumentnummer } from './parser.js';
import type { NormalizedSearchResults } from './types.js';

export interface LoadedDocument {
  /** Markdown (or JSON) rendering, before truncation. */
  text: string;
  /** RIS source HTML — needed for the outline; callers may drop it. */
  html: string;
  /** URL the HTML came from; feeds ris_dokument's resource_link. */
  contentUrl: string;
  metadata: DocumentMetadata;
}

export type LoadDocumentResult =
  | { success: true; document: LoadedDocument }
  | { success: false; error: string };

export interface LoadDocumentArgs {
  dokumentnummer?: string;
  url?: string;
  responseFormat: 'markdown' | 'json';
}

/**
 * Resolve, fetch and format a document.
 *
 * Returns a German error string for every condition the user can fix. Throws on
 * cancellation and on unexpected upstream failures — callers keep the abort and
 * `formatErrorResponse` handling they already have.
 */
export async function loadDocument(
  args: LoadDocumentArgs,
  signal: AbortSignal,
): Promise<LoadDocumentResult> {
  const { dokumentnummer, url: inputUrl, responseFormat } = args;

  if (!dokumentnummer && !inputUrl) {
    return {
      success: false,
      error:
        '**Fehler:** Bitte gib entweder eine `dokumentnummer` oder eine `url` an.\n\n' +
        'Die Dokumentnummer findest du in den Suchergebnissen von `ris_bundesrecht`, ' +
        '`ris_landesrecht` oder `ris_judikatur`.',
    };
  }

  // SSRF protection: validate user-supplied URLs against domain allowlist
  if (inputUrl && !isAllowedUrl(inputUrl)) {
    return {
      success: false,
      error:
        '**Fehler:** Die angegebene URL ist nicht erlaubt.\n\n' +
        'Nur HTTPS-URLs zu offiziellen RIS-Domains sind zulaessig ' +
        '(data.bka.gv.at, www.ris.bka.gv.at, ris.bka.gv.at).',
    };
  }

  let contentUrl = inputUrl;
  let htmlContent: string | undefined;
  let metadata: DocumentMetadata;

  if (dokumentnummer && !inputUrl) {
    // Strategy: Try direct URL construction first, fallback to search API
    const directResult = await getDocumentByNumber(dokumentnummer, undefined, signal);

    if (directResult.success) {
      // Direct fetch succeeded - use minimal metadata
      htmlContent = directResult.html;
      contentUrl = directResult.url;
      metadata = {
        dokumentnummer,
        applikation: 'Unbekannt',
        titel: dokumentnummer,
        kurztitel: null,
        citation: {},
        dokument_url: directResult.url,
      };
    } else {
      // Direct fetch failed - fallback to search API. Routing (endpoint +
      // Applikation) comes from the shared registry in client.ts so it stays
      // consistent with the direct-URL construction. Unknown prefixes default
      // to a Justiz search.
      const route = getDocumentRoute(dokumentnummer);
      const searchParams = {
        Applikation: route?.applikation ?? 'Justiz',
        Dokumentnummer: dokumentnummer,
        DokumenteProSeite: 'Ten',
      };

      let apiResponse: NormalizedSearchResults;
      switch (route?.endpoint) {
        case 'Bundesrecht':
          apiResponse = await searchBundesrecht(searchParams, undefined, signal);
          break;
        case 'Landesrecht':
          apiResponse = await searchLandesrecht(searchParams, undefined, signal);
          break;
        case 'Sonstige':
          apiResponse = await searchSonstige(searchParams, undefined, signal);
          break;
        case 'Bezirke':
          apiResponse = await searchBezirke(searchParams, undefined, signal);
          break;
        case 'Judikatur':
        default:
          apiResponse = await searchJudikatur(searchParams, undefined, signal);
          break;
      }

      // Find the document with matching dokumentnummer (don't blindly take first result)
      const findResult = findDocumentByDokumentnummer(apiResponse.documents, dokumentnummer);

      if (!findResult.success) {
        // Both direct fetch and search failed - provide helpful error
        const directError = directResult.error;
        if (findResult.error === 'no_documents') {
          return {
            success: false,
            error:
              `**Fehler:** Kein Dokument mit der Nummer \`${dokumentnummer}\` gefunden.\n\n` +
              `Direkter Abruf: ${directError}\n` +
              `Suche: Keine Ergebnisse.\n\n` +
              'Bitte pruefe die Dokumentnummer oder verwende eine Suche, ' +
              'um das gewuenschte Dokument zu finden.',
          };
        } else {
          return {
            success: false,
            error:
              `**Fehler:** Dokument \`${dokumentnummer}\` nicht gefunden.\n\n` +
              `Direkter Abruf: ${directError}\n` +
              `Suche: ${findResult.totalResults} Ergebnisse, aber keines mit dieser Dokumentnummer.\n\n` +
              `Bitte verwende eine alternative Suche oder die direkte URL.`,
          };
        }
      }

      const doc = findResult.document;
      contentUrl = doc.content_urls.html ?? undefined;

      if (!contentUrl) {
        return {
          success: false,
          error:
            `**Fehler:** Keine Inhalts-URL fuer Dokument \`${dokumentnummer}\` verfuegbar.\n\n` +
            'Das Dokument hat moeglicherweise keinen abrufbaren Volltext.',
        };
      }

      // SSRF protection: this URL comes straight from the search API response
      // and would otherwise be fetched unchecked. Validate it against the same
      // domain allowlist used for user-supplied URLs.
      if (!isAllowedUrl(contentUrl)) {
        return {
          success: false,
          error:
            '**Fehler:** Die Inhalts-URL des Dokuments ist nicht erlaubt.\n\n' +
            'Nur HTTPS-URLs zu offiziellen RIS-Domains sind zulaessig ' +
            '(data.bka.gv.at, www.ris.bka.gv.at, ris.bka.gv.at).',
        };
      }

      // Build metadata from search result
      metadata = {
        dokumentnummer: doc.dokumentnummer,
        applikation: doc.applikation,
        titel: doc.titel,
        kurztitel: doc.kurztitel,
        citation: {
          kurztitel: doc.citation.kurztitel,
          langtitel: doc.citation.langtitel,
          kundmachungsorgan: doc.citation.kundmachungsorgan,
          paragraph: doc.citation.paragraph,
          eli: doc.citation.eli,
          inkrafttreten: doc.citation.inkrafttreten,
          ausserkrafttreten: doc.citation.ausserkrafttreten,
        },
        dokument_url: doc.dokument_url,
        gesamte_rechtsvorschrift_url: doc.gesamte_rechtsvorschrift_url,
      };
    }
  } else {
    // Only URL provided - minimal metadata
    metadata = {
      dokumentnummer: dokumentnummer ?? 'Unbekannt',
      applikation: 'Unbekannt',
      titel: inputUrl ?? '',
      kurztitel: null,
      citation: {},
      dokument_url: inputUrl,
    };
  }

  if (!contentUrl) {
    return { success: false, error: '**Fehler:** Keine gueltige URL zum Abrufen des Dokuments.' };
  }

  // Fetch document content if not already fetched via direct URL
  if (!htmlContent) {
    htmlContent = await getDocumentContent(contentUrl, undefined, signal);
  }

  return {
    success: true,
    document: {
      text: formatDocument(htmlContent, metadata, responseFormat),
      html: htmlContent,
      contentUrl,
      metadata,
    },
  };
}
