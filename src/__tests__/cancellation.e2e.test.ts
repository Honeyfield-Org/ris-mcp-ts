/**
 * E2E tests for request cancellation over the MCP protocol.
 *
 * An MCP client that abandons a call sends `notifications/cancelled`; the SDK
 * aborts the handler's `extra.signal`. These tests drive that path end to end
 * over a real transport and assert the abort reaches the outbound RIS fetch —
 * without it the upstream request runs on to completion or its 30s timeout.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

import { server } from '../server.js';

let client: Client;

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  client = new Client({ name: 'test-client', version: '1.0.0' });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  await client.listTools();
});

afterAll(async () => {
  await client.close();
  await server.close();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// =============================================================================
// Test Helpers
// =============================================================================

/** The `init` object the client hands to `fetch`. */
interface FetchInit {
  signal?: AbortSignal;
}

type MockFetch = ReturnType<typeof vi.fn>;

/** A fetch that only settles once its signal aborts, as the real one does. */
function stubHangingFetch(): MockFetch {
  const mockFetch: MockFetch = vi.fn(
    (_url: string, init?: FetchInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason);
        });
      }),
  );
  vi.stubGlobal('fetch', mockFetch);
  return mockFetch;
}

/** The signal the client passed to `fetch` on the given attempt. */
function fetchSignal(mockFetch: MockFetch, callIndex = 0): AbortSignal {
  const init = mockFetch.mock.calls[callIndex][1] as FetchInit;
  return init.signal as AbortSignal;
}

/** Minimal arguments that get each tool past its parameter validation. */
const TOOL_CALLS: [name: string, args: Record<string, unknown>][] = [
  ['ris_bundesrecht', { suchworte: 'Eigentum' }],
  ['ris_landesrecht', { suchworte: 'Bauordnung' }],
  ['ris_judikatur', { suchworte: 'Schadenersatz' }],
  ['ris_bundesgesetzblatt', { suchworte: 'Novelle' }],
  ['ris_landesgesetzblatt', { suchworte: 'Novelle' }],
  ['ris_regierungsvorlagen', { suchworte: 'Regierungsvorlage' }],
  ['ris_dokument', { dokumentnummer: 'NOR40052761' }],
  ['ris_bezirke', { suchworte: 'Bescheid' }],
  ['ris_gemeinden', { suchworte: 'Verordnung' }],
  ['ris_sonstige', { applikation: 'Mrp', suchworte: 'Ministerrat' }],
  ['ris_history', { applikation: 'Bundesnormen', aenderungen_von: '2024-01-01' }],
  ['ris_verordnungen', { suchworte: 'Wolf' }],
];

// =============================================================================
// Cancellation Reaches the Upstream Request
// =============================================================================

describe('cancellation of a tool call', () => {
  it.each(TOOL_CALLS)('should abort the upstream RIS request for %s', async (name, args) => {
    const mockFetch = stubHangingFetch();
    const controller = new AbortController();

    const call = client.callTool({ name, arguments: args }, undefined, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const upstream = fetchSignal(mockFetch);
    expect(upstream.aborted).toBe(false);

    controller.abort();
    await expect(call).rejects.toThrow();
    await vi.waitFor(() => expect(upstream.aborted).toBe(true));
  });

  it('should leave the upstream request untouched when the call is not cancelled', async () => {
    const mockFetch = stubHangingFetch();
    const controller = new AbortController();

    const call = client.callTool(
      { name: 'ris_bundesrecht', arguments: { suchworte: 'x' } },
      undefined,
      {
        signal: controller.signal,
        timeout: 200,
      },
    );
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

    expect(fetchSignal(mockFetch).aborted).toBe(false);
    await expect(call).rejects.toThrow();
  });
});

// =============================================================================
// ris_dokument: No Fallback Search After Cancellation
// =============================================================================

describe('cancellation of ris_dokument', () => {
  it('should not start the fallback search after the direct fetch is cancelled', async () => {
    // Uncancelled, a failed direct fetch falls back to the search API — two
    // sequential round-trips. A cancelled call must stop after the first.
    const mockFetch = stubHangingFetch();
    const controller = new AbortController();

    const call = client.callTool(
      { name: 'ris_dokument', arguments: { dokumentnummer: 'NOR40052761' } },
      undefined,
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    controller.abort();
    await expect(call).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should still fall back to the search API when the call is not cancelled', async () => {
    const mockFetch: MockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404, text: () => Promise.resolve('not found') })
      .mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ OgdSearchResult: {} })),
      });
    vi.stubGlobal('fetch', mockFetch);

    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR40052761' },
    });

    expect(result.isError).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
