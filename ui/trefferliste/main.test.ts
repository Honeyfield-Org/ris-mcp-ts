/**
 * Mount behaviour of the widget entry, with the host stubbed out.
 *
 * Covers what only the entry decides: which of the tool result, the stored
 * snapshot and the degradation notice ends up on screen, and in which order
 * they may override each other. `main.ts` runs on import, so every case starts
 * from a fresh module instance and a fresh page shell.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COURT_RESULT, LAW_RESULT, VWGH_DOCUMENT } from '../__fixtures__/search-results.js';
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

  /** Ask for the next page, the other way into the shared query path. */
  function nextPage(): void {
    const button = view().querySelector<HTMLButtonElement>('.ris-page-next');
    if (!button) throw new Error('no next-page button rendered');
    button.click();
  }

  /** Type a date (or clear it) and leave the field, on a given element. */
  async function change(input: HTMLInputElement, value: string): Promise<void> {
    input.value = value;
    input.dispatchEvent(new Event('change'));
    await settle();
  }

  /** Do what the user does on the field currently on screen. */
  async function pick(value: string): Promise<void> {
    await change(dateInput(), value);
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

  it('drops the change while a page request is still in flight', async () => {
    let release: (result: ToolPayload) => void = () => undefined;
    const inFlight = new Promise<ToolPayload>((resolve) => {
      release = resolve;
    });
    vi.mocked(bridge.callTool).mockReturnValue(inFlight);

    await mount();
    await connect();
    deliver(payload());

    // Captured before the click, because the skeleton replaces the header for
    // the duration of the call — a change can still arrive from the detached
    // field, which is how a native date picker left open delivers one.
    const input = dateInput();
    nextPage();
    await settle();
    await change(input, '2020-01-01');

    expect(bridge.callTool).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.callTool).mock.calls[0][0].arguments).toMatchObject({ seite: 2 });

    // Let the page land so the module is not left waiting on a dead promise.
    release(payload());
    await settle();
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

describe('changing a facet', () => {
  /**
   * The Judikatur fixture with both Justiz-bound filters set.
   *
   * `tool` is named again for the reason the Rechtslage fixture above names it:
   * spreading the optional echo alone widens it into one without a tool name,
   * and a nameless echo renders no facet row to click at all.
   */
  const FILTERED_COURT_RESULT: SearchResultPayload = {
    ...COURT_RESULT,
    query: {
      ...COURT_RESULT.query,
      tool: 'ris_judikatur',
      rechtsgebiet: 'Zivilrecht',
      gericht: 'OGH',
    },
  };

  /** What the narrowed search comes back with: fewer rows than were on screen. */
  const NARROWED_COURT_RESULT: SearchResultPayload = {
    ...COURT_RESULT,
    documents: [VWGH_DOCUMENT],
    query: { ...COURT_RESULT.query, tool: 'ris_judikatur', gerichtsbarkeit: 'Vwgh' },
  };

  /** The same search with a further page to fetch, so paging is available. */
  const PAGED_COURT_RESULT: SearchResultPayload = {
    ...COURT_RESULT,
    has_more: true,
    query: { ...COURT_RESULT.query, tool: 'ris_judikatur' },
  };

  /** One facet select of the row currently on screen. */
  function facetSelect(facet: string): HTMLSelectElement {
    const select = view().querySelector<HTMLSelectElement>(`.ris-facet-${facet} .ris-facet-select`);
    if (!select) throw new Error(`no select for the facet "${facet}"`);
    return select;
  }

  /** Ask for the next page, the other way into the shared query path. */
  function nextPage(): void {
    const button = view().querySelector<HTMLButtonElement>('.ris-page-next');
    if (!button) throw new Error('no next-page button rendered');
    button.click();
  }

  /** Pick an option the way a user does, on a given element. */
  async function choose(select: HTMLSelectElement, value: string): Promise<void> {
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await settle();
  }

  /** Do what the user does on the row currently on screen. */
  async function pick(facet: string, value: string): Promise<void> {
    await choose(facetSelect(facet), value);
  }

  /** Take the court filter off, the one facet that is a button, not a select. */
  async function removeGericht(): Promise<void> {
    const button = view().querySelector<HTMLButtonElement>('.ris-facet-remove');
    if (!button) throw new Error('no court chip rendered');
    button.click();
    await settle();
  }

  it('re-issues the search for a picked jurisdiction, on page 1', async () => {
    vi.mocked(bridge.callTool).mockResolvedValue(
      payload({ structuredContent: NARROWED_COURT_RESULT }),
    );

    await mount();
    await connect();
    deliver(payload({ structuredContent: FILTERED_COURT_RESULT }));
    await pick('gerichtsbarkeit', 'Vwgh');

    const [call] = vi.mocked(bridge.callTool).mock.calls[0];
    expect(call.name).toBe('ris_judikatur');
    expect(call.arguments).toMatchObject({ gerichtsbarkeit: 'Vwgh', seite: 1 });
    // The narrowed page is on screen, not merely requested.
    expect(titles()).toEqual(['Ra 2025/09/0038']);
  });

  it('drops the Justiz-only filters when the jurisdiction leaves Justiz', async () => {
    vi.mocked(bridge.callTool).mockResolvedValue(
      payload({ structuredContent: NARROWED_COURT_RESULT }),
    );

    await mount();
    await connect();
    deliver(payload({ structuredContent: FILTERED_COURT_RESULT }));
    await pick('gerichtsbarkeit', 'Vwgh');

    const [call] = vi.mocked(bridge.callTool).mock.calls[0];
    // RIS ignores both outside Justiz, and an argument that rides the echo
    // forever would keep narrowing a search nobody can see it narrowing.
    expect(call.arguments).not.toHaveProperty('gericht');
    expect(call.arguments).not.toHaveProperty('rechtsgebiet');
  });

  it('re-issues the search with a picked document kind', async () => {
    vi.mocked(bridge.callTool).mockResolvedValue(payload({ structuredContent: COURT_RESULT }));

    await mount();
    await connect();
    deliver(payload({ structuredContent: COURT_RESULT }));
    await pick('dokumenttyp', 'entscheidungstext');

    expect(bridge.callTool).toHaveBeenCalledWith({
      name: 'ris_judikatur',
      arguments: expect.objectContaining({ dokumenttyp: 'entscheidungstext', seite: 1 }),
    });
  });

  it('re-issues the search with a picked legal area', async () => {
    vi.mocked(bridge.callTool).mockResolvedValue(payload({ structuredContent: COURT_RESULT }));

    await mount();
    await connect();
    deliver(payload({ structuredContent: COURT_RESULT }));
    await pick('rechtsgebiet', 'Strafrecht');

    expect(bridge.callTool).toHaveBeenCalledWith({
      name: 'ris_judikatur',
      arguments: expect.objectContaining({ rechtsgebiet: 'Strafrecht', seite: 1 }),
    });
  });

  it('re-issues the search without the court filter when the chip is removed', async () => {
    vi.mocked(bridge.callTool).mockResolvedValue(payload({ structuredContent: COURT_RESULT }));

    await mount();
    await connect();
    deliver(payload({ structuredContent: FILTERED_COURT_RESULT }));
    await removeGericht();

    const [call] = vi.mocked(bridge.callTool).mock.calls[0];
    expect(call.arguments).not.toHaveProperty('gericht');
    // Only that one filter goes: the jurisdiction never changed, so the legal
    // area the user picked earlier is still honoured.
    expect(call.arguments).toMatchObject({ rechtsgebiet: 'Zivilrecht', seite: 1 });
  });

  it('keeps the list and complains when the re-issue fails', async () => {
    vi.mocked(bridge.callTool).mockRejectedValue(new Error('weg'));

    await mount();
    await connect();
    deliver(payload({ structuredContent: COURT_RESULT }));
    await pick('gerichtsbarkeit', 'Vwgh');

    expect(titles()).toHaveLength(2);
    expect(noticeTitle()).toBe(COPY.sessionExpired);
  });

  it('drops the change while a page request is still in flight', async () => {
    let release: (result: ToolPayload) => void = () => undefined;
    const inFlight = new Promise<ToolPayload>((resolve) => {
      release = resolve;
    });
    vi.mocked(bridge.callTool).mockReturnValue(inFlight);

    await mount();
    await connect();
    deliver(payload({ structuredContent: PAGED_COURT_RESULT }));

    // Captured before the click, because the skeleton replaces the facet row
    // for the duration of the call — a change can still arrive from the
    // detached select, which is how an open native dropdown delivers one.
    const select = facetSelect('gerichtsbarkeit');
    nextPage();
    await settle();
    await choose(select, 'Vwgh');

    expect(bridge.callTool).toHaveBeenCalledTimes(1);
    // Page 3 of the running request, not page 1 of the dropped facet change.
    expect(vi.mocked(bridge.callTool).mock.calls[0][0].arguments).toMatchObject({ seite: 3 });

    // Let the page land so the module is not left waiting on a dead promise.
    release(payload({ structuredContent: PAGED_COURT_RESULT }));
    await settle();
  });

  it('puts focus back on the changed select afterwards', async () => {
    vi.mocked(bridge.callTool).mockResolvedValue(payload({ structuredContent: COURT_RESULT }));

    await mount();
    await connect();
    deliver(payload({ structuredContent: COURT_RESULT }));
    const before = facetSelect('gerichtsbarkeit');
    await pick('gerichtsbarkeit', 'Vwgh');

    // The render replaced the whole row, so this is a different element than
    // the one the user just used — without the restore, focus sits on <body>.
    expect(document.activeElement).toBe(facetSelect('gerichtsbarkeit'));
    expect(document.activeElement).not.toBe(before);
  });

  it('puts focus back even when the re-issue failed', async () => {
    vi.mocked(bridge.callTool).mockRejectedValue(new Error('weg'));

    await mount();
    await connect();
    deliver(payload({ structuredContent: COURT_RESULT }));
    await pick('dokumenttyp', 'entscheidungstext');

    expect(document.activeElement).toBe(facetSelect('dokumenttyp'));
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
