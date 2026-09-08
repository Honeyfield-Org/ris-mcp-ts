/**
 * Tests for src/structured-search.ts — the lean structuredContent projection
 * of the search tools (#106).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_STRUCTURED_CONTENT_BUDGET,
  fitStructuredSearchPage,
  structuredContentBudget,
  toStructuredDocument,
} from '../structured-search.js';
import { StructuredDocumentSchema, type Document, type SearchResult } from '../types.js';

const LAW: Document = {
  dokumentnummer: 'NOR40052760',
  applikation: 'BrKons',
  titel: 'ABGB',
  kurztitel: 'ABGB',
  citation: {
    kurztitel: 'ABGB',
    langtitel: 'Allgemeines bürgerliches Gesetzbuch',
    kundmachungsorgan: 'JGS Nr. 946/1811',
    paragraph: '§ 1295',
    eli: null,
    inkrafttreten: '2002-01-01',
    ausserkrafttreten: null,
  },
  citation_display: '§ 1295 ABGB (JGS Nr. 946/1811)',
  content_urls: {
    html: 'https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR40052760/NOR40052760.html',
    xml: 'https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR40052760/NOR40052760.xml',
    pdf: 'https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR40052760/NOR40052760.pdf',
    rtf: 'https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR40052760/NOR40052760.rtf',
  },
  dokument_url:
    'https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer=NOR40052760',
  gesamte_rechtsvorschrift_url:
    'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10001622',
};

const DECISION: Document = {
  dokumentnummer: 'JJT_20260903_OLG0459_00600R00101_25B0000_000',
  applikation: 'Justiz',
  titel: '6R101/25b',
  kurztitel: '6R101/25b',
  citation: {
    kurztitel: '6R101/25b',
    langtitel: null,
    kundmachungsorgan: null,
    paragraph: null,
    eli: null,
    inkrafttreten: '2026-09-03',
    ausserkrafttreten: null,
  },
  citation_display: 'OLG 20260903_OLG0459_00600R00101/25b',
  content_urls: {
    html: 'https://www.ris.bka.gv.at/Dokumente/Justiz/JJT_20260903_OLG0459_00600R00101_25B0000_000/JJT_20260903_OLG0459_00600R00101_25B0000_000.html',
    xml: 'https://www.ris.bka.gv.at/Dokumente/Justiz/JJT_20260903_OLG0459_00600R00101_25B0000_000/JJT_20260903_OLG0459_00600R00101_25B0000_000.xml',
    pdf: 'https://www.ris.bka.gv.at/Dokumente/Justiz/JJT_20260903_OLG0459_00600R00101_25B0000_000/JJT_20260903_OLG0459_00600R00101_25B0000_000.pdf',
    rtf: 'https://www.ris.bka.gv.at/Dokumente/Justiz/JJT_20260903_OLG0459_00600R00101_25B0000_000/JJT_20260903_OLG0459_00600R00101_25B0000_000.rtf',
  },
  dokument_url:
    'https://ogd.ris.bka.gv.at/Dokument.wxe?Abfrage=Justiz&Dokumentnummer=JJT_20260903_OLG0459_00600R00101_25B0000_000',
  gesamte_rechtsvorschrift_url: null,
  gericht: 'OLG Linz',
  geschaeftszahl: '6R101/25b',
  entscheidungsdatum: '2026-09-03',
  rechtssatznummer: null,
};

describe('toStructuredDocument', () => {
  it('keeps only the html and pdf renditions', () => {
    const doc = toStructuredDocument(LAW);

    expect(doc.content_urls).toEqual({ html: LAW.content_urls.html, pdf: LAW.content_urls.pdf });
  });

  it('drops the top-level kurztitel, which always equals titel', () => {
    const doc = toStructuredDocument(LAW);

    expect(doc).not.toHaveProperty('kurztitel');
    expect(doc.titel).toBe('ABGB');
  });

  it('drops citation.kurztitel and keeps every other citation field', () => {
    const { citation } = toStructuredDocument(LAW);

    expect(citation).toEqual({
      langtitel: 'Allgemeines bürgerliches Gesetzbuch',
      kundmachungsorgan: 'JGS Nr. 946/1811',
      paragraph: '§ 1295',
      eli: null,
      inkrafttreten: '2002-01-01',
      ausserkrafttreten: null,
    });
  });

  it('keeps the citation line and both document links', () => {
    const doc = toStructuredDocument(LAW);

    expect(doc.citation_display).toBe('§ 1295 ABGB (JGS Nr. 946/1811)');
    expect(doc.dokument_url).toBe(LAW.dokument_url);
    expect(doc.gesamte_rechtsvorschrift_url).toBe(LAW.gesamte_rechtsvorschrift_url);
  });

  it('keeps the four court fields on a decision, null ones included', () => {
    const doc = toStructuredDocument(DECISION);

    expect(doc).toMatchObject({
      gericht: 'OLG Linz',
      geschaeftszahl: '6R101/25b',
      entscheidungsdatum: '2026-09-03',
      rechtssatznummer: null,
    });
    // The widget tells a decision from a law by the presence of these keys.
    expect('rechtssatznummer' in doc).toBe(true);
  });

  it('adds no court keys to a law', () => {
    const doc = toStructuredDocument(LAW);

    expect('gericht' in doc).toBe(false);
    expect('geschaeftszahl' in doc).toBe(false);
  });

  it('does not mutate its input', () => {
    const before = structuredClone(DECISION);

    toStructuredDocument(DECISION);

    expect(DECISION).toEqual(before);
  });

  it.each([
    ['a law', LAW],
    ['a decision', DECISION],
  ])('satisfies StructuredDocumentSchema for %s', (_label, input) => {
    expect(StructuredDocumentSchema.safeParse(toStructuredDocument(input)).success).toBe(true);
  });
});

/** A law with a unique id; the long Langtitel makes every document weigh the same. */
function law(index: number): Document {
  return {
    ...LAW,
    dokumentnummer: `NOR${String(index).padStart(8, '0')}`,
    citation: { ...LAW.citation, langtitel: 'Bundesgesetz '.repeat(30).trim() },
  };
}

