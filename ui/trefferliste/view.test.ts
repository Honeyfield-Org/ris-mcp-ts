import { beforeEach, describe, expect, it, vi } from 'vitest';

import { COURT_RESULT, EMPTY_RESULT, LAW_RESULT } from '../__fixtures__/search-results.js';
import { COPY } from '../shared/states.js';

import {
  focusFacet,
  focusFassung,
  focusPagination,
  interpretPayload,
  renderResults,
  type ResultHandlers,
} from './view.js';
import { toViewModel, type SearchResultPayload } from './viewmodel.js';

function handlers(): ResultHandlers {
  return {
    onOpen: vi.fn(),
    onPdf: vi.fn(),
    onFullText: vi.fn(),
    onPage: vi.fn(),
    onFassungVom: vi.fn(),
    onFacet: vi.fn(),
  };
}

/** The Bundesrecht fixture with a legal-state date already picked. */
const DATED_LAW_RESULT = {
  ...LAW_RESULT,
  query: { ...LAW_RESULT.query, tool: 'ris_bundesrecht', fassung_vom: '2020-01-01' },
};

/** The Judikatur fixture with every facet the echo can carry set. */
const FILTERED_COURT_RESULT: SearchResultPayload = {
  ...COURT_RESULT,
  query: {
    ...COURT_RESULT.query,
    tool: 'ris_judikatur',
    dokumenttyp: 'beide',
    rechtsgebiet: 'Zivilrecht',
    gericht: 'OGH',
  },
};

/** The same search outside Justiz, where RIS honours no legal area. */
const VWGH_COURT_RESULT: SearchResultPayload = {
  ...COURT_RESULT,
  query: { ...COURT_RESULT.query, tool: 'ris_judikatur', gerichtsbarkeit: 'Vwgh' },
};

/** An echo naming a jurisdiction this widget's vocabulary does not know. */
const UNKNOWN_COURT_RESULT: SearchResultPayload = {
  ...COURT_RESULT,
  query: { ...COURT_RESULT.query, tool: 'ris_judikatur', gerichtsbarkeit: 'Hexenkammer' },
};

/** A Judikatur search that matched nothing — facets are all that is left. */
const EMPTY_COURT_RESULT: SearchResultPayload = {
  ...COURT_RESULT,
  total_hits: 0,
  has_more: false,
  documents: [],
};

function render(result = LAW_RESULT, actions = handlers()): [HTMLElement, ResultHandlers] {
  const container = document.createElement('div');
  renderResults(container, toViewModel(result), actions);
  return [container, actions];
}

function buttonLabelled(container: HTMLElement, label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === label,
  );
  if (!match) throw new Error(`no button labelled "${label}"`);
  return match;
}

function facetSelect(container: HTMLElement, facet: string): HTMLSelectElement {
  const select = container.querySelector<HTMLSelectElement>(
    `.ris-facet-${facet} .ris-facet-select`,
  );
  if (!select) throw new Error(`no select for the facet "${facet}"`);
  return select;
}

