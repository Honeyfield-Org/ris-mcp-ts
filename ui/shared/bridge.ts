/**
 * Host plumbing shared by every RIS widget.
 *
 * Wraps the official `App` class from `@modelcontextprotocol/ext-apps`: it owns
 * the handshake, the theme wiring and — most importantly — the rule for where a
 * tool result's `structuredContent` comes from, which differs per host.
 */

import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  type McpUiDisplayMode,
} from '@modelcontextprotocol/ext-apps';

/**
 * The part of the ext-apps `App` surface the bridge uses.
 *
 * Derived from the real class rather than restated, so a signature change in
 * the SDK breaks the build here instead of at runtime in a host — and so tests
 * can hand in a stub that is checked against the same shape.
 */
export type HostApp = Pick<
  App,
  | 'addEventListener'
  | 'callServerTool'
  | 'connect'
  | 'getHostContext'
  | 'openLink'
  | 'requestDisplayMode'
  | 'sendMessage'
>;

/** Where a payload's `structuredContent` was found. */
export type StructuredContentSource = 'toolresult' | 'host-global' | 'missing';

/** A tool result, normalised into what the widget actually reads. */
export interface ToolPayload {
  /** Unvalidated — the caller decides whether it is the shape it expects. */
  structuredContent: unknown;
  source: StructuredContentSource;
  /** Text content blocks joined by newline; the German prose on an error. */
  text: string;
  isError: boolean;
}

export interface BridgeOptions {
  /** Called for the tool result that mounted the widget. */
  onToolResult(payload: ToolPayload): void;
  /**
   * Called with the arguments of the call that mounted the widget.
   *
   * A separate channel from the result, and the one that matters for a tool
   * whose payload is text rather than structured data: it names the document
   * even when no output data reaches the widget at all.
   */
  onToolInput?(args: Record<string, unknown>): void;
  /**
   * Called with the host context on connect and on every later change.
   *
   * Theming is applied by the bridge either way; this is for the parts a widget
   * has to lay itself out against, `containerDimensions` above all.
   */
  onHostContext?(context: unknown): void;
  /** Identifies the widget to the host. Defaults to the Trefferliste. */
  appName?: string;
  /**
   * Display modes this widget can lay itself out in, declared to the host
   * during the handshake.
   *
   * Per widget rather than global, and left unset by one that only ever renders
   * inline: the declaration is what makes a host offer its fullscreen
   * affordance, so declaring a mode the widget has no layout for advertises a
   * control that leads nowhere.
   */
  displayModes?: McpUiDisplayMode[];
}

/** Host-bound actions a widget performs. */
export interface Bridge {
  /**
   * Run a tool on the originating server.
   *
   * Rejects on transport failure (evicted session, host refusal) and when the
   * host leaves the call unanswered; a tool that failed server-side resolves
   * with `isError` set instead.
   */
  callTool(call: { name: string; arguments: Record<string, unknown> }): Promise<ToolPayload>;
  /** Opens a URL in the host's browser; `false` when the host declined. */
  openLink(url: string): Promise<boolean>;
  /** Sends a user message into the conversation; `false` when it was rejected. */
  sendPrompt(text: string): Promise<boolean>;
  /**
   * Ask the host to switch display mode.
   *
   * Resolves with the mode that is actually in effect afterwards, which is not
   * necessarily the requested one: a host may grant something else, and one
   * that cannot answer at all leaves the widget where it was. Never rejects —
   * the caller renders against the resolved mode, so an unhandled rejection
   * would strand it between two layouts.
   */
  requestDisplayMode(mode: McpUiDisplayMode): Promise<McpUiDisplayMode>;
}

/**
 * How long the widget waits for a page it requested itself.
 *
 * A host that refuses widget-initiated tool calls may drop the request instead
 * of answering it — the call then never settles, and the list stays behind a
 * loading skeleton for the rest of the session. That is the one outcome the
 * widget must never produce, so an unanswered call is turned into a rejection
 * the caller can report. The server gives up on RIS after 30s, so everything
 * past this margin is the host rather than the search.
 */
