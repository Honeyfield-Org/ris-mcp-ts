import { describe, expect, it } from 'vitest';

import {
  COURT_RESULT,
  DSB_DOCUMENT,
  EMPTY_RESULT,
  JUSTIZ_CHAIN_DOCUMENT,
  LAW_DOCUMENT,
  LAW_RESULT,
  LIVE_OGH_DOCUMENT,
  VWGH_DOCUMENT,
} from '../__fixtures__/search-results.js';

import {
  fullTextPrompt,
  nextQuery,
  parseSearchResult,
  splitCaseNumbers,
  toViewModel,
} from './viewmodel.js';

describe('parseSearchResult', () => {
  it('accepts the shipped structuredContent shape', () => {
    expect(parseSearchResult(LAW_RESULT)).toEqual(LAW_RESULT);
  });

  it('accepts a result without the optional query echo', () => {
    const { query: _query, ...withoutEcho } = LAW_RESULT;
    expect(parseSearchResult(withoutEcho)).toEqual(withoutEcho);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'total_hits: 3'],
    ['an array', [LAW_DOCUMENT]],
    ['an object without documents', { total_hits: 3, page: 1, page_size: 20, has_more: false }],
    ['documents that are not an array', { ...LAW_RESULT, documents: {} }],
    ['a non-numeric total_hits', { ...LAW_RESULT, total_hits: '2570' }],
    ['a non-numeric page', { ...LAW_RESULT, page: null }],
  ])('rejects %s', (_label, value) => {
    expect(parseSearchResult(value)).toBeNull();
  });

  it('rejects a document that is missing its identity fields', () => {
    expect(parseSearchResult({ ...LAW_RESULT, documents: [{ titel: 'ohne Nummer' }] })).toBeNull();
  });
});

describe('splitCaseNumbers', () => {
  it('splits a semicolon-separated chain', () => {
    expect(splitCaseNumbers('2Ob535/90; 1Ob564/95; 1Ob140/00w')).toEqual([
      '2Ob535/90',
      '1Ob564/95',
      '1Ob140/00w',
    ]);
  });

  it('keeps a single case number as a one-element chain', () => {
    expect(splitCaseNumbers('Ra 2025/09/0038')).toEqual(['Ra 2025/09/0038']);
  });

  it('drops empty segments and surrounding whitespace', () => {
    expect(splitCaseNumbers('  5Ob7/19v ;; 3Ob34/20a ; ')).toEqual(['5Ob7/19v', '3Ob34/20a']);
  });

  it.each([null, undefined, '', '   ', ';;'])('returns an empty chain for %p', (value) => {
    expect(splitCaseNumbers(value)).toEqual([]);
  });
});

describe('fullTextPrompt', () => {
  it('names the document and the tool that loads it', () => {
    expect(fullTextPrompt('NOR40198929')).toBe(
      'Bitte lade das Dokument NOR40198929 mit ris_dokument.',
    );
  });
});

describe('toViewModel — header', () => {
  it('labels the tool, the search term and the hit count', () => {
    const model = toViewModel(LAW_RESULT);

    expect(model.toolLabel).toBe('Bundesrecht');
    expect(model.queryLabel).toBe('Schadenersatz');
    expect(model.hitsLabel).toBe('2.570 Treffer');
  });

  it('reports the position of the current page inside the result set', () => {
    expect(toViewModel(LAW_RESULT).rangeLabel).toBe('1–2 von 2.570');
    expect(toViewModel(COURT_RESULT).rangeLabel).toBe('21–22 von 24');
  });

  it('uses the singular for a single hit', () => {
    expect(toViewModel({ ...LAW_RESULT, total_hits: 1 }).hitsLabel).toBe('1 Treffer');
  });

  it('falls back to the bare tool name when no label is known', () => {
    const model = toViewModel({ ...LAW_RESULT, query: { tool: 'ris_zukunft', seite: 1 } });

    expect(model.toolLabel).toBe('zukunft');
    expect(model.queryLabel).toBe('');
  });

  it('renders a header without a query echo', () => {
    const { query: _query, ...withoutEcho } = LAW_RESULT;
    const model = toViewModel(withoutEcho);

    expect(model.toolLabel).toBe('');
    expect(model.queryLabel).toBe('');
    expect(model.hitsLabel).toBe('2.570 Treffer');
  });
});

