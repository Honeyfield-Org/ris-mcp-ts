/**
 * Mount behaviour of the widget entry, with the host stubbed out.
 *
 * Covers what only the entry decides: which rung of the first-render ladder
 * ends up on screen, what it costs in tool calls, and what survives a failure.
 * `main.ts` runs on import, so every case starts from a fresh module instance
 * and a fresh page shell.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DECISION_OUTLINE,
  documentResult,
  GAZETTE_OUTLINE,
  GAZETTE_TOTAL,
  LONG_TOTAL,
  NORM_MARKDOWN,
} from '../__fixtures__/document-chunks.js';
import type { Bridge, BridgeOptions, ToolPayload } from '../shared/bridge.js';

import { COPY } from './copy.js';
import type { DocumentChunk, DocumentResult } from './viewmodel.js';

/** Captured from the mount so a test can play the host's part. */
let deliver: BridgeOptions['onToolResult'];
let deliverInput: BridgeOptions['onToolInput'];
let deliverContext: BridgeOptions['onHostContext'];
let handshake: Promise<Bridge>;
/** Ends the handshake, so a test can decide what arrives before it does. */
let connect: () => Promise<void>;

const bridge: Bridge = {
  callTool: vi.fn(),
  openLink: vi.fn(async () => true),
  sendPrompt: vi.fn(async () => true),
};

// Only `connectBridge` is replaced: `readMountInput` is the real one, so the
// ChatGPT-global case below exercises the code that runs in a host.
vi.mock('../shared/bridge.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  connectBridge: vi.fn((options: BridgeOptions) => {
    deliver = options.onToolResult;
    deliverInput = options.onToolInput;
    deliverContext = options.onHostContext;
    return handshake;
  }),
}));

// =============================================================================
// A scroll container the widget can observe
// =============================================================================

interface FakeObserver {
  callback: IntersectionObserverCallback;
  targets: Element[];
  active: boolean;
}

const observers: FakeObserver[] = [];

/** jsdom implements no IntersectionObserver, so the sentinel gets a stand-in. */
class TestIntersectionObserver {
  private readonly record: FakeObserver;

  constructor(callback: IntersectionObserverCallback) {
    this.record = { callback, targets: [], active: true };
    observers.push(this.record);
  }

  observe(target: Element): void {
    this.record.targets.push(target);
  }

  unobserve(): void {
    /* the widget only ever disconnects */
  }

