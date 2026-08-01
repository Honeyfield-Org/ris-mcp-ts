/**
 * Tests for tool-level error signalling in the shared helpers.
 *
 * Per the MCP spec, errors during tool execution are reported inside the result
 * with `isError: true` (not as JSON-RPC protocol errors), so the model sees the
 * message and can self-correct. These tests pin the flag to the error paths and
 * guard the success paths — an empty search result is a successful search.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

import { RISAPIError, RISParsingError, RISTimeoutError } from '../client.js';
import {
  createMcpResponse,
  createValidationErrorResponse,
  executeSearchTool,
  formatErrorResponse,
} from '../helpers.js';
import { SearchResultOutputShape, type Document, type NormalizedSearchResults } from '../types.js';

// =============================================================================
// Test Helpers
// =============================================================================

/** Stand-in for the echo a real handler builds via buildQueryEcho(). */
const QUERY_ECHO = { tool: 'ris_bundesrecht', suchworte: 'Eigentum' };

/** Minimal raw document reference accepted by the parser. */
function createRawDocument(id: string) {
  return {
    Data: {
      Metadaten: {
        Technisch: { ID: id, Applikation: 'BrKons' },
        Bundesrecht: { Kurztitel: 'ABGB', Langtitel: 'Allgemeines buergerliches Gesetzbuch' },
      },
      Dokumentliste: {
        ContentReference: {
          ContentType: 'MainDocument',
          Urls: {
            ContentUrl: [{ DataType: 'Html', Url: 'https://www.ris.bka.gv.at/Dokumente/x.html' }],
          },
        },
      },
    },
  };
}

function createNormalizedResults(documentCount: number): NormalizedSearchResults {
  return {
    hits: documentCount,
    page_number: 1,
    page_size: 20,
    documents: Array.from({ length: documentCount }, (_, i) =>
      createRawDocument(`NOR4005276${i}`),
    ) as NormalizedSearchResults['documents'],
  };
}

// =============================================================================
// Validation Errors
// =============================================================================

describe('createValidationErrorResponse', () => {
  it('should flag the missing-parameter response as a tool error', () => {
    const response = createValidationErrorResponse(['suchworte` fuer Volltextsuche']);

    expect(response.isError).toBe(true);
  });

  it('should keep the German error prose unchanged', () => {
    const response = createValidationErrorResponse([
      'suchworte` fuer Volltextsuche',
      'titel` fuer Suche in Gesetzesnamen',
    ]);

    expect(response.content[0].text).toContain(
      '**Fehler:** Bitte gib mindestens einen Suchparameter an:',
    );
    expect(response.content[0].text).toContain('- `suchworte` fuer Volltextsuche');
    expect(response.content[0].text).toContain('- `titel` fuer Suche in Gesetzesnamen');
  });
});

describe('createMcpResponse', () => {
  it('should not flag a normal response as an error', () => {
    const response = createMcpResponse('Alles in Ordnung');

    expect(response.isError).toBeUndefined();
  });
});

// =============================================================================
// Search Execution: Error Paths
// =============================================================================

describe('executeSearchTool error handling', () => {
  const cases: [label: string, error: unknown][] = [
    ['RISTimeoutError', new RISTimeoutError()],
    ['RISParsingError', new RISParsingError('Unerwartetes Token', new Error('boom'))],
    ['RISAPIError', new RISAPIError('Internal Server Error', 500)],
    ['unknown Error', new Error('irgendwas')],
    ['non-Error throwable', 'kaputt'],
  ];

  it.each(cases)('should flag a %s from the API as a tool error', async (_label, error) => {
    const searchFn = vi.fn().mockRejectedValue(error);

    const response = await executeSearchTool(searchFn, {}, 'markdown', undefined, QUERY_ECHO);

    expect(response.isError).toBe(true);
  });

  it.each(cases)('should keep the German error prose for a %s', async (_label, error) => {
    const searchFn = vi.fn().mockRejectedValue(error);

    const response = await executeSearchTool(searchFn, {}, 'markdown', undefined, QUERY_ECHO);

    expect(response.content[0].text).toBe(formatErrorResponse(error));
    expect(response.content[0].text).toContain('**Fehler:**');
  });
});

// =============================================================================
// Search Execution: Success Paths (must NOT be flagged)
// =============================================================================

describe('executeSearchTool success handling', () => {
  it('should not flag a search with zero hits as an error', async () => {
    const searchFn = vi.fn().mockResolvedValue(createNormalizedResults(0));

    const response = await executeSearchTool(searchFn, {}, 'markdown', undefined, QUERY_ECHO);

    expect(response.content[0].text).toContain('Keine Dokumente gefunden');
    expect(response.isError).toBeUndefined();
  });

  it('should not flag a search with results as an error', async () => {
    const searchFn = vi.fn().mockResolvedValue(createNormalizedResults(3));

    const response = await executeSearchTool(searchFn, {}, 'markdown', undefined, QUERY_ECHO);

    expect(response.isError).toBeUndefined();
  });

  it('should not flag a zero-hit JSON response as an error', async () => {
    const searchFn = vi.fn().mockResolvedValue(createNormalizedResults(0));

    const response = await executeSearchTool(searchFn, {}, 'json', undefined, QUERY_ECHO);

    expect(response.isError).toBeUndefined();
  });
});