const CALL_TIMEOUT_MS = 45_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reject when the host leaves a call unanswered, and never leak the timer. */
async function withDeadline<T>(call: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error('host did not answer the tool call'));
    }, CALL_TIMEOUT_MS);
  });

  try {
    return await Promise.race([call, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Concatenate the text blocks of a tool result, ignoring other modalities. */
function collectText(result: Record<string, unknown>): string {
  const content = result.content;
  if (!Array.isArray(content)) return '';

  return content
    .filter((block): block is { text: string } => isRecord(block) && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

/**
 * Read a tool result the widget requested itself.
 *
 * Step 1 of the acquisition order only. The host global is deliberately not
 * consulted here: it holds the result of the call that *mounted* the widget, so
 * falling back to it after a pagination call would silently re-render the page
 * the user just left instead of reporting that the new one never arrived.
 */
export function readToolResult(result: unknown): ToolPayload {
  if (!isRecord(result)) {
    return { structuredContent: null, source: 'missing', text: '', isError: false };
  }

  const structuredContent = result.structuredContent;
  const present = structuredContent !== undefined && structuredContent !== null;

  return {
    structuredContent: present ? structuredContent : null,
    source: present ? 'toolresult' : 'missing',
    text: collectText(result),
    isError: result.isError === true,
  };
}

/**
 * Read the sanctioned host global that carries the mounting tool's output.
 *
 * `@modelcontextprotocol/ext-apps@1.7.5` neither declares nor reads this global
 * — `grep -r "openai" node_modules/@modelcontextprotocol/ext-apps/dist` finds
 * nothing — so it cannot be typed from the SDK. It belongs to ChatGPT's own
 * Apps SDK (`window.openai.toolOutput`), which the live rendering gate (#45)
 * measured as the only channel there: ChatGPT mounts the widget and sends the
 * tool-result notification, but without `structuredContent`.
 *
 * Feature-detected, never sniffed: any host that exposes the global gets the
 * fallback, and a host that does not keeps working through step 1.
 */
function readHostGlobal(globals: unknown): unknown {
  if (!isRecord(globals)) return null;

  const openai = globals.openai;
  if (!isRecord(openai)) return null;

  const output = openai.toolOutput;
  return output === undefined ? null : output;
}

/**
 * Read the tool result that mounted the widget, across hosts.
 *
 * Acquisition order: (1) `structuredContent` on the notification — what
 * claude.ai delivers; (2) the host global — the normal path in ChatGPT;
 * (3) nothing, which the caller turns into a visible German notice.
 *
 * A result that failed server-side skips step 2: the host global would then
 * hold data from an unrelated earlier call, and the error prose in `text` is
 * the honest thing to show.
 */
export function readMountResult(result: unknown, globals: unknown = globalThis): ToolPayload {
  const fromResult = readToolResult(result);
  if (fromResult.source === 'toolresult' || fromResult.isError) return fromResult;

  const fromGlobal = readHostGlobal(globals);
  if (fromGlobal === null) return fromResult;

  return { ...fromResult, structuredContent: fromGlobal, source: 'host-global' };
}

/**
 * Read the host global that carries the mounting tool's *arguments*.
 *
 * ChatGPT's own Apps SDK mirrors the `toolinput` notification as
 * `window.openai.toolInput`, and a host may have it populated before the widget
 * subscribes to anything. Feature-detected exactly like {@link readHostGlobal}:
 * a host without the global keeps working through the event.
 */
export function readMountInput(globals: unknown = globalThis): Record<string, unknown> | null {
  if (!isRecord(globals)) return null;

  const openai = globals.openai;
  if (!isRecord(openai)) return null;

  const input = openai.toolInput;
  return isRecord(input) ? input : null;
}

/**
 * Adopt the host's look.
 *
 * Fonts are deliberately not adopted (`applyHostFonts`): the host CSS may
 * `@import` a webfont, which the widget's empty CSP forbids and which the
 * system font stack makes unnecessary.
 */
function applyHostContext(context: unknown): void {
  if (!isRecord(context)) return;

  const theme = context.theme;
  if (theme === 'light' || theme === 'dark') applyDocumentTheme(theme);

  const styles = context.styles;
  if (isRecord(styles) && isRecord(styles.variables)) {
    applyHostStyleVariables(styles.variables as Parameters<typeof applyHostStyleVariables>[0]);
  }
}

function rejected(result: unknown): boolean {
  return isRecord(result) && result.isError === true;
}

/**
 * Connect a widget to its host and return the actions it can perform.
 *
 * Listeners are attached before `connect()` so a host that delivers the tool
 * result inside the handshake cannot outrun the subscription. Rejects when the
 * handshake fails — the caller shows a notice and leaves the static marker in
 * place, which is what tells "never mounted" apart from "mounted, no data".
 */
export async function connectBridge(options: BridgeOptions, app?: HostApp): Promise<Bridge> {
  const host =
    app ??
    new App(
      { name: options.appName ?? 'ris-mcp-trefferliste', version: '1.0.0' },
      options.displayModes ? { availableDisplayModes: options.displayModes } : undefined,
    );

  host.addEventListener('toolresult', (params) => {
    options.onToolResult(readMountResult(params));
  });
  host.addEventListener('toolinput', (params) => {
    const args = isRecord(params) ? params.arguments : undefined;
    if (isRecord(args)) options.onToolInput?.(args);
  });
  host.addEventListener('hostcontextchanged', (context) => {
    applyHostContext(context);
    options.onHostContext?.(context);
  });

  await host.connect();

  const context = host.getHostContext();
  applyHostContext(context);
  options.onHostContext?.(context);

  return {
    async callTool(call): Promise<ToolPayload> {
      return readToolResult(await withDeadline(host.callServerTool(call)));
    },
    async openLink(url): Promise<boolean> {
      try {
        return !rejected(await host.openLink({ url }));
      } catch {
        return false;
      }
    },
    async sendPrompt(text): Promise<boolean> {
      try {
        return !rejected(
          await host.sendMessage({ role: 'user', content: [{ type: 'text', text }] }),
        );
      } catch {
        return false;
      }
    },
    async requestDisplayMode(mode): Promise<McpUiDisplayMode> {
      try {
        return (await host.requestDisplayMode({ mode })).mode;
      } catch {
        return host.getHostContext()?.displayMode ?? 'inline';
      }
    },
  };
}