/** Pick an option the way a user does — assignment alone fires no event. */
function choose(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('renderResults — header', () => {
  it('shows the tool, the query and the hit count', () => {
    const [container] = render();

    expect(container.querySelector('.ris-tool-badge')?.textContent).toBe('Bundesrecht');
    expect(container.querySelector('.ris-query')?.textContent).toBe('Schadenersatz');
    expect(container.querySelector('.ris-hits')?.textContent).toBe('2.570 Treffer');
  });

  it('leaves out the tool badge and query when the result carries no echo', () => {
    const { query: _query, ...withoutEcho } = LAW_RESULT;
    const [container] = render(withoutEcho);

    expect(container.querySelector('.ris-tool-badge')).toBeNull();
    expect(container.querySelector('.ris-query')).toBeNull();
    expect(container.querySelector('.ris-hits')?.textContent).toBe('2.570 Treffer');
  });

  it('renders the Rechtslage-am control when the model offers one', () => {
    const [container] = render(DATED_LAW_RESULT);
    const input = container.querySelector<HTMLInputElement>('.ris-fassung-input');

    expect(container.querySelector('.ris-fassung-label')?.textContent).toBe('Rechtslage am');
    expect(input?.type).toBe('date');
    expect(input?.value).toBe('2020-01-01');
  });

  it('leaves the header without the control otherwise', () => {
    const [container] = render(COURT_RESULT);

    expect(container.querySelector('.ris-fassung')).toBeNull();
  });

  it('places the control before the hit count', () => {
    const [container] = render(DATED_LAW_RESULT);
    const parts = [...(container.querySelector('.ris-header')?.children ?? [])];
    const fassung = parts.findIndex((node) => node.classList.contains('ris-fassung'));
    const hits = parts.findIndex((node) => node.classList.contains('ris-hits'));

    // Both facts matter: the control belongs to the header rather than sitting
    // above it, and the hit count keeps the last slot it is right-aligned into.
    expect(fassung).toBeGreaterThanOrEqual(0);
    expect(fassung).toBeLessThan(hits);
  });

  it('reports a picked date and a cleared one', () => {
    const [container, actions] = render(DATED_LAW_RESULT);
    const input = container.querySelector<HTMLInputElement>('.ris-fassung-input');
    if (!input) throw new Error('no date input rendered');

    input.value = '2021-06-15';
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(actions.onFassungVom).toHaveBeenCalledWith('2021-06-15');

    input.value = '';
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(actions.onFassungVom).toHaveBeenLastCalledWith(null);
  });
});

describe('renderResults — facet row', () => {
  it('renders a labelled select per facet the model offers', () => {
    const [container] = render(COURT_RESULT);

    expect(facetSelect(container, 'gerichtsbarkeit').value).toBe('Justiz');
    expect(
      container.querySelector('.ris-facet-gerichtsbarkeit .ris-facet-label')?.textContent,
    ).toBe('Gerichtsbarkeit');
    expect(container.querySelector('.ris-facet-dokumenttyp .ris-facet-label')?.textContent).toBe(
      'Dokumenttyp',
    );
    expect(container.querySelector('.ris-facet-rechtsgebiet .ris-facet-label')?.textContent).toBe(
      'Rechtsgebiet',
    );
  });

  it('renders no row for a search that has no facets', () => {
    const [container] = render(LAW_RESULT);

    expect(container.querySelector('.ris-facets')).toBeNull();
  });

  it('places the row between the header and the list', () => {
    const [container] = render(COURT_RESULT);

    expect([...container.children].map((node) => node.className)).toEqual([
      'ris-header',
      'ris-facets',
      'ris-rows',
      'ris-footer',
    ]);
  });

  it('orders the row: jurisdiction, document kind, legal area, court chip', () => {
    const [container] = render(FILTERED_COURT_RESULT);
    const row = container.querySelector('.ris-facets');

    expect([...(row?.children ?? [])].map((node) => node.className)).toEqual([
      'ris-facet ris-facet-gerichtsbarkeit',
      'ris-facet ris-facet-dokumenttyp',
      'ris-facet ris-facet-rechtsgebiet',
      'ris-facet-chip',
    ]);
  });

  it('leaves out the legal area outside Justiz', () => {
    const [container] = render(VWGH_COURT_RESULT);

    expect(container.querySelector('.ris-facet-rechtsgebiet')).toBeNull();
    expect(container.querySelectorAll('.ris-facet-select')).toHaveLength(2);
  });

  it('shows an unknown echoed jurisdiction as the selected option', () => {
    const [container] = render(UNKNOWN_COURT_RESULT);
    const select = facetSelect(container, 'gerichtsbarkeit');

    expect(select.value).toBe('Hexenkammer');
    expect(select.options[select.selectedIndex].textContent).toBe('Hexenkammer');
  });

  // COURT_RESULT's echo names no `dokumenttyp`, so the model's value is ''. The
  // select must show nothing selected rather than the first option the DOM
  // would otherwise pick: „Rechtssätze" would claim a filter the search never
  // ran with, and the next facet change would then re-issue it as a real one.
  it('selects nothing when the query names no document kind', () => {
    const select = facetSelect(render(COURT_RESULT)[0], 'dokumenttyp');

    expect([...select.options].some((option) => option.value === '')).toBe(false);
    expect(select.value).toBe('');
    expect(select.selectedIndex).toBe(-1);
  });

  // The one select where '' is a real choice, because it has an option for it.
  it('offers „(alle)" for the legal area and selects it when none is set', () => {
    const select = facetSelect(render(COURT_RESULT)[0], 'rechtsgebiet');

    expect([...select.options].map((option) => option.value)).toEqual([
      '',
      'Zivilrecht',
      'Strafrecht',
    ]);
    expect(select.options[0].textContent).toBe('(alle)');
    expect(select.selectedIndex).toBe(0);
  });

  it('carries the echoed legal area as the selected option', () => {
    expect(facetSelect(render(FILTERED_COURT_RESULT)[0], 'rechtsgebiet').value).toBe('Zivilrecht');
  });

  it('reports a chosen jurisdiction and a chosen document kind', () => {
    const [container, actions] = render(COURT_RESULT);

    choose(facetSelect(container, 'gerichtsbarkeit'), 'Vwgh');
    expect(actions.onFacet).toHaveBeenLastCalledWith({ gerichtsbarkeit: 'Vwgh' });

    choose(facetSelect(container, 'dokumenttyp'), 'entscheidungstext');
    expect(actions.onFacet).toHaveBeenLastCalledWith({ dokumenttyp: 'entscheidungstext' });
  });

  it('reports a chosen legal area, and „(alle)" as no filter at all', () => {
    const [container, actions] = render(FILTERED_COURT_RESULT);
    const select = facetSelect(container, 'rechtsgebiet');

    choose(select, 'Strafrecht');
    expect(actions.onFacet).toHaveBeenLastCalledWith({ rechtsgebiet: 'Strafrecht' });

    choose(select, '');
    expect(actions.onFacet).toHaveBeenLastCalledWith({ rechtsgebiet: null });
  });

  it('shows the court filter as a removable chip', () => {
    const [container, actions] = render(FILTERED_COURT_RESULT);
    const remove = container.querySelector<HTMLButtonElement>('.ris-facet-remove');

    // Labelled like the selects beside it: „OGH" on its own says nothing about
    // which filter it is, and the chip is the only control without a select.
    expect(container.querySelector('.ris-facet-chip .ris-facet-label')?.textContent).toBe(
      'Gericht:',
    );
    expect(container.querySelector('.ris-facet-chip')?.textContent).toBe('Gericht:OGH×');
    expect(remove?.getAttribute('aria-label')).toBe('Gericht-Filter entfernen');

    remove?.click();
    expect(actions.onFacet).toHaveBeenCalledWith({ gericht: null });
  });

  it('shows no chip when the search carries no court filter', () => {
    expect(render(COURT_RESULT)[0].querySelector('.ris-facet-chip')).toBeNull();
  });

  it('keeps the row on an empty result', () => {
    // Same reason the Rechtslage-am control survives an empty page: with no
    // rows and no pagination, widening a facet is the only way out.
    const [container] = render(EMPTY_COURT_RESULT);

    expect(container.querySelector('.ris-rows')).toBeNull();
    expect(container.querySelectorAll('.ris-facet-select')).toHaveLength(3);
  });
});

describe('renderResults — rows', () => {
  it('renders one row per document', () => {
    const [container] = render();

    expect(container.querySelectorAll('.ris-row')).toHaveLength(2);
  });

  it('shows title, work title and application badge', () => {
    const [container] = render();
    const row = container.querySelector('.ris-row');

    expect(row?.querySelector('.ris-row-title')?.textContent).toBe(
      '§ 0 Allgemeines bürgerliches Gesetzbuch (JGS Nr. 946/1811)',
    );
    expect(row?.querySelector('.ris-row-subtitle')?.textContent).toBe(
      'Allgemeines bürgerliches Gesetzbuch',
    );
    expect(row?.querySelector('.ris-row-badge')?.textContent).toBe('Bundesrecht');
  });

  it('flags a case chain on the collapsed row', () => {
    const [container] = render(COURT_RESULT);
    const [chained, single] = container.querySelectorAll('.ris-row');

    expect(chained.querySelector('.ris-row-more')?.textContent).toBe('+2 weitere');
    expect(single.querySelector('.ris-row-more')).toBeNull();
  });

  it('lists the metadata as label/value pairs', () => {
    const [container] = render(COURT_RESULT);
    const terms = [...container.querySelectorAll('.ris-row dt')].map((dt) => dt.textContent);

    expect(terms.slice(0, 4)).toEqual([
      'Gericht',
      'Entscheidungsdatum',
      'Geschäftszahl',
      'Rechtssatznummer',
    ]);
  });
});

describe('renderResults — expanding a row', () => {
  it('starts collapsed', () => {
    const [container] = render();
    const toggle = container.querySelector<HTMLButtonElement>('.ris-row-toggle');

    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector<HTMLElement>('.ris-row-detail')?.hidden).toBe(true);
  });

  it('expands and collapses again on click', () => {
    const [container] = render();
    const toggle = container.querySelector<HTMLButtonElement>('.ris-row-toggle');
    const detail = container.querySelector<HTMLElement>('.ris-row-detail');

    toggle?.click();
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(detail?.hidden).toBe(false);

    toggle?.click();
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(detail?.hidden).toBe(true);
  });

  it('points the toggle at the panel it controls', () => {
    const [container] = render();
    const toggle = container.querySelector<HTMLButtonElement>('.ris-row-toggle');
    const detail = container.querySelector<HTMLElement>('.ris-row-detail');

    expect(toggle?.getAttribute('aria-controls')).toBe(detail?.id);
    expect(detail?.id).toBeTruthy();
  });
});

