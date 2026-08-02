/**
 * E2E tests for structured tool output over the MCP protocol.
 *
 * The 11 search tools declare an `outputSchema`, so the SDK validates the result
 * on both ends: the server refuses to answer a non-error call without
 * `structuredContent`, and the client re-validates it against the schema
 * advertised in `tools/list`. A successful `client.callTool()` here therefore
 * proves the payload round-trips and matches the declaration — a mismatch
 * surfaces as a thrown McpError.
 *
 * The two document tools declare a different shape rather than none: their
 * structured payload *is* the document text, so the client that renders
 * `structuredContent` in place of the text block — the v1.3.0 finding — shows
 * the same document. Neither emits anything but text blocks: a `resource_link`
 * on `ris_dokument` was measured to cost the widget its tool-result event in
 * claude.ai entirely (#52), and the URL it carried lives on in the text block
 * and in `structuredContent.source_url`.
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
  it('should declare an outputSchema on every search tool', async () => {
    const { tools } = await client.listTools();

    expect(tools).toHaveLength(13);
    // Both document tools are excluded: they declare a document shape rather
    // than a result list.
    const searchTools = tools.filter(
      (tool) => tool.name !== 'ris_dokument' && tool.name !== 'ris_dokument_abschnitt',
    );
    expect(searchTools).toHaveLength(11);
    for (const tool of searchTools) {
      expect(tool.outputSchema, `${tool.name} is missing an outputSchema`).toBeDefined();
    }
  });

  it('should declare the search result shape on the search tools', async () => {
    const { tools } = await client.listTools();
    const bundesrecht = tools.find((tool) => tool.name === 'ris_bundesrecht');

    const properties = bundesrecht?.outputSchema?.properties as Record<string, unknown>;
    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining(['total_hits', 'page', 'page_size', 'has_more', 'documents', 'query']),
    );
  });

  it('should declare the guaranteed tool key inside the query schema', async () => {
    const { tools } = await client.listTools();
    const bundesrecht = tools.find((tool) => tool.name === 'ris_bundesrecht');

    const properties = bundesrecht?.outputSchema?.properties as Record<string, unknown>;
    const query = properties.query as { properties?: Record<string, unknown>; required?: string[] };

    // #49 reads query.tool — it belongs in the contract, not only in prose.
    expect(Object.keys(query.properties ?? {})).toContain('tool');
    expect(query.required).toContain('tool');
  });

  it('should declare a text-carrying outputSchema on ris_dokument', async () => {
    const { tools } = await client.listTools();
    const dokument = tools.find((tool) => tool.name === 'ris_dokument');

    const properties = dokument?.outputSchema?.properties as Record<string, unknown>;
    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining(['text', 'total_length', 'dokumentnummer', 'source_url', 'outline']),
    );
    // The one field that makes the schema safe to declare at all.
    expect(dokument?.outputSchema?.required).toContain('text');
    // Not `next_offset`: the text block is a truncated rendering with a notice
    // appended, so its length is not an offset into the document.
    expect(Object.keys(properties)).not.toContain('next_offset');
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

  it('should echo the validated search arguments under query', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => okResponse(searchBody([documentReference('NOR40052761', DOCUMENT_HTML_URL)]))),
    );

    const result = await client.callTool({
      name: 'ris_bundesrecht',
      arguments: { suchworte: 'Eigentum', seite: 2 },
    });

    expect(result.structuredContent).toMatchObject({
      query: {
        tool: 'ris_bundesrecht',
        suchworte: 'Eigentum',
        seite: 2,
        // Zod defaults are part of the validated input, so the echo is
        // sufficient on its own to re-issue the call for another page.
        limit: 20,
        applikation: 'BrKons',
      },
    });
  });

  it('should carry no undefined placeholders in the query echo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => okResponse(searchBody([documentReference('NOR40052761', DOCUMENT_HTML_URL)]))),
    );

    const result = await client.callTool({
      name: 'ris_bundesrecht',
      arguments: { suchworte: 'Eigentum' },
    });

    const { query } = result.structuredContent as { query: Record<string, unknown> };
    expect(Object.values(query).every((value) => value !== undefined)).toBe(true);
    expect(query).not.toHaveProperty('titel');
    expect(query).not.toHaveProperty('paragraph');
  });

  it('should echo the tool name for a different search tool', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => okResponse(searchBody([]))),
    );

    const result = await client.callTool({
      name: 'ris_judikatur',
      arguments: { suchworte: 'Gewaehrleistung' },
    });

    expect(result.structuredContent).toMatchObject({
      query: { tool: 'ris_judikatur', suchworte: 'Gewaehrleistung' },
    });
  });

  it('should give every document a non-empty citation_display', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        okResponse(
          searchBody([
            documentReference('NOR40052761', DOCUMENT_HTML_URL),
            documentReference('NOR40052762', DOCUMENT_HTML_URL),
          ]),
        ),
      ),
    );

    const result = await client.callTool({
      name: 'ris_bundesrecht',
      arguments: { suchworte: 'Eigentum' },
    });

    const { documents } = result.structuredContent as {
      documents: { citation_display: string }[];
    };
    expect(documents).toHaveLength(2);
    for (const doc of documents) {
      expect(doc.citation_display).toBe('ABGB');
    }
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
// 3. ris_dokument: Text, and where the source URL lives instead of a link block
// =============================================================================

describe('ris_dokument text and source URL', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubDocument(html: string): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => okResponse(html)),
    );
  }

  it('should round-trip a structuredContent that repeats the text block', async () => {
    stubDocument('<html><body><p>Kurzer Text</p></body></html>');

    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR40052761' },
    });

    // Reaching here at all proves the payload validates against the schema the
    // client read from tools/list — a mismatch throws an McpError.
    expect(result.isError).not.toBe(true);
    expect((result.structuredContent as { text: string }).text).toBe(
      (result.content as { text: string }[])[0].text,
    );
  });

  it('should deliver the document text itself in the text block', async () => {
    stubDocument(
      '<html><body><p>Der Eigentuemer darf mit seiner Sache verfahren.</p></body></html>',
    );

    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR40052761' },
    });

    expect(result.isError).not.toBe(true);
    expect(getContent(result)[0].text).toContain(
      'Der Eigentuemer darf mit seiner Sache verfahren.',
    );
  });

  it('should emit no resource_link, whatever the document', async () => {
    stubDocument('<html><body><p>Kurzer Text</p></body></html>');

    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR40052761' },
    });

    // Measured live: claude.ai delivers a widget no tool-result event at all
    // when the result carries a resource_link, so the viewer sat on its
    // degradation notice while the trefferliste rendered in the same
    // conversation. Reversible once the host stops swallowing it.
    expect(getResourceLink(result)).toBeUndefined();
    expect(getContent(result).map((block) => block.type)).toEqual(['text']);
  });

  it('should name the canonical document URL in both surviving carriers', async () => {
    stubDocument('<html><body><p>Kurzer Text</p></body></html>');

    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR40052761' },
    });

    const url = (result.structuredContent as { source_url: string }).source_url;
    expect(url).toContain('NOR40052761');
    expect(url.startsWith('https://')).toBe(true);
    expect(getContent(result)[0].text).toContain(`**Quelle:** [${url}](${url})`);
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

  it('should echo the requested URL when the document was requested by URL', async () => {
    stubDocument('<html><body><p>Kurzer Text</p></body></html>');
    const url = 'https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR12345678/inhalt.html';

    const result = await client.callTool({ name: 'ris_dokument', arguments: { url } });

    expect(result.isError).not.toBe(true);
    expect((result.structuredContent as { source_url: string }).source_url).toBe(url);
    expect(getResourceLink(result)).toBeUndefined();
  });

  it('should still name the full document when the text was truncated', async () => {
    stubDocument(`<html><body><p>${'Paragraf. '.repeat(4000)}</p></body></html>`);

    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR40052761' },
    });

    // The truncated case is the one where the pointer to the untruncated
    // original matters most, so it is the one worth pinning twice — and the
    // text carrier needs pinning here in particular, because `**Quelle:**` sits
    // in the metadata header *before* `## Inhalt` (formatting.ts). That
    // ordering is what keeps truncation from eating the link, and it is the
    // invariant the dropped resource_link used to backstop.
    expect(result.isError).not.toBe(true);
    expect(getContent(result)[0].text).toContain('Antwort gekuerzt');
    expect(getContent(result)[0].text).toContain('**Quelle:**');
    expect((result.structuredContent as { source_url: string }).source_url).toContain(
      'NOR40052761',
    );
    expect(getResourceLink(result)).toBeUndefined();
  });

  it('should return text only — no link — on an error', async () => {
    const result = await client.callTool({ name: 'ris_dokument', arguments: {} });

    expect(result.isError).toBe(true);
    expect(getResourceLink(result)).toBeUndefined();
    expect(getContent(result).every((block) => block.type === 'text')).toBe(true);
  });

  it('should return text only when the requested URL is rejected by the allowlist', async () => {
    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { url: 'https://evil.example.com/doc.html' },
    });

    expect(result.isError).toBe(true);
    expect(getResourceLink(result)).toBeUndefined();
  });
});
