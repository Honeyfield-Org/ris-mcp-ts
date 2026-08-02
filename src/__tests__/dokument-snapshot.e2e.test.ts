/**
 * Byte-identity snapshot of the `ris_dokument` response (issues #51, #52).
 *
 * The **text block** of this tool does not change, whatever else the handler
 * grows or loses. The snapshots were generated from the pre-#51 handler; a byte
 * that moves in the text fails this file. The long-document case is pinned by
 * length and digest instead of by its 25 000 characters, which is the same
 * guarantee in a reviewable size.
 *
 * The `resource_link` block was removed from the snapshots in #52, deliberately
 * and as the only change to them: claude.ai delivers a widget no tool-result
 * event at all when the result carries one, which left the viewer on its
 * degradation notice while the trefferliste rendered in the same conversation.
 * The source URL is unaffected — it is in the text block's `**Quelle:**` link
 * and in `structuredContent.source_url`, both of which these tests pin.
 *
 * The `structuredContent` pin flipped in #52, deliberately: the tool now
 * declares an `outputSchema` whose payload *carries the text block*, so the
 * v1.3.0 failure mode — a client rendering structured metadata in place of the
 * document — cannot recur. What the assertions below pin is exactly that
 * property, `structuredContent.text === content[0].text`, plus the shape around
 * it.
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

/** Content URL the search fallback hands back — distinct from the direct one. */
const FALLBACK_CONTENT_URL =
  'https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR12019037/NOR12019037_fallback.html';

/**
 * Serve the second resolution strategy: the direct URL 404s, the search API
 * answers, and the content URL from that answer carries the document.
 *
 * This is the branch that produces the *rich* metadata header — langtitel,
 * kundmachungsorgan, ELI, both URLs — where the direct branch produces a
 * minimal one. The difference between the two headers is several thousand
 * characters on a real document, which is precisely why it needs its own
 * byte-level pin.
 */
