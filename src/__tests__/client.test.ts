/**
 * Tests for the RIS API client functions.
 *
 * This module tests the HTTP client for the Austrian RIS (Rechtsinformationssystem) API,
 * including error handling, request building, and response parsing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  RISAPIError,
  RISTimeoutError,
  RISParsingError,
  searchBundesrecht,
  searchLandesrecht,
  searchJudikatur,
  searchBezirke,
  searchGemeinden,
  searchHistory,
  getDocumentContent,
  constructDocumentUrl,
  getDocumentByNumber,
  getDocumentRoute,
  isValidDokumentnummer,
} from '../client.js';

// =============================================================================
// Error Classes Tests
// =============================================================================

describe('RISAPIError', () => {
  it('should have correct name property', () => {
    const error = new RISAPIError('Test error');
    expect(error.name).toBe('RISAPIError');
  });

  it('should store message', () => {
    const error = new RISAPIError('Test message');
    expect(error.message).toBe('Test message');
  });

  it('should store statusCode', () => {
    const error = new RISAPIError('Test error', 404);
    expect(error.statusCode).toBe(404);
  });

  it('should have undefined statusCode when not provided', () => {
    const error = new RISAPIError('Test error');
    expect(error.statusCode).toBeUndefined();
  });

  it('should extend Error', () => {
    const error = new RISAPIError('Test error');
    expect(error).toBeInstanceOf(Error);
  });
});

describe('RISTimeoutError', () => {
  it('should have correct name property', () => {
    const error = new RISTimeoutError();
    expect(error.name).toBe('RISTimeoutError');
  });

  it('should have default message', () => {
    const error = new RISTimeoutError();
    expect(error.message).toBe('Request to RIS API timed out');
  });

  it('should accept custom message', () => {
    const error = new RISTimeoutError('Custom timeout message');
    expect(error.message).toBe('Custom timeout message');
  });

  it('should extend RISAPIError', () => {
    const error = new RISTimeoutError();
    expect(error).toBeInstanceOf(RISAPIError);
  });

  it('should extend Error', () => {
    const error = new RISTimeoutError();
    expect(error).toBeInstanceOf(Error);
  });
});

describe('RISParsingError', () => {
  it('should have correct name property', () => {
    const error = new RISParsingError('Parse error');
    expect(error.name).toBe('RISParsingError');
  });

  it('should store message', () => {
    const error = new RISParsingError('Failed to parse');
    expect(error.message).toBe('Failed to parse');
  });

  it('should store originalError', () => {
    const originalError = new Error('Original');
    const error = new RISParsingError('Parse error', originalError);
    expect(error.originalError).toBe(originalError);
  });

  it('should have undefined originalError when not provided', () => {
    const error = new RISParsingError('Parse error');
    expect(error.originalError).toBeUndefined();
  });

  it('should extend RISAPIError', () => {
    const error = new RISParsingError('Parse error');
    expect(error).toBeInstanceOf(RISAPIError);
  });

  it('should extend Error', () => {
    const error = new RISParsingError('Parse error');
    expect(error).toBeInstanceOf(Error);
  });
});

// =============================================================================
// Search Functions Tests (with mocked fetch)
// =============================================================================

describe('searchBundesrecht', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createMockApiResponse(documents: unknown[] = [], hits = documents.length) {
    return {
      OgdSearchResult: {
        OgdDocumentResults: {
          Hits: {
            '#text': String(hits),
            '@pageNumber': '1',
            '@pageSize': '20',
          },
          OgdDocumentReference: documents,
        },
      },
    };
  }

  it('should make successful request and return normalized results', async () => {
    const mockDoc = { Data: { Metadaten: { Technisch: { ID: 'NOR40000001' } } } };
    const mockResponse = createMockApiResponse([mockDoc], 1);

    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
    });

    const result = await searchBundesrecht({ Suchworte: 'test' });

    expect(result.hits).toBe(1);
    expect(result.page_number).toBe(1);
    expect(result.page_size).toBe(20);
    expect(result.documents).toHaveLength(1);
  });

  it('should call correct URL with parameters', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(createMockApiResponse())),
    });

    await searchBundesrecht({ Suchworte: 'Mietrecht', Applikation: 'BrKons' });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://data.bka.gv.at/ris/api/v2.6/Bundesrecht'),
      expect.objectContaining({
        method: 'GET',
        headers: { Accept: 'application/json' },
      }),
    );

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('Suchworte=Mietrecht');
    expect(calledUrl).toContain('Applikation=BrKons');
  });

  it('should throw RISAPIError on HTTP error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not found'),
    });

    await expect(searchBundesrecht({ Suchworte: 'test' })).rejects.toThrow(RISAPIError);

    try {
      await searchBundesrecht({ Suchworte: 'test' });
    } catch (e) {
      expect(e).toBeInstanceOf(RISAPIError);
      expect((e as RISAPIError).statusCode).toBe(404);
    }
  });

  it('should throw RISTimeoutError on timeout', async () => {
    mockFetch.mockImplementation(() => {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      return Promise.reject(error);
    });

    await expect(searchBundesrecht({ Suchworte: 'test' }, 100)).rejects.toThrow(RISTimeoutError);
  });

  it('should throw RISAPIError on network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    await expect(searchBundesrecht({ Suchworte: 'test' })).rejects.toThrow(RISAPIError);
  });

  it('should throw RISParsingError on invalid JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('not valid json'),
    });

    await expect(searchBundesrecht({ Suchworte: 'test' })).rejects.toThrow(RISParsingError);
  });

  it('should filter null and undefined params', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(createMockApiResponse())),
    });

    await searchBundesrecht({
      Suchworte: 'test',
      NullParam: null,
      UndefinedParam: undefined,
      ValidParam: 'value',
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('Suchworte=test');
    expect(calledUrl).toContain('ValidParam=value');
    expect(calledUrl).not.toContain('NullParam');
    expect(calledUrl).not.toContain('UndefinedParam');
  });

  it('should handle single document response (not array)', async () => {
    const mockDoc = { Data: { Metadaten: { Technisch: { ID: 'NOR40000001' } } } };
    const mockResponse = {
      OgdSearchResult: {
        OgdDocumentResults: {
          Hits: 1,
          OgdDocumentReference: mockDoc, // Single object, not array
        },
      },
    };

    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
    });

    const result = await searchBundesrecht({ Suchworte: 'test' });

    expect(result.documents).toHaveLength(1);
  });

  it('should handle empty results', async () => {
    const mockResponse = {
      OgdSearchResult: {
        OgdDocumentResults: {
          Hits: 0,
        },
      },
    };

    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
    });

    const result = await searchBundesrecht({ Suchworte: 'nonexistent' });

    expect(result.hits).toBe(0);
    expect(result.documents).toHaveLength(0);
  });

  it('should handle Hits as plain number', async () => {
    const mockResponse = {
      OgdSearchResult: {
        OgdDocumentResults: {
          Hits: 42,
          OgdDocumentReference: [],
        },
      },
    };

    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
    });

    const result = await searchBundesrecht({ Suchworte: 'test' });

    expect(result.hits).toBe(42);
    // Default pagination when Hits is not an object
    expect(result.page_number).toBe(1);
    expect(result.page_size).toBe(10);
  });

  it('should use default values for missing pagination info', async () => {
    const mockResponse = {
      OgdSearchResult: {
        OgdDocumentResults: {},
      },
    };

    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
    });

    const result = await searchBundesrecht({ Suchworte: 'test' });

    expect(result.hits).toBe(0);
    expect(result.page_number).toBe(1);
    expect(result.page_size).toBe(10);
    expect(result.documents).toHaveLength(0);
  });
});

describe('searchLandesrecht', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should call Landesrecht endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            OgdSearchResult: { OgdDocumentResults: { Hits: 0 } },
          }),
        ),
    });

    await searchLandesrecht({ Suchworte: 'test' });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('Landesrecht'),
      expect.any(Object),
    );
  });

  it('should pass timeout parameter', async () => {
    mockFetch.mockImplementation(() => {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      return Promise.reject(error);
    });

    // Should timeout with custom timeout
    await expect(searchLandesrecht({ Suchworte: 'test' }, 50)).rejects.toThrow(RISTimeoutError);
  });
});

describe('searchJudikatur', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should call Judikatur endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            OgdSearchResult: { OgdDocumentResults: { Hits: 0 } },
          }),
        ),
    });

    await searchJudikatur({ Suchworte: 'test' });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('Judikatur'),
      expect.any(Object),
    );
  });

  it('should return normalized results', async () => {
    const mockDoc = { Data: { Metadaten: { Technisch: { ID: 'JJT_2024000001' } } } };
    mockFetch.mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            OgdSearchResult: {
              OgdDocumentResults: {
                Hits: {
                  '#text': '5',
                  '@pageNumber': '2',
                  '@pageSize': '10',
                },
                OgdDocumentReference: [mockDoc],
              },
            },
          }),
        ),
    });

    const result = await searchJudikatur({ Suchworte: 'test' });

    expect(result.hits).toBe(5);
    expect(result.page_number).toBe(2);
    expect(result.page_size).toBe(10);
    expect(result.documents).toHaveLength(1);
  });
});

describe('searchBezirke', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should call Bezirke endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            OgdSearchResult: { OgdDocumentResults: { Hits: 0 } },
          }),
        ),
    });

    await searchBezirke({ Suchworte: 'test' });

    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('Bezirke'), expect.any(Object));
  });

  it('should return normalized results', async () => {
    const mockDoc = { Data: { Metadaten: { Technisch: { ID: 'BVB_2024000001' } } } };
    mockFetch.mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            OgdSearchResult: {
              OgdDocumentResults: {
                Hits: {
                  '#text': '3',
                  '@pageNumber': '1',
                  '@pageSize': '20',
                },
                OgdDocumentReference: [mockDoc],
              },
            },
          }),
        ),
    });

    const result = await searchBezirke({ Suchworte: 'Baubewilligung' });

    expect(result.hits).toBe(3);
    expect(result.page_number).toBe(1);
    expect(result.page_size).toBe(20);
    expect(result.documents).toHaveLength(1);
  });
});

describe('searchGemeinden', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should call Gemeinden endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            OgdSearchResult: { OgdDocumentResults: { Hits: 0 } },
          }),
        ),
    });

    await searchGemeinden({ Suchworte: 'test' });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('Gemeinden'),
      expect.any(Object),
    );
  });

  it('should return normalized results', async () => {
    const mockDoc = { Data: { Metadaten: { Technisch: { ID: 'GR_2024000001' } } } };
    mockFetch.mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            OgdSearchResult: {
              OgdDocumentResults: {
                Hits: {
                  '#text': '7',
                  '@pageNumber': '1',
                  '@pageSize': '20',
                },
                OgdDocumentReference: [mockDoc],
              },
            },
          }),
        ),
    });

    const result = await searchGemeinden({ Gemeinde: 'Graz' });

    expect(result.hits).toBe(7);
    expect(result.page_number).toBe(1);
    expect(result.page_size).toBe(20);
    expect(result.documents).toHaveLength(1);
  });
});

describe('searchHistory', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should call History endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            OgdSearchResult: { OgdDocumentResults: { Hits: 0 } },
          }),
        ),
    });

    await searchHistory({ Anwendung: 'BrKons' });

    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('History'), expect.any(Object));
  });

  it('should return normalized results', async () => {
    const mockDoc = { Data: { Metadaten: { Technisch: { ID: 'NOR40000001' } } } };
    mockFetch.mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            OgdSearchResult: {
              OgdDocumentResults: {
                Hits: {
                  '#text': '25',
                  '@pageNumber': '1',
                  '@pageSize': '20',
                },
                OgdDocumentReference: [mockDoc],
              },
            },
          }),
        ),
    });

    const result = await searchHistory({ Anwendung: 'BrKons', AenderungenVon: '2024-01-01' });

    expect(result.hits).toBe(25);
    expect(result.page_number).toBe(1);
    expect(result.page_size).toBe(20);
    expect(result.documents).toHaveLength(1);
  });
});

// =============================================================================
// Transient Retry Tests (N2)
// =============================================================================

describe('request retry on transient errors', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  const okResponse = {
    ok: true,
    text: () =>
      Promise.resolve(JSON.stringify({ OgdSearchResult: { OgdDocumentResults: { Hits: 0 } } })),
  };

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should retry once on HTTP 503 and then succeed', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503, text: () => Promise.resolve('unavailable') })
      .mockResolvedValueOnce(okResponse);

    const result = await searchBundesrecht({ Suchworte: 'test' });

    expect(result.hits).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should retry once on timeout and then succeed', async () => {
    mockFetch
      .mockImplementationOnce(() => {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      })
      .mockResolvedValueOnce(okResponse);

    const result = await searchBundesrecht({ Suchworte: 'test' }, 100);

    expect(result.hits).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should NOT retry on HTTP 404 (non-transient)', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, text: () => Promise.resolve('nope') });

    await expect(searchBundesrecht({ Suchworte: 'test' })).rejects.toThrow(RISAPIError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should retry only once and then propagate a persistent 503', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, text: () => Promise.resolve('down') });

    await expect(searchBundesrecht({ Suchworte: 'test' })).rejects.toThrow(RISAPIError);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should NOT retry on parsing error', async () => {
    mockFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('not json') });

    await expect(searchBundesrecht({ Suchworte: 'test' })).rejects.toThrow(RISParsingError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// getDocumentContent Tests
// =============================================================================

describe('getDocumentContent', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should fetch HTML content successfully', async () => {
    const htmlContent = '<html><body>Test content</body></html>';
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(htmlContent),
    });

    const result = await getDocumentContent('https://example.com/doc.html');

    expect(result).toBe(htmlContent);
  });

  it('should call correct URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('content'),
    });

    await getDocumentContent('https://ris.bka.gv.at/Dokument.wxe?Dokumentnummer=NOR40000001');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://ris.bka.gv.at/Dokument.wxe?Dokumentnummer=NOR40000001',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('should throw RISAPIError on HTTP error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    await expect(getDocumentContent('https://example.com/doc.html')).rejects.toThrow(RISAPIError);

    try {
      await getDocumentContent('https://example.com/doc.html');
    } catch (e) {
      expect(e).toBeInstanceOf(RISAPIError);
      expect((e as RISAPIError).statusCode).toBe(500);
    }
  });

  it('should throw RISTimeoutError on timeout', async () => {
    mockFetch.mockImplementation(() => {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      return Promise.reject(error);
    });

    await expect(getDocumentContent('https://example.com/doc.html', 100)).rejects.toThrow(
      RISTimeoutError,
    );
  });

  it('should throw RISAPIError on network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));

    await expect(getDocumentContent('https://example.com/doc.html')).rejects.toThrow(RISAPIError);
  });

  it('should re-throw RISAPIError without wrapping', async () => {
    const originalError = new RISAPIError('Original error', 403);
    mockFetch.mockRejectedValue(originalError);

    try {
      await getDocumentContent('https://example.com/doc.html');
    } catch (e) {
      expect(e).toBe(originalError);
      expect((e as RISAPIError).statusCode).toBe(403);
    }
  });

  it('should handle non-Error thrown values', async () => {
    mockFetch.mockRejectedValue('string error');

    await expect(getDocumentContent('https://example.com/doc.html')).rejects.toThrow(RISAPIError);
  });

  it('should use default timeout of 30 seconds', async () => {
    // We can't directly test the timeout value, but we can verify it doesn't throw immediately
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('content'),
    });

    const result = await getDocumentContent('https://example.com/doc.html');
    expect(result).toBe('content');
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

// =============================================================================
// isValidDokumentnummer Tests (Security)
// =============================================================================

describe('isValidDokumentnummer', () => {
  describe('valid dokumentnummern', () => {
    it('should accept valid Bundesrecht document number', () => {
      expect(isValidDokumentnummer('NOR40052761')).toBe(true);
    });

    it('should accept valid BVwG document number with underscores', () => {
      expect(isValidDokumentnummer('BVWG_W123_2000000_1_00')).toBe(true);
    });

    it('should accept valid Landesrecht document number', () => {
      expect(isValidDokumentnummer('LWI12345678')).toBe(true);
    });

    it('should accept valid Judikatur document number', () => {
      expect(isValidDokumentnummer('JFR_2024000001')).toBe(true);
    });

    it('should accept minimum length (5 characters)', () => {
      expect(isValidDokumentnummer('NOR12')).toBe(true);
    });

    it('should accept maximum length (50 characters)', () => {
      const longValid = 'N' + 'O'.repeat(49);
      expect(isValidDokumentnummer(longValid)).toBe(true);
    });
  });

  describe('invalid dokumentnummern - injection attempts', () => {
    it('should reject path traversal attempt', () => {
      expect(isValidDokumentnummer('NOR../../../etc/passwd')).toBe(false);
    });

    it('should reject query injection attempt', () => {
      expect(isValidDokumentnummer('NOR12345?evil=true')).toBe(false);
    });

    it('should reject fragment injection attempt', () => {
      expect(isValidDokumentnummer('NOR12345#inject')).toBe(false);
    });

    it('should reject URL-encoded characters', () => {
      expect(isValidDokumentnummer('NOR12345%2F..')).toBe(false);
    });

    it('should reject backslash path traversal', () => {
      expect(isValidDokumentnummer('NOR..\\..\\etc')).toBe(false);
    });

    it('should reject spaces', () => {
      expect(isValidDokumentnummer('NOR 12345')).toBe(false);
    });

    it('should reject special characters', () => {
      expect(isValidDokumentnummer('NOR12345<script>')).toBe(false);
    });
  });

  describe('invalid dokumentnummern - format violations', () => {
    it('should reject lowercase letters', () => {
      expect(isValidDokumentnummer('nor40052761')).toBe(false);
    });

    it('should reject mixed case', () => {
      expect(isValidDokumentnummer('Nor40052761')).toBe(false);
    });

    it('should reject starting with number', () => {
      expect(isValidDokumentnummer('1NOR40052761')).toBe(false);
    });

    it('should reject starting with underscore', () => {
      expect(isValidDokumentnummer('_NOR40052761')).toBe(false);
    });

    it('should reject too short (less than 5 characters)', () => {
      expect(isValidDokumentnummer('NOR1')).toBe(false);
    });

    it('should reject too long (more than 50 characters)', () => {
      const tooLong = 'N' + 'O'.repeat(50);
      expect(isValidDokumentnummer(tooLong)).toBe(false);
    });

    it('should reject empty string', () => {
      expect(isValidDokumentnummer('')).toBe(false);
    });

    it('should reject hyphens', () => {
      expect(isValidDokumentnummer('NOR-12345')).toBe(false);
    });

    it('should reject dots', () => {
      expect(isValidDokumentnummer('NOR.12345')).toBe(false);
    });
  });
});

// =============================================================================
// constructDocumentUrl Tests
// =============================================================================

describe('constructDocumentUrl', () => {
  it('should construct URL for Bundesrecht (NOR prefix)', () => {
    const url = constructDocumentUrl('NOR12019037');
    expect(url).toBe('https://ris.bka.gv.at/Dokumente/Bundesnormen/NOR12019037/NOR12019037.html');
  });

  it('should construct URL for Landesrecht Burgenland (LBG prefix)', () => {
    const url = constructDocumentUrl('LBG12345678');
    expect(url).toBe('https://ris.bka.gv.at/Dokumente/LrBgld/LBG12345678/LBG12345678.html');
  });

  it('should construct URL for Landesrecht Kaernten (LKT prefix)', () => {
    const url = constructDocumentUrl('LKT12345678');
    expect(url).toBe('https://ris.bka.gv.at/Dokumente/LrK/LKT12345678/LKT12345678.html');
  });

  it('should construct URL for Landesrecht Niederoesterreich (LNO prefix)', () => {
    const url = constructDocumentUrl('LNO12345678');
    expect(url).toBe('https://ris.bka.gv.at/Dokumente/LrNO/LNO12345678/LNO12345678.html');
  });

  it('should construct URL for Landesrecht Oberoesterreich (LOO prefix)', () => {
    const url = constructDocumentUrl('LOO12345678');
    expect(url).toBe('https://ris.bka.gv.at/Dokumente/LrOO/LOO12345678/LOO12345678.html');
  });

  it('should construct URL for Landesrecht Salzburg (LSB prefix)', () => {
    const url = constructDocumentUrl('LSB12345678');
    expect(url).toBe('https://ris.bka.gv.at/Dokumente/LrSbg/LSB12345678/LSB12345678.html');
  });

  it('should construct URL for Landesrecht Steiermark (LST prefix)', () => {
    const url = constructDocumentUrl('LST12345678');
    expect(url).toBe('https://ris.bka.gv.at/Dokumente/LrStmk/LST12345678/LST12345678.html');
  });

  it('should construct URL for Landesrecht Tirol (LTI prefix)', () => {
    const url = constructDocumentUrl('LTI12345678');
    expect(url).toBe('https://ris.bka.gv.at/Dokumente/LrT/LTI12345678/LTI12345678.html');
  });

  it('should construct URL for Landesrecht Vorarlberg (LVB prefix)', () => {
    const url = constructDocumentUrl('LVB12345678');
    expect(url).toBe('https://ris.bka.gv.at/Dokumente/LrVbg/LVB12345678/LVB12345678.html');
  });

  it('should construct URL for Landesrecht Wien (LWI prefix)', () => {
    const url = constructDocumentUrl('LWI12345678');
    expect(url).toBe('https://ris.bka.gv.at/Dokumente/LrW/LWI12345678/LWI12345678.html');
  });

  it('should construct URL for VwGH Judikatur (JWR prefix)', () => {
    const url = constructDocumentUrl('JWR12345678');
    expect(url).toBe('https://ris.bka.gv.at/Dokumente/Vwgh/JWR12345678/JWR12345678.html');
  });

  it('should construct URL for VfGH Judikatur (JFR prefix)', () => {
    const url = constructDocumentUrl('JFR12345678');
    expect(url).toBe('https://ris.bka.gv.at/Dokumente/Vfgh/JFR12345678/JFR12345678.html');
  });

  it('should construct URL for VwGH Volltext (JWT prefix)', () => {
    // JWT = Verwaltungsgerichtshof Entscheidungstext (verified live: /Vwgh/ 200, /Justiz/ 404).
    const url = constructDocumentUrl('JWT12345678');
    expect(url).toBe('https://ris.bka.gv.at/Dokumente/Vwgh/JWT12345678/JWT12345678.html');
  });

  it('should construct URL for Justiz Rechtssatz (JJR prefix)', () => {
    const url = constructDocumentUrl('JJR12345678');
    expect(url).toBe('https://ris.bka.gv.at/Dokumente/Justiz/JJR12345678/JJR12345678.html');
  });

  it('should construct URL for Justiz Volltext (JJT prefix)', () => {
    const url = constructDocumentUrl('JJT12345678');
    expect(url).toBe('https://ris.bka.gv.at/Dokumente/Justiz/JJT12345678/JJT12345678.html');
  });

  it('should construct URL for historical Verg (VERG prefix)', () => {
    const url = constructDocumentUrl('VERGT12345678');
    expect(url).toBe('https://ris.bka.gv.at/Dokumente/Verg/VERGT12345678/VERGT12345678.html');
  });

  it('should construct URL for historical Uvs (JUT prefix)', () => {
    const url = constructDocumentUrl('JUT12345678');
    expect(url).toBe('https://ris.bka.gv.at/Dokumente/Uvs/JUT12345678/JUT12345678.html');
  });

  it('should construct URL for historical Ubas (UBAS prefix)', () => {
    const url = constructDocumentUrl('UBAST12345678');
    expect(url).toBe('https://ris.bka.gv.at/Dokumente/Ubas/UBAST12345678/UBAST12345678.html');
  });

  it('should construct URL for historical Umse (UMSE prefix)', () => {
    const url = constructDocumentUrl('UMSET12345678');
    expect(url).toBe('https://ris.bka.gv.at/Dokumente/Umse/UMSET12345678/UMSET12345678.html');
  });

  it('should construct URL for historical Bks (BKS prefix)', () => {
    const url = constructDocumentUrl('BKST12345678');
    expect(url).toBe('https://ris.bka.gv.at/Dokumente/Bks/BKST12345678/BKST12345678.html');
  });

  it('should construct URL for Bezirke (BVB prefix)', () => {
    const url = constructDocumentUrl('BVB12345678');
    expect(url).toBe('https://ris.bka.gv.at/Dokumente/Bvb/BVB12345678/BVB12345678.html');
  });

  it('should construct URL for Verordnungsblätter (VBL prefix)', () => {
    const url = constructDocumentUrl('VBL12345678');
    expect(url).toBe('https://ris.bka.gv.at/Dokumente/Vbl/VBL12345678/VBL12345678.html');
  });

  it('should construct URL for BVwG (BVWG prefix)', () => {
    const url = constructDocumentUrl('BVWG12345678');
    expect(url).toBe('https://ris.bka.gv.at/Dokumente/Bvwg/BVWG12345678/BVWG12345678.html');
  });

  it('should construct URL for LVwG (LVWG prefix)', () => {
    const url = constructDocumentUrl('LVWG12345678');
    expect(url).toBe('https://ris.bka.gv.at/Dokumente/Lvwg/LVWG12345678/LVWG12345678.html');
  });

  it('should construct URL for DSB (DSB prefix)', () => {
    const url = constructDocumentUrl('DSB12345678');
    expect(url).toBe('https://ris.bka.gv.at/Dokumente/Dsk/DSB12345678/DSB12345678.html');
  });

  it('should return null for unknown prefix', () => {
    const url = constructDocumentUrl('UNKNOWN12345');
    expect(url).toBeNull();
  });

  it('should return null for empty string', () => {
    const url = constructDocumentUrl('');
    expect(url).toBeNull();
  });

  it('should return null for invalid dokumentnummer with path traversal', () => {
    const url = constructDocumentUrl('NOR../../../etc/passwd');
    expect(url).toBeNull();
  });

  it('should return null for invalid dokumentnummer with query injection', () => {
    const url = constructDocumentUrl('NOR12345?evil=true');
    expect(url).toBeNull();
  });

  it('should return null for lowercase dokumentnummer', () => {
    const url = constructDocumentUrl('nor12019037');
    expect(url).toBeNull();
  });

  it('should handle longer prefixes correctly (BVWG vs BVW)', () => {
    // Ensure BVWG is not matched by a hypothetical shorter prefix
    const url = constructDocumentUrl('BVWG_W123_2000000_1_00');
    expect(url).toBe(
      'https://ris.bka.gv.at/Dokumente/Bvwg/BVWG_W123_2000000_1_00/BVWG_W123_2000000_1_00.html',
    );
  });
});

// =============================================================================
// getDocumentRoute Tests (single routing registry for URL + fallback search)
// =============================================================================

describe('getDocumentRoute', () => {
  it('should route NOR to Bundesrecht/BrKons', () => {
    expect(getDocumentRoute('NOR40052761')).toEqual({
      urlFolder: 'Bundesnormen',
      endpoint: 'Bundesrecht',
      applikation: 'BrKons',
    });
  });

  it('should route Vorarlberg LVB to Landesrecht/LrKons', () => {
    expect(getDocumentRoute('LVB40006754')).toEqual({
      urlFolder: 'LrVbg',
      endpoint: 'Landesrecht',
      applikation: 'LrKons',
    });
  });

  it('should route JWT (VwGH Volltext) to Judikatur/Vwgh, not Justiz', () => {
    const route = getDocumentRoute('JWT_2026190142_20260610L00');
    expect(route?.endpoint).toBe('Judikatur');
    expect(route?.applikation).toBe('Vwgh');
    expect(route?.urlFolder).toBe('Vwgh');
  });

  it('should route JJT (Justiz Volltext) to Judikatur/Justiz', () => {
    expect(getDocumentRoute('JJT_20261205_OLG0459')?.applikation).toBe('Justiz');
  });

  it('should route historical courts to their Judikatur applikation', () => {
    expect(getDocumentRoute('VERGT_20131230_961040_13_00')?.applikation).toBe('Verg');
    expect(getDocumentRoute('JUT_VO_20010425_03202_00_00')?.applikation).toBe('Uvs');
    expect(getDocumentRoute('JUR_VO_20010425_03202_00_00')?.applikation).toBe('Uvs');
    expect(getDocumentRoute('UBAST_20071126_227_475')?.applikation).toBe('Ubas');
    expect(getDocumentRoute('UMSET_20131218_US_8B')?.applikation).toBe('Umse');
    expect(getDocumentRoute('BKST_20131211_611001')?.applikation).toBe('Bks');
  });

  it('should route Sonstige and Bezirke prefixes to their endpoints', () => {
    expect(getDocumentRoute('MRP12345678')?.endpoint).toBe('Sonstige');
    expect(getDocumentRoute('BVB12345678')?.endpoint).toBe('Bezirke');
  });

  it('should not confuse BVWG with BVB (longest prefix wins)', () => {
    expect(getDocumentRoute('BVWG_W123_2000000_1_00')?.applikation).toBe('Bvwg');
    expect(getDocumentRoute('BVB12345678')?.applikation).toBe('Bvb');
  });

  it('should return null for unknown prefix', () => {
    expect(getDocumentRoute('XYZ12345678')).toBeNull();
  });
});

// =============================================================================
// getDocumentByNumber Tests
// =============================================================================

describe('getDocumentByNumber', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should return success with HTML content for valid document', async () => {
    const htmlContent = '<html><body>Legal document content</body></html>';
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(htmlContent),
    });

    const result = await getDocumentByNumber('NOR12019037');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.html).toBe(htmlContent);
      expect(result.url).toBe(
        'https://ris.bka.gv.at/Dokumente/Bundesnormen/NOR12019037/NOR12019037.html',
      );
    }
  });

  it('should call correct URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html></html>'),
    });

    await getDocumentByNumber('NOR12019037');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://ris.bka.gv.at/Dokumente/Bundesnormen/NOR12019037/NOR12019037.html',
      expect.any(Object),
    );
  });

  it('should return error for unknown prefix', async () => {
    const result = await getDocumentByNumber('UNKNOWN12345');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Unbekanntes Dokumentnummer-Prefix');
    }

    // Should not have called fetch
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should return error for path traversal attempt', async () => {
    const result = await getDocumentByNumber('NOR../../../etc/passwd');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Ungueltige Dokumentnummer');
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should return error for query injection attempt', async () => {
    const result = await getDocumentByNumber('NOR12345?evil=true');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Ungueltige Dokumentnummer');
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should return error for fragment injection attempt', async () => {
    const result = await getDocumentByNumber('NOR12345#inject');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Ungueltige Dokumentnummer');
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should return error for lowercase dokumentnummer', async () => {
    const result = await getDocumentByNumber('nor12019037');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Ungueltige Dokumentnummer');
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should return error on HTTP 404', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not found'),
    });

    const result = await getDocumentByNumber('NOR99999999');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(404);
    }
  });

  it('should return error on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await getDocumentByNumber('NOR12019037');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Network error');
    }
  });

  it('should handle timeout', async () => {
    mockFetch.mockImplementation(() => {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      return Promise.reject(error);
    });

    const result = await getDocumentByNumber('NOR12019037', 100);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('timed out');
    }
  });

  it('should work with Landesrecht documents', async () => {
    const htmlContent = '<html><body>Landesrecht content</body></html>';
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(htmlContent),
    });

    const result = await getDocumentByNumber('LWI12345678');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.url).toContain('LrW');
    }
  });

  it('should work with Judikatur documents', async () => {
    const htmlContent = '<html><body>Court decision</body></html>';
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(htmlContent),
    });

    const result = await getDocumentByNumber('JFR12345678');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.url).toContain('Vfgh');
    }
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('Integration scenarios', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should handle full search workflow with pagination', async () => {
    const page1Response = {
      OgdSearchResult: {
        OgdDocumentResults: {
          Hits: {
            '#text': '50',
            '@pageNumber': '1',
            '@pageSize': '20',
          },
          OgdDocumentReference: Array(20)
            .fill(null)
            .map((_, i) => ({
              Data: { Metadaten: { Technisch: { ID: `NOR4000000${i}` } } },
            })),
        },
      },
    };

    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(page1Response)),
    });

    const result = await searchBundesrecht({
      Suchworte: 'test',
      Seitennummer: 1,
      DokumenteProSeite: 'Twenty',
    });

    expect(result.hits).toBe(50);
    expect(result.page_number).toBe(1);
    expect(result.page_size).toBe(20);
    expect(result.documents).toHaveLength(20);
  });

  it('should handle missing OgdSearchResult gracefully', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({})),
    });

    const result = await searchBundesrecht({ Suchworte: 'test' });

    expect(result.hits).toBe(0);
    expect(result.documents).toHaveLength(0);
  });

  it('should convert boolean and number params to strings', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            OgdSearchResult: { OgdDocumentResults: { Hits: 0 } },
          }),
        ),
    });

    await searchBundesrecht({
      Suchworte: 'test',
      Seitennummer: 5,
      ImRisSeit: true,
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('Seitennummer=5');
    expect(calledUrl).toContain('ImRisSeit=true');
  });
});
