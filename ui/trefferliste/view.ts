/**
 * DOM rendering for the Trefferliste.
 *
 * Separate from `main.ts` so it can be exercised in jsdom without a host: this
 * module only ever touches the container it is handed, and reports user intent
 * through the handlers it is given.
 */

import type { ToolPayload } from '../shared/bridge.js';
import { COPY, createNotice } from '../shared/states.js';

import {
  parseSearchResult,
  type DocumentRow,
  type FacetChange,
  type FacetControls,
  type FacetOption,
  type ResultViewModel,
  type SearchResultPayload,
} from './viewmodel.js';

/** What the user asked for by clicking. */
export interface ResultHandlers {
  onOpen(row: DocumentRow): void;
  onPdf(row: DocumentRow): void;
  onFullText(row: DocumentRow): void;
  onPage(delta: -1 | 1): void;
  /** A legal-state date was picked, or `null` when it was cleared. */
  onFassungVom(value: string | null): void;
  /** One facet was changed or dropped — see {@link FacetChange}. */
  onFacet(change: FacetChange): void;
}

/** Either a result to render, or a notice explaining why there is none. */
export type Outcome =
  | { kind: 'result'; result: SearchResultPayload }
  | { kind: 'notice'; node: HTMLElement };

/**
 * Which call a tool result answers, which decides what a failure may claim.
 *
 * `mount` is the call that opened the widget: it always produced a chat answer
 * as well, so pointing the user at the chat is true. `follow-up` is a page the
 * widget requested itself — no chat message exists for it, and the consolation
 * is that the list already on screen survives.
 */
export type ResultContext = 'mount' | 'follow-up';

function element(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, label: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = label;
  node.addEventListener('click', onClick);
  return node;
}

/**
 * Decide what a tool result should put on screen.
 *
 * Kept here rather than in `main.ts` so every branch — server error, a host
 * that sent no structured data, a payload that is not a search result — is
 * covered by a test instead of only by a live host.
 */
export function interpretPayload(payload: ToolPayload, context: ResultContext): Outcome {
  const consolation = context === 'mount' ? COPY.answerInChat : COPY.pageUnchanged;

  if (payload.isError) {
    return { kind: 'notice', node: createNotice('error', COPY.toolErrorTitle, payload.text) };
  }

  if (payload.source === 'missing') {
    return { kind: 'notice', node: createNotice('info', COPY.degradedTitle, consolation) };
  }

  const result = parseSearchResult(payload.structuredContent);
  if (!result) {
    return { kind: 'notice', node: createNotice('info', COPY.invalidPayloadTitle, consolation) };
  }

  return { kind: 'result', result };
}

/**
 * How long the „Rechtslage am" control waits before it reports a change.
 *
 * Measured live in both hosts (#88): Chrome commits an `input[type=date]`
 * segment by segment and fires a `change` for every committed segment, so a
 * date typed by hand reported several dates instead of one — including the
 * empty string a half-typed field carries, which means „no date" and re-issued
 * the search with the filter dropped. 700ms is longer than the gap between two
 * typed segments and short enough that a date picked from the calendar still
 * answers promptly.
 */
export const FASSUNG_DEBOUNCE_MS = 700;

/**
 * The „Rechtslage am" control: which legal state the results are shown for.
 *
 * An empty input travels as `null`, not as `''`: the empty string would be
 * re-issued as a real `fassung_vom` argument and fail the server's date
 * validation, where `null` means what the user did — no date, current version.
 */
function renderFassung(control: { value: string }, handlers: ResultHandlers): HTMLElement {
  const field = element('label', 'ris-fassung');
  field.append(element('span', 'ris-fassung-label', 'Rechtslage am'));

  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'ris-fassung-input';
  input.value = control.value;

  // One search per settled date, not one per committed segment — see
  // {@link FASSUNG_DEBOUNCE_MS}. The value is read when the timer fires rather
  // than when the change arrived, so the blank a half-typed field carries never
  // travels once a later segment has completed the date. Residual: pausing
  // longer than the delay on a field the user has emptied does report the
  // clear. That is self-consistent — the field is empty and the results match
  // what it says — and it is the same thing the user gets by clearing on
  // purpose.
  //
  // A re-render does not cancel a pending report either — the timer fires on
  // the by-then detached input. Harmless: `changeFassung` drops it while a
  // re-issue is in flight, and otherwise applies it to the query echo on
  // screen, which is the search the replaced header was showing too.
  let timer: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener('change', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      handlers.onFassungVom(input.value === '' ? null : input.value);
    }, FASSUNG_DEBOUNCE_MS);
  });

  field.append(input);
  return field;
}

