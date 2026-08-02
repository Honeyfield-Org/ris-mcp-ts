/**
 * Host plumbing shared by every RIS widget.
 *
 * Wraps the official `App` class from `@modelcontextprotocol/ext-apps`: it owns
 * the handshake, the theme wiring and — most importantly — the rule for where a
 * tool result's `structuredContent` comes from, which differs per host.
 */

import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';

/**
 * The part of the ext-apps `App` surface the bridge uses.
 *
 * Derived from the real class rather than restated, so a signature change in
 * the SDK breaks the build here instead of at runtime in a host — and so tests
 * can hand in a stub that is checked against the same shape.
 */
export type HostApp = Pick<
  App,
  'addEventListener' | 'callServerTool' | 'connect' | 'getHostContext' | 'openLink' | 'sendMessage'
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
}

/** Host-bound actions a widget performs. */
export interface Bridge {
  /**
   * Run a tool on the originating server.
   *
   * Rejects on transport failure (evicted session, host refusal); a tool that
   * failed server-side resolves with `isError` set instead.
   */
  callTool(call: { name: string; arguments: Record<string, unknown> }): Promise<ToolPayload>;
  /** Opens a URL in the host's browser; `false` when the host declined. */
  openLink(url: string): Promise<boolean>;
  /** Sends a user message into the conversation; `false` when it was rejected. */
  sendPrompt(text: string): Promise<boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
export async function connectBridge(
  options: BridgeOptions,
  app: HostApp = new App({ name: 'ris-mcp-trefferliste', version: '1.0.0' }),
): Promise<Bridge> {
  app.addEventListener('toolresult', (params) => {
    options.onToolResult(readMountResult(params));
  });
  app.addEventListener('hostcontextchanged', applyHostContext);

  await app.connect();
  applyHostContext(app.getHostContext());

  return {
    async callTool(call): Promise<ToolPayload> {
      return readToolResult(await app.callServerTool(call));
    },
    async openLink(url): Promise<boolean> {
      try {
        return !rejected(await app.openLink({ url }));
      } catch {
        return false;
      }
    },
    async sendPrompt(text): Promise<boolean> {
      try {
        return !rejected(
          await app.sendMessage({ role: 'user', content: [{ type: 'text', text }] }),
        );
      } catch {
        return false;
      }
    },
  };
}
