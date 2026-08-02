/**
 * DOM rendering for the document viewer.
 *
 * Separate from `main.ts` so it can be exercised in jsdom without a host: this
 * module only ever touches the container it is handed, and reports user intent
 * through the handlers it is given.
 *
 * Hard rule throughout: every piece of document text goes in via `textContent`
 * and the module never assigns `innerHTML`. The payload is RIS content rendered
 * to plain text, and there is no path by which it could become markup — which is
 * what makes the resource's empty CSP a description of the bundle rather than a
 * hope.
 */

import type { ToolPayload } from '../shared/bridge.js';
import { createNotice } from '../shared/states.js';

import { COPY } from './copy.js';
import {
  parseChunkResult,
  sectionId,
  type Block,
  type DocumentChunk,
  type DocumentView,
  type OutlineRow,
  type RunView,
} from './viewmodel.js';

/** What the user asked for by clicking. */
export interface ViewerHandlers {
  /** Jump to a section — loading it first when it is not on screen. */
  onJump(offset: number): void;
  /** Fill the gap that starts at `offset`. */
  onLoadGap(offset: number): void;
  /** Open a RIS URL in the host's browser. */
  onOpenLink(url: string): void;
}

/** The parts of a rendered document `main.ts` keeps working with. */
export interface RenderedDocument {
  /** The scroll container, and the `IntersectionObserver` root. */
  textPane: HTMLElement;
  /** Present only while more text follows what is on screen. */
  sentinel: HTMLElement | null;
}

/**
 * What a tool result should put on screen.
 *
 * `empty` is not a failure: it means this rung of the first-render ladder
 * yielded nothing and the caller should try the next one.
 */
export type Outcome =
  | { kind: 'text'; text: string }
  | { kind: 'chunk'; chunk: DocumentChunk }
  | { kind: 'empty' }
  | { kind: 'notice'; node: HTMLElement };

/**
 * Which call a tool result answers, which decides what a failure may claim.
 *
 * `mount` is the `ris_dokument` call that opened the viewer: it always produced
 * a chat answer as well, so pointing the user at the chat is true. `section` is
 * a chunk the viewer requested itself — no chat message exists for it, and the
 * consolation is that the text already on screen survives.
 */
export type ResultContext = 'mount' | 'section';

/** Fallback height when the host says nothing about its container. */
const FALLBACK_HEIGHT = 640;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * The height the viewer may occupy, from the host's own container.
 *
 * Deliberately a pixel fallback rather than a viewport unit: inside an
 * auto-sized iframe `vh` resolves against a height this widget itself
 * determines, which is circular. A too-short reading pane still scrolls and
 * still shows everything; an unbounded one grows to tens of thousands of pixels
 * and takes the lazy loading down with it.
 */
export function viewportHeight(context: unknown): number {
  const dimensions = isRecord(context) ? context.containerDimensions : undefined;
  if (!isRecord(dimensions)) return FALLBACK_HEIGHT;

  if (isPositiveNumber(dimensions.height)) return dimensions.height;
  if (isPositiveNumber(dimensions.maxHeight)) return dimensions.maxHeight;

  return FALLBACK_HEIGHT;
}

/**
 * Decide what a tool result should put on screen.
 *
 * Kept here rather than in `main.ts` so every branch — a server error, a host
 * that delivered nothing, a payload that is not a chunk — is covered by a test
 * instead of only by a live host.
 */
export function interpretPayload(payload: ToolPayload, context: ResultContext): Outcome {
  const consolation = context === 'mount' ? COPY.textInChat : COPY.sectionUnchanged;

  if (payload.isError) {
    return { kind: 'notice', node: createNotice('error', COPY.documentErrorTitle, payload.text) };
  }

  if (context === 'mount') {
    // `ris_dokument` declares no structured content by design: its text block is
    // the payload, and up to 25 000 characters of it arrive with the mount.
    return payload.text ? { kind: 'text', text: payload.text } : { kind: 'empty' };
  }

  const chunk = parseChunkResult(payload.structuredContent);
  if (!chunk) {
    return { kind: 'notice', node: createNotice('info', COPY.invalidPayloadTitle, consolation) };
  }

  return { kind: 'chunk', chunk };
}

