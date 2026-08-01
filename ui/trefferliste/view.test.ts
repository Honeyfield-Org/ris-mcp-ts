import { beforeEach, describe, expect, it, vi } from 'vitest';

import { COURT_RESULT, EMPTY_RESULT, LAW_RESULT } from '../__fixtures__/search-results.js';
import { COPY } from '../shared/states.js';

import { focusPagination, interpretPayload, renderResults, type ResultHandlers } from './view.js';
import { toViewModel } from './viewmodel.js';

function handlers(): ResultHandlers {
  return { onOpen: vi.fn(), onPdf: vi.fn(), onFullText: vi.fn(), onPage: vi.fn() };
}

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
