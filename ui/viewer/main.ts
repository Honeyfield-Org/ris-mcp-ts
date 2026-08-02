/**
 * Entry point of the document viewer widget.
 *
 * Owns the lifecycle and the little state a reading session has — which
 * document is open, which sections are held, whether a call is in flight — and
 * delegates everything else: host protocol to `shared/bridge.ts`, display rules
 * to `viewmodel.ts`, elements to `view.ts`.
 *
 * The first render walks a four-rung ladder and takes the first rung that
 * yields content: the mounting result's text block, the document named by the
 * tool *input*, this widget's own last snapshot, and finally an honest notice.
 * The chat keeps the complete text and the resource link in every one of them.
 */

import { connectBridge, readMountInput, type Bridge, type ToolPayload } from '../shared/bridge.js';
import { createNotice, createSkeleton, type NoticeKind } from '../shared/states.js';
import { createSnapshotStore } from '../shared/widget-state.js';

import { COPY } from './copy.js';
import {
  disableLoading,
  focusAfterJump,
  interpretPayload,
  renderDocument,
  renderNotice,
  viewportHeight,
  type RenderedDocument,
  type ViewerHandlers,
} from './view.js';
import {
  anchorLabelFor,
  buildDocumentView,
  parseSnapshot,
  relocateAnchor,
  type DocumentChunk,
  type DocumentKey,
  type ViewerState,
} from './viewmodel.js';

/** The tool the viewer loads every further section with. */
const CHUNK_TOOL = 'ris_dokument_abschnitt';

/** How far ahead of the viewport a section is fetched — roughly one screen. */
const PREFETCH_MARGIN = '600px 0px';

/** How long scrolling settles before the reading position is stored. */
const ANCHOR_DEBOUNCE_MS = 500;

/** This widget's own snapshot slot; the Trefferliste keeps a separate one. */
const snapshots = createSnapshotStore('risViewer', 1);

function byId(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Dokument-Viewer: #${id} fehlt im HTML-Shell`);
  return node;
}

const marker = byId('nojs-marker');
const view = byId('ris-view');
const statusArea = byId('ris-status');

/** The document on screen, or `null` while there is none. */
let state: ViewerState | null = null;
let bridge: Bridge | null = null;
/** Guards against a second section request while one is still running. */
let pending = false;
/** True once a call failed at the transport — every further one would too. */
let expired = false;
/** True while what is on screen came from the snapshot rather than the host. */
let restored = false;
/** Identity from the `toolinput` channel, before any document exists. */
let mountKey: DocumentKey | null = null;
let height = viewportHeight(undefined);
let rendered: RenderedDocument | null = null;
let observer: IntersectionObserver | null = null;
/** Section to scroll to once the text holding it has arrived. */
let pendingAnchor: number | null = null;
/** Label of the section to scroll to after the offsets shifted under us. */
let pendingLabel: string | null = null;
/** Reading position, in characters into the document text. */
let anchorOffset = 0;
let anchorTimer: ReturnType<typeof setTimeout> | undefined;

// =============================================================================
// Notices
// =============================================================================

function showStatus(kind: NoticeKind, title: string, detail?: string): void {
  statusArea.replaceChildren(createNotice(kind, title, detail));
}

function clearStatus(): void {
  statusArea.replaceChildren();
}

/**
 * Put a notice where the document would be.
 *
 * Only ever for a mount that produced nothing: once text is on screen a failure
 * goes underneath it instead, because a section the viewer asked for itself has
 * no chat answer to fall back on — what it has is the text already read.
 */
function showEmpty(node: HTMLElement): void {
  if (state) return;
  clearStatus();
  renderNotice(view, node);
}

// =============================================================================
// Rendering
// =============================================================================

const handlers: ViewerHandlers = {
  onJump: (offset) => jumpTo(offset),
  onLoadGap: (offset) => void loadSection(offset, 'append'),
  onOpenLink: (url) => void openExternal(url),
};

function render(): void {
  if (!state) return;

  // Appended text lands below what is on screen, so the position the reader was
  // at is still the right one after the subtree is replaced.
  const scrollTop = rendered?.textPane.scrollTop ?? 0;

  stopObserving();
  const model = buildDocumentView(state);
  state.title = model.title;
  rendered = renderDocument(view, model, handlers, height);
  rendered.textPane.scrollTop = scrollTop;
  rendered.textPane.addEventListener('scroll', onScroll, { passive: true });

  if (expired) disableLoading(view);
  else observeSentinel();

  if (pendingAnchor !== null && focusAfterJump(view, pendingAnchor)) {
    anchorOffset = pendingAnchor;
    pendingAnchor = null;
  }

  persist();
}

async function openExternal(url: string): Promise<void> {
  if (!bridge) return;

  if (await bridge.openLink(url)) clearStatus();
  else showStatus('error', COPY.linkRefused);
}

/**
 * Scroll to a section, loading the text that holds it when it is not on screen.
 *
 * The outline rail stays visible and interactive throughout — it is already
 * loaded, and blanking it would lose the user's place.
 */