function renderHeader(model: DocumentView, handlers: ViewerHandlers): HTMLElement {
  const header = element('header', 'ris-doc-header');

  header.append(element('h1', 'ris-doc-title', model.title));

  const meta = element('div', 'ris-doc-meta');
  if (model.dokumentnummer) {
    meta.append(element('span', 'ris-doc-number', model.dokumentnummer));
  }
  if (model.progressLabel) {
    meta.append(element('span', 'ris-doc-progress', model.progressLabel));
  }
  if (model.sourceUrl) {
    const url = model.sourceUrl;
    meta.append(button('ris-action', COPY.openInRis, () => handlers.onOpenLink(url)));
  }
  header.append(meta);

  return header;
}

function renderOutlineRow(row: OutlineRow, handlers: ViewerHandlers): HTMLElement {
  const item = element('li', `ris-outline-item ris-outline-level-${Math.min(row.level, 6)}`);

  const jump = button('ris-outline-jump', row.label, () => handlers.onJump(row.offset));
  jump.dataset.offset = String(row.offset);
  // The share is a progress affordance, not a table of contents entry: it is
  // what tells a reader that `Text` covers most of the document.
  jump.append(element('span', 'ris-outline-share', row.shareLabel));

  item.append(jump);
  return item;
}

/**
 * The outline rail.
 *
 * A `<details>` rather than a bare `<nav>` so the narrow layout can fold it
 * above the text; the wide layout hides the summary and forces the list open in
 * CSS, so a rail the user collapsed while narrow cannot stay hidden when the
 * container grows.
 */
export function renderOutline(model: OutlineRow[], handlers: ViewerHandlers): HTMLElement {
  const disclosure = document.createElement('details');
  disclosure.className = 'ris-outline';
  disclosure.open = true;
  disclosure.append(element('summary', 'ris-outline-summary', COPY.outlineLabel));

  const nav = element('nav', 'ris-outline-nav');
  nav.setAttribute('aria-label', COPY.outlineLabel);

  const list = element('ol', 'ris-outline-list');
  for (const row of model) list.append(renderOutlineRow(row, handlers));

  nav.append(list);
  disclosure.append(nav);
  return disclosure;
}

function renderMeta(
  block: Extract<Block, { kind: 'meta' }>,
  handlers: ViewerHandlers,
): HTMLElement {
  const pair = element('div', 'ris-doc-meta-pair');
  pair.append(element('dt', undefined, block.label));

  const value = element('dd');
  if (block.url) {
    // A link becomes a button routed through the host, never an `<a href>`: no
    // navigation escapes the iframe and no URL from RIS is trusted into the DOM.
    const url = block.url;
    value.append(button('ris-link', block.value, () => handlers.onOpenLink(url)));
  } else {
    value.textContent = block.value;
  }

  pair.append(value);
  return pair;
}

function renderBlock(block: Block, handlers: ViewerHandlers): HTMLElement {
  const node = ((): HTMLElement => {
    switch (block.kind) {
      case 'title':
      case 'heading':
        return element('h2', 'ris-doc-section', block.text);
      case 'meta':
        return renderMeta(block, handlers);
      case 'paragraph':
        return element('p', 'ris-doc-p', block.text);
    }
  })();

  if (block.anchorOffset !== null) {
    node.id = sectionId(block.anchorOffset);
    // Focusable so a jump moves keyboard and screen-reader focus with the
    // scroll, the way pagination does in the Trefferliste.
    node.tabIndex = -1;
  }

  return node;
}