/**
 * One facet select: a short German label and the options the model handed over.
 *
 * The current value is assigned after the options exist, and it is assigned
 * even when it is `''`: appending the first option makes the DOM select it, and
 * a select reading „Rechtssätze" for a search that never named a document kind
 * would claim a filter the results do not have. With no option carrying `''`
 * that assignment leaves nothing selected — which is precisely the statement
 * „this search has no such filter". The Rechtsgebiet select is the deliberate
 * exception: it does have an option for `''`, see {@link RECHTSGEBIET_ALL}.
 */
function renderFacet(
  facet: string,
  label: string,
  value: string,
  options: FacetOption[],
  report: (chosen: string) => void,
): HTMLElement {
  const field = element('label', `ris-facet ris-facet-${facet}`);
  field.append(element('span', 'ris-facet-label', label));

  const select = document.createElement('select');
  select.className = 'ris-facet-select';

  for (const option of options) {
    const node = document.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    select.append(node);
  }

  select.value = value;
  select.addEventListener('change', () => report(select.value));

  field.append(select);
  return field;
}

/**
 * The court filter: shown and removable, never settable.
 *
 * RIS has no list of courts to offer — `gericht` is free text the caller
 * supplied — so the only thing the row can do with it is display it and let the
 * user take it off again. It is labelled like the selects beside it because a
 * bare „OGH" in the row says nothing about which filter it is — the remove
 * button's aria-label says it, but only to assistive technology.
 */
function renderGericht(gericht: string, handlers: ResultHandlers): HTMLElement {
  const chip = element('span', 'ris-facet-chip');
  const remove = button('ris-facet-remove', '×', () => handlers.onFacet({ gericht: null }));
  remove.setAttribute('aria-label', 'Gericht-Filter entfernen');

  chip.append(element('span', 'ris-facet-label', 'Gericht:'), gericht, remove);
  return chip;
}

/** The one facet whose absence is itself a choice, so it gets an option. */
const RECHTSGEBIET_ALL: FacetOption = { value: '', label: '(alle)' };

/**
 * The facet row of a Judikatur result.
 *
 * Every control reports a {@link FacetChange} and stops there: which argument
 * that becomes, which filters survive a change of jurisdiction and what the
 * options mean is `viewmodel.ts`'s business, not this layer's.
 */
function renderFacets(facets: FacetControls, handlers: ResultHandlers): HTMLElement {
  const row = element('div', 'ris-facets');

  row.append(
    renderFacet(
      'gerichtsbarkeit',
      'Gerichtsbarkeit',
      facets.gerichtsbarkeit.value,
      facets.gerichtsbarkeit.options,
      (value) => handlers.onFacet({ gerichtsbarkeit: value }),
    ),
    renderFacet(
      'dokumenttyp',
      'Dokumenttyp',
      facets.dokumenttyp.value,
      facets.dokumenttyp.options,
      (value) => handlers.onFacet({ dokumenttyp: value }),
    ),
  );

  if (facets.rechtsgebiet) {
    row.append(
      renderFacet(
        'rechtsgebiet',
        'Rechtsgebiet',
        facets.rechtsgebiet.value,
        [RECHTSGEBIET_ALL, ...facets.rechtsgebiet.options],
        // „(alle)" is the absence of the filter, which travels as `null` — an
        // empty string would be re-issued as a real argument.
        (value) => handlers.onFacet({ rechtsgebiet: value === '' ? null : value }),
      ),
    );
  }

  if (facets.gericht) row.append(renderGericht(facets.gericht, handlers));

  return row;
}

function renderHeader(model: ResultViewModel, handlers: ResultHandlers): HTMLElement {
  const header = element('header', 'ris-header');

  if (model.toolLabel) header.append(element('span', 'ris-tool-badge', model.toolLabel));
  if (model.queryLabel) header.append(element('span', 'ris-query', model.queryLabel));
  if (model.fassung) header.append(renderFassung(model.fassung, handlers));
  header.append(element('span', 'ris-hits', model.hitsLabel));

  return header;
}

function renderMeta(row: DocumentRow): HTMLElement {
  const list = element('dl', 'ris-meta');

  for (const entry of row.meta) {
    list.append(element('dt', undefined, entry.label));
    list.append(element('dd', undefined, entry.value));
  }

  return list;
}

function renderActions(row: DocumentRow, handlers: ResultHandlers): HTMLElement {
  const actions = element('div', 'ris-actions');

  if (row.risUrl) {
    actions.append(button('ris-action', 'Im RIS öffnen', () => handlers.onOpen(row)));
  }
  if (row.pdfUrl) {
    actions.append(button('ris-action', 'PDF', () => handlers.onPdf(row)));
  }
  actions.append(button('ris-action', 'Volltext in den Chat', () => handlers.onFullText(row)));

  return actions;
}