describe('toViewModel — pagination', () => {
  it('offers only the next page on page 1', () => {
    const model = toViewModel(LAW_RESULT);

    expect(model.page).toBe(1);
    expect(model.hasPrev).toBe(false);
    expect(model.hasNext).toBe(true);
  });

  it('offers only the previous page on the last page', () => {
    const model = toViewModel(COURT_RESULT);

    expect(model.hasPrev).toBe(true);
    expect(model.hasNext).toBe(false);
  });

  it('offers no pagination without a query echo, because the widget cannot re-issue the search', () => {
    const { query: _query, ...withoutEcho } = COURT_RESULT;
    const model = toViewModel(withoutEcho);

    expect(model.hasPrev).toBe(false);
    expect(model.hasNext).toBe(false);
  });
});

describe('toViewModel — empty result', () => {
  it('marks a zero-hit result as empty and shows no rows', () => {
    const model = toViewModel(EMPTY_RESULT);

    expect(model.isEmpty).toBe(true);
    expect(model.rows).toEqual([]);
    expect(model.hitsLabel).toBe('0 Treffer');
    expect(model.rangeLabel).toBe('');
  });
});

describe('toViewModel — law rows', () => {
  const [row, second] = toViewModel(LAW_RESULT).rows;

  it('uses the citation as the row title', () => {
    expect(row.title).toBe('§ 0 Allgemeines bürgerliches Gesetzbuch (JGS Nr. 946/1811)');
  });

  it('shows the work title underneath and the application as a badge', () => {
    expect(row.subtitle).toBe('Allgemeines bürgerliches Gesetzbuch');
    expect(row.badge).toBe('Bundesrecht');
  });

  it('carries the document number as the row id', () => {
    expect(row.id).toBe('NOR40198929');
  });

  it('has no court metadata and no case chain', () => {
    expect(row.isCourtDecision).toBe(false);
    expect(row.caseNumbers).toEqual([]);
    expect(row.meta.map((entry) => entry.label)).toEqual(['In Kraft seit', 'Dokumentnummer']);
  });

  it('links the HTML rendition and the PDF', () => {
    expect(row.risUrl).toBe(
      'https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR40198929/NOR40198929.html',
    );
    expect(row.pdfUrl).toBe(
      'https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR40198929/NOR40198929.pdf',
    );
  });

  it('falls back to dokument_url and offers no PDF when there is no rendition', () => {
    expect(second.risUrl).toBe('https://www.ris.bka.gv.at/eli/jgs/1811/946/P1/NOR12017691');
    expect(second.pdfUrl).toBeNull();
  });
});

describe('toViewModel — court rows', () => {
  const [chain, vwgh] = toViewModel(COURT_RESULT).rows;

  it('titles a chained Rechtssatz with its first case number instead of the document number', () => {
    expect(chain.title).toBe('2Ob535/90');
    expect(chain.caseNumbers).toEqual(['2Ob535/90', '1Ob564/95', '1Ob140/00w']);
  });

  it('marks court documents so the UI can show court metadata', () => {
    expect(chain.isCourtDecision).toBe(true);
    expect(vwgh.isCourtDecision).toBe(true);
  });

  it('lists court, decision date, case chain and Rechtssatz number as metadata', () => {
    expect(chain.meta).toEqual([
      { label: 'Gericht', value: 'OGH' },
      { label: 'Entscheidungsdatum', value: '10.10.1990' },
      { label: 'Geschäftszahl', value: '2Ob535/90; 1Ob564/95; 1Ob140/00w' },
      { label: 'Rechtssatznummer', value: 'RS0018547' },
      { label: 'Dokumentnummer', value: 'JJR_19901010_OGH0002_0020OB00535_9000000_001' },
    ]);
  });

  it('shows a bare-ordinal Rechtssatz number verbatim', () => {
    expect(vwgh.meta).toContainEqual({ label: 'Rechtssatznummer', value: '4' });
  });

  it('keeps the citation as the title when the server produced a real one', () => {
    expect(vwgh.title).toBe('Ra 2025/09/0038');
  });

  it('labels the applications with their short court names', () => {
    expect(chain.badge).toBe('Justiz');
    expect(vwgh.badge).toBe('VwGH');
  });

  it('drops a subtitle that only repeats the title', () => {
    expect(vwgh.subtitle).toBe('');
  });
});

