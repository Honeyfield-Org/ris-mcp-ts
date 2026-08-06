/**
 * Entry point of the document viewer widget.
 *
 * Owns the lifecycle and the little state a reading session has — which
 * document is open, which sections are held, whether a call is in flight — and
 * delegates everything else: host protocol to `shared/bridge.ts`, display rules
 * to `viewmodel.ts`, elements to `view.ts`.
 *
 * The first render walks a four-rung ladder and takes the first rung that
 * yields content: the mounting result — its text block *or* its structured
 * payload, whichever the host delivered — then the document named by the tool
 * *input*, then this widget's own last snapshot, and finally an honest notice.
 * The chat keeps the complete text, including its `**Quelle:**` link to the RIS
 * original, in every one of them.
 */

import { connectBridge, readMountInput, type Bridge, type ToolPayload } from '../shared/bridge.js';
import { createNotice, createSkeleton, type NoticeKind } from '../shared/states.js';
import { createSnapshotStore } from '../shared/widget-state.js';

import { COPY } from './copy.js';
import {
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
  readDisplayMode,
  readSafeAreaInsets,
  relocateAnchor,
  type DisplayMode,
  type DocumentChunk,
  type DocumentKey,
  type MountDocument,
  type SafeAreaInsets,
  type ViewerSnapshot,
  type ViewerState,
} from './viewmodel.js';

/** The tool the viewer loads every further section with. */
const CHUNK_TOOL = 'ris_dokument_abschnitt';

/**
 * How far ahead of the viewport a section is fetched — several screens, sized to
 * hide 10-15 seconds of host-call latency at reading pace (#93).
 */
const PREFETCH_MARGIN = '2000px 0px';

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
/** True once the handshake resolved: without it even `openLink` has no host. */
let connected = false;
/** True while what is on screen came from the snapshot rather than the host. */
let restored = false;
/** Identity from the `toolinput` channel, before any document exists. */
let mountKey: DocumentKey | null = null;
let height = viewportHeight(undefined);
/** How the host is displaying the widget right now. */
let displayMode: DisplayMode = 'inline';
/** Whether the host listed a fullscreen mode — the only feature detection there is. */
let canFullscreen = false;
/** Insets the host reported, or `null` while it reported none. */
let safeInsets: SafeAreaInsets | null = null;
/** Guards against a second display-mode request while one is still open. */
let modeRequestPending = false;
let rendered: RenderedDocument | null = null;
let observer: IntersectionObserver | null = null;
/** Section to scroll to once the text holding it has arrived. */
let pendingAnchor: number | null = null;
/** Label of the section to scroll to after the offsets shifted under us. */
let pendingLabel: string | null = null;
/** A jump the reader asked for while a section was still loading. */
let queuedJump: number | null = null;
/** Reading position, in characters into the document text. */
let anchorOffset = 0;
let anchorTimer: ReturnType<typeof setTimeout> | undefined;
/** Fingerprint of the snapshot last handed to the host. */
let persisted: string | null = null;
/** Why nothing more can be loaded, re-asserted on every later render. */
let failure: { title: string; detail?: string } | null = null;

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
  onToggleFullscreen: () => void toggleFullscreen(),
};

function render(): void {
  if (!state) return;

  // Appended text lands below what is on screen, so the position the reader was
  // at is still the right one after the subtree is replaced.
  const scrollTop = rendered?.textPane.scrollTop ?? 0;

  stopObserving();
  // The session state belongs to the module, but every control that follows from
  // it is rendered rather than reached back into afterwards.
  state.expired = expired;
  state.connected = connected;
  state.displayMode = displayMode;
  state.canFullscreen = canFullscreen;
  state.safeAreaInsets = safeInsets;
  const model = buildDocumentView(state);
  state.title = model.title;
  rendered = renderDocument(view, model, handlers, height);
  rendered.textPane.scrollTop = scrollTop;
  rendered.textPane.addEventListener('scroll', onScroll, { passive: true });
  observeSentinel();

  if (pendingAnchor !== null && focusAfterJump(view, pendingAnchor)) {
    anchorOffset = pendingAnchor;
    pendingAnchor = null;
  }

  persist();

  // A session that died stays reported. Text arriving afterwards — a host
  // replaying the mounting result, say — re-renders the document, and dropping
  // the one notice that explains why nothing more will load would leave a
  // viewer that silently stops halfway down.
  if (failure) showStatus('error', failure.title, failure.detail);
}

