import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  connectBridge,
  readMountInput,
  readMountResult,
  readToolResult,
  type HostApp,
} from './bridge.js';

const STRUCTURED = { total_hits: 3, page: 1, page_size: 20, has_more: false, documents: [] };

/** A tool result as the host hands it to the widget. */
function toolResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    content: [{ type: 'text', text: 'Gefunden: 3 Treffer' }],
    structuredContent: STRUCTURED,
    ...overrides,
  };
}

/**
 * Minimal stand-in for the host side. Typed as `HostApp`, so it stops compiling
 * the moment the ext-apps signatures the bridge relies on change.
 */
function stubApp(overrides: Partial<HostApp> = {}): HostApp & {
  emit(event: string, params: unknown): void;
} {
  const listeners = new Map<string, ((params: never) => void)[]>();

  const app = {
    addEventListener: vi.fn((event: string, handler: (params: never) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    }),
    connect: vi.fn(async () => undefined),
    getHostContext: vi.fn(() => undefined),
    callServerTool: vi.fn(async () => toolResult()),
    openLink: vi.fn(async () => ({})),
    sendMessage: vi.fn(async () => ({})),
    ...overrides,
  } as unknown as HostApp;

  return Object.assign(app, {
    emit(event: string, params: unknown): void {
      for (const handler of listeners.get(event) ?? []) {
        (handler as (value: unknown) => void)(params);
      }
    },
  });
}

describe('readMountResult — cross-host acquisition order', () => {
  it('1. takes structuredContent from the tool result event', () => {
    const payload = readMountResult(toolResult(), { openai: { toolOutput: { total_hits: 999 } } });

    expect(payload.source).toBe('toolresult');
    expect(payload.structuredContent).toEqual(STRUCTURED);
  });

  it('2. falls back to the host global when the event carries no structuredContent', () => {
    const payload = readMountResult(toolResult({ structuredContent: undefined }), {
      openai: { toolOutput: STRUCTURED },
    });

    expect(payload.source).toBe('host-global');
    expect(payload.structuredContent).toEqual(STRUCTURED);
  });

  it('3. reports missing data when neither source has any', () => {
    const payload = readMountResult(toolResult({ structuredContent: undefined }), {});

    expect(payload.source).toBe('missing');
    expect(payload.structuredContent).toBeNull();
  });

  it('reports missing data when the host global exists but is empty', () => {
    const payload = readMountResult(toolResult({ structuredContent: undefined }), {
      openai: { toolOutput: null },
    });

    expect(payload.source).toBe('missing');
  });

  it.each([
    ['a non-object global', { openai: 'yes' }],
    ['a null global', { openai: null }],
    ['no globals at all', undefined],
  ])('survives %s without throwing', (_label, globals) => {
    expect(readMountResult(toolResult({ structuredContent: undefined }), globals).source).toBe(
      'missing',
    );
  });

  it('reports missing data when the host delivered no result object at all', () => {
    expect(readMountResult(undefined, {}).source).toBe('missing');
    expect(readMountResult(undefined, {}).structuredContent).toBeNull();
  });

  it('carries the text blocks so the server prose stays available', () => {
    expect(readMountResult(toolResult(), {}).text).toBe('Gefunden: 3 Treffer');
  });

  it('joins several text blocks and ignores non-text content', () => {
    const result = toolResult({
      content: [
        { type: 'text', text: 'erste Zeile' },
        { type: 'image', data: 'irrelevant' },
        { type: 'text', text: 'zweite Zeile' },
      ],
    });

    expect(readMountResult(result, {}).text).toBe('erste Zeile\nzweite Zeile');
  });

  it('flags a server-side tool error and keeps its German prose', () => {
    const result = toolResult({
      isError: true,
      structuredContent: undefined,
      content: [{ type: 'text', text: 'Zeitüberschreitung bei der RIS-Anfrage.' }],
    });

    const payload = readMountResult(result, {});

    expect(payload.isError).toBe(true);
    expect(payload.text).toBe('Zeitüberschreitung bei der RIS-Anfrage.');
  });

  it('does not treat a host global as the answer to a failed tool call', () => {
    const result = toolResult({ isError: true, structuredContent: undefined });
    const payload = readMountResult(result, { openai: { toolOutput: STRUCTURED } });

    expect(payload.source).toBe('missing');
    expect(payload.structuredContent).toBeNull();
  });
});