describe('renderResults — row actions', () => {
  it('opens the RIS page', () => {
    const [container, actions] = render();
    container.querySelector<HTMLButtonElement>('.ris-row-toggle')?.click();

    buttonLabelled(container, 'Im RIS öffnen').click();

    expect(actions.onOpen).toHaveBeenCalledTimes(1);
    expect(vi.mocked(actions.onOpen).mock.calls[0][0].id).toBe('NOR40198929');
  });

  it('offers the PDF only where there is one', () => {
    const [container] = render();
    const [first, second] = container.querySelectorAll<HTMLElement>('.ris-row');

    expect(buttonLabelled(first, 'PDF')).toBeTruthy();
    expect(() => buttonLabelled(second, 'PDF')).toThrow();
  });

  it('omits the RIS link when the document carries no URL', () => {
    const linkless = {
      ...COURT_RESULT,
      documents: [{ ...COURT_RESULT.documents[1], content_urls: {}, dokument_url: null }],
    };
    const [container] = render(linkless);

    expect(() => buttonLabelled(container, 'Im RIS öffnen')).toThrow();
  });

  it('requests the full text for the row it was clicked on', () => {
    const [container, actions] = render(COURT_RESULT);
    const second = container.querySelectorAll<HTMLElement>('.ris-row')[1];

    buttonLabelled(second, 'Volltext in den Chat').click();

    expect(vi.mocked(actions.onFullText).mock.calls[0][0].id).toBe('JWR_2025090038_20260624L04');
  });
});

