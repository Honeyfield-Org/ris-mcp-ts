/**
 * Tests for the HTTP transport layer (src/http.ts).
 *
 * RED phase: These tests define the expected behavior of the Express-based
 * MCP HTTP server. They should FAIL until http.ts is implemented.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  app,
  mcpLimiter,
  sessions,
  VERSION,
  SESSION_IDLE_TIMEOUT_MS,
  MAX_SESSIONS,
  sweepIdleSessions,
  registerSession,
} from '../http.js';
import { registerAllTools } from '../tools/index.js';

// ---------------------------------------------------------------------------
// Mocks — vi.mock calls are hoisted by vitest above all imports
// ---------------------------------------------------------------------------

const mockHandleRequest = vi.fn();
const mockTransportClose = vi.fn();
let capturedOnClose: (() => void) | undefined;

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn().mockImplementation(function () {
    return { connect: vi.fn().mockResolvedValue(undefined) };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: vi.fn().mockImplementation(function () {
    const transport = {
      handleRequest: mockHandleRequest,
      close: mockTransportClose,
      sessionId: 'test-session-id',
      onclose: undefined as (() => void) | undefined,
    };
    // Capture the onclose callback when it gets assigned
    Object.defineProperty(transport, 'onclose', {
      get() {
        return capturedOnClose;
      },
      set(fn: (() => void) | undefined) {
        capturedOnClose = fn;
      },
      enumerable: true,
      configurable: true,
    });
    return transport;
  }),
}));

vi.mock('../tools/index.js', () => ({
  registerAllTools: vi.fn(),
}));

// =============================================================================
// Test Suite
// =============================================================================

describe('HTTP transport (http.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessions.clear();
    capturedOnClose = undefined;
    mcpLimiter.resetKey('::ffff:127.0.0.1');
    mcpLimiter.resetKey('unknown');
  });

  // ---------------------------------------------------------------------------
  // GET /health
  // ---------------------------------------------------------------------------

  describe('GET /health', () => {
    it('should return 200 with correct shape', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 'ok',
        service: 'ris-mcp',
        activeSessions: 0,
      });
    });

    it('should return activeSessions count matching sessions map size', async () => {
      // Manually add fake sessions to the map
      sessions.set('session-1', {} as never);
      sessions.set('session-2', {} as never);

      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.activeSessions).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /mcp — new session
  // ---------------------------------------------------------------------------

  describe('POST /mcp (new session)', () => {
    it('should create a new McpServer and transport', async () => {
      mockHandleRequest.mockImplementation(
        (_req: unknown, res: { writeHead: (code: number) => void; end: () => void }) => {
          res.writeHead(200);
          res.end();
        },
      );

      await request(app).post('/mcp').send({ jsonrpc: '2.0', method: 'initialize', id: 1 });

      expect(McpServer).toHaveBeenCalled();
      expect(StreamableHTTPServerTransport).toHaveBeenCalled();
    });

    it('should call registerAllTools with the new server', async () => {
      mockHandleRequest.mockImplementation(
        (_req: unknown, res: { writeHead: (code: number) => void; end: () => void }) => {
          res.writeHead(200);
          res.end();
        },
      );

      await request(app).post('/mcp').send({ jsonrpc: '2.0', method: 'initialize', id: 1 });

      expect(registerAllTools).toHaveBeenCalled();
    });

    it('should store the session in the sessions map', async () => {
      mockHandleRequest.mockImplementation(
        (_req: unknown, res: { writeHead: (code: number) => void; end: () => void }) => {
          res.writeHead(200);
          res.end();
        },
      );

      await request(app).post('/mcp').send({ jsonrpc: '2.0', method: 'initialize', id: 1 });

      expect(sessions.size).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /mcp — existing session
  // ---------------------------------------------------------------------------

  describe('POST /mcp (existing session)', () => {
    it('should reuse transport for valid mcp-session-id header', async () => {
      const mockTransport = {
        handleRequest: mockHandleRequest,
        sessionId: 'existing-session',
      };
      sessions.set('existing-session', {
        transport: mockTransport,
        lastActivity: Date.now(),
      } as never);

      mockHandleRequest.mockImplementation(
        (_req: unknown, res: { writeHead: (code: number) => void; end: () => void }) => {
          res.writeHead(200);
          res.end();
        },
      );

      await request(app)
        .post('/mcp')
        .set('mcp-session-id', 'existing-session')
        .send({ jsonrpc: '2.0', method: 'ping', id: 2 });

      // Should reuse existing transport, not create a new one
      expect(mockHandleRequest).toHaveBeenCalled();
      // Should NOT create a new McpServer since session already exists
      expect(McpServer).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // GET /mcp — without valid session
  // ---------------------------------------------------------------------------

  describe('GET /mcp (no valid session)', () => {
    it('should return 400 with German error message', async () => {
      const res = await request(app).get('/mcp');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'Keine gültige Session. Starte mit POST /mcp.',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /mcp — without valid session
  // ---------------------------------------------------------------------------

  describe('DELETE /mcp (no valid session)', () => {
    it('should return 400 with German error message', async () => {
      const res = await request(app).delete('/mcp');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'Keine gültige Session. Starte mit POST /mcp.',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Rate Limiting
  // ---------------------------------------------------------------------------

  describe('Rate limiting', () => {
    it('should return 429 on /mcp after exceeding MCP rate limit', async () => {
      mockHandleRequest.mockImplementation(
        (_req: unknown, res: { writeHead: (code: number) => void; end: () => void }) => {
          res.writeHead(200);
          res.end();
        },
      );

      // Fire requests exceeding the MCP limit (60/min)
      const results = [];
      for (let i = 0; i < 65; i++) {
        results.push(
          request(app).post('/mcp').send({ jsonrpc: '2.0', method: 'initialize', id: i }),
        );
      }
      const responses = await Promise.all(results);

      const rateLimited = responses.some((res) => res.status === 429);
      expect(rateLimited).toBe(true);
    });

    it('should not rate-limit /health at the MCP rate', async () => {
      // Health endpoint should tolerate many rapid requests
      const results = [];
      for (let i = 0; i < 10; i++) {
        results.push(request(app).get('/health'));
      }
      const responses = await Promise.all(results);

      const allOk = responses.every((res) => res.status === 200);
      expect(allOk).toBe(true);
    });

    it('should include standard rate limit headers in /mcp responses', async () => {
      mockHandleRequest.mockImplementation(
        (_req: unknown, res: { writeHead: (code: number) => void; end: () => void }) => {
          res.writeHead(200);
          res.end();
        },
      );

      const res = await request(app)
        .post('/mcp')
        .send({ jsonrpc: '2.0', method: 'initialize', id: 1 });

      // Standard draft-7 combined header: "limit=N, remaining=N, reset=N"
      expect(res.headers).toHaveProperty('ratelimit');
      expect(res.headers).toHaveProperty('ratelimit-policy');
      expect(res.headers['ratelimit']).toMatch(/limit=\d+, remaining=\d+, reset=\d+/);
    });

    it('should return JSON error body on 429', async () => {
      mockHandleRequest.mockImplementation(
        (_req: unknown, res: { writeHead: (code: number) => void; end: () => void }) => {
          res.writeHead(200);
          res.end();
        },
      );

      // Exhaust the limit (60/min)
      const results = [];
      for (let i = 0; i < 65; i++) {
        results.push(
          request(app).post('/mcp').send({ jsonrpc: '2.0', method: 'initialize', id: i }),
        );
      }
      const responses = await Promise.all(results);

      const limited = responses.find((res) => res.status === 429);
      expect(limited).toBeDefined();
      expect(limited?.body).toHaveProperty('error');
    });
  });

  // ---------------------------------------------------------------------------
  // Session cleanup via transport.onclose
  // ---------------------------------------------------------------------------

  describe('Session cleanup', () => {
    it('should remove session from map when transport.onclose fires', async () => {
      mockHandleRequest.mockImplementation(
        (_req: unknown, res: { writeHead: (code: number) => void; end: () => void }) => {
          res.writeHead(200);
          res.end();
        },
      );

      // Create a session via POST /mcp
      await request(app).post('/mcp').send({ jsonrpc: '2.0', method: 'initialize', id: 1 });

      expect(sessions.size).toBe(1);

      // Simulate transport closing
      expect(capturedOnClose).toBeDefined();
      if (capturedOnClose) capturedOnClose();

      expect(sessions.size).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Version (M4 — no more hardcoded drift)
  // ---------------------------------------------------------------------------

  describe('Server version', () => {
    it('exposes the package.json version, not the stale 1.0.0', () => {
      expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
      expect(VERSION).not.toBe('1.0.0');
    });

    it('creates each per-session McpServer with the package version', async () => {
      mockHandleRequest.mockImplementation(
        (_req: unknown, res: { writeHead: (code: number) => void; end: () => void }) => {
          res.writeHead(200);
          res.end();
        },
      );

      await request(app).post('/mcp').send({ jsonrpc: '2.0', method: 'initialize', id: 1 });

      expect(McpServer).toHaveBeenCalledWith({ name: 'ris-mcp', version: VERSION });
    });
  });

  // ---------------------------------------------------------------------------
  // Proxy / body-size hardening (M3, N7)
  // ---------------------------------------------------------------------------

  describe('Express hardening', () => {
    it('trusts exactly one proxy hop (M3)', () => {
      expect(app.get('trust proxy')).toBe(1);
    });

    it('rejects request bodies larger than the JSON limit with 413 (N7)', async () => {
      const oversized = { blob: 'a'.repeat(2 * 1024 * 1024) };

      const res = await request(app).post('/mcp').send(oversized);

      expect(res.status).toBe(413);
    });
  });

  // ---------------------------------------------------------------------------
  // Session TTL / eviction (H1 — memory-leak fix)
  // ---------------------------------------------------------------------------

  describe('Session TTL sweep', () => {
    const makeEntry = (
      lastActivity: number,
    ): { transport: { close: () => void }; lastActivity: number } => ({
      transport: { close: vi.fn() },
      lastActivity,
    });

    it('evicts sessions idle beyond the timeout and keeps fresh ones', () => {
      const now = 5_000_000;
      const stale = makeEntry(now - SESSION_IDLE_TIMEOUT_MS - 1);
      const fresh = makeEntry(now);
      sessions.set('stale', stale as never);
      sessions.set('fresh', fresh as never);

      const evicted = sweepIdleSessions(now);

      expect(evicted).toBe(1);
      expect(sessions.has('stale')).toBe(false);
      expect(sessions.has('fresh')).toBe(true);
      expect(stale.transport.close).toHaveBeenCalledTimes(1);
      expect(fresh.transport.close).not.toHaveBeenCalled();
    });

    it('keeps a session exactly at the timeout boundary', () => {
      const now = 5_000_000;
      sessions.set('boundary', makeEntry(now - SESSION_IDLE_TIMEOUT_MS) as never);

      const evicted = sweepIdleSessions(now);

      expect(evicted).toBe(0);
      expect(sessions.has('boundary')).toBe(true);
    });

    it('uses the current clock by default (vi.useFakeTimers)', () => {
      vi.useFakeTimers();
      try {
        const entry = makeEntry(Date.now());
        sessions.set('stale', entry as never);

        vi.advanceTimersByTime(SESSION_IDLE_TIMEOUT_MS + 1);
        sweepIdleSessions();

        expect(sessions.has('stale')).toBe(false);
        expect(entry.transport.close).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Session cap (H1 — hard upper bound)
  // ---------------------------------------------------------------------------

  describe('Session cap', () => {
    it('evicts the oldest session once MAX_SESSIONS is reached', () => {
      for (let i = 0; i < MAX_SESSIONS; i++) {
        // lastActivity ascending → s0 is the oldest
        sessions.set(`s${i}`, { transport: { close: vi.fn() }, lastActivity: 1000 + i } as never);
      }
      expect(sessions.size).toBe(MAX_SESSIONS);

      const incoming = { close: vi.fn(), sessionId: 'incoming' };
      registerSession('incoming', incoming as never);

      expect(sessions.size).toBe(MAX_SESSIONS);
      expect(sessions.has('s0')).toBe(false);
      expect(sessions.has('incoming')).toBe(true);
    });

    it('does not evict when re-registering an existing session id at the cap', () => {
      for (let i = 0; i < MAX_SESSIONS; i++) {
        sessions.set(`s${i}`, { transport: { close: vi.fn() }, lastActivity: 1000 + i } as never);
      }

      registerSession('s0', { close: vi.fn(), sessionId: 's0' } as never);

      expect(sessions.size).toBe(MAX_SESSIONS);
      expect(sessions.has('s0')).toBe(true);
    });
  });
});
