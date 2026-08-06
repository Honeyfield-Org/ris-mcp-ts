/**
 * E2E: the two document tools against a RIS *website* page (issue #94).
 *
 * `ris_dokument` mostly fetches bare document HTML, but a `url` the caller
 * pasted out of a browser is regularly a rendered page — `GeltendeFassung.wxe`
 * or `Dokument.wxe` — which carries the site around the law: skip links, header
 * menu, version navigation, footer. Unscoped, the reader gets the navigation
 * first and the law somewhere below it, and the viewer's outline offers the
 * chrome headings as jump targets.
 *
 * `scopeRisContent` is unit-tested in formatting.test.ts; what these cases pin
 * is that the *loader* applies it, once, on the path both tools share — so the
 * text block, the structured payload and the outline the viewer's rail is built
 * from all describe the same scoped document.
 *
 * The other half of the contract is that nothing moves for a bare document.
 * That is pinned here by name (the titel of a url-addressed norm stays the URL)
 * and byte-for-byte by the frozen snapshots in dokument-snapshot.e2e.test.ts,
 * whose url-addressed case serves this same norm fixture.
 */

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

  // Installs the output validators: from here on the client re-validates every
  // structured payload below against the schema the tool advertises.
  await client.listTools();
});

afterAll(async () => {
  await client.close();
  await server.close();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** "Gesamte Rechtsvorschrift" for the Datenschutzgesetz — 3 of its 77 blocks. */
const GF_HTML = readFileSync(new URL('./fixtures/gf-dsg-excerpt.html', import.meta.url), 'utf8');
const GF_URL =
  'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10001597';

/** Single-norm page for § 1 BFGG — the shape that carries the `.Warning`. */
const WXE_HTML = readFileSync(
  new URL('./fixtures/dokumentwxe-nor-excerpt.html', import.meta.url),
  'utf8',
);
const WXE_URL =
  'https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer=NOR40217553';

/** A bare document, the shape ris_dokument has always fetched — the control. */
const NORM_HTML = readFileSync(
  new URL('./fixtures/nor12019037-excerpt.html', import.meta.url),
  'utf8',
);
const NORM_URL = 'https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR12019037/NOR12019037.html';

/** Same fetch seam the snapshot suite uses: one body for every request. */
function serve(html: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(html) })),
  );
}

interface DocumentPayload {
  text: string;
  total_length: number;
  source_url: string;
  outline?: { label: string }[];
}

async function dokument(args: Record<string, unknown>): Promise<DocumentPayload> {
  const result = await client.callTool({ name: 'ris_dokument', arguments: args });

  expect(result.isError).toBeFalsy();
  return result.structuredContent as unknown as DocumentPayload;
}

// =============================================================================
// A rendered RIS page reached by URL
// =============================================================================

describe('ris_dokument with a site-chrome page (issue #94)', () => {
  it('should drop the site chrome from the document text', async () => {
    serve(GF_HTML);

    const payload = await dokument({ url: GF_URL });

    // The loud-failure pin: if RIS renames the wrapper, scoping goes silently
    // inert and every assertion below would fail as "chrome is gone" without
    // naming the cause.
    expect(GF_HTML).toContain('class="documentContent"');

    // Skip links at the top, footer at the bottom — verbatim in the fixture, so
    // an unscoped rendering carries all three and these bite.
    expect(payload.text).not.toContain('Seitenbereiche');
    expect(payload.text).not.toContain('Zum Seitenanfang');
    expect(payload.text).not.toContain('Bundeskanzleramt der Republik');
  });

  it('should start the content at the law itself', async () => {
    serve(GF_HTML);

    const payload = await dokument({ url: GF_URL });
    const content = payload.text.split('## Inhalt\n\n')[1];

    // Not merely "the chrome is gone somewhere": the first thing under the
    // heading is the law's own § marker and its Langtitel.
    expect(content.split('\n').slice(0, 3)).toEqual(['§ 0', '', 'Langtitel']);
    expect(content).toContain(
      'Bundesgesetz zum Schutz natürlicher Personen bei der Verarbeitung ' +
        'personenbezogener Daten (Datenschutzgesetz – DSG)',
    );
  });

  it('should name the document by the page title rather than by the URL', async () => {
    serve(GF_HTML);

    const payload = await dokument({ url: GF_URL });

    // A url call has nothing to name the document by but the URL the caller
    // typed, which is what both the markdown heading and the Titel field showed.
    // A scoped page carries the name RIS itself gives it.
    expect(payload.text.split('\n')[0]).toBe(
      '# RIS - Datenschutzgesetz - Bundesrecht konsolidiert, Fassung vom 06.08.2026',
    );
    expect(payload.text).toContain(
      '**Titel:** RIS - Datenschutzgesetz - Bundesrecht konsolidiert, Fassung vom 06.08.2026',
    );
    expect(payload.text).not.toContain(`# ${GF_URL}`);

    // The URL is not lost by being replaced as the title — it is still the way
    // back to the original, in the text and in the structured payload.
    expect(payload.source_url).toBe(GF_URL);
    expect(payload.text).toContain(`**Quelle:** [${GF_URL}](${GF_URL})`);
  });

  it('should keep the legal status of the displayed Fassung', async () => {
    serve(WXE_HTML);

    const payload = await dokument({ url: WXE_URL });

    // `.Warning` is chrome by position and content by meaning: it says the text
    // below is not in force. The version navigation around it is chrome by both.
    expect(payload.text).toContain('Diese Fassung ist nicht aktuell');
    expect(payload.text).not.toContain('Alle Fassungen');
    expect(payload.text.split('\n')[0]).toBe(
      '# RIS - Bundesfinanzgerichtsgesetz § 1 - Bundesrecht konsolidiert',
    );
  });
});

