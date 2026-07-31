/**
 * E2E tests for tool-level error signalling over the MCP protocol.
 *
 * Every failure a tool handler reports itself — missing arguments, a document
 * that cannot be found, an upstream RIS failure — must come back as a result
 * with `isError: true` so clients and models can tell success from failure
 * without parsing German prose. Successful results (including searches with
 * zero hits and truncated documents) must stay unflagged.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

import { server } from '../server.js';

// =============================================================================
// Setup: MCP Client connected to server via InMemoryTransport
// =============================================================================

let client: Client;
let clientTransport: InMemoryTransport;
let serverTransport: InMemoryTransport;

beforeAll(async () => {
  [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  client = new Client({ name: 'test-client', version: '1.0.0' });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await server.close();
});

/** Helper to extract text from MCP tool response */
function getResponseText(result: Awaited<ReturnType<typeof client.callTool>>): string {
  const content = result.content as { type: string; text: string }[];
  return content[0]?.text ?? '';
}

/** Search API response body with the given document references. */
function searchBody(documents: unknown[]): string {
  return JSON.stringify({
    OgdSearchResult: {
      OgdDocumentResults: {
        Hits: { '#text': String(documents.length), '@pageNumber': '1', '@pageSize': '10' },
        OgdDocumentReference: documents,
      },
    },
  });
}

/** Minimal document reference; omit `htmlUrl` to simulate a document without full text. */
function documentReference(id: string, htmlUrl?: string) {
  return {
    Data: {
      Metadaten: { Technisch: { ID: id, Applikation: 'BrKons' } },
      Dokumentliste: {
        ContentReference: {
          ContentType: 'MainDocument',
          Urls: htmlUrl ? { ContentUrl: [{ DataType: 'Html', Url: htmlUrl }] } : {},
        },
      },
    },
  };
}

const okResponse = (text: string) =>
  Promise.resolve({ ok: true, text: () => Promise.resolve(text) });
const notFoundResponse = () =>
  Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('not found') });

// =============================================================================
// 1. Argument Validation Errors (no network involved)
// =============================================================================

describe('handler-level argument validation', () => {
  it('should flag a search without any search parameter as an error', async () => {
    const result = await client.callTool({ name: 'ris_bundesrecht', arguments: {} });

    expect(result.isError).toBe(true);
    expect(getResponseText(result)).toContain('Bitte gib mindestens einen Suchparameter an');
  });

  it('should flag ris_judikatur without any search parameter as an error', async () => {
    const result = await client.callTool({ name: 'ris_judikatur', arguments: {} });

    expect(result.isError).toBe(true);
  });

  it('should flag ris_sonstige without any search parameter as an error', async () => {
    const result = await client.callTool({
      name: 'ris_sonstige',
      arguments: { applikation: 'Mrp' },
    });

    expect(result.isError).toBe(true);
  });
});

// =============================================================================
// 2. Document Lookup Failures
// =============================================================================

describe('ris_dokument lookup failures', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  /** Route fetches: direct document URL always 404s, search returns `documents`. */
  function stubFetch(documents: unknown[]): void {
    mockFetch = vi.fn((input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/Dokumente/')) {
        return notFoundResponse();
      }

      return okResponse(searchBody(documents));
    });
    vi.stubGlobal('fetch', mockFetch);
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should flag an empty search fallback as an error', async () => {
    stubFetch([]);

    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR40052761' },
    });

    expect(result.isError).toBe(true);
    expect(getResponseText(result)).toContain('Kein Dokument mit der Nummer');
  });

  it('should flag a search hit with a different dokumentnummer as an error', async () => {
    stubFetch([documentReference('NOR99999999', 'https://ris.bka.gv.at/Dokumente/x.html')]);

    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR40052761' },
    });

    expect(result.isError).toBe(true);
    expect(getResponseText(result)).toContain('nicht gefunden');
  });

  it('should flag a document without content URL as an error', async () => {
    stubFetch([documentReference('NOR40052761')]);

    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR40052761' },
    });

    expect(result.isError).toBe(true);
    expect(getResponseText(result)).toContain('Keine Inhalts-URL');
  });
});

// =============================================================================
// 3. Upstream RIS Failures
// =============================================================================

describe('upstream RIS failures', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should flag a failing search API request as an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('socket hang up'))),
    );

    const result = await client.callTool({
      name: 'ris_bundesrecht',
      arguments: { suchworte: 'Eigentum' },
    });

    expect(result.isError).toBe(true);
    expect(getResponseText(result)).toContain('**Fehler:**');
  });

  it('should flag a failing document fetch as an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL) => {
        const url = typeof input === 'string' ? input : input.toString();

        if (url.includes('/Dokumente/')) {
          return notFoundResponse();
        }

        return okResponse(
          searchBody([
            documentReference('NOR40052761', 'https://ris.bka.gv.at/Dokumente/Bundesnormen/x.html'),
          ]),
        );
      }),
    );

    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR40052761' },
    });

    expect(result.isError).toBe(true);
  });

  it('should flag an unparseable search response as an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => okResponse('<html>not json</html>')),
    );

    const result = await client.callTool({
      name: 'ris_bundesrecht',
      arguments: { suchworte: 'Eigentum' },
    });

    expect(result.isError).toBe(true);
    expect(getResponseText(result)).toContain('**Fehler:**');
  });
});

// =============================================================================
// 4. Successful Results Must Stay Unflagged
// =============================================================================

describe('successful results are not flagged', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should not flag a search with zero hits', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => okResponse(searchBody([]))),
    );

    const result = await client.callTool({
      name: 'ris_bundesrecht',
      arguments: { suchworte: 'Wortohnetreffer' },
    });

    expect(result.isError).not.toBe(true);
    expect(getResponseText(result)).toContain('Keine Dokumente gefunden');
  });

  it('should not flag a search with hits', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        okResponse(
          searchBody([
            documentReference('NOR40052761', 'https://ris.bka.gv.at/Dokumente/Bundesnormen/x.html'),
          ]),
        ),
      ),
    );

    const result = await client.callTool({
      name: 'ris_bundesrecht',
      arguments: { suchworte: 'Eigentum' },
    });

    expect(result.isError).not.toBe(true);
  });

  it('should not flag a truncated long document', async () => {
    const longHtml = `<html><body><p>${'Paragraf. '.repeat(4000)}</p></body></html>`;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => okResponse(longHtml)),
    );

    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR40052761' },
    });

    expect(result.isError).not.toBe(true);
    expect(getResponseText(result)).toContain('Antwort gekuerzt');
  });
});
