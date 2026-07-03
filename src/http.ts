/**
 * HTTP transport entry point for the RIS MCP Server.
 *
 * Provides an Express-based HTTP server with Streamable HTTP transport
 * for deployment on cloud platforms (e.g., AWS Lightsail).
 */

import crypto from 'node:crypto';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Express, Request, Response } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';

import { registerAllTools } from './tools/index.js';
import { VERSION } from './version.js';

// Re-exported for backward compatibility: VERSION now lives in version.js
// (shared with server.ts), but the HTTP server still surfaces it as part of
// its module API.
export { VERSION };

// Session lifecycle limits (H1 — prevent unbounded growth of the session map).
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // evict after 30 min idle
export const SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // check every 5 min
export const MAX_SESSIONS = 100; // hard upper bound

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  lastActivity: number;
}

export const app: Express = express();
export const sessions = new Map<string, SessionEntry>();

// Behind the Lightsail load balancer exactly one proxy hop sits in front of us,
// so req.ip reflects the real client instead of the LB address (M3 — otherwise
// the rate limit below would apply globally rather than per client).
app.set('trust proxy', 1);

// Explicit body-size limit (N7) — reject oversized payloads early.
app.use(express.json({ limit: '1mb' }));

// Rate limiting: MCP-specific (each request triggers upstream RIS API calls)
export const mcpLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => (req.headers['mcp-session-id'] as string) || req.ip || 'unknown',
  message: { error: 'Zu viele Anfragen. Bitte später erneut versuchen.' },
  validate: { keyGeneratorIpFallback: false },
});
app.use('/mcp', mcpLimiter);

/**
 * Close a transport and drop it from the session map. Idempotent: the
 * transport's own `onclose` handler also deletes the entry, so calling this
 * during a sweep or shutdown is safe.
 */
function closeSession(sessionId: string, entry: SessionEntry): void {
  entry.transport.close();
  sessions.delete(sessionId);
}

/**
 * Evict the single least-recently-active session. Used when the map is at
 * capacity and a new session needs to be admitted.
 */
function evictOldestSession(): void {
  let oldestId: string | undefined;
  let oldestActivity = Infinity;
  for (const [id, entry] of sessions) {
    if (entry.lastActivity < oldestActivity) {
      oldestActivity = entry.lastActivity;
      oldestId = id;
    }
  }
  if (oldestId !== undefined) {
    const entry = sessions.get(oldestId);
    if (entry) {
      closeSession(oldestId, entry);
    }
  }
}

/**
 * Store a session, enforcing the MAX_SESSIONS cap. If the map is full and the
 * id is new, the oldest session is evicted first (H1).
 */
export function registerSession(sessionId: string, transport: StreamableHTTPServerTransport): void {
  if (!sessions.has(sessionId) && sessions.size >= MAX_SESSIONS) {
    evictOldestSession();
  }
  sessions.set(sessionId, { transport, lastActivity: Date.now() });
}

/**
 * Remove every session idle for longer than SESSION_IDLE_TIMEOUT_MS.
 * Returns the number of evicted sessions. Exported for testability.
 */
export function sweepIdleSessions(now: number = Date.now()): number {
  let evicted = 0;
  for (const [id, entry] of sessions) {
    if (now - entry.lastActivity > SESSION_IDLE_TIMEOUT_MS) {
      closeSession(id, entry);
      evicted += 1;
    }
  }
  return evicted;
}

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'ris-mcp',
    activeSessions: sessions.size,
  });
});

// MCP endpoint — POST creates or reuses sessions, GET/DELETE require existing session
app.post('/mcp', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  // Reuse existing session
  if (sessionId) {
    const existing = sessions.get(sessionId);
    if (existing) {
      existing.lastActivity = Date.now();
      await existing.transport.handleRequest(req, res, req.body);
      return;
    }
    // Session expired or server restarted — client must reinitialize
    res.status(404).json({ error: 'Session nicht gefunden. Bitte neu verbinden.' });
    return;
  }

  // Create new session
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: (): string => crypto.randomUUID(),
  });
  const server = new McpServer({ name: 'ris-mcp', version: VERSION });

  registerAllTools(server);

  transport.onclose = (): void => {
    if (transport.sessionId) {
      sessions.delete(transport.sessionId);
    }
  };

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);

  // Store session AFTER handleRequest so the sessionId is available
  // (the SDK generates the sessionId during initialize handling)
  if (transport.sessionId && !sessions.has(transport.sessionId)) {
    registerSession(transport.sessionId, transport);
  }
});

app.get('/mcp', (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (sessionId) {
    const entry = sessions.get(sessionId);
    if (entry) {
      entry.lastActivity = Date.now();
      entry.transport.handleRequest(req, res, req.body);
      return;
    }
  }

  res.status(400).json({ error: 'Keine gültige Session. Starte mit POST /mcp.' });
});

app.delete('/mcp', (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (sessionId) {
    const entry = sessions.get(sessionId);
    if (entry) {
      entry.lastActivity = Date.now();
      entry.transport.handleRequest(req, res, req.body);
      return;
    }
  }

  res.status(400).json({ error: 'Keine gültige Session. Starte mit POST /mcp.' });
});

// Start server only when not in test mode
const PORT = process.env.PORT ?? 3000;

if (process.env.NODE_ENV !== 'test') {
  // Periodic idle-session sweep (H1). unref() so it never keeps the process alive.
  const sweepTimer = setInterval(() => {
    sweepIdleSessions();
  }, SESSION_SWEEP_INTERVAL_MS);
  sweepTimer.unref();

  const httpServer = app.listen(PORT, () => {
    console.log(`RIS MCP HTTP server listening on port ${PORT}`);
  });

  // Graceful shutdown (N4) — Node runs as PID 1 in the container, so we must
  // handle the signals ourselves: stop accepting connections, close all active
  // session transports, then exit.
  const shutdown = (signal: string): void => {
    console.log(`${signal} empfangen — Server wird heruntergefahren…`);
    clearInterval(sweepTimer);
    for (const [id, entry] of sessions) {
      closeSession(id, entry);
    }
    httpServer.close(() => {
      process.exit(0);
    });
    // Fail-safe: force exit if connections do not drain in time.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
