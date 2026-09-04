/**
 * Tests for src/structured-search.ts — the lean structuredContent projection
 * of the search tools (#106).
 */

import { describe, expect, it } from 'vitest';

import { toStructuredDocument } from '../structured-search.js';
import { StructuredDocumentSchema, type Document } from '../types.js';

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
