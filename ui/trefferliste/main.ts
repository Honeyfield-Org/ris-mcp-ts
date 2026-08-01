/**
 * Entry point of the Trefferliste widget.
 *
 * Deliberately thin: it owns the page elements and the little state a session
 * has (the result on screen, whether a page request is in flight) and delegates
 * everything else — host protocol to `shared/bridge.ts`, display rules to
 * `viewmodel.ts`, elements to `view.ts`.
 */

import { connectBridge, type Bridge, type ToolPayload } from '../shared/bridge.js';
import { COPY, createNotice, createSkeleton, type NoticeKind } from '../shared/states.js';

import { interpretPayload, renderResults, type Outcome, type ResultHandlers } from './view.js';
import { fullTextPrompt, nextQuery, toViewModel, type SearchResultPayload } from './viewmodel.js';

function byId(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Trefferliste: #${id} fehlt im HTML-Shell`);
  return node;
}

const marker = byId('nojs-marker');
const view = byId('ris-view');
const statusArea = byId('ris-status');

/** The result currently on screen — the source for pagination and for restores. */
let current: SearchResultPayload | null = null;
let bridge: Bridge | null = null;
/** Guards against a second page request while one is still running. */
let pending = false;

function showStatus(kind: NoticeKind, title: string, detail?: string): void {
  statusArea.replaceChildren(createNotice(kind, title, detail));
}

function clearStatus(): void {
  statusArea.replaceChildren();
}

function renderCurrent(): void {
  if (current) renderResults(view, toViewModel(current), handlers);
}

/**
 * Put an outcome on screen.
 *
 * `keepPrevious` is what makes a failed page request non-destructive: the list
 * the user was reading stays and the notice goes underneath it. Only the
 * initial mount — which has nothing to keep — replaces the whole view.
 */
function show(outcome: Outcome, keepPrevious: boolean): void {
  if (outcome.kind === 'result') {
    current = outcome.result;
    clearStatus();
    renderCurrent();
    return;
  }

  if (keepPrevious && current) {
    renderCurrent();
    statusArea.replaceChildren(outcome.node);
    return;
  }

  clearStatus();
  view.replaceChildren(outcome.node);
}

async function openExternal(url: string | null): Promise<void> {
  if (!url || !bridge) return;

  if (await bridge.openLink(url)) clearStatus();
  else showStatus('error', COPY.linkRefused);
}

async function requestFullText(dokumentnummer: string): Promise<void> {
  if (!bridge) return;

  if (await bridge.sendPrompt(fullTextPrompt(dokumentnummer))) clearStatus();
  else showStatus('error', COPY.promptRefused);
}

/**
 * Fetch another page by re-issuing the search the server echoed back.
 *
 * A rejected `callTool` means the transport failed — typically an evicted
 * session — which is the one case where the list must survive the error.
 */
async function goToPage(delta: -1 | 1): Promise<void> {
  const call = nextQuery(current?.query, delta);
  if (!call || !bridge || pending) return;

  pending = true;
  clearStatus();
  view.replaceChildren(createSkeleton(current?.documents.length));

  try {
    show(interpretPayload(await bridge.callTool(call)), true);
  } catch {
    renderCurrent();
    showStatus('error', COPY.sessionExpired);
  } finally {
    pending = false;
  }
}

const handlers: ResultHandlers = {
  onOpen: (row) => void openExternal(row.risUrl),
  onPdf: (row) => void openExternal(row.pdfUrl),
  onFullText: (row) => void requestFullText(row.id),
  onPage: (delta) => void goToPage(delta),
};

function onToolResult(payload: ToolPayload): void {
  show(interpretPayload(payload), false);
}

// The marker only ever answers "did the bundle run at all" — reaching this line
// is that answer, so it goes away before anything else is decided.
marker.hidden = true;
view.replaceChildren(createSkeleton());

connectBridge({ onToolResult })
  .then((connected) => {
    bridge = connected;
  })
  .catch(() => {
    if (!current) {
      view.replaceChildren(
        createNotice('error', COPY.connectFailedTitle, COPY.connectFailedDetail),
      );
    }
  });