describe('toViewModel — defensive display', () => {
  it('falls back to the document number when neither citation nor title exist', () => {
    const bare = { ...LAW_DOCUMENT, citation_display: '', titel: '', kurztitel: null };
    const [row] = toViewModel({ ...LAW_RESULT, documents: [bare] }).rows;

    expect(row.title).toBe('NOR40198929');
  });

  it('shows the raw application code when no German label is known', () => {
    const exotic = { ...LAW_DOCUMENT, applikation: 'PruefGewO' };
    const [row] = toViewModel({ ...LAW_RESULT, documents: [exotic] }).rows;

    expect(row.badge).toBe('PruefGewO');
  });

  it('leaves an unparseable decision date untouched rather than inventing one', () => {
    const odd = { ...VWGH_DOCUMENT, entscheidungsdatum: 'unbekannt' };
    const [row] = toViewModel({ ...COURT_RESULT, documents: [odd] }).rows;

    expect(row.meta).toContainEqual({ label: 'Entscheidungsdatum', value: 'unbekannt' });
  });

  it('omits court metadata rows whose value is null', () => {
    const sparse = { ...JUSTIZ_CHAIN_DOCUMENT, gericht: null, rechtssatznummer: null };
    const [row] = toViewModel({ ...COURT_RESULT, documents: [sparse] }).rows;

    expect(row.meta.map((entry) => entry.label)).toEqual([
      'Entscheidungsdatum',
      'Geschäftszahl',
      'Dokumentnummer',
    ]);
  });

  it('offers no link at all when the document carries no URL', () => {
    const linkless = {
      ...VWGH_DOCUMENT,
      content_urls: {},
      dokument_url: null,
    };
    const [row] = toViewModel({ ...COURT_RESULT, documents: [linkless] }).rows;

    expect(row.risUrl).toBeNull();
    expect(row.pdfUrl).toBeNull();
  });
});

describe('nextQuery', () => {
  it('re-issues the same search one page further', () => {
    expect(nextQuery(LAW_RESULT.query, 1)).toEqual({
      name: 'ris_bundesrecht',
      arguments: {
        applikation: 'BrKons',
        suchworte: 'Schadenersatz',
        abschnitt_typ: 'Paragraph',
        seite: 2,
        limit: 20,
      },
    });
  });

  it('steps back a page', () => {
    expect(nextQuery(COURT_RESULT.query, -1)?.arguments.seite).toBe(1);
  });

  it('drops the tool name from the arguments', () => {
    expect(nextQuery(LAW_RESULT.query, 1)?.arguments).not.toHaveProperty('tool');
  });

  it('starts from page 1 when the echo carries no seite', () => {
    expect(nextQuery({ tool: 'ris_bundesrecht', suchworte: 'x' }, 1)?.arguments.seite).toBe(2);
  });

  it('refuses to page before the first page', () => {
    expect(nextQuery(LAW_RESULT.query, -1)).toBeNull();
  });

  it('refuses to page without a query echo', () => {
    expect(nextQuery(undefined, 1)).toBeNull();
  });

  it('refuses to page when the echo names no tool', () => {
    expect(nextQuery({ tool: '', seite: 1 }, 1)).toBeNull();
  });
});

describe('toViewModel — court rows against live shapes', () => {
  it('titles a decision by its case number, not by the id-derived citation', () => {
    const [row] = toViewModel({ ...COURT_RESULT, documents: [LIVE_OGH_DOCUMENT] }).rows;

    expect(row.title).toBe('1Ob49/01i');
  });

  it('drops a subtitle that only repeats the case chain', () => {
    const [row] = toViewModel({ ...COURT_RESULT, documents: [LIVE_OGH_DOCUMENT] }).rows;

    expect(row.subtitle).toBe('');
  });

  it('keeps a subtitle that says something the case number does not', () => {
    const [row] = toViewModel({ ...COURT_RESULT, documents: [DSB_DOCUMENT] }).rows;

    expect(row.title).toBe('2025-1.043.098');
    expect(row.subtitle).toBe('Geheimhaltung, Löschung, Rechtmäßigkeit der Verarbeitung');
  });

  it('falls back to the citation for a decision without a case number', () => {
    const withoutCase = { ...LIVE_OGH_DOCUMENT, geschaeftszahl: null };
    const [row] = toViewModel({ ...COURT_RESULT, documents: [withoutCase] }).rows;

    expect(row.title).toBe('OGH 20011022_OGH0002_0010OB00049/01i');
  });

  it('leaves law rows on their citation, which is the useful headline there', () => {
    const [row] = toViewModel(LAW_RESULT).rows;

    expect(row.title).toBe('§ 0 Allgemeines bürgerliches Gesetzbuch (JGS Nr. 946/1811)');
  });
});
