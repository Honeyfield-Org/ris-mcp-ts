/**
 * Tool 7: ris_dokument — Retrieve full text of a legal document.
 */

import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { DocumentCache } from '../document-cache.js';
import { loadDocument } from '../document-loader.js';
import { extractOutline, truncateResponse } from '../formatting.js';
import { createErrorResponse, formatErrorResponse } from '../helpers.js';
import { VIEWER_WIDGET_META } from '../widgets.js';

export function registerDokumentTool(server: McpServer, cache: DocumentCache): void {
  // registerAppTool only normalises the UI metadata on the descriptor — it
  // mirrors `_meta.ui.resourceUri` onto the legacy flat key — and passes the
  // handler through untouched. The response below is unchanged by it, which
  // dokument-snapshot.e2e.test.ts pins byte for byte.
  registerAppTool(
    server,
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
      _meta: VIEWER_WIDGET_META,
    },
    async (args, extra) => {
      const { dokumentnummer, url: inputUrl, response_format } = args;

      try {
        const loaded = await loadDocument(
          { dokumentnummer, url: inputUrl, responseFormat: response_format },
          extra.signal,
        );

        if (!loaded.success) {
          return createErrorResponse(loaded.error);
        }

        const { text, html, contentUrl, metadata } = loaded.document;

        // Hand the viewer the very string this response was cut from, so its
        // first chunk call is a hit and its offsets address the text the reader
        // is looking at. Only the markdown rendering: the JSON one has a
        // completely different character distribution.
        if (response_format === 'markdown') {
          try {
            cache.set(
              dokumentnummer ?? contentUrl,
              { text, outline: extractOutline(html, text), sourceUrl: contentUrl },
              contentUrl,
            );
          } catch (e) {
            // The text path is mandatory: a failed cache write costs a later
            // cache miss and nothing else, so it must never turn a document that
            // was fetched successfully into an error response.
            console.error('Dokument-Cache konnte nicht befuellt werden:', e);
          }
        }

        const result = truncateResponse(text);

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