function jumpTo(offset: number): void {
  if (focusAfterJump(view, offset)) {
    anchorOffset = offset;
    persist();
    return;
  }

  pendingAnchor = offset;
  void loadSection(offset, 'replace');
}

// =============================================================================
// Loading
// =============================================================================

/** An identifier pair with no `undefined` members, so it travels as arguments. */
function documentKey(dokumentnummer?: string, url?: string): DocumentKey {
  const key: DocumentKey = {};
  if (dokumentnummer) key.dokumentnummer = dokumentnummer;
  if (url) key.url = url;
  return key;
}

function currentKey(): DocumentKey | null {
  const key = state?.key ?? mountKey;
  return key && (key.dokumentnummer ?? key.url) ? key : null;
}

/**
 * Take a section into the document on screen.
 *
 * A `total_length` that differs from the one held means the text was fetched
 * again between two calls — the metadata header of a document differs depending
 * on whether the direct fetch or the search fallback supplied it — so every
 * offset held addresses the wrong place and only the section that just arrived
 * is still true.
 */
function adoptChunk(offset: number, chunk: DocumentChunk, key: DocumentKey): boolean {
  const shifted =
    state !== null && state.totalLength !== null && state.totalLength !== chunk.total_length;

  if (!state || shifted) {
    state = {
      key,
      chunks: [],
      totalLength: null,
      outline: [],
      sourceUrl: null,
      title: state?.title ?? '',
      provisional: false,
    };
  }

  // The mount text is a truncated prefix with no length and no outline; the
  // canonical series supersedes it whole.
  if (state.provisional) {
    state.chunks = [];
    state.provisional = false;
  }

  state.totalLength = chunk.total_length;
  if (chunk.outline) state.outline = chunk.outline;
  if (chunk.source_url) state.sourceUrl = chunk.source_url;
  state.chunks.push({ offset, text: chunk.text, nextOffset: chunk.next_offset });
  restored = false;

  return shifted;
}

/**
 * Fetch one section of the open document.
 *
 * Exactly one call is ever in flight: the observer is disconnected while one
 * runs and re-attached afterwards, which is what keeps a burst of intersections
 * during fast scrolling from turning into a burst of tool calls.
 */
async function loadSection(offset: number, mode: 'append' | 'replace'): Promise<void> {
  const key = currentKey();
  if (!bridge || !key || pending || expired) return;

  pending = true;
  stopObserving();

  if (mode === 'replace' && rendered) {
    rendered.textPane.replaceChildren(createSkeleton(3, COPY.loadingSection));
  }

  try {
    const payload = await bridge.callTool({ name: CHUNK_TOOL, arguments: { ...key, offset } });
    const outcome = interpretPayload(payload, 'section');

    if (outcome.kind === 'chunk') {
      const priorOutline = state?.outline ?? [];
      const shifted = adoptChunk(offset, outcome.chunk, key);
      clearStatus();

      // Only a fresh outline can say where a remembered section sits now, and
      // that arrives with the opening section alone.
      if (shifted && offset !== 0) {
        pendingLabel ??= anchorLabelFor(priorOutline, anchorOffset);
        render();
        pending = false;
        await loadSection(0, 'replace');
        return;
      }

      if (pendingLabel && state) {
        const target = relocateAnchor(state.outline, pendingLabel, 0);
        pendingLabel = null;
        if (target > 0) pendingAnchor = target;
      }

      render();
      return;
    }

    if (outcome.kind === 'notice') {
      if (state) {
        render();
        statusArea.replaceChildren(outcome.node);
      } else {
        showEmpty(outcome.node);
      }
    }
  } catch {
    // A rejected call is a transport failure — an evicted session, in practice.
    // Everything already read stays on screen; only the controls that would
    // fail the same way are taken out of service.
    expired = true;
    pendingAnchor = null;
    pendingLabel = null;
    if (state) render();
    showStatus('error', COPY.sessionExpired);
  } finally {
    pending = false;
  }
}

// =============================================================================
// Lazy loading
// =============================================================================

function stopObserving(): void {
  observer?.disconnect();
  observer = null;
}

/**
 * Watch for the end of the text coming into view.
 *
 * The root is the text pane rather than the iframe: the pane is the only real
 * scroll container, and against the iframe's own viewport — which is as tall as
 * its content — every sentinel would intersect at once and load the whole
 * document immediately.
 */
function observeSentinel(): void {
  const sentinel = rendered?.sentinel;
  if (!sentinel || expired) return;
  if (typeof IntersectionObserver !== 'function') return;
  if (document.visibilityState === 'hidden') return;

  const offset = Number(sentinel.dataset.offset);
  const root = rendered?.textPane ?? null;

  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadSection(offset, 'append');
    },
    { root, rootMargin: PREFETCH_MARGIN },
  );
  observer.observe(sentinel);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') stopObserving();
  else if (!pending) observeSentinel();
});

// =============================================================================
// Reading position
// =============================================================================