function renderRow(row: DocumentRow, index: number, handlers: ResultHandlers): HTMLElement {
  const item = element('li', 'ris-row');
  const detailId = `ris-detail-${index}`;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'ris-row-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', detailId);

  const heading = element('span', 'ris-row-heading');
  heading.append(element('span', 'ris-row-title', row.title));
  if (row.caseNumbers.length > 1) {
    heading.append(element('span', 'ris-row-more', `+${row.caseNumbers.length - 1} weitere`));
  }
  toggle.append(heading);

  if (row.subtitle) toggle.append(element('span', 'ris-row-subtitle', row.subtitle));
  toggle.append(element('span', 'ris-row-badge', row.badge));

  const detail = element('div', 'ris-row-detail');
  detail.id = detailId;
  detail.hidden = true;
  detail.append(renderMeta(row), renderActions(row, handlers));

  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    detail.hidden = expanded;
  });

  item.append(toggle, detail);
  return item;
}

function renderFooter(model: ResultViewModel, handlers: ResultHandlers): HTMLElement {
  const footer = element('footer', 'ris-footer');

  const previous = button('ris-page ris-page-prev', '‹ Zurück', () => handlers.onPage(-1));
  previous.setAttribute('aria-label', 'Vorherige Seite');
  previous.disabled = !model.hasPrev;

  const next = button('ris-page ris-page-next', 'Weiter ›', () => handlers.onPage(1));
  next.setAttribute('aria-label', 'Nächste Seite');
  next.disabled = !model.hasNext;

  footer.append(previous, element('span', 'ris-range', model.rangeLabel), next);
  return footer;
}

/**
 * Render one page of results into `container`, replacing whatever was there.
 *
 * An empty result keeps the header and the facet row — the user still wants to
 * see which search came back with nothing, and widening a facet is the only way
 * out of it — and drops list and pagination.
 */
export function renderResults(
  container: HTMLElement,
  model: ResultViewModel,
  handlers: ResultHandlers,
): void {
  const controls = [renderHeader(model, handlers)];
  if (model.facets) controls.push(renderFacets(model.facets, handlers));

  if (model.isEmpty) {
    container.replaceChildren(...controls, createNotice('info', COPY.emptyTitle, COPY.emptyDetail));
    return;
  }

  const list = element('ul', 'ris-rows');
  model.rows.forEach((row, index) => list.append(renderRow(row, index, handlers)));

  container.replaceChildren(...controls, list, renderFooter(model, handlers));
}

/**
 * Put keyboard focus back after a page change.
 *
 * {@link renderResults} replaces the whole subtree, so the button the user just
 * activated no longer exists and focus would fall to `<body>` — leaving a
 * keyboard user at the top of the document after every page. Focus goes to the
 * button for the same direction, or to the opposite one when that direction has
 * just run out of pages.
 */
export function focusPagination(container: HTMLElement, delta: -1 | 1): void {
  const sameDirection = container.querySelector<HTMLButtonElement>(
    delta === 1 ? '.ris-page-next' : '.ris-page-prev',
  );

  if (sameDirection && !sameDirection.disabled) {
    sameDirection.focus();
    return;
  }

  container.querySelector<HTMLButtonElement>('.ris-page:not(:disabled)')?.focus();
}

/**
 * Put keyboard focus back after a change of the legal-state date.
 *
 * Same reason as {@link focusPagination}: the re-issued search re-renders the
 * header, so the field the user just left is gone and focus would fall to
 * `<body>`. Silent where the new page carries no control — a search whose
 * results no longer offer a Fassung has nothing to hand the focus to.
 */
export function focusFassung(container: HTMLElement): void {
  container.querySelector<HTMLInputElement>('.ris-fassung-input')?.focus();
}

/**
 * Put keyboard focus back after a facet change.
 *
 * Same reason as {@link focusFassung}: the re-issued search replaces the whole
 * row, so the select the user just left is gone. Which select to return to is
 * read off the change itself rather than matched against a list of facet names
 * — a variant added later needs nothing here.
 *
 * A removed court filter focuses nothing, deliberately: the chip that carried
 * the button went away with the filter, there is no control that stands for it,
 * and grabbing a neighbouring select would drop the user somewhere they never
 * asked to be.
 */
export function focusFacet(container: HTMLElement, change: FacetChange): void {
  if ('gericht' in change) return;

  const [facet] = Object.keys(change);
  container.querySelector<HTMLSelectElement>(`.ris-facet-${facet} .ris-facet-select`)?.focus();
}
