/**
 * Tool 7: ris_dokument — Retrieve full text of a legal document.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

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
} from '../client.js';
import { formatDocument, truncateResponse, type DocumentMetadata } from '../formatting.js';
import { createErrorResponse, formatErrorResponse } from '../helpers.js';
import { findDocumentByDokumentnummer } from '../parser.js';
import type { NormalizedSearchResults } from '../types.js';

export function registerDokumentTool(server: McpServer): void {
  server.registerTool(
    'ris_dokument',
    {
      title: 'Dokument abrufen',
      description: `Retrieve full text of a legal document.

Use this after searching to load the complete text of a specific law or decision.

Note: For long documents, content may be truncated. Use specific searches to narrow down.`,
      inputSchema: {
        dokumentnummer: z
          .string()
          .optional()
          .describe('RIS document number (e.g., "NOR40052761") - from search results'),
        url: z.string().optional().describe('Direct URL to document content'),
        response_format: z
          .enum(['markdown', 'json'])
          .default('markdown')
          .describe('"markdown" (default) or "json"'),
      },
      // Deliberately no outputSchema: the spec lets a client treat the text block
      // as a mere serialization of structuredContent and render only the latter.
      // For this tool the text block IS the payload, so any structured metadata
      // would replace the document text with a handful of fields and the model
      // would never see the document.
      annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
    },
    async (args, extra) => {
      const { dokumentnummer, url: inputUrl, response_format } = args;

      if (!dokumentnummer && !inputUrl) {
        return createErrorResponse(
          '**Fehler:** Bitte gib entweder eine `dokumentnummer` oder eine `url` an.\n\n' +
            'Die Dokumentnummer findest du in den Suchergebnissen von `ris_bundesrecht`, ' +
            '`ris_landesrecht` oder `ris_judikatur`.',
        );
      }

      // SSRF protection: validate user-supplied URLs against domain allowlist
      if (inputUrl && !isAllowedUrl(inputUrl)) {
        return createErrorResponse(
          '**Fehler:** Die angegebene URL ist nicht erlaubt.\n\n' +
            'Nur HTTPS-URLs zu offiziellen RIS-Domains sind zulaessig ' +
            '(data.bka.gv.at, www.ris.bka.gv.at, ris.bka.gv.at).',
        );
      }

      try {
        let contentUrl = inputUrl;
        let htmlContent: string | undefined;
        let metadata: DocumentMetadata;

        if (dokumentnummer && !inputUrl) {
          // Strategy: Try direct URL construction first, fallback to search API
          const directResult = await getDocumentByNumber(dokumentnummer, undefined, extra.signal);

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
                apiResponse = await searchBundesrecht(searchParams, undefined, extra.signal);
                break;
              case 'Landesrecht':
                apiResponse = await searchLandesrecht(searchParams, undefined, extra.signal);
                break;
              case 'Sonstige':
                apiResponse = await searchSonstige(searchParams, undefined, extra.signal);
                break;
              case 'Bezirke':
                apiResponse = await searchBezirke(searchParams, undefined, extra.signal);
                break;
              case 'Judikatur':
              default:
                apiResponse = await searchJudikatur(searchParams, undefined, extra.signal);
                break;
            }

            // Find the document with matching dokumentnummer (don't blindly take first result)
            const findResult = findDocumentByDokumentnummer(apiResponse.documents, dokumentnummer);

            if (!findResult.success) {
              // Both direct fetch and search failed - provide helpful error
              const directError = directResult.error;
              if (findResult.error === 'no_documents') {
                return createErrorResponse(
                  `**Fehler:** Kein Dokument mit der Nummer \`${dokumentnummer}\` gefunden.\n\n` +
                    `Direkter Abruf: ${directError}\n` +
                    `Suche: Keine Ergebnisse.\n\n` +
                    'Bitte pruefe die Dokumentnummer oder verwende eine Suche, ' +
                    'um das gewuenschte Dokument zu finden.',
                );
              } else {
                return createErrorResponse(
                  `**Fehler:** Dokument \`${dokumentnummer}\` nicht gefunden.\n\n` +
                    `Direkter Abruf: ${directError}\n` +
                    `Suche: ${findResult.totalResults} Ergebnisse, aber keines mit dieser Dokumentnummer.\n\n` +
                    `Bitte verwende eine alternative Suche oder die direkte URL.`,
                );
              }
            }

            const doc = findResult.document;
            contentUrl = doc.content_urls.html ?? undefined;

            if (!contentUrl) {
              return createErrorResponse(
                `**Fehler:** Keine Inhalts-URL fuer Dokument \`${dokumentnummer}\` verfuegbar.\n\n` +
                  'Das Dokument hat moeglicherweise keinen abrufbaren Volltext.',
              );
            }

            // SSRF protection: this URL comes straight from the search API response
            // and would otherwise be fetched unchecked. Validate it against the same
            // domain allowlist used for user-supplied URLs.
            if (!isAllowedUrl(contentUrl)) {
              return createErrorResponse(
                '**Fehler:** Die Inhalts-URL des Dokuments ist nicht erlaubt.\n\n' +
                  'Nur HTTPS-URLs zu offiziellen RIS-Domains sind zulaessig ' +
                  '(data.bka.gv.at, www.ris.bka.gv.at, ris.bka.gv.at).',
              );
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
          return createErrorResponse('**Fehler:** Keine gueltige URL zum Abrufen des Dokuments.');
        }

        // Fetch document content if not already fetched via direct URL
        if (!htmlContent) {
          htmlContent = await getDocumentContent(contentUrl, undefined, extra.signal);
        }

        // Format the document
        const formatted = formatDocument(htmlContent, metadata, response_format);
        const result = truncateResponse(formatted);

        // The text stays the payload; the resource_link lets a client open the
        // untruncated original, which matters most for a truncated document.
        return {
          content: [
            { type: 'text' as const, text: result },
            {
              type: 'resource_link' as const,
              uri: contentUrl,
              name: dokumentnummer ?? metadata.titel ?? contentUrl,
              mimeType: 'text/html',
            },
          ],
        };
      } catch (e) {
        // A cancelled call has no reader left for a German error message; let the
        // abort propagate so the SDK drops the request.
        if (extra.signal.aborted) {
          throw e;
        }
        return createErrorResponse(formatErrorResponse(e));
      }
    },
  );
}
