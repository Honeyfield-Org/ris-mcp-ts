/**
 * E2E security tests for the RIS MCP Server.
 *
 * Tests the three security fixes through the MCP client-server protocol:
 * 1. SSRF protection: URL allowlist on ris_dokument
 * 2. String max-length: Zod .max() on free-text parameters
 * 3. Enum restrictions: z.enum() on applikation/gericht parameters
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

import { server } from '../server.js';

// =============================================================================
// Setup: MCP Client connected to server via InMemoryTransport
// =============================================================================

let client: Client;
let clientTransport: InMemoryTransport;
let serverTransport: InMemoryTransport;

beforeAll(async () => {
  [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  client = new Client({ name: 'test-client', version: '1.0.0' });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await server.close();
});

/** Helper to extract text from MCP tool response */
function getResponseText(result: Awaited<ReturnType<typeof client.callTool>>): string {
  const content = result.content as { type: string; text: string }[];
  return content[0]?.text ?? '';
}

// =============================================================================
// 1. SSRF Protection Tests
// =============================================================================

describe('SSRF protection on ris_dokument', () => {
  it('should reject HTTP URLs (non-HTTPS)', async () => {
    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { url: 'http://ris.bka.gv.at/Dokumente/test.html' },
    });

    const text = getResponseText(result);
    expect(text).toContain('nicht erlaubt');
    expect(text).toContain('HTTPS');
  });

  it('should reject AWS metadata URL (classic SSRF)', async () => {
    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { url: 'http://169.254.169.254/latest/meta-data/' },
    });

    const text = getResponseText(result);
    expect(text).toContain('nicht erlaubt');
  });

  it('should reject localhost URLs', async () => {
    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { url: 'http://localhost:8080/admin' },
    });

    const text = getResponseText(result);
    expect(text).toContain('nicht erlaubt');
  });

  it('should reject URLs to arbitrary external domains', async () => {
    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { url: 'https://evil.com/steal-data' },
    });

    const text = getResponseText(result);
    expect(text).toContain('nicht erlaubt');
  });

  it('should reject file:// protocol URLs', async () => {
    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { url: 'file:///etc/passwd' },
    });

    const text = getResponseText(result);
    expect(text).toContain('nicht erlaubt');
  });

  it('should reject domain spoofing attempts', async () => {
    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { url: 'https://evil.com/ris.bka.gv.at' },
    });

    const text = getResponseText(result);
    expect(text).toContain('nicht erlaubt');
  });

  it('should reject HTTPS URLs to non-RIS domains', async () => {
    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { url: 'https://google.com' },
    });

    const text = getResponseText(result);
    expect(text).toContain('nicht erlaubt');
  });

  it('should still require either dokumentnummer or url', async () => {
    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: {},
    });

    const text = getResponseText(result);
    expect(text).toContain('dokumentnummer');
    expect(text).toContain('url');
  });
});

// =============================================================================
// 1b. SSRF Protection on Search-Derived Content URL (N6)
// =============================================================================

