/**
 * Test-only payloads mirroring the `structuredContent` the search tools ship.
 *
 * The documents are copied from `src/__tests__/fixtures/search-output-baseline.json`
 * (a recorded RIS response) and extended with the fields #47 added — the
 * baseline predates them. Nothing here is imported by the widget entry, so the
 * bundle never sees it.
 */

import type { SearchDocument, SearchResultPayload } from '../trefferliste/viewmodel.js';

/** A consolidated federal law: no court fields at all. */
export const LAW_DOCUMENT: SearchDocument = {
  dokumentnummer: 'NOR40198929',
  applikation: 'BrKons',
  titel: 'Allgemeines bürgerliches Gesetzbuch',
  kurztitel: 'Allgemeines bürgerliches Gesetzbuch',
  citation: {
    kurztitel: 'Allgemeines bürgerliches Gesetzbuch',
    langtitel:
      'Allgemeines bürgerliches Gesetzbuch für die gesammten deutschen Erbländer der Oesterreichischen Monarchie<br/>StF: JGS Nr. 946/1811',
    kundmachungsorgan: 'JGS Nr. 946/1811',
    paragraph: '§ 0',
    eli: 'https://ris.bka.gv.at/eli/jgs/1811/946/P0/NOR40198929',
    inkrafttreten: '1812-01-01',
    ausserkrafttreten: null,
  },
  citation_display: '§ 0 Allgemeines bürgerliches Gesetzbuch (JGS Nr. 946/1811)',
  content_urls: {
    html: 'https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR40198929/NOR40198929.html',
    xml: 'https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR40198929/NOR40198929.xml',
    pdf: 'https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR40198929/NOR40198929.pdf',
    rtf: 'https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR40198929/NOR40198929.rtf',
  },
  dokument_url: 'https://www.ris.bka.gv.at/eli/jgs/1811/946/P0/NOR40198929',
  gesamte_rechtsvorschrift_url:
    'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10001622',
};

/** Second law document, without a PDF rendition. */
export const LAW_DOCUMENT_WITHOUT_PDF: SearchDocument = {
  ...LAW_DOCUMENT,
  dokumentnummer: 'NOR12017691',
  citation_display: '§ 1 Allgemeines bürgerliches Gesetzbuch (JGS Nr. 946/1811)',
  content_urls: {
    xml: 'https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR12017691/NOR12017691.xml',
    html: null,
    pdf: null,
    rtf: null,
  },
  dokument_url: 'https://www.ris.bka.gv.at/eli/jgs/1811/946/P1/NOR12017691',
};

/**
 * An OGH Rechtssatz whose `geschaeftszahl` is a chain of 62 case numbers, and
 * whose `titel` is that same chain — long enough that the server's
 * `citation_display` falls back to the plain document number.
 */
export const JUSTIZ_CHAIN_DOCUMENT: SearchDocument = {
  dokumentnummer: 'JJR_19901010_OGH0002_0020OB00535_9000000_001',
  applikation: 'Justiz',
  titel: '2Ob535/90; 1Ob564/95; 1Ob140/00w; 3Ob127/04d; 6Ob27/05x; 1Ob14/05y; 3Ob24/05h',
  kurztitel: '2Ob535/90; 1Ob564/95; 1Ob140/00w; 3Ob127/04d; 6Ob27/05x; 1Ob14/05y; 3Ob24/05h',
  citation: {
    kurztitel: '2Ob535/90; 1Ob564/95',
    langtitel: null,
    kundmachungsorgan: null,
    paragraph: null,
    eli: null,
    inkrafttreten: '2026-06-23',
    ausserkrafttreten: null,
  },
  citation_display: 'JJR_19901010_OGH0002_0020OB00535_9000000_001',
  content_urls: {
    html: 'https://www.ris.bka.gv.at/Dokumente/Justiz/JJR_19901010_OGH0002_0020OB00535_9000000_001/JJR_19901010_OGH0002_0020OB00535_9000000_001.html',
    xml: 'https://www.ris.bka.gv.at/Dokumente/Justiz/JJR_19901010_OGH0002_0020OB00535_9000000_001/JJR_19901010_OGH0002_0020OB00535_9000000_001.xml',
    pdf: 'https://www.ris.bka.gv.at/Dokumente/Justiz/JJR_19901010_OGH0002_0020OB00535_9000000_001/JJR_19901010_OGH0002_0020OB00535_9000000_001.pdf',
    rtf: null,
  },
  dokument_url: null,
  gesamte_rechtsvorschrift_url: null,
  gericht: 'OGH',
  geschaeftszahl: '2Ob535/90; 1Ob564/95; 1Ob140/00w',
  entscheidungsdatum: '1990-10-10',
  rechtssatznummer: 'RS0018547',
};

/**
 * A VwGH decision: single case number, and a bare-ordinal `rechtssatznummer`
 * that must never be reformatted into an RS-prefixed one.
 */
export const VWGH_DOCUMENT: SearchDocument = {
  dokumentnummer: 'JWR_2025090038_20260624L04',
  applikation: 'Vwgh',
  titel: 'Ra 2025/09/0038',
  kurztitel: null,
  citation: {
    kurztitel: null,
    langtitel: null,
    kundmachungsorgan: null,
    paragraph: null,
    eli: null,
    inkrafttreten: '2026-06-24',
    ausserkrafttreten: null,
  },
  citation_display: 'Ra 2025/09/0038',
  content_urls: {
    html: 'https://www.ris.bka.gv.at/Dokumente/Vwgh/JWR_2025090038_20260624L04/JWR_2025090038_20260624L04.html',
    xml: null,
    pdf: null,
    rtf: null,
  },
  dokument_url: null,
  gesamte_rechtsvorschrift_url: null,
  gericht: 'Verwaltungsgerichtshof',
  geschaeftszahl: 'Ra 2025/09/0038',
  entscheidungsdatum: '2026-06-24',
  rechtssatznummer: '4',
};

/** Page 1 of a Bundesrecht search with further pages available. */
export const LAW_RESULT: SearchResultPayload = {
  total_hits: 2570,
  page: 1,
  page_size: 20,
  has_more: true,
  documents: [LAW_DOCUMENT, LAW_DOCUMENT_WITHOUT_PDF],
  query: {
    tool: 'ris_bundesrecht',
    applikation: 'BrKons',
    suchworte: 'Schadenersatz',
    abschnitt_typ: 'Paragraph',
    seite: 1,
    limit: 20,
  },
};

/** Judikatur results, second page, last page. */
export const COURT_RESULT: SearchResultPayload = {
  total_hits: 24,
  page: 2,
  page_size: 20,
  has_more: false,
  documents: [JUSTIZ_CHAIN_DOCUMENT, VWGH_DOCUMENT],
  query: {
    tool: 'ris_judikatur',
    gerichtsbarkeit: 'Justiz',
    suchworte: 'Verjährung',
    seite: 2,
    limit: 20,
  },
};

/** A search that matched nothing. */
export const EMPTY_RESULT: SearchResultPayload = {
  total_hits: 0,
  page: 1,
  page_size: 20,
  has_more: false,
  documents: [],
  query: { tool: 'ris_bundesrecht', suchworte: 'xyzzy', seite: 1, limit: 20 },
};
