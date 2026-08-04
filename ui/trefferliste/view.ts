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
  input.addEventListener('change', () => {
    handlers.onFassungVom(input.value === '' ? null : input.value);
  });

  field.append(input);
  return field;
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
 * An empty result keeps the header — the user still wants to see which search
 * came back with nothing — and drops list and pagination.
 */
export function renderResults(
  container: HTMLElement,
  model: ResultViewModel,
  handlers: ResultHandlers,
): void {
  const header = renderHeader(model, handlers);

  if (model.isEmpty) {
    container.replaceChildren(header, createNotice('info', COPY.emptyTitle, COPY.emptyDetail));
    return;
  }

  const list = element('ul', 'ris-rows');
  model.rows.forEach((row, index) => list.append(renderRow(row, index, handlers)));

  container.replaceChildren(header, list, renderFooter(model, handlers));
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