describe('SSRF protection on search-derived content URL', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Route by URL: fail the direct-URL construction so the tool falls back to
    // the search API, then have the search API return a document whose HTML
    // content URL points to an off-domain (attacker-controlled) host.
    mockFetch = vi.fn((input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/Dokumente/')) {
        return Promise.resolve({
          ok: false,
          status: 404,
          text: () => Promise.resolve('not found'),
        });
      }

      if (url.includes('/Bundesrecht')) {
        const body = {
          OgdSearchResult: {
            OgdDocumentResults: {
              Hits: { '#text': '1', '@pageNumber': '1', '@pageSize': '10' },
              OgdDocumentReference: {
                Data: {
                  Metadaten: { Technisch: { ID: 'NOR40052761', Applikation: 'BrKons' } },
                  Dokumentliste: {
                    ContentReference: {
                      ContentType: 'MainDocument',
                      Urls: {
                        ContentUrl: [
                          { DataType: 'Html', Url: 'https://evil.example.com/steal.html' },
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
        };
        return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(body)) });
      }

      // Any other fetch (e.g. the evil URL) would return this sentinel.
      return Promise.resolve({ ok: true, text: () => Promise.resolve('SHOULD_NOT_BE_FETCHED') });
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should reject an off-domain content URL returned by the search API', async () => {
    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR40052761' },
    });

    const text = getResponseText(result);
    expect(text).toContain('nicht erlaubt');
  });

  it('should never fetch the off-domain content URL', async () => {
    await client.callTool({
      name: 'ris_dokument',
      arguments: { dokumentnummer: 'NOR40052761' },
    });

    const fetchedHosts = mockFetch.mock.calls.map(([u]) => new URL(String(u)).hostname);
    expect(fetchedHosts).not.toContain('evil.example.com');
  });
});

// =============================================================================
// 2. String Max-Length Tests
// =============================================================================

describe('String max-length validation', () => {
  const longString = 'x'.repeat(1001);

  it('should reject suchworte exceeding 1000 chars on ris_bundesrecht', async () => {
    const result = await client.callTool({
      name: 'ris_bundesrecht',
      arguments: { suchworte: longString },
    });

    expect(result.isError).toBe(true);
  });

  it('should reject titel exceeding 500 chars on ris_landesrecht', async () => {
    const result = await client.callTool({
      name: 'ris_landesrecht',
      arguments: { titel: 'x'.repeat(501) },
    });

    expect(result.isError).toBe(true);
  });

  it('should reject geschaeftszahl exceeding 200 chars on ris_judikatur', async () => {
    const result = await client.callTool({
      name: 'ris_judikatur',
      arguments: { geschaeftszahl: 'x'.repeat(201) },
    });

    expect(result.isError).toBe(true);
  });

  it('should reject paragraph exceeding 100 chars on ris_bundesrecht', async () => {
    const result = await client.callTool({
      name: 'ris_bundesrecht',
      arguments: { paragraph: 'x'.repeat(101) },
    });

    expect(result.isError).toBe(true);
  });

  it('should reject bgblnummer exceeding 100 chars on ris_bundesgesetzblatt', async () => {
    const result = await client.callTool({
      name: 'ris_bundesgesetzblatt',
      arguments: { bgblnummer: 'x'.repeat(101) },
    });

    expect(result.isError).toBe(true);
  });

  it('should reject suchworte exceeding 1000 chars on ris_sonstige', async () => {
    const result = await client.callTool({
      name: 'ris_sonstige',
      arguments: { applikation: 'Mrp', suchworte: longString },
    });

    expect(result.isError).toBe(true);
  });

  it('should reject suchworte exceeding 1000 chars on ris_verordnungen', async () => {
    const result = await client.callTool({
      name: 'ris_verordnungen',
      arguments: { suchworte: longString },
    });

    expect(result.isError).toBe(true);
  });

  it('should accept suchworte within 1000 char limit', async () => {
    const result = await client.callTool({
      name: 'ris_bundesrecht',
      arguments: { suchworte: 'x'.repeat(1000) },
    });

    // Should not be a validation error (may still fail due to API, but not Zod)
    expect(result.isError).not.toBe(true);
  });
});

// =============================================================================
// 3. Enum Restriction Tests
// =============================================================================

describe('Enum restrictions on applikation and gericht', () => {
  it('should reject invalid applikation on ris_bundesrecht', async () => {
    const result = await client.callTool({
      name: 'ris_bundesrecht',
      arguments: { suchworte: 'test', applikation: 'InvalidApp' },
    });

    expect(result.isError).toBe(true);
  });

  it('should accept valid applikation on ris_bundesrecht', async () => {
    const result = await client.callTool({
      name: 'ris_bundesrecht',
      arguments: { suchworte: 'test', applikation: 'BrKons' },
    });

    // Should not be a schema validation error
    expect(result.isError).not.toBe(true);
  }, 15000);

  it('should reject invalid applikation on ris_landesrecht', async () => {
    const result = await client.callTool({
      name: 'ris_landesrecht',
      arguments: { suchworte: 'test', applikation: 'SomeInvalidValue' },
    });

    expect(result.isError).toBe(true);
  });

  it('should accept LrKons on ris_landesrecht', async () => {
    const result = await client.callTool({
      name: 'ris_landesrecht',
      arguments: { suchworte: 'test', applikation: 'LrKons' },
    });

    expect(result.isError).not.toBe(true);
  });

  it('should reject invalid gerichtsbarkeit on ris_judikatur', async () => {
    // The court-system enum is now the `gerichtsbarkeit` parameter (was `gericht`).
    const result = await client.callTool({
      name: 'ris_judikatur',
      arguments: { suchworte: 'test', gerichtsbarkeit: 'FakeCourt' },
    });

    expect(result.isError).toBe(true);
  });

  it('should accept valid gericht on ris_judikatur', async () => {
    const result = await client.callTool({
      name: 'ris_judikatur',
      arguments: { suchworte: 'test', gericht: 'Justiz' },
    });

    expect(result.isError).not.toBe(true);
  }, 15000);

  it('should reject arbitrary string as applikation probe attempt', async () => {
    const result = await client.callTool({
      name: 'ris_bundesrecht',
      arguments: { suchworte: 'test', applikation: '../../../etc/passwd' },
    });

    expect(result.isError).toBe(true);
  });
});

// =============================================================================
// 4. Combined Validation Tests
// =============================================================================

describe('Combined validation edge cases', () => {
  it('should reject both invalid enum AND oversized string simultaneously', async () => {
    const result = await client.callTool({
      name: 'ris_bundesrecht',
      arguments: {
        suchworte: 'x'.repeat(1001),
        applikation: 'InvalidApp',
      },
    });

    expect(result.isError).toBe(true);
  });

  it('should validate URL before attempting document fetch', async () => {
    const result = await client.callTool({
      name: 'ris_dokument',
      arguments: {
        url: 'https://evil.com/steal',
        dokumentnummer: 'NOR40052761',
      },
    });

    // When both are provided, URL is used but should be validated
    const text = getResponseText(result);
    expect(text).toContain('nicht erlaubt');
  });
});
