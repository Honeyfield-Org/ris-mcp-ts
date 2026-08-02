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
import { persistSnapshot, restoreSnapshot } from '../shared/widget-state.js';

import {
  focusPagination,
  interpretPayload,
  renderResults,
  type Outcome,
  type ResultHandlers,
} from './view.js';
import {
  fullTextPrompt,
  nextQuery,
  parseSearchResult,
  toViewModel,
  type SearchResultPayload,
} from './viewmodel.js';

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
/** True while the list on screen came from the previous render, not the host. */
let restored = false;

/** Which action a status notice belongs to. */
type StatusSource = 'pagination' | 'link' | 'prompt';

function showStatus(kind: NoticeKind, source: StatusSource, title: string, detail?: string): void {
  const notice = createNotice(kind, title, detail);
  notice.dataset.source = source;
  statusArea.replaceChildren(notice);
}

/**
 * Remove the status notice.
 *
 * With `only` set, an action clears just its own message: a link that opened
 * fine says nothing about the „Verbindung abgelaufen" notice above it, and
 * wiping that would hide a problem the user still has. Called without an
 * argument — from a page that actually arrived — everything goes, because a new
 * page supersedes every complaint about the old one.
 */
function clearStatus(only?: StatusSource): void {
  const current = statusArea.firstElementChild;

  if (only && current instanceof HTMLElement && current.dataset.source !== only) return;

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
    restored = false;
    // The one place a page becomes the page on screen, and therefore the one
    // place worth remembering for a reopen — including which page it is, which
    // the payload carries in its query echo.
    persistSnapshot(current);
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

  if (await bridge.openLink(url)) clearStatus('link');
  else showStatus('error', 'link', COPY.linkRefused);
}

async function requestFullText(dokumentnummer: string): Promise<void> {
  if (!bridge) return;

  if (await bridge.sendPrompt(fullTextPrompt(dokumentnummer))) clearStatus('prompt');
  else showStatus('error', 'prompt', COPY.promptRefused);
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
    present(await bridge.callTool(call));
  } catch {
    renderCurrent();
    showStatus('error', 'pagination', COPY.sessionExpired);
  } finally {
    pending = false;
    // Whether the page arrived or the old one was put back, the button the user
    // pressed was replaced along with the rest of the list.
    focusPagination(view, delta);
  }
}

const handlers: ResultHandlers = {
  onOpen: (row) => void openExternal(row.risUrl),
  onPdf: (row) => void openExternal(row.pdfUrl),
  onFullText: (row) => void requestFullText(row.id),
  onPage: (delta) => void goToPage(delta),
};

/**
 * Put a tool result on screen, whichever call it answers.
 *
 * Having a list already is what separates the two cases, so both the notice
 * wording and the decision to keep the list follow from it. In particular a
 * *second* tool-result notification — a host re-delivering, or a re-run of the
 * search — must not be able to replace a rendered list with a notice just
 * because it arrived without structured content.
 */
function present(payload: ToolPayload): void {
  const isFollowUp = current !== null;
  show(interpretPayload(payload, isFollowUp ? 'follow-up' : 'mount'), isFollowUp);
}

/**
 * Take a tool result the host delivered by itself.
 *
 * Kept apart from a page the widget asked for, because only here can a result
 * arrive that the widget already knows better: on reopening a conversation
 * ChatGPT replays the mounting result stripped of its data, and complaining
 * about that underneath a list restored from this widget's own last render
 * would be noise about a problem the user does not have. Anything that carries
 * data — or reports a failure — is passed on unchanged.
 */
function presentFromHost(payload: ToolPayload): void {
  if (restored && payload.source === 'missing' && !payload.isError) return;

  present(payload);
}

/**
 * Put this widget's own last render back on screen.
 *
 * Only ever runs while there is nothing else to show, which is what keeps a
 * restored page from masking fresher data: a result that already arrived
 * prevents the restore, and one that arrives later replaces it.
 */
function restorePrevious(): void {
  if (current) return;

  const snapshot = parseSearchResult(restoreSnapshot());
  if (!snapshot) return;

  current = snapshot;
  restored = true;
  clearStatus();
  renderCurrent();
}

// The marker only ever answers "did the bundle run at all" — reaching this line
// is that answer, so it goes away before anything else is decided.
marker.hidden = true;
view.replaceChildren(createSkeleton());

connectBridge({ onToolResult: presentFromHost })
  .then((connected) => {
    bridge = connected;
    // Late enough that a host which delivers the mount result during the
    // handshake has already been served, and early enough that a reopened
    // conversation shows its page instead of a notice. A failed handshake
    // deliberately restores nothing: a list whose buttons cannot reach a host
    // would be worse than the notice that says so.
    restorePrevious();
  })
  .catch(() => {
    // A handshake that never completed means no tool result ever arrived, so
    // this is always the mount case.
    if (!current) {
      view.replaceChildren(createNotice('error', COPY.connectFailedTitle, COPY.answerInChat));
    }
  });