// =============================================================================
// The outline the viewer's rail is built from
// =============================================================================

describe('ris_dokument_abschnitt with a site-chrome page (issue #94)', () => {
  it('should offer no chrome heading as a jump target', async () => {
    serve(GF_HTML);

    // The scoped fixture renders to 12 721 characters, below the limit at which
    // `ris_dokument` carries an outline — so the outline that reaches the viewer
    // for this document is the section tool's, which is also the one the rail is
    // built from. Same loader, same html: this is where scoping has to have
    // happened for the rail to be free of chrome.
    const result = await client.callTool({
      name: 'ris_dokument_abschnitt',
      arguments: { url: GF_URL, offset: 0 },
    });
    const outline = (result.structuredContent as unknown as { outline: { label: string }[] })
      .outline;
    const labels = outline.map((entry) => entry.label);

    expect(labels).not.toContain('Über diese Seite');
    expect(labels).not.toContain(
      'Bundesrecht konsolidiert: Gesamte Rechtsvorschrift für Datenschutzgesetz, ' +
        'Fassung vom 06.08.2026',
    );
    expect(labels[0]).toBe('§ 0');
  });
});

// =============================================================================
// The control: a bare document must not notice any of this
// =============================================================================

describe('ris_dokument with a bare document (issue #94 inertness)', () => {
  it('should keep naming a url-addressed norm by its URL', async () => {
    serve(NORM_HTML);

    const payload = await dokument({ url: NORM_URL });

    // Scoping is a no-op here by construction — no `.documentContent`, so
    // `scopeRisContent` hands back the identical string and a null pageTitle,
    // and the title adoption above must not fire. The full byte-identity of this
    // response is frozen in dokument-snapshot.e2e.test.ts ("should freeze the
    // response for a document addressed by URL"), whose snapshot predates this
    // change; what is named here is the one field that could plausibly move.
    expect(NORM_HTML).not.toContain('documentContent');
    expect(payload.text.split('\n')[0]).toBe(`# ${NORM_URL}`);
    expect(payload.text).toContain(`**Titel:** ${NORM_URL}`);
    expect(payload.text).toContain('Allgemeines bürgerliches Gesetzbuch');
  });

  it('should keep naming a number-addressed norm by its Dokumentnummer', async () => {
    serve(NORM_HTML);

    const payload = await dokument({ dokumentnummer: 'NOR12019037' });

    // The other minimal-metadata branch. Its titel is the Dokumentnummer, which
    // is an identifier the caller can use again — a page title would replace it
    // with prose. Measured 0/4 RIS document routes serve `.documentContent`, so
    // the branch is not reached by a scoped page today; the gate is what keeps
    // that true if one ever does.
    expect(payload.text.split('\n')[0]).toBe('# NOR12019037');
    expect(payload.text).toContain('**Dokumentnummer:** `NOR12019037`');
  });
});
