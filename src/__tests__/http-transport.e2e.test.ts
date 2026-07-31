/**
 * Real-transport tests for the HTTP entry point (src/http.ts).
 *
 * Deliberately does NOT mock the MCP SDK: http.test.ts replaces both McpServer
 * and StreamableHTTPServerTransport with fakes, so it verifies our Express
 * wiring but never the actual session/transport semantics. A behavior change in
 * the SDK would slip through CI unnoticed.
 *
 * These are characterization tests — they pin down what the real SDK (1.30)
 * does today: SSE-framed responses, 202 for notifications, 404 for unknown
 * sessions, 415 for a non-JSON Content-Type.
 *
 * No network access: every request is served in-process by supertest.
 */

import request from 'supertest';
import { describe, it, expect, afterAll } from 'vitest';

import { app, sessions, VERSION } from '../http.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Headers every Streamable HTTP client has to send on POST /mcp. */
const MCP_HEADERS = {
  Accept: 'application/json, text/event-stream',
  'Content-Type': 'application/json',
};

const INITIALIZE_BODY = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'e2e-test-client', version: '1.0.0' },
  },
};

interface JsonRpcEnvelope {
  jsonrpc: string;
  id?: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/**
 * Extract the JSON-RPC payloads from an SSE body. Without `enableJsonResponse`
 * the SDK answers a POST as `text/event-stream`, so the payload arrives as
 * `event: message\ndata: {...}` rather than as a JSON body supertest could
 * parse on its own.
 */
function parseSseMessages(body: string): JsonRpcEnvelope[] {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice('data:'.length).trim()) as JsonRpcEnvelope);
}

/** Run a full initialize handshake and return the session id the SDK assigned. */
async function initializeSession(): Promise<string> {
  const res = await request(app).post('/mcp').set(MCP_HEADERS).send(INITIALIZE_BODY);

  expect(res.status).toBe(200);
  const sessionId = res.headers['mcp-session-id'] as string | undefined;
  expect(sessionId).toBeDefined();

  await request(app)
    .post('/mcp')
    .set({ ...MCP_HEADERS, 'mcp-session-id': sessionId as string })
    .send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  return sessionId as string;
}

afterAll(() => {
  // Close whatever survived so vitest can exit without dangling transports.
  for (const [id, entry] of sessions) {
    entry.transport.close();
    sessions.delete(id);
  }
});

// =============================================================================
// Test Suite
// =============================================================================

describe('HTTP transport against the real MCP SDK', () => {
  // ---------------------------------------------------------------------------
  // 1. Initialize handshake
  // ---------------------------------------------------------------------------

  describe('initialize handshake', () => {
    it('answers with an SSE-framed serverInfo and assigns a session id', async () => {
      const res = await request(app).post('/mcp').set(MCP_HEADERS).send(INITIALIZE_BODY);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');

      const sessionId = res.headers['mcp-session-id'] as string | undefined;
      expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

      const [message] = parseSseMessages(res.text);
      expect(message.id).toBe(1);
      expect(message.result?.serverInfo).toEqual({ name: 'ris-mcp', version: VERSION });
      expect(message.result?.protocolVersion).toBe('2025-03-26');

      // The Express layer must have adopted the SDK-generated id.
      expect(sessions.has(sessionId as string)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. tools/list on an established session
  // ---------------------------------------------------------------------------

  describe('established session', () => {
    it('accepts notifications/initialized with 202 and no body', async () => {
      const res = await request(app).post('/mcp').set(MCP_HEADERS).send(INITIALIZE_BODY);
      const sessionId = res.headers['mcp-session-id'] as string;

      const notification = await request(app)
        .post('/mcp')
        .set({ ...MCP_HEADERS, 'mcp-session-id': sessionId })
        .send({ jsonrpc: '2.0', method: 'notifications/initialized' });

      expect(notification.status).toBe(202);
      expect(notification.text).toBe('');
    });

    it('lists all 12 ris_* tools', async () => {
      const sessionId = await initializeSession();

      const res = await request(app)
        .post('/mcp')
        .set({ ...MCP_HEADERS, 'mcp-session-id': sessionId })
        .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

      expect(res.status).toBe(200);

      const [message] = parseSseMessages(res.text);
      const tools = message.result?.tools as { name: string }[];
      const names = tools.map((tool) => tool.name).sort();

      expect(names).toEqual([
        'ris_bezirke',
        'ris_bundesgesetzblatt',
        'ris_bundesrecht',
        'ris_dokument',
        'ris_gemeinden',
        'ris_history',
        'ris_judikatur',
        'ris_landesgesetzblatt',
        'ris_landesrecht',
        'ris_regierungsvorlagen',
        'ris_sonstige',
        'ris_verordnungen',
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Unknown session id
  // ---------------------------------------------------------------------------

  describe('unknown session id', () => {
    it('answers 404 so the client knows to reinitialize', async () => {
      const res = await request(app)
        .post('/mcp')
        .set({ ...MCP_HEADERS, 'mcp-session-id': 'e3b0c442-98fc-1c14-9afb-f4c8996fb924' })
        .send({ jsonrpc: '2.0', id: 3, method: 'tools/list' });

      // Our Express check fires first and never reaches the transport; the SDK
      // uses the same status for an unknown session, so the client sees 404
      // either way.
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Session nicht gefunden. Bitte neu verbinden.' });
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Session termination via DELETE
  // ---------------------------------------------------------------------------

  describe('DELETE /mcp', () => {
    it('terminates the session, drops it from the map, and 404s afterwards', async () => {
      const sessionId = await initializeSession();
      expect(sessions.has(sessionId)).toBe(true);

      const del = await request(app)
        .delete('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .set('mcp-session-id', sessionId);

      expect(del.status).toBe(200);
      // transport.onclose removes the entry — no explicit delete in the route.
      expect(sessions.has(sessionId)).toBe(false);

      const afterDelete = await request(app)
        .post('/mcp')
        .set({ ...MCP_HEADERS, 'mcp-session-id': sessionId })
        .send({ jsonrpc: '2.0', id: 4, method: 'tools/list' });

      expect(afterDelete.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Content-Type enforcement (SDK 1.30 strict parsing)
  // ---------------------------------------------------------------------------

  describe('Content-Type enforcement', () => {
    it('rejects a non-JSON Content-Type with 415 and a JSON-RPC error', async () => {
      const res = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .set('Content-Type', 'text/plain')
        .send('nicht JSON');

      // express.json() ignores the body instead of rejecting it (it only parses
      // application/json), so the request reaches the transport and the SDK is
      // the one that answers 415.
      expect(res.status).toBe(415);
      expect(res.body).toEqual({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32000,
          message: 'Unsupported Media Type: Content-Type must be application/json',
        },
      });
    });

    it('does not register a session for a rejected Content-Type', async () => {
      const before = sessions.size;

      await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .set('Content-Type', 'text/plain')
        .send('nicht JSON');

      expect(sessions.size).toBe(before);
    });
  });
});
