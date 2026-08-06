/**
 * Minimal host side of the ext-apps postMessage protocol — just enough for
 * what `ui/shared/bridge.ts` actually uses, with scriptable misbehavior
 * (delays, RPC errors) that the real SDK host (`AppBridge`) would not allow.
 *
 * Runs INSIDE the Playwright page via `page.evaluate(installHostSim, config)`,
 * so it must stay fully self-contained: no imports, no captured scope.
 * Protocol reference: node_modules/@modelcontextprotocol/ext-apps/dist/src/app.js
 */

/**
 * One scripted answer to a `tools/call`, carrying either a result or an error.
 *
 * The union is load-bearing: an answer with neither field would send
 * `result: undefined`, which fails the SDK's `JSONRPCMessageSchema` parse and
 * so reaches the widget as an unexplained 45s timeout rather than as a reply.
 */
export type HostSimCallAnswer = { delayMs?: number } & (
  | { result: unknown; rpcError?: never }
  | { rpcError: string; result?: never }
);

/**
 * One scripted answer to `ui/request-display-mode`, carrying either the mode
 * the host granted or an error. Same union discipline as `HostSimCallAnswer`,
 * for the same reason: `result: undefined` would not parse as a reply.
 *
 * A granted mode may differ from the requested one — that is the whole point of
 * scripting it, and the widget must read the answer rather than its own wish.
 */
export type HostSimDisplayModeAnswer = { delayMs?: number } & (
  | { mode: 'inline' | 'fullscreen' | 'pip'; rpcError?: never }
  | { rpcError: string; mode?: never }
);

/**
 * One request the widget sent, as `window.__hostSim.calls` hands it back.
 *
 * `params` stays unknown: its shape is per-method and the recorder never reads
 * it — the spec that asks for a specific method narrows it itself.
 */
export interface HostSimCall {
  method: string;
  params: unknown;
}

export interface HostSimConfig {
  widgetHtml: string;
  /** Delivered as `ui/notifications/tool-result` right after the handshake. */
  mountResult?: unknown;
  hostContext?: Record<string, unknown>;
  /** Consumed in order, one per `tools/call`. */
  callAnswers?: HostSimCallAnswer[];
  /** Consumed in order, one per `ui/request-display-mode`. */
  displayModeAnswers?: HostSimDisplayModeAnswer[];
}

export function installHostSim(config: HostSimConfig): void {
  const calls: HostSimCall[] = [];
  const answers = [...(config.callAnswers ?? [])];
  const displayModeAnswers = [...(config.displayModeAnswers ?? [])];

  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.style.width = '900px';
  iframe.style.height = '700px';
  iframe.style.border = '0';
  iframe.srcdoc = config.widgetHtml;

  const send = (message: unknown): void => {
    iframe.contentWindow?.postMessage(message, '*');
  };

  /** Answer one request after its scripted delay, as a result or as an error. */
  const reply = (
    id: unknown,
    delayMs: number | undefined,
    payload: { rpcError: string } | { result: unknown },
  ): void => {
    const answer = (): void => {
      if ('rpcError' in payload) {
        send({ jsonrpc: '2.0', id, error: { code: -32000, message: payload.rpcError } });
      } else {
        send({ jsonrpc: '2.0', id, result: payload.result });
      }
    };
    if (delayMs) setTimeout(answer, delayMs);
    else answer();
  };

  window.addEventListener('message', (event) => {
    if (event.source !== iframe.contentWindow) return;
    // `params` stays unknown on the envelope: its shape is per-method, and the
    // recorder hands it to the spec unread.
    const msg = event.data as {
      jsonrpc?: string;
      id?: unknown;
      method?: string;
      params?: unknown;
    };
    if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return;
    if (msg.method !== 'ui/notifications/size-changed') {
      calls.push({ method: msg.method, params: msg.params });
    }

    if (msg.method === 'ui/initialize') {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2026-01-26',
          hostInfo: { name: 'host-sim', version: '0.0.0' },
          // `message` is advertised because the stub answers `ui/message`; a
          // host that acks a method it never claimed is not a host worth
          // testing against.
          hostCapabilities: { openLinks: {}, serverTools: {}, message: {} },
          hostContext: config.hostContext ?? { theme: 'light' },
        },
      });
      return;
    }

    if (msg.method === 'ui/notifications/initialized') {
      if (config.mountResult !== undefined) {
        send({
          jsonrpc: '2.0',
          method: 'ui/notifications/tool-result',
          params: config.mountResult,
        });
      }
      return;
    }

    if (msg.method === 'tools/call') {
      const answer: HostSimCallAnswer = answers.shift() ?? {
        rpcError: 'host-sim: no scripted answer left',
      };
      reply(
        msg.id,
        answer.delayMs,
        answer.rpcError !== undefined ? { rpcError: answer.rpcError } : { result: answer.result },
      );
      return;
    }

    // Must come before the catch-all below: an unscripted display-mode request
    // is a spec that forgot its answer, not a method the stub cannot speak.
    if (msg.method === 'ui/request-display-mode') {
      const answer: HostSimDisplayModeAnswer = displayModeAnswers.shift() ?? {
        rpcError: 'host-sim: no scripted display-mode answer',
      };
      reply(
        msg.id,
        answer.delayMs,
        answer.rpcError !== undefined
          ? { rpcError: answer.rpcError }
          : { result: { mode: answer.mode } },
      );
      return;
    }

    if (msg.method === 'ui/open-link' || msg.method === 'ui/message') {
      send({ jsonrpc: '2.0', id: msg.id, result: {} });
      return;
    }

    // A request nobody handled must fail loudly and by name. Staying silent
    // leaves the widget's promise pending until its own 45s deadline, which
    // surfaces as a timeout that says nothing about which method was missing.
    // Notifications carry no id and get no reply, per JSON-RPC.
    if (msg.id !== undefined) {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: `host-sim: no handler for ${msg.method}` },
      });
    }
  });

  /**
   * Change the host context mid-test — a real host does this when it grants
   * fullscreen, resizes the container or switches the theme.
   *
   * The method string is the SDK's `HOST_CONTEXT_CHANGED_METHOD`, and `params`
   * is the patch itself (the App merges it into its stored context), so an
   * unwrapped patch is what the widget's `hostcontextchanged` listener sees.
   */
  const pushHostContext = (patch: Record<string, unknown>): void => {
    send({
      jsonrpc: '2.0',
      method: 'ui/notifications/host-context-changed',
      params: patch,
    });
  };

  (
    window as unknown as {
      __hostSim: { calls: typeof calls; pushHostContext: typeof pushHostContext };
    }
  ).__hostSim = { calls, pushHostContext };
  document.body.append(iframe);
}
