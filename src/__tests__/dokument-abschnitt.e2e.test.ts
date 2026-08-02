/**
 * E2E tests for `ris_dokument_abschnitt`, the document viewer's chunk tool
 * (issue #51).
 *
 * These go through a real Client over InMemoryTransport rather than calling the
 * handler, because two of the properties under test only exist on the wire: the
 * `_meta` the host reads, and the SDK's validation of `structuredContent`
 * against the declared `outputSchema` on both ends.
 *
 * Each test gets its own `McpServer`, and with it its own document cache — the
 * cache is a closure over `registerAllTools()`, which is exactly how a session
 * gets one on HTTP. `fetch` is stubbed and counted: "a cache hit costs no RIS
 * request" is the claim the whole design rests on, and counting the calls is the
 * only way to see the difference between a hit and a fast miss.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { loadDocument } from '../document-loader.js';
import { registerAllTools } from '../tools/index.js';

// =============================================================================
// Setup
// =============================================================================

let client: Client;
let server: McpServer;
/** Every URL the server fetched, in order — the RIS load the cache is meant to remove. */
let fetched: string[];

/**
 * A document whose markdown rendering is well past the 25 000-character limit,
 * so it actually pages. The heading structure mirrors a RIS record: field
 * labels on h1, structure below.
 */
function longDocumentHtml(marker: string): string {
  const paragraphs = Array.from(
    { length: 40 },
    (_, i) =>
      `<h2 class="UeberschrPara">Abschnitt ${i + 1}</h2>` +
      `<p>${marker} Absatz ${i + 1}. ${'Der Beschaediger haftet fuer den Schaden. '.repeat(30)}</p>`,
  ).join('');

  return `<html><body><div class="contentBlock"><h1 class="Titel">Kurztitel</h1><p>${marker}</p></div><div class="contentBlock"><h1 class="Titel">Text</h1>${paragraphs}</div></body></html>`;
}

/** A document that fits in a single chunk. */
function shortDocumentHtml(marker: string): string {
  return `<html><body><h1 class="Titel">Kurztitel</h1><p>${marker}</p></body></html>`;
}

function stubFetch(bodyFor: (url: string) => string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      fetched.push(String(url));
      return Promise.resolve({ ok: true, text: () => Promise.resolve(bodyFor(String(url))) });
    }),
  );
}

/** Serve one long document under every URL — the default for most tests. */
function stubSingleDocument(marker = 'DOK'): void {
  stubFetch(() => longDocumentHtml(marker));
}

/** Serve a distinct document per URL, identified by its Dokumentnummer. */
function stubDocumentPerUrl(): void {
  stubFetch((url) => shortDocumentHtml(url.split('/').pop() ?? 'unknown'));
}