function serveSearchFallback(): void {
  const searchBody = JSON.stringify({
    OgdSearchResult: {
      OgdDocumentResults: {
        Hits: { '#text': '1', '@pageNumber': '1', '@pageSize': '10' },
        OgdDocumentReference: [
          {
            Data: {
              Metadaten: {
                Technisch: { ID: 'NOR12019037', Applikation: 'BrKons' },
                Allgemein: {
                  DokumentUrl: 'https://www.ris.bka.gv.at/eli/jgs/1811/946/P1295/NOR12019037',
                },
                Bundesrecht: {
                  Kurztitel: 'ABGB',
                  Langtitel: 'Allgemeines buergerliches Gesetzbuch',
                  Eli: 'eli/jgs/1811/946/P1295/NOR12019037',
                  BrKons: {
                    Kundmachungsorgan: 'JGS Nr. 946/1811',
                    ArtikelParagraphAnlage: '§ 1295',
                    Inkrafttretensdatum: '1917-01-01',
                    Ausserkrafttretensdatum: '9999-12-31',
                    GesamteRechtsvorschriftUrl:
                      'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10001622',
                  },
                },
              },
              Dokumentliste: {
                ContentReference: {
                  ContentType: 'MainDocument',
                  Urls: { ContentUrl: [{ DataType: 'Html', Url: FALLBACK_CONTENT_URL }] },
                },
              },
            },
          },
        ],
      },
    },
  });

  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const target = String(url);
      if (target.includes('/ris/api/')) {
        return Promise.resolve({ ok: true, text: () => Promise.resolve(searchBody) });
      }
      if (target === FALLBACK_CONTENT_URL) {
        return Promise.resolve({ ok: true, text: () => Promise.resolve(NORM_HTML) });
      }
      // The direct URL construction — this is the failure that triggers the fallback.
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('Not Found') });
    }),
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
  it('should return the text block and nothing else', async () => {
    serve(NORM_HTML);

    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR12019037' },
    });

    // A resource_link here costs the whole widget in claude.ai — the host
    // delivers no tool-result event at all for a result that carries one.
    expect((result.content as { type: string }[]).map((block) => block.type)).toEqual(['text']);
  });

  it('should keep the source URL reachable in both surviving carriers', async () => {
    serve(NORM_HTML);

    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR12019037' },
    });

    const text = (result.content as { text: string }[])[0].text;
    const url = (result.structuredContent as { source_url: string }).source_url;

    // What the dropped block used to carry has two homes left, so removing it
    // costs a client nothing it cannot reach.
    expect(url).toContain('NOR12019037');
    expect(text).toContain(`**Quelle:** [${url}](${url})`);
  });

  it('should carry the text block itself in structuredContent', async () => {
    serve(NORM_HTML);

    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR12019037' },
    });

    const text = (result.content as { text: string }[])[0].text;

    // The property the whole reversal rests on: a client that renders only the
    // structured payload renders the same document, not metadata about it.
    expect(result.structuredContent).toEqual({
      dokumentnummer: 'NOR12019037',
      text,
      total_length: text.length,
      source_url: 'https://ris.bka.gv.at/Dokumente/Bundesnormen/NOR12019037/NOR12019037.html',
    });
  });

  it('should omit the Dokumentnummer for a document addressed by URL', async () => {
    serve(NORM_HTML);

    const url = 'https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR12019037/NOR12019037.html';
    const result = await client.callTool({ name: 'ris_dokument', arguments: { url } });

    // Echoing an invented number would hand the viewer a key that resolves to
    // nothing; `source_url` is what addresses these documents.
    expect(result.structuredContent).not.toHaveProperty('dokumentnummer');
    expect((result.structuredContent as { source_url: string }).source_url).toBe(url);
  });

  it('should carry the outline and the untruncated length for a long document', async () => {
    serve(
      `<html><body><h1>Titel</h1><h2>Erster Abschnitt</h2>${'<p>Ein Absatz mit Text zum Kuerzen.</p>'.repeat(2000)}</body></html>`,
    );

    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR12019037' },
    });

    const text = (result.content as { text: string }[])[0].text;
    const structured = result.structuredContent as {
      text: string;
      total_length: number;
      outline: { label: string }[];
    };

    expect(structured.text).toBe(text);
    // The length of the whole document, not of the truncated rendering — it is
    // what tells the viewer there is more and gates its outline rail.
    expect(structured.total_length).toBeGreaterThan(text.length);
    expect(structured.outline.map((entry) => entry.label)).toContain('Erster Abschnitt');
  });

  it('should carry no outline for a document that fits in one response', async () => {
    serve(NORM_HTML);

    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR12019037' },
    });

    // Nothing to navigate to, so the entries would be payload nobody reads.
    expect(result.structuredContent).not.toHaveProperty('outline');
  });

  it('should carry no outline when it would outweigh the excerpt it travels with', async () => {
    // A consolidated statute: measured at 499 headings serialising to 38 123
    // characters against a 24 686-character excerpt. Every client would pay for
    // it; the viewer instead gets it from the section call it is about to make.
    const headings = Array.from(
      { length: 600 },
      (_unused, index) =>
        `<h2>Abschnitt ${index} mit einer Ueberschrift von realistischer Laenge</h2>` +
        '<p>Ein Absatz mit Text zum Kuerzen.</p>'.repeat(3),
    ).join('');
    serve(`<html><body><h1>Titel</h1>${headings}</body></html>`);

    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR12019037' },
    });

    const structured = result.structuredContent as { total_length: number };
    expect(structured.total_length).toBeGreaterThan(25_000);
    expect(result.structuredContent).not.toHaveProperty('outline');
  });

  it('should carry no structured payload on an error', async () => {
    serve(NORM_HTML);

    const result = await client.callTool({ name: 'ris_dokument', arguments: {} });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  it('should freeze the markdown response for a norm document', async () => {
    serve(NORM_HTML);

    expect(await dokument({ dokumentnummer: 'NOR12019037' })).toMatchSnapshot();
  });

  it('should freeze the markdown response for a gazette document', async () => {
    serve(GAZETTE_HTML);

    expect(await dokument({ dokumentnummer: 'BGBLA_2012_II_371' })).toMatchSnapshot();
  });

  it('should freeze the markdown response the search fallback produces', async () => {
    serveSearchFallback();

    const content = (await dokument({ dokumentnummer: 'NOR12019037' })) as { text?: string }[];

    // Guards the fixture as much as the response: if the direct branch ever
    // answered here, the header would be minimal and the snapshot would pin the
    // wrong branch without anyone noticing.
    expect(content[0].text).toContain('**Kundmachungsorgan:**');
    expect(content[0].text).toContain('**ELI:**');
    expect(content).toMatchSnapshot();
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
