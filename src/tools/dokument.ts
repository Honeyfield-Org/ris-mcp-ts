/**
 * Tool 7: ris_dokument — Retrieve full text of a legal document.
 */

import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { DocumentCache } from '../document-cache.js';
import { loadDocument } from '../document-loader.js';
import {
  CHARACTER_LIMIT,
  extractOutline,
  truncateResponse,
  type OutlineEntry,
} from '../formatting.js';
import { createErrorResponse, formatErrorResponse } from '../helpers.js';
import { DocumentOutputShape } from '../types.js';
import { VIEWER_WIDGET_META } from '../widgets.js';

/**
 * Characters of outline a response may carry alongside the document excerpt.
 *
 * Measured against the live API: a court decision's outline serialises to 361
 * characters, a consolidated statute's (ElWG, 612 650 characters, 499 headings)
 * to 38 123 — half again the excerpt it would travel with, in every client,
 * including every one that will never draw a navigation rail. Past this budget
 * the viewer earns the outline from the section call it is about to make anyway,
 * which carries it at no extra cost.
 */
const OUTLINE_BUDGET = CHARACTER_LIMIT / 4;

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
      // The structured payload carries the document text itself, byte for byte
      // the same string as the text block below. That is what makes declaring it
      // safe: a client that renders `structuredContent` in place of the text
      // block — the v1.3.0 finding — shows the same document rather than a
      // handful of metadata fields. See DocumentOutputShape.
      outputSchema: DocumentOutputShape,
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

        // Offsets in an outline address the markdown rendering, and the viewer
        // shows a rail only for a document too long for one response — so the
        // outline is worth carrying in exactly that case, within the budget
        // above, and is dead payload in every other.
        let outline: OutlineEntry[] | undefined;

        // Hand the viewer the very string this response was cut from, so its
        // first chunk call is a hit and its offsets address the text the reader
        // is looking at. Only the markdown rendering: the JSON one has a
        // completely different character distribution.
        if (response_format === 'markdown') {
          try {
            const extracted = extractOutline(html, text);
            if (
              text.length > CHARACTER_LIMIT &&
              JSON.stringify(extracted).length <= OUTLINE_BUDGET
            ) {
              outline = extracted;
            }

            cache.set(
              dokumentnummer ?? contentUrl,
              { text, outline: extracted, sourceUrl: contentUrl },
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
          // `text` is `result`, not a second rendering of it: the two blocks are
          // the same string, which is the whole safety argument for declaring an
          // outputSchema here at all. The identifiers let the viewer address the
          // document for further sections on a host that delivers neither the
          // content blocks nor the tool input to a widget.
          structuredContent: {
            ...(dokumentnummer === undefined ? {} : { dokumentnummer }),
            text: result,
            total_length: text.length,
            ...(outline === undefined ? {} : { outline }),
            source_url: contentUrl,
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