  disconnect(): void {
    this.record.active = false;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/**
 * Observers still watching something inside the widget on screen.
 *
 * Scoped to the current shell on purpose: `vi.resetModules()` leaves every
 * earlier module instance subscribed to the same jsdom `document`, and their
 * `visibilitychange` handlers still create observers over their own detached
 * elements. Only the ones watching the live shell are this widget's.
 */
function liveObservers(): FakeObserver[] {
  const shell = view();
  return observers.filter(
    (observer) => observer.active && observer.targets.some((target) => shell.contains(target)),
  );
}

function fire(observer: FakeObserver): void {
  observer.callback(
    observer.targets.map(
      (target) => ({ isIntersecting: true, target }) as unknown as IntersectionObserverEntry,
    ),
    observer as unknown as IntersectionObserver,
  );
}

/** Scroll the sentinel into view, the way reading to the end of the text does. */
async function scrollToEnd(): Promise<void> {
  const observer = liveObservers().at(-1);
  if (!observer) throw new Error('nothing is watching for the end of the text');

  fire(observer);
  await settle();
}

/**
 * Deliver another intersection from whatever is still watching.
 *
 * A real host keeps calling back for as long as the sentinel is in view, so an
 * observer the widget re-armed on the same offset would fire again here.
 */
async function scrollAgain(): Promise<void> {
  for (const observer of liveObservers()) fire(observer);
  await settle();
}

/** Put the tab in the background, or bring it back. */
async function setVisibility(state: 'hidden' | 'visible'): Promise<void> {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  await settle();
}

// =============================================================================
// Payloads
// =============================================================================

/** A mounting result as a host delivering content blocks hands it over. */
function payload(overrides: Partial<ToolPayload> = {}): ToolPayload {
  return {
    structuredContent: null,
    source: 'missing',
    text: NORM_MARKDOWN,
    isError: false,
    ...overrides,
  };
}

/**
 * The same mounting result as claude.ai hands it over: structured content, no
 * content blocks.
 */
function structuredPayload(overrides: Partial<DocumentResult> = {}): ToolPayload {
  return {
    structuredContent: documentResult(overrides),
    source: 'toolresult',
    text: '',
    isError: false,
  };
}

/** What a host that delivered no data at all replays. */
function emptyPayload(): ToolPayload {
  return payload({ text: '' });
}

/** A section as `ris_dokument_abschnitt` answers it. */
function section(overrides: Partial<DocumentChunk> = {}): ToolPayload {
  const chunk: DocumentChunk = {
    text: '# Titel\n\n## Inhalt\n\nErster Abschnitt.',
    total_length: LONG_TOTAL,
    next_offset: 37,
    outline: DECISION_OUTLINE,
    source_url: 'https://www.ris.bka.gv.at/Dokumente/Bvwg/BVWGT_1/BVWGT_1.html',
    ...overrides,
  };

  return { structuredContent: chunk, source: 'toolresult', text: chunk.text, isError: false };
}

/** Install a host that already holds a viewer snapshot. */
function hostHolding(snapshot: unknown, extra: Record<string, unknown> = {}): void {
  Object.assign(globalThis, {
    openai: {
      widgetState: { privateContent: { risViewer: { version: 1, payload: snapshot } } },
      setWidgetState: vi.fn(),
      ...extra,
    },
  });
}

async function mount(): Promise<void> {
  vi.resetModules();
  await import('./main.js');
}

/** Let the handshake's `.then` and everything it queues run. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
}

function view(): HTMLElement {
  return document.getElementById('ris-view') as HTMLElement;
}

function text(): string {
  return view().querySelector('.ris-doc-text')?.textContent ?? '';
}

function noticeTitle(): string | undefined {
  return document.querySelector('.ris-notice-title')?.textContent ?? undefined;
}

function sentinelOffset(): string | undefined {
  return view().querySelector<HTMLElement>('.ris-doc-sentinel')?.dataset.offset;
}

function railLabels(): string[] {
  return [...view().querySelectorAll('.ris-outline-jump')].map(
    (jump) => jump.firstChild?.textContent ?? '',
  );
}

function calls(): unknown[] {
  return (bridge.callTool as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
}

function answersWith(payload: ToolPayload | Error): void {
  const mock = bridge.callTool as ReturnType<typeof vi.fn>;
  if (payload instanceof Error) mock.mockRejectedValue(payload);
  else mock.mockResolvedValue(payload);
}

/** Hold the next call open, so a second one can be attempted while it runs. */
function answersWhenTold(): (payload: ToolPayload) => Promise<void> {
  let release: (payload: ToolPayload) => void;
  const held = new Promise<ToolPayload>((resolve) => {
    release = resolve;
  });

  (bridge.callTool as ReturnType<typeof vi.fn>).mockReturnValue(held);

  return async (payload) => {
    release(payload);
    await settle();
  };
}

/** A payload that is not a section, which the viewer reports and does not adopt. */
function nonsense(): ToolPayload {
  return {
    structuredContent: { nichts: 'brauchbar' },
    source: 'toolresult',
    text: '',
    isError: false,
  };
}

beforeEach(() => {
  document.body.innerHTML =
    '<p id="nojs-marker"></p><main id="ris-view"></main><div id="ris-status"></div>';
  observers.length = 0;
  vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);

  let ready: (connected: Bridge) => void;
  handshake = new Promise<Bridge>((resolve) => {
    ready = resolve;
  });
  connect = async () => {
    ready(bridge);
    await settle();
  };
  answersWith(section());
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).openai;
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// =============================================================================
// Rung 1 — the text block of the mounting result
// =============================================================================

describe('rung 1: the mounting result carries the text', () => {
  it('renders the document without asking the server for anything', async () => {
    // The whole first-render thesis: `ris_dokument` declares no
    // `structuredContent`, and its text block reaches the widget regardless.
    await mount();
    deliver(payload());
    await connect();

    expect(text()).toContain('§ 1295.');
    expect(bridge.callTool).not.toHaveBeenCalled();
  });

  it('hides the marker that says the bundle never ran', async () => {
    await mount();

    expect(document.getElementById('nojs-marker')?.hidden).toBe(true);
  });

  it('replaces the mount text with the canonical section immediately at mount', async () => {
    // The mounting response is a truncated prefix with no length and no
    // outline, so the first section the viewer fetches supersedes it whole —
    // and it fetches it as soon as it has a host, not when the reader scrolls.
    await mount();
    deliverInput?.({ dokumentnummer: 'NOR12019037' });
    deliver(payload());
    expect(sentinelOffset()).toBe('0');

    await connect();

    expect(text()).toContain('Erster Abschnitt.');
    expect(text()).not.toContain('§ 1295.');
    expect(sentinelOffset()).toBe('37');
  });

  it('does not fire at mount for a document it cannot name', async () => {
    // A text block carries no identifier and no tool input arrived, so there is
    // nothing to address a section call to. The mount run stays what is on
    // screen, and no control promises more of it.
    await mount();
    deliver(payload());
    await connect();

    expect(bridge.callTool).not.toHaveBeenCalled();
    expect(text()).toContain('§ 1295.');
    expect(view().querySelector('.ris-doc-sentinel')).toBeNull();
  });

  it('reports a failed document load with the prose the server sent', async () => {
    await mount();
    await connect();
    deliver(payload({ isError: true, text: 'Dokument NOR1 wurde nicht gefunden.' }));

    expect(noticeTitle()).toBe(COPY.documentErrorTitle);
    expect(document.querySelector('.ris-notice-detail')?.textContent).toBe(
      'Dokument NOR1 wurde nicht gefunden.',
    );
  });
});

// =============================================================================
// Rung 1 — the same result through the structured channel
// =============================================================================

describe('rung 1: the mounting result arrives as structured content', () => {
  it('renders the document before it has a host, then fetches its first section', async () => {
    // claude.ai delivers neither content blocks nor tool input to a widget. Its
    // one measured channel carries the text itself, so the first render costs
    // nothing and happens before the handshake resolves (Live-Befund
    // 2026-08-02); the canonical series replaces it as soon as there is a host.
    await mount();
    deliver(structuredPayload());
    expect(text()).toContain('§ 1295.');
    expect(bridge.callTool).not.toHaveBeenCalled();

    await connect();

    expect(calls()).toEqual([
      { name: 'ris_dokument_abschnitt', arguments: { dokumentnummer: 'BVWGT_1', offset: 0 } },
    ]);
    expect(text()).toContain('Erster Abschnitt.');
  });

  it('fires the first section call at mount, before any scrolling', async () => {
    // #92: the outline arrives with the offset-0 section, and a document whose
    // outline blew the mount budget carries none. Waiting for the sentinel left
    // the rail invisible until the reader had scrolled the whole mount run.
    answersWith(section({ outline: GAZETTE_OUTLINE, total_length: GAZETTE_TOTAL }));

    await mount();
    deliver(structuredPayload({ outline: undefined, total_length: GAZETTE_TOTAL }));
    expect(railLabels()).toEqual([]);

    await connect();

    expect(calls()).toEqual([
      { name: 'ris_dokument_abschnitt', arguments: { dokumentnummer: 'BVWGT_1', offset: 0 } },
    ]);
    expect(text()).toContain('Erster Abschnitt.');
    expect(railLabels()).toContain('Steuersätze');
  });

  it('fires it for a document that only arrives after the handshake', async () => {
    // The other order: the host had nothing to deliver during the handshake, so
    // the ladder ended in its notice and the result replaces it later. The
    // eager call cannot ride on the handshake here — it has already resolved.
    await mount();
    await connect();
    expect(noticeTitle()).toBe(COPY.degradedTitle);

    deliver(structuredPayload());
    await settle();

    expect(calls()).toEqual([
      { name: 'ris_dokument_abschnitt', arguments: { dokumentnummer: 'BVWGT_1', offset: 0 } },
    ]);
    expect(text()).toContain('Erster Abschnitt.');
  });

  it('draws the outline rail and the progress from the same payload', async () => {
    // A mount payload that carried its outline draws the rail with no call at
    // all; the eager section then supersedes the text without taking it away.
    answersWith(section({ outline: GAZETTE_OUTLINE, total_length: GAZETTE_TOTAL }));

    await mount();
    deliver(structuredPayload({ outline: GAZETTE_OUTLINE, total_length: GAZETTE_TOTAL }));
    expect(railLabels()).toContain('Steuersätze');
    expect(bridge.callTool).not.toHaveBeenCalled();

    await connect();

    expect(railLabels()).toContain('Steuersätze');
    expect(view().querySelector('.ris-doc-progress')?.textContent).toMatch(/geladen$/);
    expect(calls()).toHaveLength(1);
  });

  it('names the document, so the reader can keep scrolling', async () => {
    // The finding this fixes: with no identifier from any channel the viewer
    // renders no sentinel at all, and the document ends after the first 25 000
    // characters however far the reader scrolls.
    await mount();
    deliver(structuredPayload());
    await connect();

    expect(sentinelOffset()).toBe('37');
    await scrollToEnd();

    expect(calls()).toEqual([
      { name: 'ris_dokument_abschnitt', arguments: { dokumentnummer: 'BVWGT_1', offset: 0 } },
      { name: 'ris_dokument_abschnitt', arguments: { dokumentnummer: 'BVWGT_1', offset: 37 } },
    ]);
    expect(text()).toContain('Erster Abschnitt.');
  });

  it('addresses a document with no Dokumentnummer by its source URL', async () => {
    const url = 'https://www.ris.bka.gv.at/Dokumente/Bvwg/BVWGT_1/BVWGT_1.html';

    await mount();
    deliver(structuredPayload({ dokumentnummer: undefined, source_url: url }));
    await connect();

    // Never both identifiers: the chunk tool given a `url` resolves through the
    // URL branch of the loader, which builds a different metadata header and
    // shifts every offset the viewer holds.
    expect(calls()).toEqual([{ name: 'ris_dokument_abschnitt', arguments: { url, offset: 0 } }]);
  });

  it('prefers the structured payload over the text block when a host sends both', async () => {
    await mount();
    deliver({ ...structuredPayload(), text: 'Etwas ganz anderes.' });

    // Identical strings on the wire, so the choice shows only in what comes with
    // them — here, the identifier the section call is addressed to.
    expect(text()).toContain('§ 1295.');

    await connect();

    expect(calls()).toEqual([
      { name: 'ris_dokument_abschnitt', arguments: { dokumentnummer: 'BVWGT_1', offset: 0 } },
    ]);
    expect(sentinelOffset()).toBe('37');
  });

  it('keeps the text on screen when the structured payload is unusable', async () => {
    await mount();
    deliver(payload({ structuredContent: { text: '', total_length: 0 } }));
    await connect();

    expect(text()).toContain('§ 1295.');
  });
});

// =============================================================================
// Rung 2 — the document named by the tool input
// =============================================================================

describe('rung 2: only the arguments of the mounting call arrive', () => {
  it('loads the opening section of the document it was told about', async () => {
    await mount();
    deliverInput?.({ dokumentnummer: 'NOR12019037' });
    deliver(emptyPayload());
    await connect();

    expect(calls()).toEqual([
      { name: 'ris_dokument_abschnitt', arguments: { dokumentnummer: 'NOR12019037', offset: 0 } },
    ]);
    expect(text()).toContain('Erster Abschnitt.');
  });

  it('takes the arguments from the ChatGPT global when no event fires', async () => {
    Object.assign(globalThis, { openai: { toolInput: { dokumentnummer: 'NOR12019037' } } });

    await mount();
    deliver(emptyPayload());
    await connect();

    expect(calls()).toEqual([
      { name: 'ris_dokument_abschnitt', arguments: { dokumentnummer: 'NOR12019037', offset: 0 } },
    ]);
  });

  it('addresses a document opened by URL by that URL', async () => {
    const url = 'https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR1/NOR1.html';
    answersWith(section({ dokumentnummer: undefined }));

    await mount();
    deliverInput?.({ url });
    deliver(emptyPayload());
    await connect();

    // The response's own `dokumentnummer` is optional and absent here; what the
    // viewer called with is what identifies the document.
    expect(calls()).toEqual([{ name: 'ris_dokument_abschnitt', arguments: { url, offset: 0 } }]);
    expect(text()).toContain('Erster Abschnitt.');
  });
});

// =============================================================================
// Rung 4 — nothing anywhere
// =============================================================================

describe('rung 4: no data on any channel', () => {
  it('says so instead of showing an empty box', async () => {
    await mount();
    deliver(emptyPayload());
    await connect();

    expect(noticeTitle()).toBe(COPY.degradedTitle);
    expect(document.querySelector('.ris-notice-detail')?.textContent).toBe(COPY.textInChat);
    expect(bridge.callTool).not.toHaveBeenCalled();
  });

  it('reports a handshake the host never completed', async () => {
    handshake = Promise.reject(new Error('kein Host'));
    handshake.catch(() => undefined);

    await mount();
    await settle();

    expect(noticeTitle()).toBe(COPY.connectFailedTitle);
  });
});

// =============================================================================
// Lazy loading and the expired session
// =============================================================================

describe('loading further sections', () => {
  async function openDocument(): Promise<void> {
    await mount();
    deliverInput?.({ dokumentnummer: 'NOR1' });
    deliver(emptyPayload());
    await connect();
  }

  it('appends the next section and moves the sentinel forward', async () => {
    await openDocument();
    expect(sentinelOffset()).toBe('37');

    answersWith(section({ text: 'Zweiter Abschnitt.', next_offset: 55, outline: undefined }));
    await scrollToEnd();

    expect(text()).toContain('Erster Abschnitt.');
    expect(text()).toContain('Zweiter Abschnitt.');
    expect(sentinelOffset()).toBe('55');
  });

  it('asks for one section at a time', async () => {
    await openDocument();
    answersWith(section({ text: 'Zweiter Abschnitt.', next_offset: 55, outline: undefined }));

    await scrollToEnd();
    await scrollToEnd();

    // Two intersections, two sections — never a burst of calls for the same one.
    expect(calls()).toHaveLength(3);
    expect(calls()[1]).toMatchObject({ arguments: { offset: 37 } });
    expect(calls()[2]).toMatchObject({ arguments: { offset: 55 } });
  });

  it('stops watching once the document ends', async () => {
    await openDocument();

    answersWith(section({ text: 'Letzter Abschnitt.', next_offset: null, outline: undefined }));
    await scrollToEnd();

    expect(view().querySelector('.ris-doc-sentinel')).toBeNull();
  });

  it('keeps the text already read when the session is gone', async () => {
    await openDocument();
    expect(text()).toContain('Erster Abschnitt.');

    answersWith(new Error('session gone'));
    await scrollToEnd();

    expect(text()).toContain('Erster Abschnitt.');
    expect(noticeTitle()).toBe(COPY.sessionExpired);
    // Every further call would fail the same way, and a control that cannot
    // work is worse than none.
    expect(view().querySelector('.ris-doc-sentinel')).toBeNull();
  });

  it('leaves the section on screen unchanged when a payload is not a section', async () => {
    await openDocument();

    answersWith(nonsense());
    await scrollToEnd();

    expect(text()).toContain('Erster Abschnitt.');
    expect(noticeTitle()).toBe(COPY.invalidPayloadTitle);
    expect(document.querySelector('.ris-notice-detail')?.textContent).toBe(COPY.sectionUnchanged);
  });

  it('asks for a failing section exactly once, and offers a manual retry', async () => {
    await openDocument();

    answersWith(nonsense());
    await scrollToEnd();
    expect(calls()).toHaveLength(2);

    // The sentinel is gone, so there is nothing left to fire; a host that kept
    // reporting the old one in view must not produce a second attempt either.
    expect(liveObservers()).toHaveLength(0);
    await scrollAgain();

    expect(calls()).toHaveLength(2);
    expect(view().querySelector('.ris-doc-gap button')).not.toBeNull();
  });

  it('retries the failed section when the reader presses the gap marker', async () => {
    await openDocument();
    answersWith(nonsense());
    await scrollToEnd();

    answersWith(section({ text: 'Doch noch da.', next_offset: null, outline: undefined }));
    view().querySelector<HTMLButtonElement>('.ris-doc-gap button')?.click();
    await settle();

    expect(calls()).toHaveLength(3);
    expect(calls()[2]).toMatchObject({ arguments: { offset: 37 } });
    expect(text()).toContain('Doch noch da.');
    expect(view().querySelector('.ris-doc-gap')).toBeNull();
  });

  it('stops watching while a section is in flight', async () => {
    await openDocument();
    const finish = answersWhenTold();

    await scrollToEnd();
    // Nothing is left to report an intersection during the call, which is what
    // keeps fast scrolling from turning into a burst of requests.
    expect(liveObservers()).toHaveLength(0);
    await scrollAgain();
    expect(calls()).toHaveLength(2);

    await finish(section({ text: 'Zweiter Abschnitt.', next_offset: null, outline: undefined }));
    expect(text()).toContain('Zweiter Abschnitt.');
  });

  it('asks for one section at a time, however often the reader presses', async () => {
    await openDocument();
    answersWith(nonsense());
    await scrollToEnd();

    const gap = (): HTMLButtonElement | null =>
      view().querySelector<HTMLButtonElement>('.ris-doc-gap button');
    const finish = answersWhenTold();

    gap()?.click();
    await settle();
    expect(calls()).toHaveLength(3);

    // A second press while the first request is still open. Only the in-flight
    // guard stands between this and two concurrent calls for the same section —
    // the observer is not involved at all here.
    gap()?.click();
    await settle();
    expect(calls()).toHaveLength(3);

    await finish(section({ text: 'Doch noch da.', next_offset: null, outline: undefined }));
    expect(text()).toContain('Doch noch da.');
  });

  it('stops watching while the tab is in the background and resumes after', async () => {
    await openDocument();
    expect(liveObservers()).toHaveLength(1);

    await setVisibility('hidden');
    expect(liveObservers()).toHaveLength(0);

    await setVisibility('visible');
    expect(liveObservers()).toHaveLength(1);
    expect(calls()).toHaveLength(1);
  });
});

describe('jumping while a section is loading', () => {
  const railed = {
    text: '# Titel\n\n## Inhalt\n\nErster Abschnitt.',
    total_length: GAZETTE_TOTAL,
    next_offset: 37,
    outline: GAZETTE_OUTLINE,
  };

  it('runs the jump the reader pressed once the call in flight settles', async () => {
    await mount();
    deliverInput?.({ dokumentnummer: 'NOR1' });
    deliver(emptyPayload());
    answersWith(section(railed));
    await connect();

    const finish = answersWhenTold();
    await scrollToEnd();

    // The click lands while the prefetch is open: dropping it would leave a
    // button that does nothing, and a stale target that scrolls the reader away
    // when an unrelated section arrives later.
    view().querySelectorAll<HTMLButtonElement>('.ris-outline-jump')[3].click();
    await settle();
    expect(calls()).toHaveLength(2);

    await finish(section({ ...railed, text: 'Nachgeladen.', next_offset: null }));

    expect(calls()).toHaveLength(3);
    expect(calls()[2]).toMatchObject({ arguments: { offset: GAZETTE_OUTLINE[3].offset } });
  });
});

// =============================================================================
// Reopening a conversation
// =============================================================================

describe('reopening a conversation', () => {
  const snapshot = {
    dokumentnummer: 'NOR12019037',
    title: 'BVwG W176 2342256-1',
    totalLength: LONG_TOTAL,
    anchorOffset: 737,
    anchorLabel: 'Spruch',
    outline: DECISION_OUTLINE,
  };

  it('restores the chrome and asks for the section the reader was on', async () => {
    hostHolding(snapshot);
    answersWith(section({ text: 'Der Spruch.', next_offset: null, outline: undefined }));

    await mount();
    deliver(emptyPayload());
    await connect();

    expect(view().querySelector('.ris-doc-title')?.textContent).toBe('BVwG W176 2342256-1');
    expect(calls()).toEqual([
      { name: 'ris_dokument_abschnitt', arguments: { dokumentnummer: 'NOR12019037', offset: 737 } },
    ]);
    expect(text()).toContain('Der Spruch.');
  });

  it('keeps the restored chrome and says the session is gone when the call fails', async () => {
    hostHolding(snapshot);
    answersWith(new Error('session gone'));

    await mount();
    deliver(emptyPayload());
    await connect();

    // The user sees which document, its structure and where they were — and is
    // told to ask for it again in the chat.
    expect(view().querySelector('.ris-doc-title')?.textContent).toBe('BVwG W176 2342256-1');
    expect(noticeTitle()).toBe(COPY.sessionExpired);
  });

  it('restarts at the opening section when the offsets shifted under the snapshot', async () => {
    // The same document measures differently depending on which branch supplied
    // its metadata header, so a stored offset can land thousands of characters
    // off. A `total_length` that does not match is how the viewer notices.
    hostHolding(snapshot);
    answersWith(section({ text: 'Verschoben.', total_length: LONG_TOTAL + 4567 }));

    await mount();
    deliver(emptyPayload());
    await connect();

    expect(calls()).toEqual([
      { name: 'ris_dokument_abschnitt', arguments: { dokumentnummer: 'NOR12019037', offset: 737 } },
      { name: 'ris_dokument_abschnitt', arguments: { dokumentnummer: 'NOR12019037', offset: 0 } },
    ]);
  });

  it('lets a host that still has the text win over the snapshot', async () => {
    hostHolding(snapshot);

    await mount();
    deliver(payload());
    await connect();

    expect(text()).toContain('§ 1295.');
    expect(bridge.callTool).not.toHaveBeenCalled();
  });

  it('lets a structured replay win over the snapshot', async () => {
    // The claude.ai reopen: the host has both a snapshot and a replay of the
    // mounting result, and that replay carries the document in its structured
    // payload rather than in content blocks.
    hostHolding(snapshot);

    await mount();
    deliver(structuredPayload());
    expect(text()).toContain('§ 1295.');

    await connect();

    // Fresh data wins whole: the stored reading position is not restored — the
    // one call opens the document that just arrived at its first section, and
    // the header names it rather than the one the snapshot remembers.
    expect(calls()).toEqual([
      { name: 'ris_dokument_abschnitt', arguments: { dokumentnummer: 'BVWGT_1', offset: 0 } },
    ]);
    expect(view().querySelector('.ris-doc-title')?.textContent).toBe('Titel');
    expect(text()).toContain('Erster Abschnitt.');
  });

  it('keeps the canonical section when a stripped replay arrives after it', async () => {
    hostHolding(snapshot);
    answersWith(section({ text: 'Der Spruch.', next_offset: null, outline: undefined }));

    await mount();
    await connect();
    deliver(emptyPayload());

    // A host replaying the mounting result without its content says nothing the
    // viewer does not already know better.
    expect(text()).toContain('Der Spruch.');
    expect(noticeTitle()).toBeUndefined();
  });

  it('ignores a snapshot that is not a document', async () => {
    hostHolding({ total_hits: 3, documents: [] });

    await mount();
    deliver(emptyPayload());
    await connect();

    expect(noticeTitle()).toBe(COPY.degradedTitle);
  });

  it('restores nothing when the handshake failed', async () => {
    hostHolding(snapshot);
    handshake = Promise.reject(new Error('kein Host'));
    handshake.catch(() => undefined);

    await mount();
    await settle();

    // A document whose buttons cannot reach a host would be worse than the
    // notice that says so.
    expect(noticeTitle()).toBe(COPY.connectFailedTitle);
    expect(view().querySelector('.ris-doc-title')).toBeNull();
  });

  it('returns to the stored position even when the host also names the document', async () => {
    // The host that stores snapshots is the same one that delivers the
    // arguments, so taking rung 2 blindly would make the reading position
    // unreachable in the only host that has one.
    hostHolding(snapshot);
    answersWith(section({ text: 'Der Spruch.', next_offset: null, outline: undefined }));

    await mount();
    deliverInput?.({ dokumentnummer: 'NOR12019037' });
    deliver(emptyPayload());
    await connect();

    expect(view().querySelector('.ris-doc-title')?.textContent).toBe('BVwG W176 2342256-1');
    expect(calls()).toEqual([
      { name: 'ris_dokument_abschnitt', arguments: { dokumentnummer: 'NOR12019037', offset: 737 } },
    ]);
  });

  it('ignores a stored position that belongs to a different document', async () => {
    hostHolding(snapshot);

    await mount();
    deliverInput?.({ dokumentnummer: 'NOR99999999' });
    deliver(emptyPayload());
    await connect();

    // Fresh data wins: the new document opens at its first section and the old
    // title never appears.
    expect(calls()).toEqual([
      { name: 'ris_dokument_abschnitt', arguments: { dokumentnummer: 'NOR99999999', offset: 0 } },
    ]);
    expect(view().querySelector('.ris-doc-title')?.textContent).toBe('Titel');
  });
});

describe('a handshake that fails after the document is on screen', () => {
  it('says so under the text and stops offering sections it cannot load', async () => {
    handshake = Promise.reject(new Error('kein Host'));
    handshake.catch(() => undefined);

    await mount();
    deliverInput?.({ dokumentnummer: 'NOR1' });
    deliver(payload());
    await settle();

    // The text stays; what goes is the promise that more of it can be fetched.
    expect(text()).toContain('§ 1295.');
    expect(noticeTitle()).toBe(COPY.connectFailedTitle);
    expect(view().querySelector('.ris-doc-sentinel')).toBeNull();
  });

  it('does not offer a RIS link it has no host to open', async () => {
    handshake = Promise.reject(new Error('kein Host'));
    handshake.catch(() => undefined);

    await mount();
    deliverInput?.({ dokumentnummer: 'NOR1' });
    deliver(payload());
    await settle();

    const link = view().querySelector<HTMLButtonElement>('.ris-doc-metadata .ris-link');
    expect(link?.disabled).toBe(true);
  });

  it('offers the links again once a handshake does complete', async () => {
    // The mounting result normally arrives *during* the handshake, so the first
    // render happens before there is a host — the links must not stay dead.
    await mount();
    deliver(payload());
    expect(view().querySelector<HTMLButtonElement>('.ris-doc-metadata .ris-link')?.disabled).toBe(
      true,
    );

    await connect();

    expect(view().querySelector<HTMLButtonElement>('.ris-doc-metadata .ris-link')?.disabled).toBe(
      false,
    );
  });
});

// =============================================================================
// Storing the reading position
// =============================================================================

describe('storing what is on screen', () => {
  it('hands the host structure and a reading position, never the text', async () => {
    const setWidgetState = vi.fn();
    hostHolding(null, { setWidgetState });

    await mount();
    deliverInput?.({ dokumentnummer: 'NOR12019037' });
    deliver(emptyPayload());
    await connect();

    expect(setWidgetState).toHaveBeenLastCalledWith({
      privateContent: {
        risViewer: {
          version: 1,
          payload: {
            dokumentnummer: 'NOR12019037',
            title: 'Titel',
            totalLength: LONG_TOTAL,
            anchorOffset: 0,
            anchorLabel: null,
            outline: DECISION_OUTLINE,
          },
        },
      },
    });
  });

  it('does not write again for a section that changes nothing it stores', async () => {
    const setWidgetState = vi.fn();
    hostHolding(null, { setWidgetState });

    await mount();
    deliverInput?.({ dokumentnummer: 'NOR12019037' });
    deliver(emptyPayload());
    await connect();
    const afterFirstRender = setWidgetState.mock.calls.length;

    answersWith(section({ text: 'Zweiter Abschnitt.', next_offset: 55, outline: undefined }));
    await scrollToEnd();

    // Appending a section changes the text on screen and nothing in the
    // snapshot, which stores structure and a reading position.
    expect(setWidgetState.mock.calls.length).toBe(afterFirstRender);
  });

  it('drops the outline rather than the whole snapshot when it does not fit', async () => {
    const setWidgetState = vi.fn();
    hostHolding(null, { setWidgetState });
    const huge = Array.from({ length: 2000 }, (_entry, index) => ({
      level: 2,
      label: `Abschnitt mit einer ziemlich langen Überschrift Nummer ${index}`,
      offset: index * 100,
      span: 100,
    }));
    answersWith(section({ outline: huge }));

    await mount();
    deliverInput?.({ dokumentnummer: 'NOR12019037' });
    deliver(emptyPayload());
    await connect();

    const stored = setWidgetState.mock.lastCall?.[0] as {
      privateContent: { risViewer: { payload: Record<string, unknown> } };
    };
    expect(stored.privateContent.risViewer.payload).not.toHaveProperty('outline');
    expect(stored.privateContent.risViewer.payload.dokumentnummer).toBe('NOR12019037');
  });
});

// =============================================================================
// Host context
// =============================================================================

describe('the height the host allows', () => {
  it('takes the container height and re-renders against it', async () => {
    await mount();
    deliver(payload());
    await connect();
    expect(view().style.height).toBe('640px');

    deliverContext?.({ containerDimensions: { height: 420, width: 800 } });

    expect(view().style.height).toBe('420px');
  });
});
