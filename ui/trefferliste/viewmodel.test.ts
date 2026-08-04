import { describe, expect, it } from 'vitest';

import { JUDIKATUR_GERICHTSBARKEITEN } from '../../src/facets.js';
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
  facetControls,
  facetQuery,
  fassungControl,
  fassungQuery,
  fullTextPrompt,
  gerichtsbarkeitLabel,
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

  // toViewModel reads doc.content_urls.* and doc.citation.* directly. Letting a
  // document through without them would throw inside the render and strand the
  // widget on its loading skeleton, so they are part of the contract check.
  it.each([
    ['content_urls', { ...LAW_DOCUMENT, content_urls: undefined }],
    ['citation', { ...LAW_DOCUMENT, citation: undefined }],
    ['a content_urls that is not an object', { ...LAW_DOCUMENT, content_urls: 'nope' }],
    ['a citation that is not an object', { ...LAW_DOCUMENT, citation: [] }],
  ])('rejects a document without %s', (_label, doc) => {
    expect(parseSearchResult({ ...LAW_RESULT, documents: [doc] })).toBeNull();
  });

  it('never yields a result that toViewModel cannot render', () => {
    for (const broken of [
      { ...LAW_DOCUMENT, content_urls: undefined },
      { ...LAW_DOCUMENT, citation: undefined },
    ]) {
      const parsed = parseSearchResult({ ...LAW_RESULT, documents: [broken] });
      expect(parsed).toBeNull();
    }

    // The guard is what stands between a malformed payload and a thrown render.
    expect(() =>
      toViewModel({
        ...LAW_RESULT,
        documents: [{ ...LAW_DOCUMENT, content_urls: undefined }],
      } as unknown as Parameters<typeof toViewModel>[0]),
    ).toThrow();
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

  it('offers the Rechtslage control for a law search', () => {
    expect(toViewModel(LAW_RESULT).fassung).toEqual({ value: '' });
  });

  it('offers no Rechtslage control for a Judikatur search', () => {
    expect(toViewModel(COURT_RESULT).fassung).toBeNull();
  });

  it('offers the facet row for a Judikatur search and nothing else', () => {
    expect(toViewModel(COURT_RESULT).facets?.gerichtsbarkeit.value).toBe('Justiz');
    expect(toViewModel(LAW_RESULT).facets).toBeNull();
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

describe('fassungControl', () => {
  it('offers the control for a Bundesrecht query without a date', () => {
    expect(fassungControl(LAW_RESULT.query)).toEqual({ value: '' });
  });

  it('carries the echoed date', () => {
    expect(
      fassungControl({ ...LAW_RESULT.query, tool: 'ris_landesrecht', fassung_vom: '2020-01-01' }),
    ).toEqual({
      value: '2020-01-01',
    });
  });

  it('stays away from other tools and from a missing echo', () => {
    expect(fassungControl(COURT_RESULT.query)).toBeNull();
    expect(fassungControl(undefined)).toBeNull();
  });

  it('stays away from the English translations, which have no dated Fassung', () => {
    expect(
      fassungControl({ ...LAW_RESULT.query, tool: 'ris_bundesrecht', applikation: 'Erv' }),
    ).toBeNull();
  });
});

describe('fassungQuery', () => {
  it('re-issues the search with the date and resets the page', () => {
    const call = fassungQuery(
      { ...LAW_RESULT.query, tool: 'ris_bundesrecht', seite: 4 },
      '2020-01-01',
    );
    expect(call).toEqual({
      name: 'ris_bundesrecht',
      arguments: {
        applikation: 'BrKons',
        suchworte: 'Schadenersatz',
        abschnitt_typ: 'Paragraph',
        limit: 20,
        seite: 1,
        fassung_vom: '2020-01-01',
      },
    });
  });

  it('drops the date entirely when cleared', () => {
    const call = fassungQuery(
      { ...LAW_RESULT.query, tool: 'ris_bundesrecht', fassung_vom: '2020-01-01' },
      null,
    );
    expect(call?.arguments).not.toHaveProperty('fassung_vom');
    expect(call?.arguments.seite).toBe(1);
  });

  it('refuses other tools and a missing echo', () => {
    expect(fassungQuery(COURT_RESULT.query, '2020-01-01')).toBeNull();
    expect(fassungQuery(undefined, '2020-01-01')).toBeNull();
  });

  it('refuses the English translations, whose results would ignore the date', () => {
    expect(
      fassungQuery(
        { ...LAW_RESULT.query, tool: 'ris_bundesrecht', applikation: 'Erv' },
        '2020-01-01',
      ),
    ).toBeNull();
  });
});

/**
 * The Judikatur echo as the server really ships it: `gerichtsbarkeit` and
 * `dokumenttyp` are zod defaults, so they are materialized in every echo even
 * when the caller named neither. The fixture predates `dokumenttyp`.
 */
const JUDIKATUR_ECHO = { ...COURT_RESULT.query, tool: 'ris_judikatur', dokumenttyp: 'beide' };

/** The same search with all three Justiz-bound filters set, on a later page. */
const FILTERED_ECHO = {
  ...JUDIKATUR_ECHO,
  gericht: 'OGH',
  rechtsgebiet: 'Zivilrecht',
  fachgebiet: 'Arbeitsrecht',
  seite: 4,
};

describe('facetControls', () => {
  it('stays away from other tools and from a missing echo', () => {
    expect(facetControls(LAW_RESULT.query)).toBeNull();
    expect(facetControls(undefined)).toBeNull();
  });

  it('offers every jurisdiction, with the echoed one as the current value', () => {
    const controls = facetControls(JUDIKATUR_ECHO);

    expect(controls?.gerichtsbarkeit.value).toBe('Justiz');
    expect(controls?.gerichtsbarkeit.options).toHaveLength(16);
    expect(controls?.gerichtsbarkeit.options[0]).toEqual({
      value: 'Justiz',
      label: 'Justiz (OGH/OLG/LG/BG)',
    });
    expect(controls?.gerichtsbarkeit.options).toContainEqual({ value: 'Vwgh', label: 'VwGH' });
  });

  it('offers the three document kinds', () => {
    expect(facetControls(JUDIKATUR_ECHO)?.dokumenttyp).toEqual({
      value: 'beide',
      options: [
        { value: 'rechtssatz', label: 'Rechtssätze' },
        { value: 'entscheidungstext', label: 'Entscheidungstexte' },
        { value: 'beide', label: 'Rechtssätze + Entscheidungen' },
      ],
    });
  });

  it('offers the legal areas only for Justiz, where RIS honours them', () => {
    expect(facetControls(JUDIKATUR_ECHO)?.rechtsgebiet).toEqual({
      value: '',
      options: [
        { value: 'Zivilrecht', label: 'Zivilrecht' },
        { value: 'Strafrecht', label: 'Strafrecht' },
      ],
    });
    expect(facetControls({ ...JUDIKATUR_ECHO, gerichtsbarkeit: 'Vwgh' })?.rechtsgebiet).toBeNull();
  });

  it('carries the echoed legal area', () => {
    expect(facetControls(FILTERED_ECHO)?.rechtsgebiet?.value).toBe('Zivilrecht');
  });

  it('reports the court filter only when the echo carries one', () => {
    expect(facetControls(FILTERED_ECHO)?.gericht).toBe('OGH');
    expect(facetControls(JUDIKATUR_ECHO)?.gericht).toBeNull();
  });

  // A jurisdiction the widget has never heard of must still be selectable as
  // the current state — otherwise the select would silently claim the search
  // ran somewhere else.
  it('keeps an unknown echoed jurisdiction representable, labelled with its raw value', () => {
    const controls = facetControls({ ...JUDIKATUR_ECHO, gerichtsbarkeit: 'Hexenkammer' });

    expect(controls?.gerichtsbarkeit.value).toBe('Hexenkammer');
    expect(controls?.gerichtsbarkeit.options).toHaveLength(17);
    expect(controls?.gerichtsbarkeit.options.at(-1)).toEqual({
      value: 'Hexenkammer',
      label: 'Hexenkammer',
    });
  });

  it('keeps an unknown echoed document kind and legal area representable too', () => {
    const controls = facetControls({
      ...JUDIKATUR_ECHO,
      dokumenttyp: 'gutachten',
      rechtsgebiet: 'Weltraumrecht',
    });

    expect(controls?.dokumenttyp.options).toHaveLength(4);
    expect(controls?.dokumenttyp.options.at(-1)).toEqual({
      value: 'gutachten',
      label: 'gutachten',
    });
    expect(controls?.rechtsgebiet?.options.at(-1)).toEqual({
      value: 'Weltraumrecht',
      label: 'Weltraumrecht',
    });
  });

  // Every live echo carries the zod default, so this is the shape of an echo
  // from somewhere else — a stale snapshot, another server. Inventing a value
  // would claim a filter the search never ran with.
  it('invents no value when the echo names no document kind', () => {
    const { dokumenttyp: _dokumenttyp, ...withoutTyp } = JUDIKATUR_ECHO;
    const controls = facetControls({ ...withoutTyp, tool: 'ris_judikatur' });

    expect(controls?.dokumenttyp.value).toBe('');
    expect(controls?.dokumenttyp.options).toHaveLength(3);
  });
});

describe('gerichtsbarkeitLabel', () => {
  it('names all sixteen jurisdictions in German', () => {
    expect(JUDIKATUR_GERICHTSBARKEITEN.map(gerichtsbarkeitLabel)).toEqual([
      'Justiz (OGH/OLG/LG/BG)',
      'VfGH',
      'VwGH',
      'BVwG',
      'LVwG',
      'Datenschutz (DSB)',
      'AsylGH (historisch)',
      'Normenliste',
      'PVAK',
      'Gleichbehandlungskommission',
      'Disziplinarkommission',
      'Vergabeamt (historisch)',
      'UVS (historisch)',
      'UBAS (historisch)',
      'Umweltsenat (historisch)',
      'BKS (historisch)',
    ]);
  });

  it('falls back to the raw value for a jurisdiction added server-side', () => {
    expect(gerichtsbarkeitLabel('Hexenkammer')).toBe('Hexenkammer');
  });
});

describe('facetQuery', () => {
  it('refuses other tools and a missing echo', () => {
    expect(facetQuery(LAW_RESULT.query, { dokumenttyp: 'beide' })).toBeNull();
    expect(facetQuery(undefined, { dokumenttyp: 'beide' })).toBeNull();
  });

  it('drops the Justiz-bound filters when the jurisdiction leaves Justiz', () => {
    expect(facetQuery(FILTERED_ECHO, { gerichtsbarkeit: 'Vwgh' })).toEqual({
      name: 'ris_judikatur',
      arguments: {
        gerichtsbarkeit: 'Vwgh',
        dokumenttyp: 'beide',
        suchworte: 'Verjährung',
        limit: 20,
        seite: 1,
      },
    });
  });

  it('keeps them when the jurisdiction stays Justiz', () => {
    const call = facetQuery(FILTERED_ECHO, { gerichtsbarkeit: 'Justiz' });

    expect(call?.arguments).toEqual({
      gerichtsbarkeit: 'Justiz',
      dokumenttyp: 'beide',
      suchworte: 'Verjährung',
      gericht: 'OGH',
      rechtsgebiet: 'Zivilrecht',
      fachgebiet: 'Arbeitsrecht',
      limit: 20,
      seite: 1,
    });
  });

  it('changes the document kind and leaves the rest of the search alone', () => {
    const call = facetQuery(FILTERED_ECHO, { dokumenttyp: 'entscheidungstext' });

    expect(call?.arguments).toEqual({
      gerichtsbarkeit: 'Justiz',
      dokumenttyp: 'entscheidungstext',
      suchworte: 'Verjährung',
      gericht: 'OGH',
      rechtsgebiet: 'Zivilrecht',
      fachgebiet: 'Arbeitsrecht',
      limit: 20,
      seite: 1,
    });
  });

  it('picks a legal area', () => {
    expect(facetQuery(JUDIKATUR_ECHO, { rechtsgebiet: 'Strafrecht' })?.arguments).toMatchObject({
      rechtsgebiet: 'Strafrecht',
      seite: 1,
    });
  });

  it('removes the legal area entirely for „alle" instead of sending an empty one', () => {
    const call = facetQuery(FILTERED_ECHO, { rechtsgebiet: null });

    expect(call?.arguments).not.toHaveProperty('rechtsgebiet');
    expect(call?.arguments).toMatchObject({ gericht: 'OGH', fachgebiet: 'Arbeitsrecht', seite: 1 });
  });

  it('removes the court filter and keeps the other filters', () => {
    const call = facetQuery(FILTERED_ECHO, { gericht: null });

    expect(call?.arguments).not.toHaveProperty('gericht');
    expect(call?.arguments).toMatchObject({
      rechtsgebiet: 'Zivilrecht',
      fachgebiet: 'Arbeitsrecht',
      seite: 1,
    });
  });

  it('resets to the first page on every change and never echoes the tool name', () => {
    for (const change of [
      { gerichtsbarkeit: 'Vwgh' },
      { dokumenttyp: 'rechtssatz' },
      { rechtsgebiet: 'Strafrecht' },
      { rechtsgebiet: null },
      { gericht: null },
    ] as const) {
      const call = facetQuery(FILTERED_ECHO, change);

      expect(call?.name).toBe('ris_judikatur');
      expect(call?.arguments.seite).toBe(1);
      expect(call?.arguments).not.toHaveProperty('tool');
    }
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
