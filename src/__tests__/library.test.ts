/**
 * Tests for the library entry point (`ris-mcp-ts/library`): tool registration on
 * a caller-owned server, the per-server fetch hook, the handler wrapper, the
 * machine-readable error kind and the CC BY 4.0 attribution.
 */

import { readFileSync } from 'node:fs';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ATTRIBUTION_LICENSE,
  ATTRIBUTION_TEXT,
  LEGAL_NOTICE,
  RIS_ERROR_META_KEY,
  RIS_TOOL_NAMES,
  UNCOUNTED_TOOLS,
  registerRisTools,
  type RisToolOptions,
} from '../library.js';

const judikaturBody = readFileSync(
  new URL('./fixtures/judikatur-search-raw.json', import.meta.url),
  'utf8',
);

type Fetch = NonNullable<RisToolOptions['fetch']>;

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

async function connect(options: RisToolOptions = {}): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerRisTools(server, options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

const SEARCH = { name: 'ris_judikatur', arguments: { suchworte: 'Gewährleistung' } };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('registerRisTools', () => {
  it('exposes the library entry in package.json exports', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.exports['./library']).toMatchObject({
      import: './dist/library.js',
      types: './dist/library.d.ts',
    });
  });

  it('registers all 13 tools with title, readOnlyHint and the legal notice', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...RIS_TOOL_NAMES].sort());
    expect(RIS_TOOL_NAMES).toHaveLength(13);
    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.description, tool.name).toContain(LEGAL_NOTICE);
    }
    expect(UNCOUNTED_TOOLS).toEqual(['ris_dokument_abschnitt']);
  });

  it('routes RIS requests through the injected fetch instead of the global one', async () => {
    const globalFetch = vi.fn<Fetch>();
    vi.stubGlobal('fetch', globalFetch);
    const injected = vi.fn<Fetch>(async () => jsonResponse(judikaturBody));
    const client = await connect({ fetch: injected });
    const result = await client.callTool(SEARCH);
    expect(result.isError).toBeFalsy();
    expect(injected).toHaveBeenCalledTimes(1);
    expect(String(injected.mock.calls[0]?.[0])).toMatch(/^https:\/\/data\.bka\.gv\.at\//);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it('keeps the fetch hooks of two servers apart under concurrency', async () => {
    const a = vi.fn<Fetch>(async () => jsonResponse(judikaturBody));
    const b = vi.fn<Fetch>(async () => jsonResponse(judikaturBody));
    const [clientA, clientB] = await Promise.all([connect({ fetch: a }), connect({ fetch: b })]);
    await Promise.all([
      clientA.callTool(SEARCH),
      clientB.callTool(SEARCH),
      clientA.callTool(SEARCH),
    ]);
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('wraps every handler once with its tool name and returns the wrapper result', async () => {
    const names: string[] = [];
    const client = await connect({
      fetch: async () => jsonResponse(judikaturBody),
      wrapHandler: (name, handler) => {
        names.push(name);
        return async (args, extra) => {
          const result = await handler(args, extra);
          return { ...result, _meta: { ...result._meta, wrapped: name } };
        };
      },
    });
    expect(names.sort()).toEqual([...RIS_TOOL_NAMES].sort());
    const result = await client.callTool(SEARCH);
    expect(result._meta?.wrapped).toBe('ris_judikatur');
  });

  it('attaches the CC BY 4.0 attribution to text and structured content', async () => {
    const client = await connect({ fetch: async () => jsonResponse(judikaturBody) });
    const result = await client.callTool(SEARCH);
    const texts = (result.content as { type: string; text?: string }[])
      .map((c) => c.text ?? '')
      .join('\n');
    expect(texts).toContain(ATTRIBUTION_TEXT);
    expect(texts).toContain('https://www.ris.bka.gv.at');
    expect(
      (result.structuredContent as { attribution?: unknown } | undefined)?.attribution,
    ).toEqual({
      text: ATTRIBUTION_TEXT,
      license: ATTRIBUTION_LICENSE,
      source_url: 'https://www.ris.bka.gv.at',
    });
  });

  it.each([
    [503, 'upstream'],
    [500, 'upstream'],
    [404, 'client'],
  ])('marks an RIS HTTP %i as error kind %s', async (status, kind) => {
    const client = await connect({ fetch: async () => jsonResponse('{}', status) });
    const result = await client.callTool(SEARCH);
    expect(result.isError).toBe(true);
    expect(result._meta?.[RIS_ERROR_META_KEY]).toBe(kind);
    const text = (result.content as { text: string }[])[0]?.text ?? '';
    expect(text).not.toContain(ATTRIBUTION_TEXT);
  });

  it('marks an unparseable RIS answer as error kind parsing', async () => {
    const client = await connect({ fetch: async () => jsonResponse('not json') });
    const result = await client.callTool(SEARCH);
    expect(result._meta?.[RIS_ERROR_META_KEY]).toBe('parsing');
  });

  it('marks a missing-argument error as validation, without RIS call', async () => {
    const injected = vi.fn<Fetch>();
    const client = await connect({ fetch: injected });
    const result = await client.callTool({ name: 'ris_judikatur', arguments: {} });
    expect(result.isError).toBe(true);
    expect(result._meta?.[RIS_ERROR_META_KEY]).toBe('validation');
    expect(injected).not.toHaveBeenCalled();
  });
});