// =============================================================================
// Search Execution: Structured Content
// =============================================================================

const SearchResultOutputSchema = z.object(SearchResultOutputShape);

/** Read structuredContent as the search payload it is declared to be. */
function structuredSearchResult(structuredContent: unknown) {
  return structuredContent as { documents: Document[] } & Record<string, unknown>;
}

describe('executeSearchTool structured content', () => {
  it('should mirror the parsed search result in structuredContent', async () => {
    const searchFn = vi.fn().mockResolvedValue(createNormalizedResults(2));

    const response = await executeSearchTool(searchFn, {}, 'markdown', undefined, QUERY_ECHO);

    expect(response.structuredContent).toMatchObject({
      total_hits: 2,
      page: 1,
      page_size: 20,
      has_more: false,
    });
    expect(structuredSearchResult(response.structuredContent).documents).toHaveLength(2);
  });

  it('should carry the parsed document fields, not the formatted text', async () => {
    const searchFn = vi.fn().mockResolvedValue(createNormalizedResults(1));

    const response = await executeSearchTool(searchFn, {}, 'markdown', undefined, QUERY_ECHO);

    const [document] = structuredSearchResult(response.structuredContent).documents;
    expect(document.dokumentnummer).toBe('NOR40052760');
    expect(document.kurztitel).toBe('ABGB');
    expect(document.content_urls.html).toBe('https://www.ris.bka.gv.at/Dokumente/x.html');
  });

  it('should satisfy the declared output schema', async () => {
    const searchFn = vi.fn().mockResolvedValue(createNormalizedResults(3));

    const response = await executeSearchTool(searchFn, {}, 'markdown', undefined, QUERY_ECHO);

    expect(SearchResultOutputSchema.safeParse(response.structuredContent).success).toBe(true);
  });

  it('should emit structuredContent for a zero-hit search', async () => {
    const searchFn = vi.fn().mockResolvedValue(createNormalizedResults(0));

    const response = await executeSearchTool(searchFn, {}, 'markdown', undefined, QUERY_ECHO);

    expect(response.structuredContent).toMatchObject({ total_hits: 0, has_more: false });
    expect(structuredSearchResult(response.structuredContent).documents).toHaveLength(0);
  });

  it('should emit the same structuredContent for the json response format', async () => {
    const searchFn = vi.fn().mockResolvedValue(createNormalizedResults(2));

    const markdown = await executeSearchTool(searchFn, {}, 'markdown', undefined, QUERY_ECHO);
    const json = await executeSearchTool(searchFn, {}, 'json', undefined, QUERY_ECHO);

    expect(json.structuredContent).toEqual(markdown.structuredContent);
  });

  it('should keep the text content unchanged for backwards compatibility', async () => {
    const searchFn = vi.fn().mockResolvedValue(createNormalizedResults(2));

    const response = await executeSearchTool(searchFn, {}, 'markdown', undefined, QUERY_ECHO);

    expect(response.content[0].text).toContain('**Gefunden: 2 Treffer**');
    expect(response.content[0].text).toContain('Dokumentnummer: NOR40052760');
  });

  it('should not attach structuredContent to an error result', async () => {
    const searchFn = vi.fn().mockRejectedValue(new RISTimeoutError());

    const response = await executeSearchTool(searchFn, {}, 'markdown', undefined, QUERY_ECHO);

    expect(response.isError).toBe(true);
    expect(response.structuredContent).toBeUndefined();
  });

  it('should always attach the query echo, never a bare search result', async () => {
    const searchFn = vi.fn().mockResolvedValue(createNormalizedResults(1));

    const response = await executeSearchTool(searchFn, {}, 'markdown', undefined, QUERY_ECHO);

    expect(response.structuredContent?.query).toEqual(QUERY_ECHO);
  });

  it('should reject a query echo without a tool name', () => {
    const result = SearchResultOutputSchema.safeParse({
      total_hits: 0,
      page: 1,
      page_size: 20,
      has_more: false,
      documents: [],
      query: { suchworte: 'Eigentum' },
    });

    expect(result.success).toBe(false);
  });

  it('should accept arbitrary further keys in the query echo', () => {
    const result = SearchResultOutputSchema.safeParse({
      total_hits: 0,
      page: 1,
      page_size: 20,
      has_more: false,
      documents: [],
      // Each tool has its own parameter vocabulary, so only `tool` is fixed.
      query: { tool: 'ris_sonstige', applikation: 'Mrp', sitzungsnummer: 12, seite: 3 },
    });

    expect(result.success).toBe(true);
  });

  it('should accept pagination values the RIS API reports outside the expected range', async () => {
    // The declared output schema must not be stricter than what the upstream API
    // can actually produce: page_size is read straight from the response and a
    // schema violation here would turn a usable answer into a protocol error.
    const searchFn = vi.fn().mockResolvedValue({
      hits: 0,
      page_number: 1,
      page_size: 0,
      documents: [],
    } satisfies NormalizedSearchResults);

    const response = await executeSearchTool(searchFn, {}, 'markdown', undefined, QUERY_ECHO);

    expect(response.isError).toBeUndefined();
    expect(SearchResultOutputSchema.safeParse(response.structuredContent).success).toBe(true);
  });
});