async function openExternal(url: string): Promise<void> {
  if (!bridge) return;

  if (await bridge.openLink(url)) clearStatus();
  else showStatus('error', COPY.linkRefused);
}

/**
 * Ask the host for the fullscreen display mode.
 *
 * Fire-and-forget on purpose: the request carries no deadline of its own, so a
 * host that never answers holds it for the SDK's full minute, and nothing on
 * screen may wait that out. What a second click during that minute must not do
 * is send a second request — the button stays enabled, because a control dead
 * for a minute is worse than one that ignores a click.
 *
 * A refusal arrives as an answer rather than as an error: the host replies with
 * the mode still in effect, which is why the granted mode is always checked.
 */
async function toggleFullscreen(): Promise<void> {
  if (!bridge || !connected || modeRequestPending) return;

  modeRequestPending = true;

  try {
    const granted = await bridge.requestDisplayMode('fullscreen');

    if (granted !== 'fullscreen') {
      showStatus('error', COPY.fullscreenRefused);
      return;
    }

    clearStatus();
    displayMode = granted;
    keepReadingPosition();
    render();
  } finally {
    modeRequestPending = false;
  }
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

  // A jump pressed while a section is still loading is queued rather than
  // dropped: only one call may be in flight, and silently ignoring the click
  // would leave the reader pressing a button that does nothing.
  if (pending) {
    queuedJump = offset;
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
      failedOffset: null,
      expired,
      connected,
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
  // Whatever failed before, this offset answered — the automatic sentinel gets
  // its attempt back.
  state.failedOffset = null;
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

  // A targeted insert rather than a state flag: rendering it would mean a
  // `render()` mid-flight, which re-arms the sentinel the call just disarmed.
  // It goes beside the sentinel and not inside it, because that one is
  // `aria-hidden` and would take the announcement down with it.
  let loadingNode: HTMLElement | null = null;
  if (mode === 'append' && rendered) {
    loadingNode = document.createElement('div');
    loadingNode.className = 'ris-doc-loading';
    loadingNode.setAttribute('role', 'status');
    loadingNode.textContent = COPY.loadingMore;
    rendered.textPane.append(loadingNode);
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
      pendingAnchor = null;

      if (state) {
        // One automatic attempt per offset. Re-arming the sentinel here would
        // request the failing section again the moment it scrolls back into
        // view — forever, and hardest against a server that is rate-limiting.
        // The offset becomes a gap marker the reader may press instead.
        state.failedOffset = offset;
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
    failure = { title: COPY.sessionExpired };
    pendingAnchor = null;
    pendingLabel = null;
    queuedJump = null;

    if (state) render();
    else showStatus('error', COPY.sessionExpired);
  } finally {
    pending = false;
    // Every outcome that puts text on screen re-renders the pane without it;
    // this covers the ones that leave the pane standing — a failure, an evicted
    // session — where a label promising a section would outlive the section.
    loadingNode?.remove();

    // A jump the reader pressed while this call ran, now that the section it
    // waited for is on screen — which may even be the one it wanted.
    const queued = queuedJump;
    queuedJump = null;
    if (queued !== null && !expired) jumpTo(queued);
  }
}

/**
 * Fetch the opening section as soon as there is a host to ask.
 *
 * The offset-0 section carries the outline, and a document whose outline blew
 * the mount budget carries none — leaving it to the sentinel kept the rail
 * invisible until the reader had scrolled the whole 25 000-character mount run
 * (#92). Every further section stays scroll-driven.
 *
 * The guards mirror `loadSection`'s own; `provisional` is the additional one, so
 * a document that is already canonical — restored, or loaded section by section
 * — never refetches what it holds.
 */
function eagerFirstSection(): void {
  if (!state?.provisional || pending || expired) return;
  void loadSection(0, 'append');
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
 * Writes only when what would be stored actually changed — the first render of
 * a document, and afterwards a reading position that moved. Appending a section
 * changes the text on screen and nothing in the snapshot, so it is not a write.
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

  // Every field the snapshot carries, plus the outline by length — the only
  // thing that can change about it is arriving or being replaced wholesale.
  const signature = [
    snapshot.dokumentnummer ?? '',
    snapshot.url ?? '',
    snapshot.title,
    snapshot.totalLength,
    snapshot.anchorOffset,
    snapshot.anchorLabel ?? '',
    state.outline.length,
  ].join('|');

  if (signature === persisted) return;
  persisted = signature;

  if (state.outline.length > 0 && snapshots.persist({ ...snapshot, outline: state.outline })) {
    return;
  }

  snapshots.persist(snapshot);
}

// =============================================================================
// The frame around the widget
// =============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Ask the next render to return to the section the reader was on.
 *
 * For every render the host forces by re-laying the widget out: the pane is
 * rebuilt, and the pixel scroll of a pane that no longer exists says nothing
 * about where the reader was, while a content offset survives any reflow.
 *
 * Two accepted consequences: `focusAfterJump` moves DOM focus along with the
 * scroll, and the anchor is scroll-debounced, so a change inside that window
 * returns to the section before the last one. An anchor of 0 is deliberately
 * left alone — that is the top of the document, which the re-render restores by
 * keeping the pane's scroll position, so moving focus is all it would do.
 */
function keepReadingPosition(): void {
  if (state && anchorOffset > 0) pendingAnchor = anchorOffset;
}

/**
 * Take what the host says about the frame the widget is rendered in.
 *
 * The context arrives as a *delta*: a host sends the fields that changed and
 * nothing else, so each one is read only where it is present. Recomputing the
 * height regardless is what let a `{ theme }` or `{ displayMode }` change answer
 * "no dimensions" with the fallback and collapse a pane the host had sized.
 */
function onHostContext(context: unknown): void {
  if (!isRecord(context)) return;

  let changed = false;

  if (context.containerDimensions !== undefined) {
    const next = viewportHeight(context);
    if (next !== height) {
      height = next;
      changed = true;
    }
  }

  if (context.displayMode !== undefined) {
    const mode = readDisplayMode(context.displayMode);
    if (mode && mode !== displayMode) {
      displayMode = mode;
      changed = true;
    }
  }

  if (context.availableDisplayModes !== undefined) {
    const offered =
      Array.isArray(context.availableDisplayModes) &&
      context.availableDisplayModes.includes('fullscreen');
    if (offered !== canFullscreen) {
      canFullscreen = offered;
      changed = true;
    }
  }

  if (context.safeAreaInsets !== undefined) {
    safeInsets = readSafeAreaInsets(context.safeAreaInsets);
    changed = true;
  }

  if (!changed || !state) return;

  keepReadingPosition();
  render();
}

// =============================================================================
// The first-render ladder
// =============================================================================

/**
 * Rung 1: the mounting `ris_dokument` result, from whichever channel carried it.
 *
 * The text is a *truncated* rendering with a German notice appended, so the run
 * stays provisional however much the payload said about it: where this text ends
 * is not where the document continues, and the canonical series replaces it
 * whole on the first scroll. What the structured payload adds is everything
 * around the text — the document's real length, its outline, and the identifier
 * without which no further section could be fetched at all.
 */
function adoptMountDocument(mount: MountDocument): void {
  // Fresh text always wins over a restored snapshot, and never over the
  // canonical sections the viewer has already loaded for itself.
  if (state && !state.provisional && !restored) return;

  // The payload's own identifier when it carried one — this is the whole reason
  // the structured channel matters, because a host may deliver it and nothing
  // else. Otherwise whatever the tool-input channel or an earlier render knew.
  const named = Boolean(mount.key.dokumentnummer ?? mount.key.url);

  state = {
    key: named ? mount.key : (state?.key ?? mountKey ?? {}),
    chunks: [{ offset: 0, text: mount.text, nextOffset: null }],
    totalLength: mount.totalLength,
    outline: mount.outline ?? [],
    sourceUrl: mount.sourceUrl,
    title: '',
    provisional: true,
    failedOffset: null,
    expired,
    connected,
  };
  restored = false;
  clearStatus();
  render();
  // Synchronously after the render that armed the sentinel, so the call's own
  // `stopObserving()` disarms it before an intersection can fire a second one.
  eagerFirstSection();
}

/**
 * Take the result the host delivered by itself.
 *
 * A reopened conversation replays the mounting result, and how much of it
 * survives the replay is the host's business: one that kept the structured
 * payload replays the document itself, which then wins over anything restored
 * from this widget's own snapshot; one that replays it stripped of both
 * channels says nothing the viewer does not already know better.
 */
function presentMount(payload: ToolPayload): void {
  const outcome = interpretPayload(payload, 'mount');

  if (outcome.kind === 'empty') {
    // Neither channel carried anything. Under a document already on screen that
    // is the stripped replay above, and complaining about it would be noise
    // about a problem the user does not have; with nothing on screen the ladder
    // has further rungs to try.
    return;
  }

  if (outcome.kind === 'document') {
    adoptMountDocument(outcome.document);
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
function restoreFrom(snapshot: ViewerSnapshot): void {
  state = {
    key: documentKey(snapshot.dokumentnummer, snapshot.url),
    chunks: [],
    totalLength: snapshot.totalLength,
    outline: snapshot.outline ?? [],
    sourceUrl: null,
    title: snapshot.title,
    provisional: false,
    failedOffset: null,
    expired,
    connected,
  };
  restored = true;
  anchorOffset = snapshot.anchorOffset;
  pendingLabel = snapshot.anchorLabel;
  pendingAnchor = snapshot.anchorOffset;
  render();

  void loadSection(snapshot.anchorOffset, 'replace');
}

/** Whether a stored snapshot describes the document the mounting call named. */
function sameDocument(snapshot: ViewerSnapshot, key: DocumentKey): boolean {
  if (snapshot.dokumentnummer && key.dokumentnummer) {
    return snapshot.dokumentnummer === key.dokumentnummer;
  }
  if (snapshot.url && key.url) return snapshot.url === key.url;

  return false;
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

  const snapshot = parseSnapshot(snapshots.restore());

  if (mountKey) {
    // The two rungs are not exclusive, and the host that stores snapshots is
    // also the one that delivers the arguments: taking rung 2 blindly would
    // reopen every conversation at the top of the document and make the stored
    // reading position unreachable in the only host that has one. A snapshot of
    // a *different* document is stale — fresh data wins and rung 2 starts the
    // new document from its first section.
    if (snapshot && sameDocument(snapshot, mountKey)) {
      restoreFrom(snapshot);
      return;
    }

    void loadSection(0, 'append');
    return;
  }

  if (snapshot) {
    restoreFrom(snapshot);
    return;
  }

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
  // Declared per widget: the host renders its fullscreen affordance from this
  // list, so a widget with no fullscreen layout stays out of it. `pip` is not
  // declared — claude.ai does not offer it and this pane has no layout for it.
  displayModes: ['inline', 'fullscreen'],
  onToolResult: presentMount,
  onToolInput: takeMountInput,
  onHostContext,
})
  .then((host) => {
    bridge = host;
    connected = true;
    // The first render may have happened before the handshake resolved — on a
    // host that delivers the mounting result during it, which is the normal
    // path. Its links were rendered against a host that was not there yet.
    if (state) render();
    advanceLadder();
    // On the normal path the mount result arrived while `bridge` was still
    // null, so its own eager attempt was dropped and this is the one that runs.
    // It sits after `advanceLadder()` because every rung that fetches something
    // itself leaves `pending` set or the document canonical, and neither can
    // then become a second call.
    eagerFirstSection();
  })
  .catch(() => {
    // Without a handshake no section can ever be loaded, so the controls that
    // would try are taken out of service exactly as they are for an evicted
    // session. The notice holds either way: a document rendered from the mount
    // text alone would otherwise quietly stop working halfway down.
    expired = true;
    failure = { title: COPY.connectFailedTitle, detail: COPY.textInChat };

    if (state) render();
    else renderNotice(view, createNotice('error', COPY.connectFailedTitle, COPY.textInChat));
  });