describe('readToolResult — results the widget requested itself', () => {
  it('takes structuredContent from the result', () => {
    const payload = readToolResult(toolResult());

    expect(payload.source).toBe('toolresult');
    expect(payload.structuredContent).toEqual(STRUCTURED);
  });

  it('never consults the host global, which would replay the previous page', () => {
    const globals = { openai: { toolOutput: STRUCTURED } };
    Object.assign(globalThis, globals);

    try {
      const payload = readToolResult(toolResult({ structuredContent: undefined }));

      expect(payload.source).toBe('missing');
      expect(payload.structuredContent).toBeNull();
    } finally {
      delete (globalThis as Record<string, unknown>).openai;
    }
  });
});

describe('readMountInput — the arguments channel', () => {
  it('reads the arguments ChatGPT mirrors onto its global', () => {
    expect(readMountInput({ openai: { toolInput: { dokumentnummer: 'NOR12019037' } } })).toEqual({
      dokumentnummer: 'NOR12019037',
    });
  });

  it.each([
    ['no globals at all', undefined],
    ['a host without the extension', {}],
    ['a host that exposes no input', { openai: {} }],
    ['a non-object input', { openai: { toolInput: 'NOR12019037' } }],
    ['a non-object global', { openai: 'yes' }],
  ])('finds nothing in %s', (_label, globals) => {
    expect(readMountInput(globals)).toBeNull();
  });
});

