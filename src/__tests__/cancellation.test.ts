/**
 * Tests for propagating MCP request cancellation to the upstream RIS API.
 *
 * Every outbound fetch already carries its own 30s timeout signal. A cancelled
 * MCP request adds a second reason to stop, so the two are combined and the
 * fetch aborts on whichever fires first. The distinction matters for the result:
 * a timeout is an upstream failure the user should read about (RISTimeoutError,
 * German prose), a caller cancellation is not an error at all and must surface
 * as a plain abort.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  RISTimeoutError,
  getDocumentByNumber,
  getDocumentContent,
  searchBundesrecht,
} from '../client.js';
import { executeSearchTool } from '../helpers.js';
import type { NormalizedSearchResults } from '../types.js';

// =============================================================================
// Test Helpers
// =============================================================================

/** The `init` object our client hands to `fetch`. */
interface FetchInit {
  signal?: AbortSignal;
}

type MockFetch = ReturnType<typeof vi.fn>;

/**
 * A fetch that never settles on its own and rejects the way the real one does
 * once its signal aborts — with the signal's reason.
 */
function hangingFetch(): MockFetch {
  return vi.fn(
    (_url: string, init?: FetchInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason);
        });
      }),
  );
}

/** The signal our client passed to `fetch` on the given attempt. */
function fetchSignal(mockFetch: MockFetch, callIndex = 0): AbortSignal {
  const init = mockFetch.mock.calls[callIndex][1] as FetchInit;
  return init.signal as AbortSignal;
}

/** Await a rejection and hand back the thrown value for inspection. */
function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    (value) => {
      throw new Error(`Expected a rejection, got: ${JSON.stringify(value)}`);
    },
    (error: unknown) => error,
  );
}

const emptyResultBody = JSON.stringify({ OgdSearchResult: { OgdDocumentResults: { Hits: 0 } } });

const okResponse = { ok: true, text: () => Promise.resolve(emptyResultBody) };

let mockFetch: MockFetch;

beforeEach(() => {
  mockFetch = hangingFetch();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// =============================================================================
// Search Requests: Signal Plumbing
// =============================================================================

describe('search request cancellation', () => {
  it('should abort the outbound fetch when the caller signal aborts', async () => {
    const controller = new AbortController();
    const pending = rejection(
      searchBundesrecht({ Suchworte: 'test' }, undefined, controller.signal),
    );
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const outbound = fetchSignal(mockFetch);
    expect(outbound.aborted).toBe(false);

    controller.abort();
    await pending;

    expect(outbound.aborted).toBe(true);
  });

  it('should reject with an abort — not a timeout error — when the caller cancels', async () => {
    const controller = new AbortController();
    const pending = rejection(
      searchBundesrecht({ Suchworte: 'test' }, undefined, controller.signal),
    );
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

    controller.abort();
    const error = await pending;

    expect(error).not.toBeInstanceOf(RISTimeoutError);
    expect((error as Error).name).toBe('AbortError');
  });

  it('should still map the 30s timeout onto RISTimeoutError when the caller has not cancelled', async () => {
    const controller = new AbortController();

    const error = await rejection(searchBundesrecht({ Suchworte: 'test' }, 20, controller.signal));

    expect(error).toBeInstanceOf(RISTimeoutError);
    expect(controller.signal.aborted).toBe(false);
  });

  it('should still send the timeout signal when no caller signal is given', async () => {
    const pending = rejection(searchBundesrecht({ Suchworte: 'test' }, 20));
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

    expect(fetchSignal(mockFetch)).toBeInstanceOf(AbortSignal);
    await pending;
  });
});

// =============================================================================
// Search Requests: Retry Interaction
// =============================================================================

describe('retry after cancellation', () => {
  it('should not retry a transient failure when the caller cancels during the backoff', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('unavailable'),
    });
    const controller = new AbortController();

    const pending = rejection(
      searchBundesrecht({ Suchworte: 'test' }, undefined, controller.signal),
    );
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    controller.abort();
    const error = await pending;

    expect((error as Error).name).toBe('AbortError');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should still retry a transient failure when the caller has not cancelled', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503, text: () => Promise.resolve('unavailable') })
      .mockResolvedValueOnce(okResponse);
    const controller = new AbortController();

    const result = await searchBundesrecht({ Suchworte: 'test' }, undefined, controller.signal);

    expect(result.hits).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// =============================================================================
// Document Fetches
// =============================================================================

const DOCUMENT_URL = 'https://ris.bka.gv.at/Dokumente/Bundesnormen/NOR40052761/NOR40052761.html';

describe('getDocumentContent cancellation', () => {
  it('should abort the outbound fetch when the caller signal aborts', async () => {
    const controller = new AbortController();
    const pending = rejection(getDocumentContent(DOCUMENT_URL, undefined, controller.signal));
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

    controller.abort();
    const error = await pending;

    expect(fetchSignal(mockFetch).aborted).toBe(true);
    expect(error).not.toBeInstanceOf(RISTimeoutError);
    expect((error as Error).name).toBe('AbortError');
  });

  it('should still map the 30s timeout onto RISTimeoutError', async () => {
    const error = await rejection(getDocumentContent(DOCUMENT_URL, 20));

    expect(error).toBeInstanceOf(RISTimeoutError);
  });
});

describe('getDocumentByNumber cancellation', () => {
  it('should reject instead of reporting a failed direct fetch when the caller cancels', async () => {
    // A `{ success: false }` result here would send ris_dokument into its
    // fallback search — a second upstream round-trip for a request nobody is
    // waiting for anymore.
    const controller = new AbortController();
    const pending = rejection(getDocumentByNumber('NOR40052761', undefined, controller.signal));
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

    controller.abort();
    const error = await pending;

    expect((error as Error).name).toBe('AbortError');
  });

  it('should still report an ordinary fetch failure as an unsuccessful result', async () => {
    mockFetch.mockRejectedValue(new Error('socket hang up'));
    const controller = new AbortController();

    const result = await getDocumentByNumber('NOR40052761', undefined, controller.signal);

    expect(result.success).toBe(false);
  });
});

// =============================================================================
// executeSearchTool
// =============================================================================

function emptyResults(): NormalizedSearchResults {
  return { hits: 0, page_number: 1, page_size: 20, documents: [] };
}

/** Stand-in for the echo a real handler builds via buildQueryEcho(). */
const QUERY_ECHO = { tool: 'ris_bundesrecht', suchworte: 'test' };

describe('executeSearchTool cancellation', () => {
  it('should pass the caller signal through to the search function', async () => {
    const searchFn = vi.fn().mockResolvedValue(emptyResults());
    const controller = new AbortController();

    await executeSearchTool(
      searchFn,
      { Suchworte: 'test' },
      'markdown',
      controller.signal,
      QUERY_ECHO,
    );

    expect(searchFn).toHaveBeenCalledWith({ Suchworte: 'test' }, undefined, controller.signal);
  });

  it('should propagate the abort instead of formatting a German error response', async () => {
    const controller = new AbortController();
    controller.abort();
    const searchFn = vi.fn().mockRejectedValue(controller.signal.reason);

    const error = await rejection(
      executeSearchTool(searchFn, {}, 'markdown', controller.signal, QUERY_ECHO),
    );

    expect((error as Error).name).toBe('AbortError');
  });

  it('should still return a German error response for a genuine upstream failure', async () => {
    const controller = new AbortController();
    const searchFn = vi.fn().mockRejectedValue(new RISTimeoutError());

    const response = await executeSearchTool(
      searchFn,
      {},
      'markdown',
      controller.signal,
      QUERY_ECHO,
    );

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('**Fehler:**');
  });
});