beforeEach(async () => {
  fetched = [];

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  server = new McpServer({ name: 'ris-mcp-test', version: '0.0.0' });
  registerAllTools(server);

  client = new Client({ name: 'test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  // Installs the client-side output validators for the tools under test.
  await client.listTools();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await client.close();
  await server.close();
});

// =============================================================================
// Helpers
// =============================================================================

interface ChunkPayload {
  dokumentnummer?: string;
  text: string;
  total_length: number;
  next_offset: number | null;
  outline?: { level: number; label: string; offset: number; span: number }[];
  source_url?: string;
}

async function chunk(args: Record<string, unknown>): Promise<ChunkPayload> {
  const result = await client.callTool({ name: 'ris_dokument_abschnitt', arguments: args });
  expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
  return result.structuredContent as unknown as ChunkPayload;
}

async function callChunkRaw(
  args: Record<string, unknown>,
): Promise<Awaited<ReturnType<typeof client.callTool>>> {
  return client.callTool({ name: 'ris_dokument_abschnitt', arguments: args });
}

function errorText(result: Awaited<ReturnType<typeof client.callTool>>): string {
  return (result.content as { type: string; text?: string }[])[0].text ?? '';
}

/** `_meta.ui` as it arrives over the wire, before narrowing. */
interface WireUiMeta {
  visibility?: string[];
  resourceUri?: string;
  csp?: unknown;
  domain?: unknown;
}

async function chunkTool(): Promise<{
  _meta?: Record<string, unknown>;
  outputSchema?: { properties?: Record<string, unknown>; required?: string[] };
  annotations?: Record<string, unknown>;
  description?: string;
  title?: string;
}> {
  const { tools } = await client.listTools();
  const tool = tools.find((candidate) => candidate.name === 'ris_dokument_abschnitt');
  expect(tool, 'ris_dokument_abschnitt is not registered').toBeDefined();
  return tool as never;
}

// =============================================================================
// 1. Declaration
// =============================================================================

describe('chunk tool declaration', () => {
  it('should mark the tool as callable by the app only', async () => {
    const meta = (await chunkTool())._meta?.ui as WireUiMeta | undefined;

    expect(meta?.visibility).toEqual(['app']);
  });

  it('should let the widget call it in ChatGPT', async () => {
    // `openai/widgetAccessible` defaults to false there and gates every
    // widget-initiated tools/call — without it the viewer loads no section.
    expect((await chunkTool())._meta?.['openai/widgetAccessible']).toBe(true);
  });

  it('should point at no widget resource of its own', async () => {
    // It feeds the viewer that is already open. A resourceUri would invite the
    // host to render a fresh widget for every section.
    const tool = await chunkTool();

    expect((tool._meta?.ui as WireUiMeta | undefined)?.resourceUri).toBeUndefined();
    expect(tool._meta?.['ui/resourceUri']).toBeUndefined();
  });

  it('should still appear in tools/list', async () => {
    // `visibility` is a declaration to the host, not server-side filtering:
    // neither the SDK nor ext-apps removes the tool. A host that ignores the key
    // shows it to the model, which is why the description points at
    // ris_dokument.
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toContain('ris_dokument_abschnitt');
    expect((await chunkTool()).description).toContain('ris_dokument');
  });

  it('should declare the chunk output shape', async () => {
    const schema = (await chunkTool()).outputSchema;

    expect(Object.keys(schema?.properties ?? {})).toEqual(
      expect.arrayContaining([
        'dokumentnummer',
        'text',
        'total_length',
        'next_offset',
        'outline',
        'source_url',
      ]),
    );
    // The viewer compares total_length across calls to notice a refetch, so it
    // has to be there every time, not just on the first chunk.
    expect(schema?.required).toEqual(
      expect.arrayContaining(['text', 'total_length', 'next_offset']),
    );
  });

  it('should carry the same annotations as every other tool', async () => {
    expect((await chunkTool()).annotations).toMatchObject({
      readOnlyHint: true,
      openWorldHint: true,
      destructiveHint: false,
    });
  });
});

// =============================================================================
// 2. Paging through a document
// =============================================================================

describe('paging', () => {
  it('should return the first section and the outline at offset 0', async () => {
    stubSingleDocument();

    const first = await chunk({ dokumentnummer: 'NOR12019037', offset: 0 });

    expect(first.text.length).toBeGreaterThan(0);
    expect(first.text.length).toBeLessThanOrEqual(25000);
    expect(first.total_length).toBeGreaterThan(25000);
    expect(first.next_offset).toBe(first.text.length);
    expect(first.outline?.length).toBeGreaterThan(1);
    expect(first.dokumentnummer).toBe('NOR12019037');
    expect(first.source_url).toContain('NOR12019037');
  });

  it('should repeat the text of the section in the content block', async () => {
    stubSingleDocument();

    const result = await client.callTool({
      name: 'ris_dokument_abschnitt',
      arguments: { dokumentnummer: 'NOR12019037', offset: 0 },
    });
    const content = result.content as { type: string; text: string }[];
    const payload = result.structuredContent as unknown as ChunkPayload;

    expect(content).toHaveLength(1);
    expect(content[0].type).toBe('text');
    expect(content[0].text).toBe(payload.text);
  });

  it('should reassemble the whole document across sections', async () => {
    stubSingleDocument();

    const sections: string[] = [];
    let offset: number | null = 0;
    let total = 0;

    while (offset !== null) {
      const payload: ChunkPayload = await chunk({ dokumentnummer: 'NOR12019037', offset });
      total = payload.total_length;
      sections.push(payload.text);
      offset = payload.next_offset;
    }

    expect(sections.length).toBeGreaterThan(1);
    expect(sections.join('').length).toBe(total);
  });

  it('should cut its sections from the very string ris_dokument renders', async () => {
    // The property the whole offset scheme rests on. Both tools go through
    // loadDocument(), so comparing against its untruncated output is comparing
    // against what ris_dokument rendered — ris_dokument's own response is cut at
    // 25 000 characters and cannot show this for a document that pages.
    stubSingleDocument();

    const first = await chunk({ dokumentnummer: 'NOR12019037', offset: 0 });
    const loaded = await loadDocument(
      { dokumentnummer: 'NOR12019037', responseFormat: 'markdown' },
      new AbortController().signal,
    );

    expect(loaded.success).toBe(true);
    const canonical = loaded.success ? loaded.document.text : '';
    expect(first.total_length).toBe(canonical.length);
    expect(canonical.startsWith(first.text)).toBe(true);
  });

  it('should report total_length on every section, not only the first', async () => {
    stubSingleDocument();

    const first = await chunk({ dokumentnummer: 'NOR12019037', offset: 0 });
    const second = await chunk({
      dokumentnummer: 'NOR12019037',
      offset: first.next_offset ?? 0,
    });

    expect(second.total_length).toBe(first.total_length);
  });

  it('should send the outline only with the section that opens the document', async () => {
    stubSingleDocument();

    const first = await chunk({ dokumentnummer: 'NOR12019037', offset: 0 });
    const second = await chunk({
      dokumentnummer: 'NOR12019037',
      offset: first.next_offset ?? 0,
    });

    expect(first.outline).toBeDefined();
    expect(second.outline).toBeUndefined();
  });

  it('should give outline offsets that address the document text', async () => {
    stubSingleDocument();

    const first = await chunk({ dokumentnummer: 'NOR12019037', offset: 0 });
    const entry = first.outline?.find((candidate) => candidate.label === 'Abschnitt 20');
    expect(entry).toBeDefined();

    // Read the document from the jump target: the outline offset has to land on
    // the heading in the very text these sections are cut from.
    const jumped = await chunk({ dokumentnummer: 'NOR12019037', offset: entry?.offset ?? 0 });
    expect(jumped.text.startsWith('Abschnitt 20')).toBe(true);
  });

  it('should default to the first section when no offset is given', async () => {
    stubSingleDocument();

    const implicit = await chunk({ dokumentnummer: 'NOR12019037' });
    const explicit = await chunk({ dokumentnummer: 'NOR12019037', offset: 0 });

    expect(implicit.text).toBe(explicit.text);
    expect(implicit.outline).toBeDefined();
  });

  it('should answer an offset past the end with an empty final section', async () => {
    stubSingleDocument();

    const first = await chunk({ dokumentnummer: 'NOR12019037', offset: 0 });
    const beyond = await chunk({
      dokumentnummer: 'NOR12019037',
      offset: first.total_length + 500,
    });

    expect(beyond.text).toBe('');
    expect(beyond.next_offset).toBeNull();
    expect(beyond.total_length).toBe(first.total_length);
  });

  it('should serve a document that fits in one section', async () => {
    stubFetch(() => shortDocumentHtml('KURZ'));

    const only = await chunk({ dokumentnummer: 'NOR12019037', offset: 0 });

    expect(only.next_offset).toBeNull();
    expect(only.text).toContain('KURZ');
  });

  it('should omit dokumentnummer for a document addressed by URL', async () => {
    // There is none to echo, and the URL under that name would be a key that
    // does not resolve. source_url identifies the document instead.
    stubSingleDocument();

    const payload = await chunk({
      url: 'https://ris.bka.gv.at/Dokumente/Bundesnormen/NOR12019037/NOR12019037.html',
      offset: 0,
    });

    expect(payload.dokumentnummer).toBeUndefined();
    expect(payload.source_url).toBe(
      'https://ris.bka.gv.at/Dokumente/Bundesnormen/NOR12019037/NOR12019037.html',
    );
    expect(payload.text.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// 3. The cache, counted in RIS requests
// =============================================================================

describe('cache behaviour', () => {
  it('should fetch the document once and serve every further section from memory', async () => {
    stubSingleDocument();

    let offset: number | null = 0;
    let sections = 0;

    while (offset !== null) {
      const payload: ChunkPayload = await chunk({ dokumentnummer: 'NOR12019037', offset });
      offset = payload.next_offset;
      sections += 1;
    }

    expect(sections).toBeGreaterThan(2);
    expect(fetched).toHaveLength(1);
  });

  it('should serve the first section of a document ris_dokument opened', async () => {
    // The reason ris_dokument fills the cache: the viewer's first chunk call is
    // a hit, and it pages the same string the reader was shown.
    stubSingleDocument();

    await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR12019037' },
    });
    expect(fetched).toHaveLength(1);

    await chunk({ dokumentnummer: 'NOR12019037', offset: 0 });

    expect(fetched).toHaveLength(1);
  });

  it('should not fill the cache from a json response', async () => {
    // The JSON rendering has a different character distribution, so its offsets
    // would not address the markdown the viewer displays.
    stubSingleDocument();

    await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR12019037', response_format: 'json' },
    });
    await chunk({ dokumentnummer: 'NOR12019037', offset: 0 });

    expect(fetched).toHaveLength(2);
  });

  it('should find a document opened by number when the viewer asks by URL', async () => {
    stubSingleDocument();

    const byNumber = await chunk({ dokumentnummer: 'NOR12019037', offset: 0 });
    const byUrl = await chunk({ url: byNumber.source_url, offset: byNumber.next_offset });

    expect(fetched).toHaveLength(1);
    expect(byUrl.total_length).toBe(byNumber.total_length);
  });

  it('should page a document ris_dokument opened by URL without refetching it', async () => {
    // A document opened by URL has no Dokumentnummer anywhere in the response,
    // so the URL is the only identifier the viewer can hold — and the one it
    // gets back as source_url.
    stubSingleDocument();
    const url = 'https://ris.bka.gv.at/Dokumente/Bundesnormen/NOR12019037/NOR12019037.html';

    await client.callTool({ name: 'ris_dokument', arguments: { url } });
    expect(fetched).toHaveLength(1);

    const payload = await chunk({ url, offset: 0 });

    expect(fetched).toHaveLength(1);
    expect(payload.source_url).toBe(url);
  });

  it('should refetch a document evicted by a run of other documents', async () => {
    stubDocumentPerUrl();

    await chunk({ dokumentnummer: 'NOR10000000', offset: 0 });
    expect(fetched).toHaveLength(1);

    // The cache holds ten documents; eleven more push the first one out.
    for (let i = 1; i <= 11; i++) {
      await chunk({ dokumentnummer: `NOR1000000${i}`, offset: 0 });
    }
    expect(fetched).toHaveLength(12);

    await chunk({ dokumentnummer: 'NOR10000000', offset: 0 });

    expect(fetched).toHaveLength(13);
  });

  it('should keep a document that stays in the working set', async () => {
    stubDocumentPerUrl();

    for (let i = 0; i < 5; i++) {
      await chunk({ dokumentnummer: `NOR1000000${i}`, offset: 0 });
    }
    expect(fetched).toHaveLength(5);

    await chunk({ dokumentnummer: 'NOR10000000', offset: 0 });

    expect(fetched).toHaveLength(5);
  });
});

// =============================================================================
// 4. Errors
// =============================================================================

describe('errors', () => {
  it('should ask for an identifier when neither is given', async () => {
    stubSingleDocument();

    const result = await callChunkRaw({ offset: 0 });

    expect(result.isError).toBe(true);
    expect(errorText(result)).toContain('`dokumentnummer`');
    expect(fetched).toHaveLength(0);
  });

  it('should refuse a URL outside the RIS domains', async () => {
    // The SSRF allowlist is inherited from the shared load path rather than
    // reimplemented — `url` is a new, widget-filled entry point.
    stubSingleDocument();

    const result = await callChunkRaw({ url: 'https://evil.example.com/doc.html', offset: 0 });

    expect(result.isError).toBe(true);
    expect(errorText(result)).toContain('nicht erlaubt');
    expect(fetched).toHaveLength(0);
  });

  it('should refuse an http URL on a RIS domain', async () => {
    stubSingleDocument();

    const result = await callChunkRaw({
      url: 'http://ris.bka.gv.at/Dokumente/Bundesnormen/NOR12019037/NOR12019037.html',
      offset: 0,
    });

    expect(result.isError).toBe(true);
    expect(fetched).toHaveLength(0);
  });

  it('should report an upstream failure in German instead of throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network down'))),
    );

    const result = await callChunkRaw({ dokumentnummer: 'NOR12019037', offset: 0 });

    expect(result.isError).toBe(true);
    expect(errorText(result)).toContain('Fehler');
  });

  it('should reject a negative offset at the schema', async () => {
    // The schema is what keeps a nonsensical offset away from the chunker, which
    // is why the clamping there is only a second line of defence.
    stubSingleDocument();

    const result = await callChunkRaw({ dokumentnummer: 'NOR12019037', offset: -5 });

    expect(result.isError).toBe(true);
    expect(errorText(result)).toContain('offset');
    expect(fetched).toHaveLength(0);
  });
});
