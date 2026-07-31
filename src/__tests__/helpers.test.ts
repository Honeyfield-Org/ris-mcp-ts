/**
 * Tests for tool-level error signalling in the shared helpers.
 *
 * Per the MCP spec, errors during tool execution are reported inside the result
 * with `isError: true` (not as JSON-RPC protocol errors), so the model sees the
 * message and can self-correct. These tests pin the flag to the error paths and
 * guard the success paths — an empty search result is a successful search.
 */

import { describe, it, expect, vi } from 'vitest';

import { RISAPIError, RISParsingError, RISTimeoutError } from '../client.js';
import {
  createMcpResponse,
  createValidationErrorResponse,
  executeSearchTool,
  formatErrorResponse,
} from '../helpers.js';
import type { NormalizedSearchResults } from '../types.js';

// =============================================================================
// Test Helpers
// =============================================================================

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

    const response = await executeSearchTool(searchFn, {}, 'markdown');

    expect(response.isError).toBe(true);
  });

  it.each(cases)('should keep the German error prose for a %s', async (_label, error) => {
    const searchFn = vi.fn().mockRejectedValue(error);

    const response = await executeSearchTool(searchFn, {}, 'markdown');

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

    const response = await executeSearchTool(searchFn, {}, 'markdown');

    expect(response.content[0].text).toContain('Keine Dokumente gefunden');
    expect(response.isError).toBeUndefined();
  });

  it('should not flag a search with results as an error', async () => {
    const searchFn = vi.fn().mockResolvedValue(createNormalizedResults(3));

    const response = await executeSearchTool(searchFn, {}, 'markdown');

    expect(response.isError).toBeUndefined();
  });

  it('should not flag a zero-hit JSON response as an error', async () => {
    const searchFn = vi.fn().mockResolvedValue(createNormalizedResults(0));

    const response = await executeSearchTool(searchFn, {}, 'json');

    expect(response.isError).toBeUndefined();
  });
});
