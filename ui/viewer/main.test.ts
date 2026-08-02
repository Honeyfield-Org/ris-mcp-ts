/**
 * Mount behaviour of the widget entry, with the host stubbed out.
 *
 * Covers what only the entry decides: which rung of the first-render ladder
 * ends up on screen, what it costs in tool calls, and what survives a failure.
 * `main.ts` runs on import, so every case starts from a fresh module instance
 * and a fresh page shell.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DECISION_OUTLINE, LONG_TOTAL, NORM_MARKDOWN } from '../__fixtures__/document-chunks.js';
import type { Bridge, BridgeOptions, ToolPayload } from '../shared/bridge.js';

import { COPY } from './copy.js';
import type { DocumentChunk } from './viewmodel.js';

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

/** Scroll the sentinel into view, the way reading to the end of the text does. */
async function scrollToEnd(): Promise<void> {
  const live = observers.filter((observer) => observer.active);
  const observer = live[live.length - 1];
  if (!observer) throw new Error('nothing is watching for the end of the text');

  observer.callback(
    observer.targets.map(
      (target) => ({ isIntersecting: true, target }) as unknown as IntersectionObserverEntry,
    ),
    observer as unknown as IntersectionObserver,
  );
  await settle();
}

// =============================================================================
// Payloads
// =============================================================================

/** A tool result as the host hands it over: text, never structured content. */
function payload(overrides: Partial<ToolPayload> = {}): ToolPayload {
  return {
    structuredContent: null,
    source: 'missing',
    text: NORM_MARKDOWN,
    isError: false,
    ...overrides,
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

function calls(): unknown[] {
  return (bridge.callTool as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
}

function answersWith(payload: ToolPayload | Error): void {
  const mock = bridge.callTool as ReturnType<typeof vi.fn>;
  if (payload instanceof Error) mock.mockRejectedValue(payload);
  else mock.mockResolvedValue(payload);
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

  it('replaces the mount text with the canonical section once the reader scrolls', async () => {
    // The mounting response is a truncated prefix with no length and no
    // outline, so the first section the viewer fetches supersedes it whole.
    await mount();
    deliverInput?.({ dokumentnummer: 'NOR12019037' });
    deliver(payload());
    await connect();

    expect(sentinelOffset()).toBe('0');
    await scrollToEnd();

    expect(text()).toContain('Erster Abschnitt.');
    expect(text()).not.toContain('§ 1295.');
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

    answersWith({
      structuredContent: { nichts: 'brauchbar' },
      source: 'toolresult',
      text: '',
      isError: false,
    });
    await scrollToEnd();

    expect(text()).toContain('Erster Abschnitt.');
    expect(noticeTitle()).toBe(COPY.invalidPayloadTitle);
    expect(document.querySelector('.ris-notice-detail')?.textContent).toBe(COPY.sectionUnchanged);
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