describe('renderResults — pagination', () => {
  it('disables the back button on the first page', () => {
    const [container] = render();

    expect(buttonLabelled(container, '‹ Zurück').disabled).toBe(true);
    expect(buttonLabelled(container, 'Weiter ›').disabled).toBe(false);
  });

  it('disables the forward button on the last page', () => {
    const [container] = render(COURT_RESULT);

    expect(buttonLabelled(container, '‹ Zurück').disabled).toBe(false);
    expect(buttonLabelled(container, 'Weiter ›').disabled).toBe(true);
  });

  it('names the direction for screen readers', () => {
    const [container] = render();

    expect(buttonLabelled(container, '‹ Zurück').getAttribute('aria-label')).toBe(
      'Vorherige Seite',
    );
    expect(buttonLabelled(container, 'Weiter ›').getAttribute('aria-label')).toBe('Nächste Seite');
  });

  it('reports which direction was requested', () => {
    const [container, actions] = render();

    buttonLabelled(container, 'Weiter ›').click();

    expect(actions.onPage).toHaveBeenCalledWith(1);
  });

  it('shows the position inside the result set', () => {
    const [container] = render();

    expect(container.querySelector('.ris-range')?.textContent).toBe('1–2 von 2.570');
  });
});

describe('renderResults — empty result', () => {
  it('keeps the header, drops the list and explains the emptiness', () => {
    const [container] = render(EMPTY_RESULT);

    expect(container.querySelector('.ris-hits')?.textContent).toBe('0 Treffer');
    expect(container.querySelector('.ris-rows')).toBeNull();
    expect(container.querySelector('.ris-footer')).toBeNull();
    expect(container.querySelector('.ris-notice-title')?.textContent).toBe(COPY.emptyTitle);
  });

  it('still offers the Rechtslage-am control', () => {
    const [container] = render(EMPTY_RESULT);

    // With no rows and no pagination, the date is the only thing left to act on
    // — dropping it here would leave the user with a dead end.
    expect(container.querySelector('.ris-fassung-input')).not.toBeNull();
  });
});

