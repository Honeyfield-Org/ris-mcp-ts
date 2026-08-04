/**
 * Mount behaviour of the widget entry, with the host stubbed out.
 *
 * Covers what only the entry decides: which of the tool result, the stored
 * snapshot and the degradation notice ends up on screen, and in which order
 * they may override each other. `main.ts` runs on import, so every case starts
 * from a fresh module instance and a fresh page shell.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COURT_RESULT, LAW_RESULT } from '../__fixtures__/search-results.js';
import type { Bridge, BridgeOptions, ToolPayload } from '../shared/bridge.js';
import { COPY } from '../shared/states.js';

import type { SearchResultPayload } from './viewmodel.js';

/** Captured from the mount so a test can play the host's part. */
let deliver: BridgeOptions['onToolResult'];
let handshake: Promise<Bridge>;
/** Ends the handshake, so a test can decide what arrives before it does. */
let connect: () => Promise<void>;

const bridge: Bridge = {
  callTool: vi.fn(),
  openLink: vi.fn(async () => true),
  sendPrompt: vi.fn(async () => true),
};

vi.mock('../shared/bridge.js', () => ({
  connectBridge: vi.fn((options: BridgeOptions) => {
    deliver = options.onToolResult;
    return handshake;
  }),
}));

/** A tool result as the host hands it over. */
function payload(overrides: Partial<ToolPayload> = {}): ToolPayload {
  return {
    structuredContent: LAW_RESULT,
    source: 'toolresult',
    text: 'Gefunden: 2.570 Treffer',
    isError: false,
    ...overrides,
  };
}

/** What ChatGPT replays when a conversation is reopened: nothing usable. */
function emptyPayload(): ToolPayload {
  return payload({ structuredContent: null, source: 'missing' });
}

/** Install a host that already holds a snapshot of `result`. */
function hostHolding(result: unknown): void {
  Object.assign(globalThis, {
    openai: {
      widgetState: { privateContent: { risTrefferliste: { version: 1, payload: result } } },
      setWidgetState: vi.fn(),
    },
  });
}

async function mount(): Promise<void> {
  vi.resetModules();
  await import('./main.js');
}

