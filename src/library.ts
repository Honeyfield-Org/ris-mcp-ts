/**
 * Library entry point (`ris-mcp-ts/library`): registers the RIS tools on a
 * server the host owns, without starting a transport.
 *
 * Hosts — such as a metered SaaS gateway — can inject
 * - `fetch`: the function every RIS request of a tool call goes through
 *   (shared cache, global rate limit),
 * - `wrapHandler`: a wrapper around each tool handler (auth context, quota),
 * - `documentCache`: the cache `ris_dokument` fills and `ris_dokument_abschnitt`
 *   pages through (share one across per-request servers in stateless hosting).
 *
 * Every successful result carries the CC BY 4.0 attribution and every tool
 * description the legal notice (see `attribution.ts`); every caught failure
 * carries its kind under {@link RIS_ERROR_META_KEY}.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { ATTRIBUTION, ATTRIBUTION_BLOCK, LEGAL_NOTICE } from './attribution.js';
import { createDocumentCache, type DocumentCache } from './document-cache.js';
import { runWithFetch, type FetchLike } from './fetch-context.js';
import { registerToolsOn } from './tools/index.js';

export {
  ATTRIBUTION,
  ATTRIBUTION_LICENSE,
  ATTRIBUTION_SOURCE_URL,
  ATTRIBUTION_TEXT,
  LEGAL_NOTICE,
  type Attribution,
} from './attribution.js';
export { RISAPIError, RISParsingError, RISTimeoutError } from './client.js';
export { createDocumentCache, type CachedDocument, type DocumentCache } from './document-cache.js';
export type { FetchLike } from './fetch-context.js';
export { RIS_ERROR_META_KEY, type RisErrorKind } from './helpers.js';

export const RIS_TOOL_NAMES = [
  'ris_bundesrecht',
  'ris_landesrecht',
  'ris_judikatur',
  'ris_bundesgesetzblatt',
  'ris_landesgesetzblatt',
  'ris_regierungsvorlagen',
  'ris_dokument',
  'ris_dokument_abschnitt',
  'ris_bezirke',
  'ris_gemeinden',
  'ris_sonstige',
  'ris_history',
  'ris_verordnungen',
] as const;

/** App-only paging through a document `ris_dokument` already returned — a host should not bill it again. */
export const UNCOUNTED_TOOLS = ['ris_dokument_abschnitt'] as const;

const UNCOUNTED: ReadonlySet<string> = new Set(UNCOUNTED_TOOLS);

export type ToolHandler = (args: unknown, extra: unknown) => Promise<CallToolResult>;

export interface RisToolOptions {
  fetch?: FetchLike;
  wrapHandler?: (toolName: string, handler: ToolHandler) => ToolHandler;
  documentCache?: DocumentCache;
}

interface ToolConfig {
  description?: string;
  [key: string]: unknown;
}

/**
 * Adds the attribution to a successful result; leaves errors untouched.
 *
 * Appended to the last text block rather than as a block of its own (several
 * hosts render exactly one text block), and as `structuredContent.attribution`.
 * `structuredContent.text` stays as the tool built it: its offsets and
 * `total_length` are what `ris_dokument_abschnitt` pages by. `textBlock: false`
 * leaves the text alone — for the app-only paging tool, whose sections the
 * viewer reassembles into the document.
 */
export function withAttribution(
  result: CallToolResult,
  opts: { textBlock?: boolean } = {},
): CallToolResult {
  if (result.isError) return result;
  const content = [...result.content];
  if (opts.textBlock !== false) {
    const last = content.length - 1;
    const lastBlock = content[last];
    if (lastBlock?.type === 'text') {
      content[last] = { ...lastBlock, text: `${lastBlock.text}\n\n---\n${ATTRIBUTION_BLOCK}` };
    } else {
      content.push({ type: 'text', text: ATTRIBUTION_BLOCK });
    }
  }
  const structured = result.structuredContent;
  return {
    ...result,
    content,
    ...(structured === undefined
      ? {}
      : { structuredContent: { ...structured, attribution: ATTRIBUTION } }),
  };
}

/** Registers all RIS tools and their widget resources on `server`. */
export function registerRisTools(server: McpServer, options: RisToolOptions = {}): void {
  const register = server.registerTool.bind(server) as (
    name: string,
    config: ToolConfig,
    handler: ToolHandler,
  ) => unknown;
  const proxy = new Proxy(server, {
    get(target, prop, receiver): unknown {
      if (prop !== 'registerTool') return Reflect.get(target, prop, receiver);
      return (name: string, config: ToolConfig, handler: ToolHandler): unknown => {
        const base: ToolHandler = (args, extra) =>
          runWithFetch(options.fetch, async () =>
            withAttribution(await handler(args, extra), { textBlock: !UNCOUNTED.has(name) }),
          );
        const wrapped = options.wrapHandler ? options.wrapHandler(name, base) : base;
        const description = config.description
          ? `${config.description}\n\n${LEGAL_NOTICE}`
          : LEGAL_NOTICE;
        return register(name, { ...config, description }, wrapped);
      };
    },
  });
  registerToolsOn(proxy, options.documentCache ?? createDocumentCache());
}