describe('connectBridge', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.removeProperty('--color-text-primary');
  });

  it('reports the mount payload once the host delivers the tool result', async () => {
    const app = stubApp();
    const onToolResult = vi.fn();
    await connectBridge({ onToolResult }, app);

    app.emit('toolresult', toolResult());

    expect(onToolResult).toHaveBeenCalledTimes(1);
    expect(onToolResult.mock.calls[0][0]).toMatchObject({
      source: 'toolresult',
      structuredContent: STRUCTURED,
    });
  });

  it('subscribes before connecting, so an immediate result is not missed', async () => {
    const order: string[] = [];
    const app = stubApp({
      addEventListener: vi.fn(() =>
        order.push('subscribe'),
      ) as unknown as HostApp['addEventListener'],
      connect: vi.fn(async () => {
        order.push('connect');
      }),
    });

    await connectBridge({ onToolResult: vi.fn() }, app);

    expect(order.indexOf('subscribe')).toBeLessThan(order.indexOf('connect'));
  });

  it('rejects when the handshake fails, so the caller can show a notice', async () => {
    const app = stubApp({
      connect: vi.fn(async () => {
        throw new Error('kein Host');
      }),
    });

    await expect(connectBridge({ onToolResult: vi.fn() }, app)).rejects.toThrow('kein Host');
  });

  it('applies the host theme and style variables on connect', async () => {
    const app = stubApp({
      getHostContext: vi.fn(() => ({
        theme: 'dark' as const,
        styles: { variables: { '--color-text-primary': 'rgb(1, 2, 3)' } },
      })) as unknown as HostApp['getHostContext'],
    });

    await connectBridge({ onToolResult: vi.fn() }, app);

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--color-text-primary')).toBe(
      'rgb(1, 2, 3)',
    );
  });

  it('follows later theme changes from the host', async () => {
    const app = stubApp();
    await connectBridge({ onToolResult: vi.fn() }, app);

    app.emit('hostcontextchanged', { theme: 'dark' });

    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('ignores a host context update that mentions no theme', async () => {
    const app = stubApp();
    await connectBridge({ onToolResult: vi.fn() }, app);
    document.documentElement.dataset.theme = 'light';

    app.emit('hostcontextchanged', { locale: 'de-AT' });

    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('reports the arguments of the call that mounted the widget', async () => {
    const app = stubApp();
    const onToolInput = vi.fn();
    await connectBridge({ onToolResult: vi.fn(), onToolInput }, app);

    app.emit('toolinput', { arguments: { dokumentnummer: 'NOR12019037' } });

    expect(onToolInput).toHaveBeenCalledWith({ dokumentnummer: 'NOR12019037' });
  });

  it.each([
    ['a notification without arguments', {}],
    ['arguments that are not an object', { arguments: 'NOR12019037' }],
    ['no params at all', undefined],
  ])('ignores %s', async (_label, params) => {
    const app = stubApp();
    const onToolInput = vi.fn();
    await connectBridge({ onToolResult: vi.fn(), onToolInput }, app);

    app.emit('toolinput', params);

    expect(onToolInput).not.toHaveBeenCalled();
  });

  it('subscribes to the input channel before connecting as well', async () => {
    const events: string[] = [];
    const app = stubApp({
      addEventListener: vi.fn((event: string) => {
        events.push(event);
      }) as unknown as HostApp['addEventListener'],
      connect: vi.fn(async () => {
        events.push('connect');
      }),
    });

    await connectBridge({ onToolResult: vi.fn(), onToolInput: vi.fn() }, app);

    expect(events.indexOf('toolinput')).toBeLessThan(events.indexOf('connect'));
  });

  it('hands the host context to a widget that lays itself out against it', async () => {
    const context = { containerDimensions: { height: 480, width: 720 } };
    const app = stubApp({
      getHostContext: vi.fn(() => context) as unknown as HostApp['getHostContext'],
    });
    const onHostContext = vi.fn();

    await connectBridge({ onToolResult: vi.fn(), onHostContext }, app);
    app.emit('hostcontextchanged', { containerDimensions: { maxHeight: 900 } });

    expect(onHostContext).toHaveBeenNthCalledWith(1, context);
    expect(onHostContext).toHaveBeenNthCalledWith(2, { containerDimensions: { maxHeight: 900 } });
  });
});

describe('bridge actions', () => {
  it('calls a server tool and normalises the result', async () => {
    const app = stubApp();
    const bridge = await connectBridge({ onToolResult: vi.fn() }, app);

    const payload = await bridge.callTool({ name: 'ris_bundesrecht', arguments: { seite: 2 } });

    expect(app.callServerTool).toHaveBeenCalledWith({
      name: 'ris_bundesrecht',
      arguments: { seite: 2 },
    });
    expect(payload.structuredContent).toEqual(STRUCTURED);
  });

  it('gives up on a call the host never answers, instead of loading forever', async () => {
    vi.useFakeTimers();
    try {
      const app = stubApp({ callServerTool: vi.fn(() => new Promise<never>(() => undefined)) });
      const bridge = await connectBridge({ onToolResult: vi.fn() }, app);

      const call = bridge.callTool({ name: 'ris_bundesrecht', arguments: { seite: 2 } });
      const settled = expect(call).rejects.toThrow('host did not answer');

      await vi.advanceTimersByTimeAsync(45_000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not fail a call that the host answers in time', async () => {
    vi.useFakeTimers();
    try {
      const app = stubApp({
        callServerTool: vi.fn(
          () =>
            new Promise((resolve) => {
              setTimeout(() => resolve(toolResult()), 29_000);
            }),
        ) as unknown as HostApp['callServerTool'],
      });
      const bridge = await connectBridge({ onToolResult: vi.fn() }, app);

      const call = bridge.callTool({ name: 'ris_bundesrecht', arguments: {} });
      await vi.advanceTimersByTimeAsync(29_000);

      expect((await call).structuredContent).toEqual(STRUCTURED);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets a transport failure surface, so the caller can tell it from a tool error', async () => {
    const app = stubApp({
      callServerTool: vi.fn(async () => {
        throw new Error('session gone');
      }),
    });
    const bridge = await connectBridge({ onToolResult: vi.fn() }, app);

    await expect(bridge.callTool({ name: 'ris_bundesrecht', arguments: {} })).rejects.toThrow(
      'session gone',
    );
  });

  it('opens a link through the host', async () => {
    const app = stubApp();
    const bridge = await connectBridge({ onToolResult: vi.fn() }, app);

    await expect(bridge.openLink('https://www.ris.bka.gv.at/x')).resolves.toBe(true);
    expect(app.openLink).toHaveBeenCalledWith({ url: 'https://www.ris.bka.gv.at/x' });
  });

  it('reports a refused link instead of throwing', async () => {
    const app = stubApp({ openLink: vi.fn(async () => ({ isError: true })) });
    const bridge = await connectBridge({ onToolResult: vi.fn() }, app);

    await expect(bridge.openLink('https://example.invalid')).resolves.toBe(false);
  });

  it('reports a link the host could not even be asked about', async () => {
    const app = stubApp({
      openLink: vi.fn(async () => {
        throw new Error('no host');
      }),
    });
    const bridge = await connectBridge({ onToolResult: vi.fn() }, app);

    await expect(bridge.openLink('https://example.invalid')).resolves.toBe(false);
  });

  it('sends a prompt as a user text message', async () => {
    const app = stubApp();
    const bridge = await connectBridge({ onToolResult: vi.fn() }, app);

    await expect(bridge.sendPrompt('Bitte lade das Dokument NOR1 mit ris_dokument.')).resolves.toBe(
      true,
    );
    expect(app.sendMessage).toHaveBeenCalledWith({
      role: 'user',
      content: [{ type: 'text', text: 'Bitte lade das Dokument NOR1 mit ris_dokument.' }],
    });
  });

  it('reports a prompt the host rejected', async () => {
    const app = stubApp({ sendMessage: vi.fn(async () => ({ isError: true })) });
    const bridge = await connectBridge({ onToolResult: vi.fn() }, app);

    await expect(bridge.sendPrompt('egal')).resolves.toBe(false);
  });
});