/** Let the handshake's `.then` and everything it queues run. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function view(): HTMLElement {
  return document.getElementById('ris-view') as HTMLElement;
}

function titles(): string[] {
  return [...view().querySelectorAll('.ris-row-title')].map((node) => node.textContent ?? '');
}

function noticeTitle(): string | undefined {
  return document.querySelector('.ris-notice-title')?.textContent ?? undefined;
}

beforeEach(() => {
  document.body.innerHTML =
    '<p id="nojs-marker"></p><main id="ris-view"></main><div id="ris-status"></div>';

  let ready: (connected: Bridge) => void;
  handshake = new Promise<Bridge>((resolve) => {
    ready = resolve;
  });
  connect = async () => {
    ready(bridge);
    await settle();
  };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).openai;
  vi.clearAllMocks();
});

describe('mount without a stored page', () => {
  it('renders the result the host delivers', async () => {
    await mount();
    await connect();
    deliver(payload());

    expect(titles()).toHaveLength(2);
  });

  it('says so when the host delivers no data and nothing was stored', async () => {
    await mount();
    await connect();
    deliver(emptyPayload());

    expect(noticeTitle()).toBe(COPY.degradedTitle);
  });

  it('renders on a host without the state extension at all', async () => {
    await mount();
    deliver(payload());
    await connect();

    expect(titles()).toHaveLength(2);
  });

  it('says so when the host global holds something that is not a search result', async () => {
    await mount();
    await connect();
    deliver(payload({ structuredContent: { nothing: 'useful' }, source: 'host-global' }));

    // With nothing restored there is no better answer on screen to protect, so
    // the notice is the honest one — the suppression is strictly for a restore.
    expect(noticeTitle()).toBe(COPY.invalidPayloadTitle);
  });
});

describe('reopening a conversation', () => {
  it('shows the stored page when the replay arrives during the handshake', async () => {
    hostHolding(LAW_RESULT);

    await mount();
    deliver(emptyPayload());
    await connect();

    expect(titles()).toHaveLength(2);
    // The list is the right one, so there is nothing left to complain about.
    expect(noticeTitle()).toBeUndefined();
  });

  it('shows the stored page when the replay arrives after the handshake', async () => {
    hostHolding(LAW_RESULT);

    await mount();
    await connect();
    deliver(emptyPayload());

    expect(titles()).toHaveLength(2);
    expect(noticeTitle()).toBeUndefined();
  });

  it('stays quiet when the host global no longer holds this search', async () => {
    hostHolding(LAW_RESULT);

    await mount();
    await connect();
    deliver(payload({ structuredContent: { nothing: 'useful' }, source: 'host-global' }));

    // ChatGPT answers the stripped replay out of its own global, which by then
    // carries something unrelated. The restored list is the better answer.
    expect(titles()).toHaveLength(2);
    expect(noticeTitle()).toBeUndefined();
  });

  it('keeps the restore alive after dropping such a replay', async () => {
    hostHolding(LAW_RESULT);

    await mount();
    await connect();
    deliver(payload({ structuredContent: { nothing: 'useful' }, source: 'host-global' }));
    deliver(payload({ structuredContent: COURT_RESULT }));

    // Dropping a replay must stay a decision about that one payload: a real
    // result arriving afterwards still replaces the restored page.
    expect(titles()).toEqual(['2Ob535/90', 'Ra 2025/09/0038']);
  });

  it('lets a usable host global win over the stored page', async () => {
    hostHolding(LAW_RESULT);

    await mount();
    await connect();
    deliver(payload({ structuredContent: COURT_RESULT, source: 'host-global' }));

    expect(titles()).toEqual(['2Ob535/90', 'Ra 2025/09/0038']);
    expect(noticeTitle()).toBeUndefined();
  });

  it('lets fresh data win over the stored page', async () => {
    hostHolding(LAW_RESULT);

    await mount();
    await connect();
    deliver(payload({ structuredContent: COURT_RESULT }));

    expect(titles()).toEqual(['2Ob535/90', 'Ra 2025/09/0038']);
  });

  it('lets fresh data delivered during the handshake win as well', async () => {
    hostHolding(LAW_RESULT);

    await mount();
    deliver(payload({ structuredContent: COURT_RESULT }));
    await connect();

    expect(titles()).toEqual(['2Ob535/90', 'Ra 2025/09/0038']);
  });

  it('still reports a failed search over the stored page', async () => {
    hostHolding(LAW_RESULT);

    await mount();
    await connect();
    deliver(payload({ structuredContent: null, source: 'missing', isError: true }));

    expect(noticeTitle()).toBe(COPY.toolErrorTitle);
  });

  it('ignores a stored page that is not a search result', async () => {
    hostHolding({ nothing: 'useful' });

    await mount();
    deliver(emptyPayload());
    await connect();

    expect(noticeTitle()).toBe(COPY.degradedTitle);
  });

  it('restores nothing when the handshake failed', async () => {
    hostHolding(LAW_RESULT);
    handshake = Promise.reject(new Error('kein Host'));
    handshake.catch(() => undefined);

    await mount();
    await settle();

    // A list whose buttons cannot reach a host would be worse than the notice.
    expect(noticeTitle()).toBe(COPY.connectFailedTitle);
    expect(titles()).toHaveLength(0);
  });
});

describe('changing the Rechtslage', () => {
  /**
   * The Bundesrecht fixture as it comes back once a date has been picked.
   *
   * `tool` is named again rather than left to the spread: `query` is optional on
   * the payload, so spreading it alone widens the echo into one without a tool
   * name — and a nameless echo renders no control at all.
   */
  const DATED_LAW_RESULT: SearchResultPayload = {
    ...LAW_RESULT,
    query: { ...LAW_RESULT.query, tool: 'ris_bundesrecht', fassung_vom: '2020-01-01' },
  };

  /** The header's date field; only a Fassung-carrying search renders one. */
  function dateInput(): HTMLInputElement {
    const input = view().querySelector<HTMLInputElement>('.ris-fassung-input');
    if (!input) throw new Error('no date input rendered');
    return input;
  }

  /** Do what the user does: type a date (or clear it) and leave the field. */
  async function pick(value: string): Promise<void> {
    const input = dateInput();
    input.value = value;
    input.dispatchEvent(new Event('change'));
    await settle();
  }

  it('re-issues the search with the picked date and page 1', async () => {
    vi.mocked(bridge.callTool).mockResolvedValue(payload({ structuredContent: COURT_RESULT }));

    await mount();
    await connect();
    deliver(payload());
    await pick('2020-01-01');

    expect(bridge.callTool).toHaveBeenCalledWith({
      name: 'ris_bundesrecht',
      arguments: expect.objectContaining({ fassung_vom: '2020-01-01', seite: 1 }),
    });
    expect(titles()).toEqual(['2Ob535/90', 'Ra 2025/09/0038']);
  });

  it('drops the date from the search when the field is cleared', async () => {
    vi.mocked(bridge.callTool).mockResolvedValue(payload());

    await mount();
    await connect();
    deliver(payload({ structuredContent: DATED_LAW_RESULT }));
    await pick('');

    const [call] = vi.mocked(bridge.callTool).mock.calls[0];
    // Not `fassung_vom: ''`, which the server rejects as a date: clearing means
    // the current version, and the echoed date must not survive the round trip.
    expect(call.arguments).not.toHaveProperty('fassung_vom');
    expect(call.arguments.seite).toBe(1);
  });

  it('keeps the list and complains when the re-issue fails', async () => {
    vi.mocked(bridge.callTool).mockRejectedValue(new Error('weg'));

    await mount();
    await connect();
    deliver(payload());
    await pick('2020-01-01');

    expect(titles()).toHaveLength(2);
    expect(noticeTitle()).toBe(COPY.sessionExpired);
  });

  it('puts focus back on the date field afterwards', async () => {
    vi.mocked(bridge.callTool).mockResolvedValue(payload());

    await mount();
    await connect();
    deliver(payload());
    const before = dateInput();
    await pick('2020-01-01');

    // The render replaced the header, so this is a different element than the
    // one the user just used — without the restore, focus would sit on <body>.
    expect(document.activeElement).toBe(dateInput());
    expect(document.activeElement).not.toBe(before);
  });

  it('puts focus back even when the re-issue failed', async () => {
    vi.mocked(bridge.callTool).mockRejectedValue(new Error('weg'));

    await mount();
    await connect();
    deliver(payload());
    await pick('2020-01-01');

    expect(document.activeElement).toBe(dateInput());
  });
});

describe('storing the page on screen', () => {
  it('hands the rendered result to the host', async () => {
    hostHolding(null);

    await mount();
    await connect();
    deliver(payload());

    const host = (globalThis as { openai?: { setWidgetState: ReturnType<typeof vi.fn> } }).openai;
    expect(host?.setWidgetState).toHaveBeenCalledWith({
      privateContent: { risTrefferliste: { version: 1, payload: LAW_RESULT } },
    });
  });
});
