/**
 * E2E tests for structured tool output over the MCP protocol.
 *
 * Every tool declares an `outputSchema`, so the SDK validates the result on both
 * ends: the server refuses to answer a non-error call without `structuredContent`,
 * and the client re-validates it against the schema advertised in `tools/list`.
 * A successful `client.callTool()` here therefore proves the payload round-trips
 * and matches the declaration — a mismatch surfaces as a thrown McpError.
 *
 * `ris_dokument` additionally returns a `resource_link` block so clients can open
 * the canonical RIS document instead of re-parsing the text.
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

  // The client only validates structured output for tools it has seen in
  // tools/list — this call installs the output validators.
  await client.listTools();
});

afterAll(async () => {
  await client.close();
  await server.close();
});

/** Content blocks as they arrive over the wire, before narrowing by `type`. */
interface WireContentBlock {
  type: string;
  text?: string;
  uri?: string;
  name?: string;
  mimeType?: string;
}

function getContent(result: Awaited<ReturnType<typeof client.callTool>>): WireContentBlock[] {
  return result.content as WireContentBlock[];
}

function getResourceLink(
  result: Awaited<ReturnType<typeof client.callTool>>,
): WireContentBlock | undefined {
  return getContent(result).find((block) => block.type === 'resource_link');
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

function documentReference(id: string, htmlUrl: string) {
  return {
    Data: {
      Metadaten: {
        Technisch: { ID: id, Applikation: 'BrKons' },
        Bundesrecht: { Kurztitel: 'ABGB', Langtitel: 'Allgemeines buergerliches Gesetzbuch' },
      },
      Dokumentliste: {
        ContentReference: {
          ContentType: 'MainDocument',
          Urls: { ContentUrl: [{ DataType: 'Html', Url: htmlUrl }] },
        },
      },
    },
  };
}

const okResponse = (text: string) =>
  Promise.resolve({ ok: true, text: () => Promise.resolve(text) });

const DOCUMENT_HTML_URL = 'https://ris.bka.gv.at/Dokumente/Bundesnormen/x.html';

// =============================================================================
// 1. Tool Declarations
// =============================================================================

describe('tool output schema declarations', () => {
  it('should declare an outputSchema on every registered tool', async () => {
    const { tools } = await client.listTools();

    expect(tools).toHaveLength(12);
    for (const tool of tools) {
      expect(tool.outputSchema, `${tool.name} is missing an outputSchema`).toBeDefined();
    }
  });

  it('should declare the search result shape on the search tools', async () => {
    const { tools } = await client.listTools();
    const bundesrecht = tools.find((tool) => tool.name === 'ris_bundesrecht');

    const properties = bundesrecht?.outputSchema?.properties as Record<string, unknown>;
    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining(['total_hits', 'page', 'page_size', 'has_more', 'documents']),
    );
  });

  it('should declare document metadata — not the document text — on ris_dokument', async () => {
    const { tools } = await client.listTools();
    const dokument = tools.find((tool) => tool.name === 'ris_dokument');

    const properties = dokument?.outputSchema?.properties as Record<string, unknown>;
    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining(['dokumentnummer', 'quelle_url', 'laenge', 'gekuerzt']),
    );
    expect(properties).not.toHaveProperty('inhalt');
  });
});

// =============================================================================
// 2. Search Tools: Validated Round-Trip
// =============================================================================