/** Render the blocks of one contiguous run, wrapping metadata pairs in a `<dl>`. */
export function renderBlocks(run: RunView, handlers: ViewerHandlers): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  let list: HTMLElement | null = null;

  for (const block of run.blocks) {
    const node = renderBlock(block, handlers);

    if (block.kind === 'meta') {
      if (!list) {
        list = element('dl', 'ris-doc-metadata');
        nodes.push(list);
      }
      list.append(node);
      continue;
    }

    list = null;
    nodes.push(node);
  }

  return nodes;
}

/**
 * Render a document, replacing whatever was in `container`.
 *
 * The container takes a definite height and the text pane inside it scrolls.
 * That breaks the Trefferliste's "never set a height or an overflow" rule on
 * purpose: it was written for a 20-row list, and a 260 000-character decision
 * would otherwise produce an iframe tens of thousands of pixels tall in which
 * every sentinel intersects at once and "lazy" loading fetches everything.
 */
export function renderDocument(
  container: HTMLElement,
  model: DocumentView,
  handlers: ViewerHandlers,
  height: number,
): RenderedDocument {
  const body = element('div', 'ris-doc-body');

  if (model.rail) body.append(renderOutline(model.rail, handlers));

  const textPane = element('article', 'ris-doc-text');
  textPane.tabIndex = 0;

  for (const run of model.runs) {
    textPane.append(...renderBlocks(run, handlers));

    if (run.gapOffset !== null) {
      const offset = run.gapOffset;
      const gap = element('div', 'ris-doc-gap');
      // The gap marker doubles as the retry for a section that failed to load,
      // so a failure needs no recovery UI of its own.
      gap.append(button('ris-action', COPY.gapMarker, () => handlers.onLoadGap(offset)));
      textPane.append(gap);
    }
  }

  let sentinel: HTMLElement | null = null;
  if (model.sentinelOffset !== null) {
    sentinel = element('div', 'ris-doc-sentinel');
    sentinel.dataset.offset = String(model.sentinelOffset);
    sentinel.setAttribute('aria-hidden', 'true');
    textPane.append(sentinel);
  }

  body.append(textPane);

  container.classList.add('ris-doc-root');
  container.style.height = `${height}px`;
  container.replaceChildren(renderHeader(model, handlers), body);

  return { textPane, sentinel };
}

/**
 * Put a notice in `container` and give the height back.
 *
 * A three-line notice in a 640-pixel box would be a worse answer than the
 * notice itself, and nothing in it scrolls.
 */
export function renderNotice(container: HTMLElement, node: HTMLElement): void {
  container.classList.remove('ris-doc-root');
  container.style.removeProperty('height');
  container.replaceChildren(node);
}

/**
 * Scroll a section into view and move focus to it.
 *
 * Without the focus move a keyboard user stays wherever they were and a screen
 * reader announces nothing — the same concern `focusPagination()` handles for
 * the Trefferliste.
 */
export function focusAfterJump(container: HTMLElement, offset: number): boolean {
  const target = container.querySelector<HTMLElement>(`#${sectionId(offset)}`);
  if (!target) return false;

  target.scrollIntoView?.({ block: 'start' });
  target.focus?.();

  for (const jump of container.querySelectorAll<HTMLElement>('.ris-outline-jump')) {
    if (jump.dataset.offset === String(offset)) jump.setAttribute('aria-current', 'true');
    else jump.removeAttribute('aria-current');
  }

  return true;
}

/**
 * Take every control that would issue a tool call out of service.
 *
 * Used when the session is gone: every further call fails the same way, and a
 * button that cannot work is worse than none. The text stays exactly as it is.
 */
export function disableLoading(container: HTMLElement): void {
  container.querySelector('.ris-doc-sentinel')?.remove();

  for (const gap of container.querySelectorAll<HTMLButtonElement>('.ris-doc-gap button')) {
    gap.disabled = true;
  }

  for (const jump of container.querySelectorAll<HTMLButtonElement>('.ris-outline-jump')) {
    if (!container.querySelector(`#${sectionId(Number(jump.dataset.offset))}`)) {
      jump.disabled = true;
    }
  }
}
