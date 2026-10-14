/**
 * Real-transport tests for the deployment switches of src/http.ts:
 * MCP_AUTH_TOKEN, MCP_STATELESS and RATE_LIMIT_PER_MINUTE.
 *
 * All three are read once at module load (like ALLOWED_ORIGINS), so every case
 * re-imports the module with its environment in place. The MCP SDK is not
 * mocked: what is pinned here is what a LibreChat or Claude client really sees.
 */

import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as Http from '../http.js';

type HttpModule = typeof Http;

const MCP_HEADERS = {
  Accept: 'application/json, text/event-stream',
  'Content-Type': 'application/json',
};

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'e2e-test-client', version: '1.0.0' },
  },
};

const TOOLS_LIST = { jsonrpc: '2.0', id: 2, method: 'tools/list' };

async function loadApp(env: Record<string, string>): Promise<HttpModule> {
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  vi.resetModules();
  return import('../http.js');
}

/** The JSON-RPC payload of an SSE-framed answer. */
function firstMessage(body: string): { result?: Record<string, unknown> } {
  const line = body.split('\n').find((l) => l.startsWith('data:'));
  if (line === undefined) {
    throw new Error(`no SSE data line in: ${body}`);
  }
  return JSON.parse(line.slice('data:'.length).trim()) as { result?: Record<string, unknown> };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('MCP_AUTH_TOKEN', () => {
  it('leaves /mcp open while unset', async () => {
    const { app, sessions } = await loadApp({});
    const res = await request(app).post('/mcp').set(MCP_HEADERS).send(INITIALIZE);
    sessions.clear();

    expect(res.status).toBe(200);
  });

  it('rejects a request without a token, with a wrong token and with a wrong scheme', async () => {
    const { app } = await loadApp({ MCP_AUTH_TOKEN: 's3cret-token' });

    const none = await request(app).post('/mcp').set(MCP_HEADERS).send(INITIALIZE);
    const wrong = await request(app)
      .post('/mcp')
      .set(MCP_HEADERS)
      .set('Authorization', 'Bearer not-the-token')
      .send(INITIALIZE);
    const scheme = await request(app)
      .post('/mcp')
      .set(MCP_HEADERS)
      .set('Authorization', 's3cret-token')
      .send(INITIALIZE);

    for (const res of [none, wrong, scheme]) {
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Bearer');
      expect(res.body).toEqual({ error: 'Nicht autorisiert. Gültiges Bearer-Token erforderlich.' });
    }
  });

  it('guards GET and DELETE as well', async () => {
    const { app } = await loadApp({ MCP_AUTH_TOKEN: 's3cret-token' });

    expect((await request(app).get('/mcp')).status).toBe(401);
    expect((await request(app).delete('/mcp')).status).toBe(401);
  });

  it('accepts the right token, whatever the case of the scheme, and creates a session', async () => {
    const { app, sessions } = await loadApp({ MCP_AUTH_TOKEN: 's3cret-token' });

    for (const scheme of ['Bearer', 'bearer']) {
      const res = await request(app)
        .post('/mcp')
        .set(MCP_HEADERS)
        .set('Authorization', `${scheme} s3cret-token`)
        .send(INITIALIZE);

      expect(res.status).toBe(200);
      expect(res.headers['mcp-session-id']).toBeTruthy();
    }
    sessions.clear();
  });

  it('keeps /health reachable without a token', async () => {
    const { app } = await loadApp({ MCP_AUTH_TOKEN: 's3cret-token' });

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('treats a blank token as unset', async () => {
    const { app, sessions } = await loadApp({ MCP_AUTH_TOKEN: '   ' });
    const res = await request(app).post('/mcp').set(MCP_HEADERS).send(INITIALIZE);
    sessions.clear();

    expect(res.status).toBe(200);
  });

  it('does not spend rate-limit budget on unauthenticated requests', async () => {
    const { app } = await loadApp({ MCP_AUTH_TOKEN: 's3cret-token', RATE_LIMIT_PER_MINUTE: '2' });

    for (let i = 0; i < 5; i += 1) {
      expect((await request(app).post('/mcp').set(MCP_HEADERS).send(INITIALIZE)).status).toBe(401);
    }
  });
});

describe('RATE_LIMIT_PER_MINUTE', () => {
  it('defaults to 60', async () => {
    const { app, sessions } = await loadApp({});
    const res = await request(app).post('/mcp').set(MCP_HEADERS).send(INITIALIZE);
    sessions.clear();

    expect(res.headers['ratelimit-policy']).toBe('60;w=60');
  });

  it('applies a configured limit', async () => {
    const { app, sessions } = await loadApp({ RATE_LIMIT_PER_MINUTE: '2' });
    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await request(app).get('/mcp');
      statuses.push(res.status);
    }
    sessions.clear();

    expect(statuses).toEqual([400, 400, 429]);
  });

  it.each(['0', '-5', 'abc', '1.5x', ''])('falls back to 60 for %j', async (raw) => {
    const { app } = await loadApp({ RATE_LIMIT_PER_MINUTE: raw });
    const res = await request(app).get('/mcp');

    expect(res.headers['ratelimit-policy']).toBe('60;w=60');
  });
});

describe('MCP_STATELESS', () => {
  it('answers initialize without handing out a session', async () => {
    const { app, sessions } = await loadApp({ MCP_STATELESS: 'true' });

    const res = await request(app).post('/mcp').set(MCP_HEADERS).send(INITIALIZE);

    expect(res.status).toBe(200);
    expect(res.headers['mcp-session-id']).toBeUndefined();
    expect(sessions.size).toBe(0);
    const result = firstMessage(res.text).result as {
      instructions?: string;
      serverInfo: { name: string };
    };
    expect(result.serverInfo.name).toBe('ris-mcp');
    expect(result.instructions).toContain('RIS');
  });

  it('serves tools/list on a request that has no session and no prior initialize', async () => {
    const { app } = await loadApp({ MCP_STATELESS: '1' });

    const res = await request(app).post('/mcp').set(MCP_HEADERS).send(TOOLS_LIST);

    expect(res.status).toBe(200);
    const tools = (firstMessage(res.text).result as { tools: { name: string }[] }).tools;
    expect(tools).toHaveLength(13);
    expect(tools.map((t) => t.name)).toContain('ris_bundesrecht');
  });

  it('survives a "restart": a stale session id from a stateful run is simply served', async () => {
    const { app } = await loadApp({ MCP_STATELESS: 'true' });

    const res = await request(app)
      .post('/mcp')
      .set(MCP_HEADERS)
      .set('mcp-session-id', 'from-before-the-restart')
      .send(TOOLS_LIST);

    expect(res.status).toBe(200);
  });

  it('answers GET and DELETE with 405 and an Allow header', async () => {
    const { app } = await loadApp({ MCP_STATELESS: 'true' });

    for (const res of [await request(app).get('/mcp'), await request(app).delete('/mcp')]) {
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('POST');
    }
  });

  it('combines with the token check', async () => {
    const { app } = await loadApp({ MCP_STATELESS: 'true', MCP_AUTH_TOKEN: 'abc' });

    const denied = await request(app).post('/mcp').set(MCP_HEADERS).send(TOOLS_LIST);
    const allowed = await request(app)
      .post('/mcp')
      .set(MCP_HEADERS)
      .set('Authorization', 'Bearer abc')
      .send(TOOLS_LIST);

    expect(denied.status).toBe(401);
    expect(allowed.status).toBe(200);
  });

  it('stays stateful when the variable is unset or not truthy', async () => {
    const cases: Record<string, string>[] = [
      {},
      { MCP_STATELESS: 'false' },
      { MCP_STATELESS: '0' },
    ];
    for (const env of cases) {
      const { app, sessions } = await loadApp(env);
      const res = await request(app).post('/mcp').set(MCP_HEADERS).send(INITIALIZE);

      expect(res.headers['mcp-session-id']).toBeTruthy();
      sessions.clear();
      vi.unstubAllEnvs();
    }
  });
});