describe('search tool structured content', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should return structuredContent the SDK validated against the declared schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => okResponse(searchBody([documentReference('NOR40052761', DOCUMENT_HTML_URL)]))),
    );

    const result = await client.callTool({
      name: 'ris_bundesrecht',
      arguments: { suchworte: 'Eigentum' },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      total_hits: 1,
      page: 1,
      page_size: 10,
      has_more: false,
    });

    const { documents } = result.structuredContent as { documents: { titel: string }[] };
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({ dokumentnummer: 'NOR40052761', kurztitel: 'ABGB' });
  });

  it('should keep the markdown text alongside the structured payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => okResponse(searchBody([documentReference('NOR40052761', DOCUMENT_HTML_URL)]))),
    );

    const result = await client.callTool({
      name: 'ris_bundesrecht',
      arguments: { suchworte: 'Eigentum' },
    });

    expect(getContent(result)[0]).toMatchObject({ type: 'text' });
    expect(getContent(result)[0].text).toContain('**Gefunden: 1 Treffer**');
  });

  it('should return structuredContent for a search without hits', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => okResponse(searchBody([]))),
    );

    const result = await client.callTool({
      name: 'ris_judikatur',
      arguments: { suchworte: 'Wortohnetreffer' },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ total_hits: 0, has_more: false });
  });

  it('should omit structuredContent on an error result without failing validation', async () => {
    const result = await client.callTool({ name: 'ris_bundesrecht', arguments: {} });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  it('should omit structuredContent when the upstream RIS request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('socket hang up'))),
    );

    const result = await client.callTool({
      name: 'ris_bundesrecht',
      arguments: { suchworte: 'Eigentum' },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });
});

// =============================================================================
// 3. ris_dokument: Metadata + Resource Link
// =============================================================================

describe('ris_dokument structured content and resource link', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubDocument(html: string): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => okResponse(html)),
    );
  }

  it('should return metadata about the document', async () => {
    stubDocument(
      '<html><body><p>Der Eigentuemer darf mit seiner Sache verfahren.</p></body></html>',
    );

    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR40052761' },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      dokumentnummer: 'NOR40052761',
      gekuerzt: false,
    });

    const { quelle_url, laenge } = result.structuredContent as {
      quelle_url: string;
      laenge: number;
    };
    expect(quelle_url).toContain('NOR40052761');
    expect(quelle_url.startsWith('https://')).toBe(true);
    expect(laenge).toBe(getContent(result)[0].text?.length);
  });

  it('should not duplicate the document text into structuredContent', async () => {
    stubDocument(
      '<html><body><p>Der Eigentuemer darf mit seiner Sache verfahren.</p></body></html>',
    );

    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR40052761' },
    });

    expect(JSON.stringify(result.structuredContent)).not.toContain('Eigentuemer');
    expect(getContent(result)[0].text).toContain('Eigentuemer');
  });

  it('should emit a resource_link pointing at the canonical document URL', async () => {
    stubDocument('<html><body><p>Kurzer Text</p></body></html>');

    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR40052761' },
    });

    const link = getResourceLink(result);
    expect(link).toBeDefined();
    expect(link?.uri).toBe((result.structuredContent as { quelle_url: string }).quelle_url);
    expect(link?.name).toBe('NOR40052761');
    expect(link?.mimeType).toBe('text/html');
  });

  it('should keep the text block first so text-only clients are unaffected', async () => {
    stubDocument('<html><body><p>Kurzer Text</p></body></html>');

    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR40052761' },
    });

    expect(getContent(result)[0].type).toBe('text');
    expect(getContent(result)[0].text).toContain('## Inhalt');
  });

  it('should omit dokumentnummer when the document was requested by URL', async () => {
    stubDocument('<html><body><p>Kurzer Text</p></body></html>');
    const url = 'https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR12345678/inhalt.html';

    const result = await client.callTool({ name: 'ris_dokument', arguments: { url } });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ quelle_url: url, gekuerzt: false });
    expect(
      (result.structuredContent as { dokumentnummer?: string }).dokumentnummer,
    ).toBeUndefined();
    expect(getResourceLink(result)?.uri).toBe(url);
  });

  it('should report gekuerzt: true for a truncated document', async () => {
    stubDocument(`<html><body><p>${'Paragraf. '.repeat(4000)}</p></body></html>`);

    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR40052761' },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ gekuerzt: true });
    expect(getContent(result)[0].text).toContain('Antwort gekuerzt');
  });

  it('should return text only — no link, no structuredContent — on an error', async () => {
    const result = await client.callTool({ name: 'ris_dokument', arguments: {} });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(getResourceLink(result)).toBeUndefined();
    expect(getContent(result).every((block) => block.type === 'text')).toBe(true);
  });

  it('should return text only when the requested URL is rejected by the allowlist', async () => {
    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { url: 'https://evil.example.com/doc.html' },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(getResourceLink(result)).toBeUndefined();
  });
});