/** The topmost section still at or above the top of the reading pane. */
function visibleAnchor(): number {
  const pane = rendered?.textPane;
  if (!pane) return anchorOffset;

  const top = pane.getBoundingClientRect().top;
  let best = state?.chunks[0]?.offset ?? 0;

  for (const section of pane.querySelectorAll<HTMLElement>('[id^="ris-sec-"]')) {
    if (section.getBoundingClientRect().top - top > 0) break;
    best = Number(section.id.slice('ris-sec-'.length));
  }

  return best;
}

function onScroll(): void {
  clearTimeout(anchorTimer);
  anchorTimer = setTimeout(() => {
    const next = visibleAnchor();
    if (next === anchorOffset) return;

    anchorOffset = next;
    persist();
  }, ANCHOR_DEBOUNCE_MS);
}

/**
 * Remember the document and the place in it, never its text.
 *
 * The outline is the elastic element: a long one is dropped rather than losing
 * the whole snapshot, because the document, its title and the reading position
 * are what make a reopen recognisable at all.
 */
function persist(): void {
  if (!state) return;

  const snapshot = {
    ...state.key,
    title: state.title,
    totalLength: state.totalLength,
    anchorOffset,
    anchorLabel: anchorLabelFor(state.outline, anchorOffset),
  };

  if (state.outline.length > 0 && snapshots.persist({ ...snapshot, outline: state.outline })) {
    return;
  }

  snapshots.persist(snapshot);
}

// =============================================================================
// The first-render ladder
// =============================================================================

/** Rung 1: the text block of the result that mounted the widget. */
function adoptMountText(text: string): void {
  // Fresh text always wins over a restored snapshot, and never over the
  // canonical sections the viewer has already loaded for itself.
  if (state && !state.provisional && !restored) return;

  state = {
    key: state?.key ?? mountKey ?? {},
    chunks: [{ offset: 0, text, nextOffset: null }],
    totalLength: null,
    outline: [],
    sourceUrl: null,
    title: '',
    provisional: true,
  };
  restored = false;
  clearStatus();
  render();
}

/**
 * Take the result the host delivered by itself.
 *
 * A host that reopens a conversation replays the mounting result stripped of
 * its content; complaining about that underneath a document restored from this
 * widget's own snapshot would be noise about a problem the user does not have.
 */
function presentMount(payload: ToolPayload): void {
  if (restored && !payload.text && !payload.isError) return;

  const outcome = interpretPayload(payload, 'mount');

  if (outcome.kind === 'text') {
    adoptMountText(outcome.text);
    return;
  }

  if (outcome.kind === 'notice') {
    if (state) statusArea.replaceChildren(outcome.node);
    else showEmpty(outcome.node);
  }
}

/** Rung 2: the document named by the arguments of the mounting call. */
function takeMountInput(args: Record<string, unknown>): void {
  const key = documentKey(
    typeof args.dokumentnummer === 'string' ? args.dokumentnummer : undefined,
    typeof args.url === 'string' ? args.url : undefined,
  );

  if (key.dokumentnummer ?? key.url) mountKey = key;
}

/** Rung 3: this widget's own last render, as structure without its text. */
function restorePrevious(): boolean {
  const snapshot = parseSnapshot(snapshots.restore());
  if (!snapshot) return false;

  state = {
    key: documentKey(snapshot.dokumentnummer, snapshot.url),
    chunks: [],
    totalLength: snapshot.totalLength,
    outline: snapshot.outline ?? [],
    sourceUrl: null,
    title: snapshot.title,
    provisional: false,
  };
  restored = true;
  anchorOffset = snapshot.anchorOffset;
  pendingLabel = snapshot.anchorLabel;
  pendingAnchor = snapshot.anchorOffset;
  render();

  void loadSection(snapshot.anchorOffset, 'replace');
  return true;
}

/**
 * Walk the ladder as far as the host allows.
 *
 * Runs once the handshake has resolved: late enough that a host delivering the
 * mount result during the handshake has already been served, and early enough
 * that a reopened conversation shows its document instead of a notice.
 */
function advanceLadder(): void {
  if (state) return;

  if (!mountKey) {
    const args = readMountInput();
    if (args) takeMountInput(args);
  }

  if (mountKey) {
    void loadSection(0, 'append');
    return;
  }

  if (restorePrevious()) return;

  showEmpty(createNotice('info', COPY.degradedTitle, COPY.textInChat));
}

// =============================================================================
// Mount
// =============================================================================

// The marker only ever answers "did the bundle run at all" — reaching this line
// is that answer, so it goes away before anything else is decided.
marker.hidden = true;
view.replaceChildren(createSkeleton(3, COPY.loading));

connectBridge({
  appName: 'ris-mcp-viewer',
  onToolResult: presentMount,
  onToolInput: takeMountInput,
  onHostContext: (context) => {
    const next = viewportHeight(context);
    if (next === height) return;

    height = next;
    if (state) render();
  },
})
  .then((connected) => {
    bridge = connected;
    advanceLadder();
  })
  .catch(() => {
    // A handshake that never completed means no tool result ever arrived, so
    // this is always the mount case.
    if (!state) {
      renderNotice(view, createNotice('error', COPY.connectFailedTitle, COPY.textInChat));
    }
  });