function resultOf(count: number, pageSize: number, page = 1, totalHits = 1000): SearchResult {
  return {
    total_hits: totalHits,
    page,
    page_size: pageSize,
    has_more: page * pageSize < totalHits,
    documents: Array.from({ length: count }, (_, i) => law(i)),
  };
}

const ECHO = { tool: 'ris_bundesrecht', suchworte: 'Bundesgesetz', limit: 100, seite: 1 };

/** Serialized size of one lean document — the unit every budget below is expressed in. */
const D = JSON.stringify(toStructuredDocument(law(0))).length;

describe('fitStructuredSearchPage', () => {
  it('returns the page untouched when it fits the budget', () => {
    const result = resultOf(20, 20);

    const page = fitStructuredSearchPage(result, { ...ECHO, limit: 20 }, 1_000_000);

    expect(page.downgrade).toBeNull();
    expect(page.notice).toBeNull();
    expect(page.result).toBe(result);
    expect(page.structured).toMatchObject({
      total_hits: 1000,
      page: 1,
      page_size: 20,
      has_more: true,
      query: { limit: 20, seite: 1 },
    });
    expect(page.structured).not.toHaveProperty('notice');
    expect((page.structured.documents as unknown[]).length).toBe(20);
  });

  it('delivers 50 of an over-budget 100-page and repoints the echo', () => {
    const page = fitStructuredSearchPage(resultOf(100, 100), ECHO, 60 * D + 500);

    expect(page.downgrade).toEqual({ from: 100, to: 50 });
    expect(page.result.documents).toHaveLength(50);
    expect(page.result).toMatchObject({ page: 1, page_size: 50, has_more: true });
    expect(page.structured).toMatchObject({
      page: 1,
      page_size: 50,
      has_more: true,
      query: { ...ECHO, limit: 50, seite: 1 },
    });
    expect((page.structured.documents as unknown[]).length).toBe(50);
    expect(page.structured.notice).toBe(page.notice);
    expect(page.notice).toBe(
      'Seitengröße von 100 auf 50 reduziert, damit die Antwort in den Client passt. Nächste Seite: seite=2, limit=50 (Treffer 51–100).',
    );
  });

  it('falls through to 20 when 50 does not fit either', () => {
    const page = fitStructuredSearchPage(resultOf(100, 100), ECHO, 30 * D + 500);

    expect(page.downgrade).toEqual({ from: 100, to: 20 });
    expect(page.structured).toMatchObject({
      page: 1,
      page_size: 20,
      query: { limit: 20, seite: 1 },
    });
    expect(page.notice).toContain('seite=2, limit=20 (Treffer 21–40)');
  });

  it('keeps the offset exact on a deeper page', () => {
    // Page 3 of 100 starts at hit 201; as 50s that is page 5.
    const page = fitStructuredSearchPage(
      resultOf(100, 100, 3),
      { ...ECHO, seite: 3 },
      60 * D + 500,
    );

    expect(page.structured).toMatchObject({
      page: 5,
      page_size: 50,
      has_more: true,
      query: { limit: 50, seite: 5 },
    });
    expect(page.notice).toContain('seite=6, limit=50 (Treffer 251–300)');
  });

  it('skips a size that does not divide the offset', () => {
    // Page 2 of 50 starts at hit 51: 20 does not divide 50, 10 does — page 6 of 10.
    const page = fitStructuredSearchPage(
      resultOf(50, 50, 2),
      { ...ECHO, limit: 50, seite: 2 },
      30 * D + 500,
    );

    expect(page.downgrade).toEqual({ from: 50, to: 10 });
    expect(page.structured).toMatchObject({
      page: 6,
      page_size: 10,
      query: { limit: 10, seite: 6 },
    });
    expect(page.notice).toContain('seite=7, limit=10 (Treffer 61–70)');
  });

  it('recomputes has_more from the delivered size and caps the hint at total_hits', () => {
    // 60 hits in total, all on one 100-page: the first 50 leave 10 more.
    const page = fitStructuredSearchPage(resultOf(60, 100, 1, 60), ECHO, 55 * D + 500);

    expect(page.structured).toMatchObject({ page_size: 50, has_more: true });
    expect(page.notice).toContain('(Treffer 51–60)');
  });

  it('omits the next-page hint when the delivered page already holds every hit', () => {
    // Only reachable through the nothing-fits fallback: 10 hits, all delivered.
    const page = fitStructuredSearchPage(resultOf(10, 100, 1, 10), ECHO, 100);

    expect(page.downgrade).toEqual({ from: 100, to: 10 });
    expect(page.structured).toMatchObject({ page: 1, page_size: 10, has_more: false });
    expect(page.notice).toBe(
      'Seitengröße von 100 auf 10 reduziert, damit die Antwort in den Client passt.',
    );
  });

  it('delivers the smallest size even when nothing fits', () => {
    const page = fitStructuredSearchPage(resultOf(100, 100), ECHO, 100);

    expect(page.downgrade).toEqual({ from: 100, to: 10 });
    expect((page.structured.documents as unknown[]).length).toBe(10);
  });

  it('leaves an over-budget 10-page alone — there is nothing smaller', () => {
    const result = resultOf(10, 10);

    const page = fitStructuredSearchPage(result, { ...ECHO, limit: 10 }, 100);

    expect(page.downgrade).toBeNull();
    expect(page.result).toBe(result);
  });

  it('only projects when the echo names no limit to re-page with', () => {
    const page = fitStructuredSearchPage(resultOf(100, 100), { tool: 'ris_bundesrecht' }, 100);

    expect(page.downgrade).toBeNull();
    expect((page.structured.documents as unknown[]).length).toBe(100);
    expect(page.structured.documents).toEqual(
      resultOf(100, 100).documents.map(toStructuredDocument),
    );
  });
});

