/**
 * Byte-identity snapshot of the `ris_dokument` response (issue #51).
 *
 * The recorded decision is that this tool's response does not change: no
 * `outputSchema`, no `structuredContent`, the same text block and the same
 * `resource_link`. #51 moves its entire load path into `document-loader.ts` and
 * adds a cache write to the handler, so the claim "the response is untouched"
 * needs something stronger than a reading of the diff.
 *
 * The snapshots below were generated from the pre-#51 handler and committed
 * unchanged; a byte that moves fails this file. The long-document case is
 * pinned by length and digest instead of by its 25 000 characters, which is the
 * same guarantee in a reviewable size.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

import { server } from '../server.js';

// =============================================================================
// Setup
// =============================================================================

let client: Client;

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  client = new Client({ name: 'test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await server.close();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const NORM_HTML = readFileSync(
  new URL('./fixtures/nor12019037-excerpt.html', import.meta.url),
  'utf8',
);
const GAZETTE_HTML = readFileSync(
  new URL('./fixtures/bgbla-2012-ii-371-excerpt.html', import.meta.url),
  'utf8',
);

function serve(html: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(html) })),
  );
}

async function dokument(args: Record<string, unknown>): Promise<unknown> {
  const result = await client.callTool({ name: 'ris_dokument', arguments: args });
  return result.content;
}

// =============================================================================
// Frozen responses
// =============================================================================

describe('ris_dokument response identity', () => {
  it('should return text plus resource_link and nothing structured', async () => {
    serve(NORM_HTML);

    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR12019037' },
    });

    expect(result.structuredContent).toBeUndefined();
    expect((result.content as { type: string }[]).map((block) => block.type)).toEqual([
      'text',
      'resource_link',
    ]);
  });

  it('should freeze the markdown response for a norm document', async () => {
    serve(NORM_HTML);

    expect(await dokument({ dokumentnummer: 'NOR12019037' })).toMatchSnapshot();
  });

  it('should freeze the markdown response for a gazette document', async () => {
    serve(GAZETTE_HTML);

    expect(await dokument({ dokumentnummer: 'BGBLA_2012_II_371' })).toMatchSnapshot();
  });

  it('should freeze the json response', async () => {
    serve(NORM_HTML);

    expect(
      await dokument({ dokumentnummer: 'NOR12019037', response_format: 'json' }),
    ).toMatchSnapshot();
  });

  it('should freeze the response for a document addressed by URL', async () => {
    serve(NORM_HTML);

    expect(
      await dokument({
        url: 'https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR12019037/NOR12019037.html',
      }),
    ).toMatchSnapshot();
  });

  it('should freeze the truncated response for a long document', async () => {
    // Pinned by digest rather than by 25 000 inline characters: the truncation
    // boundary and the warning it appends are exactly what a change to the
    // chunking code could move.
    serve(
      `<html><body><h1>Titel</h1>${'<p>Ein Absatz mit Text zum Kuerzen.</p>'.repeat(2000)}</body></html>`,
    );

    const content = (await dokument({ dokumentnummer: 'NOR12019037' })) as { text: string }[];
    const text = content[0].text;

    expect({
      length: text.length,
      sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
      tail: text.slice(-220),
    }).toMatchSnapshot();
  });

  it('should freeze the error response when no identifier is given', async () => {
    serve(NORM_HTML);

    const result = await client.callTool({ name: 'ris_dokument', arguments: {} });

    expect(result.isError).toBe(true);
    expect(result.content).toMatchSnapshot();
  });

  it('should freeze the error response for a URL outside the RIS domains', async () => {
    serve(NORM_HTML);

    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { url: 'https://evil.example.com/doc.html' },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatchSnapshot();
  });
});
