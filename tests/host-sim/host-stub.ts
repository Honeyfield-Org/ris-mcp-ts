/**
 * Minimal host side of the ext-apps postMessage protocol — just enough for
 * what `ui/shared/bridge.ts` actually uses, with scriptable misbehavior
 * (delays, RPC errors) that the real SDK host (`AppBridge`) would not allow.
 *
 * Runs INSIDE the Playwright page via `page.evaluate(installHostSim, config)`,
 * so it must stay fully self-contained: no imports, no captured scope.
 * Protocol reference: node_modules/@modelcontextprotocol/ext-apps/dist/src/app.js
 */

export interface HostSimCallAnswer {
  delayMs?: number;
  rpcError?: string;
  result?: unknown;
}

export interface HostSimConfig {
  widgetHtml: string;
  /** Delivered as `ui/notifications/tool-result` right after the handshake. */
  mountResult?: unknown;
  hostContext?: Record<string, unknown>;
  /** Consumed in order, one per `tools/call`. */
  callAnswers?: HostSimCallAnswer[];
}

export function installHostSim(config: HostSimConfig): void {
  const calls: { method: string; params: unknown }[] = [];
  const answers = [...(config.callAnswers ?? [])];

  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.style.width = '900px';
  iframe.style.height = '700px';
  iframe.style.border = '0';
  iframe.srcdoc = config.widgetHtml;

  const send = (message: unknown): void => {
    iframe.contentWindow?.postMessage(message, '*');
  };

  window.addEventListener('message', (event) => {
    if (event.source !== iframe.contentWindow) return;
    const msg = event.data as {
      jsonrpc?: string;
      id?: unknown;
      method?: string;
      params?: { name?: string; arguments?: unknown };
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
          hostCapabilities: { openLinks: {}, serverTools: {} },
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
      const answer = answers.shift() ?? {
        rpcError: 'host-sim: no scripted answer left',
      };
      const reply = (): void => {
        if (answer.rpcError !== undefined) {
          send({
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -32000, message: answer.rpcError },
          });
        } else {
          send({ jsonrpc: '2.0', id: msg.id, result: answer.result });
        }
      };
      if (answer.delayMs) setTimeout(reply, answer.delayMs);
      else reply();
      return;
    }

    if (msg.method === 'ui/open-link' || msg.method === 'ui/message') {
      send({ jsonrpc: '2.0', id: msg.id, result: {} });
      return;
    }
  });

  (window as unknown as { __hostSim: { calls: typeof calls } }).__hostSim = { calls };
  document.body.append(iframe);
}
