/**
 * Tool 13: ris_dokument_abschnitt — one section of an open document.
 *
 * The document viewer renders a document that can run to a quarter of a million
 * characters, far past what a single tool response may carry. This tool serves
 * the rest of it section by section, addressed by character offset into the very
 * text `ris_dokument` produced.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { DocumentCache } from '../document-cache.js';
import { loadDocument } from '../document-loader.js';
import { chunkResponse, extractOutline } from '../formatting.js';
import { createErrorResponse, formatErrorResponse } from '../helpers.js';
import { DocumentChunkOutputShape } from '../types.js';
import { DOCUMENT_CHUNK_META } from '../widgets.js';

export function registerDokumentAbschnittTool(server: McpServer, cache: DocumentCache): void {
  server.registerTool(
    'ris_dokument_abschnitt',
    {
      title: 'Dokumentabschnitt',
      description:
        'Return one section of a document already open in the RIS document viewer. ' +
        'Intended for the viewer widget, not for direct use — for the full text of a ' +
        'document use `ris_dokument`.',
      inputSchema: {
        dokumentnummer: z
          .string()
          .optional()
          .describe(
            'RIS document number of the open document - from the ris_dokument call that opened it',
          ),
        url: z
          .string()
          .optional()
          .describe(
            'Direct URL of the open document, for documents opened by URL rather than by number',
          ),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe(
            'Character offset into the document text; 0 returns the first section and the outline',
          ),
      },
      outputSchema: DocumentChunkOutputShape,
      annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
      _meta: DOCUMENT_CHUNK_META,
    },
    async (args, extra) => {
      const { dokumentnummer, url: inputUrl, offset } = args;

      try {
        // Either identifier finds the document: the cache carries both, because
        // nothing says the viewer holds the one it was opened with. A miss on
        // the crossing would still answer correctly, just with a fetch per
        // section.
        const key = dokumentnummer ?? inputUrl;
        let cached = key === undefined ? undefined : cache.get(key);

        if (!cached) {
          // Same load path as ris_dokument, which is what makes the offsets the
          // viewer holds address the same text. It also carries the validation:
          // the missing-identifier case, the Dokumentnummer check and the SSRF
          // allowlist for `url`.
          const loaded = await loadDocument(
            { dokumentnummer, url: inputUrl, responseFormat: 'markdown' },
            extra.signal,
          );

          if (!loaded.success) {
            return createErrorResponse(loaded.error);
          }

          const { text, html, contentUrl } = loaded.document;
          cached = { text, outline: extractOutline(html, text), sourceUrl: contentUrl };
          cache.set(dokumentnummer ?? contentUrl, cached, contentUrl);
        }

        const chunk = chunkResponse(cached.text, offset);

        return {
          content: [{ type: 'text' as const, text: chunk.text }],
          structuredContent: {
            ...(dokumentnummer === undefined ? {} : { dokumentnummer }),
            text: chunk.text,
            total_length: chunk.total_length,
            next_offset: chunk.next_offset,
            // The outline describes the whole document, so it rides along with
            // the section that opens it rather than with every one of them.
            ...(offset === 0 ? { outline: cached.outline } : {}),
            source_url: cached.sourceUrl,
          },
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