describe('renderResults — repeated renders', () => {
  it('replaces the previous page instead of appending to it', () => {
    const container = document.createElement('div');
    renderResults(container, toViewModel(LAW_RESULT), handlers());
    renderResults(container, toViewModel(COURT_RESULT), handlers());

    expect(container.querySelectorAll('.ris-row')).toHaveLength(2);
    expect(container.querySelector('.ris-hits')?.textContent).toBe('24 Treffer');
  });
});

describe('interpretPayload', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('passes a well-formed result through', () => {
    const outcome = interpretPayload(
      { structuredContent: LAW_RESULT, source: 'toolresult', text: '', isError: false },
      'mount',
    );

    expect(outcome).toEqual({ kind: 'result', result: LAW_RESULT });
  });

  it('accepts a result the host global supplied', () => {
    const outcome = interpretPayload(
      { structuredContent: LAW_RESULT, source: 'host-global', text: '', isError: false },
      'mount',
    );

    expect(outcome.kind).toBe('result');
  });

  it('turns a missing payload into the degradation notice', () => {
    const outcome = interpretPayload(
      { structuredContent: null, source: 'missing', text: 'Gefunden: 3 Treffer', isError: false },
      'mount',
    );

    expect(outcome.kind).toBe('notice');
    expect(outcome.kind === 'notice' && outcome.node.textContent).toContain(COPY.degradedTitle);
    expect(outcome.kind === 'notice' && outcome.node.textContent).toContain(COPY.answerInChat);
  });

  it('surfaces the server prose of a failed tool call', () => {
    const outcome = interpretPayload(
      {
        structuredContent: null,
        source: 'missing',
        text: 'Zeitüberschreitung bei der RIS-Anfrage.',
        isError: true,
      },
      'mount',
    );

    expect(outcome.kind === 'notice' && outcome.node.textContent).toContain(
      'Zeitüberschreitung bei der RIS-Anfrage.',
    );
    expect(outcome.kind === 'notice' && outcome.node.getAttribute('role')).toBe('alert');
  });

  it('still explains an error that arrived without prose', () => {
    const outcome = interpretPayload(
      { structuredContent: null, source: 'missing', text: '', isError: true },
      'mount',
    );

    expect(outcome.kind === 'notice' && outcome.node.textContent).toContain(COPY.toolErrorTitle);
  });

  it('reports a payload that is not a search result at all', () => {
    const outcome = interpretPayload(
      { structuredContent: { unerwartet: true }, source: 'host-global', text: '', isError: false },
      'mount',
    );

    expect(outcome.kind === 'notice' && outcome.node.textContent).toContain(
      COPY.invalidPayloadTitle,
    );
  });

  it('does not promise a chat answer for a page the widget asked for itself', () => {
    const missing = {
      structuredContent: null,
      source: 'missing' as const,
      text: '',
      isError: false,
    };
    const outcome = interpretPayload(missing, 'follow-up');

    expect(outcome.kind === 'notice' && outcome.node.textContent).toContain(COPY.degradedTitle);
    expect(outcome.kind === 'notice' && outcome.node.textContent).toContain(COPY.pageUnchanged);
    expect(outcome.kind === 'notice' && outcome.node.textContent).not.toContain(COPY.answerInChat);
  });

  it('says the same about an unrecognised follow-up payload', () => {
    const outcome = interpretPayload(
      { structuredContent: { unerwartet: true }, source: 'toolresult', text: '', isError: false },
      'follow-up',
    );

    expect(outcome.kind === 'notice' && outcome.node.textContent).toContain(COPY.pageUnchanged);
    expect(outcome.kind === 'notice' && outcome.node.textContent).not.toContain(COPY.answerInChat);
  });
});