describe('structuredContentBudget', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to 45 000 characters', () => {
    vi.stubEnv('RIS_STRUCTURED_CONTENT_BUDGET', undefined);

    expect(structuredContentBudget()).toBe(45_000);
    expect(DEFAULT_STRUCTURED_CONTENT_BUDGET).toBe(45_000);
  });

  it('reads a positive integer from RIS_STRUCTURED_CONTENT_BUDGET', () => {
    vi.stubEnv('RIS_STRUCTURED_CONTENT_BUDGET', '120000');

    expect(structuredContentBudget()).toBe(120_000);
  });

  it.each(['abc', '0', '-5', '1.5', ''])('falls back to the default for %j', (raw) => {
    vi.stubEnv('RIS_STRUCTURED_CONTENT_BUDGET', raw);

    expect(structuredContentBudget()).toBe(45_000);
  });

  it('is the default budget of fitStructuredSearchPage', () => {
    vi.stubEnv('RIS_STRUCTURED_CONTENT_BUDGET', String(30 * D + 500));

    const page = fitStructuredSearchPage(resultOf(100, 100), ECHO);

    expect(page.downgrade).toEqual({ from: 100, to: 20 });
  });

  it('downgrades a 50-hit page that Claude Code rejects at ~58k under the default budget', () => {
    vi.stubEnv('RIS_STRUCTURED_CONTENT_BUDGET', undefined);

    // 50 documents that serialize to just under 60 000 characters — the
    // 58 659-character page measured live on 2026-09-08 (#106): under the old
    // 60 000 default it was delivered as is and Claude Code rejected it.
    const heavy = resultOf(50, 50);
    const unpadded = JSON.stringify(
      fitStructuredSearchPage(heavy, { ...ECHO, limit: 50 }, Number.MAX_SAFE_INTEGER).structured,
    ).length;
    const padding = 'x'.repeat(Math.ceil((58_000 - unpadded) / 50));
    for (const doc of heavy.documents) {
      doc.titel = doc.titel + padding;
    }

    const page = fitStructuredSearchPage(heavy, { ...ECHO, limit: 50 });

    expect(page.downgrade).toEqual({ from: 50, to: 20 });
    expect(JSON.stringify(page.structured).length).toBeLessThanOrEqual(45_000);
  });
});