describe('focusPagination', () => {
  function mounted(result = LAW_RESULT): HTMLElement {
    const container = document.createElement('div');
    document.body.replaceChildren(container);
    renderResults(container, toViewModel(result), handlers());
    return container;
  }

  it('labels the two footer buttons distinctly', () => {
    const container = mounted();

    expect(container.querySelector('.ris-page-prev')?.textContent).toBe('‹ Zurück');
    expect(container.querySelector('.ris-page-next')?.textContent).toBe('Weiter ›');
  });

  it('returns focus to the button that triggered the page change', () => {
    const container = mounted();

    focusPagination(container, 1);

    expect(document.activeElement).toBe(container.querySelector('.ris-page-next'));
  });

  it('falls back to the other direction when the preferred button is now disabled', () => {
    // Last page: „Weiter ›" is disabled, so focus must not land on it — nor on body.
    const container = mounted(COURT_RESULT);

    focusPagination(container, 1);

    expect(document.activeElement).toBe(container.querySelector('.ris-page-prev'));
  });

  it('leaves focus alone when there is no pagination at all', () => {
    const container = mounted(EMPTY_RESULT);
    const before = document.activeElement;

    focusPagination(container, 1);

    expect(document.activeElement).toBe(before);
  });
});

describe('focusFassung', () => {
  it('returns focus to the date field of the re-rendered header', () => {
    const container = document.createElement('div');
    document.body.replaceChildren(container);
    renderResults(container, toViewModel(DATED_LAW_RESULT), handlers());

    focusFassung(container);

    expect(document.activeElement).toBe(container.querySelector('.ris-fassung-input'));
  });
});

describe('focusFacet', () => {
  function mounted(result = FILTERED_COURT_RESULT): HTMLElement {
    const container = document.createElement('div');
    document.body.replaceChildren(container);
    renderResults(container, toViewModel(result), handlers());
    return container;
  }

  it.each([
    ['gerichtsbarkeit', { gerichtsbarkeit: 'Vwgh' }],
    ['dokumenttyp', { dokumenttyp: 'rechtssatz' }],
    ['rechtsgebiet', { rechtsgebiet: 'Strafrecht' }],
  ] as const)('returns focus to the %s select', (facet, change) => {
    const container = mounted();

    focusFacet(container, change);

    expect(document.activeElement).toBe(facetSelect(container, facet));
  });

  it('focuses nothing after a removed court filter', () => {
    // The chip and its button went away with the filter, and no other control
    // stands for it — grabbing an unrelated select would move the user
    // somewhere they never asked to be.
    const container = mounted();
    const before = document.activeElement;

    focusFacet(container, { gericht: null });

    expect(document.activeElement).toBe(before);
  });

  it('stays silent where the new page offers no such control', () => {
    const container = mounted(VWGH_COURT_RESULT);
    const before = document.activeElement;

    focusFacet(container, { rechtsgebiet: null });

    expect(document.activeElement).toBe(before);
  });
});
