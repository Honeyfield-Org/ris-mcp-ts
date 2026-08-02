/**
 * Helper functions for MCP tool handlers.
 *
 * Extracted from server.ts to reduce file size and improve maintainability.
 */

import { RISAPIError, RISParsingError, RISTimeoutError } from './client.js';
import { formatSearchResults, truncateResponse } from './formatting.js';
import { parseSearchResults } from './parser.js';
import { type NormalizedSearchResults, limitToDokumenteProSeite } from './types.js';

// =============================================================================
// Error Handling
// =============================================================================

/**
 * Format an error response in German.
 */
export function formatErrorResponse(error: unknown): string {
  if (error instanceof RISTimeoutError) {
    return (
      '**Fehler:** Die Anfrage an das RIS hat zu lange gedauert.\n\n' +
      'Bitte versuche es erneut oder verwende spezifischere Suchparameter.'
    );
  }

  if (error instanceof RISParsingError) {
    return (
      '**Fehler:** Die Antwort des RIS konnte nicht verarbeitet werden.\n\n' +
      `Technische Details: ${error.message}`
    );
  }

  if (error instanceof RISAPIError) {
    const statusInfo = error.statusCode ? ` (Status: ${error.statusCode})` : '';
    return (
      `**Fehler:** Das RIS hat einen Fehler zurueckgegeben${statusInfo}.\n\n` +
      `Details: ${error.message}`
    );
  }

  return (
    '**Fehler:** Ein unerwarteter Fehler ist aufgetreten.\n\n' +
    `Details: ${error instanceof Error ? error.message : String(error)}`
  );
}

// =============================================================================
// Helper Functions for Code Deduplication
// =============================================================================

/** A plain text content block. */
export interface TextContent {
  type: 'text';
  text: string;
}

/**
 * A pointer to a resource the client can fetch itself instead of re-parsing text.
 *
 * No handler emits one at the moment: `ris_dokument` dropped its block because
 * claude.ai delivers a widget no tool-result event at all for a result that
 * carries one (#52, see DECISIONS.md). The type stays because that is a host
 * bug and the block is meant to come back once it is fixed.
 */
export interface ResourceLinkContent {
  type: 'resource_link';
  uri: string;
  name: string;
  mimeType?: string;
}

export type McpContent = TextContent | ResourceLinkContent;

/**
 * MCP tool response type with index signature for SDK compatibility.
 *
 * The content type is a parameter so the text-only helpers keep returning a
 * single-element tuple — callers can still reach `content[0].text` without
 * narrowing — while handlers that add further blocks use the default.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type McpToolResponse<C extends McpContent[] = McpContent[]> = {
  [x: string]: unknown;
  content: C;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/**
 * Create a standard MCP text response.
 */
export function createMcpResponse(text: string): McpToolResponse<[TextContent]> {
  return { content: [{ type: 'text' as const, text }] };
}

/**
 * Create an MCP error response.
 *
 * Per the MCP spec, errors during tool execution are reported inside the result
 * with `isError: true` (not as JSON-RPC protocol errors), so the model sees the
 * message and can self-correct. A search without hits is not an error.
 */
export function createErrorResponse(text: string): McpToolResponse<[TextContent]> {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

/**
 * Create a validation error response listing required parameters.
 */
export function createValidationErrorResponse(
  requiredParams: string[],
): McpToolResponse<[TextContent]> {
  const paramList = requiredParams.map((p) => `- \`${p}\``).join('\n');
  return createErrorResponse(
    '**Fehler:** Bitte gib mindestens einen Suchparameter an:\n' + paramList,
  );
}

/**
 * Check if any of the specified parameters has a truthy value.
 */
export function hasAnyParam(args: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => {
    const value = args[key];
    return value !== undefined && value !== null && value !== '';
  });
}

/**
 * Build base API parameters common to all search requests.
 */
export function buildBaseParams(
  applikation: string,
  limit: number,
  seite: number,
): Record<string, unknown> {
  return {
    Applikation: applikation,
    DokumenteProSeite: limitToDokumenteProSeite(limit),
    Seitennummer: seite,
  };
}

/**
 * Add optional parameters to the params object.
 * Only adds values that are truthy (not undefined, null, or empty string).
 */
export function addOptionalParams(
  params: Record<string, unknown>,
  mappings: [value: unknown, key: string][],
): void {
  for (const [value, key] of mappings) {
    if (value !== undefined && value !== null && value !== '') {
      params[key] = value;
    }
  }
}

/**
 * Build the `query` echo returned alongside a search result.
 *
 * Carries the tool's own name plus its validated arguments (Zod defaults
 * included), which is everything a client needs to re-issue the same search for
 * another page. Arguments the caller omitted are dropped rather than echoed as
 * `undefined`, so the echo only ever describes the search that actually ran.
 */
export function buildQueryEcho(
  tool: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const echo: Record<string, unknown> = { tool };
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined) {
      echo[key] = value;
    }
  }
  return echo;
}

/** Search function type for API calls */
export type SearchFunction = (
  params: Record<string, unknown>,
  timeout?: number,
  signal?: AbortSignal,
) => Promise<unknown>;

/**
 * Execute a search tool and return formatted results.
 * Handles the common try-catch, parsing, formatting, and truncation logic.
 *
 * The formatted text stays the primary payload; the parsed result is attached as
 * `structuredContent` so clients can consume the hits without re-parsing prose.
 * Error results carry no structured payload — there is no result to describe.
 *
 * `signal` is the MCP request's cancellation signal (`extra.signal`). It reaches
 * the outbound RIS request so an abandoned call stops upstream too; a cancelled
 * request then propagates the abort instead of being reported as a tool error,
 * since nobody is waiting to read it.
 *
 * `queryEcho` (see {@link buildQueryEcho}) is attached to the structured payload
 * so a client can page through the results without reconstructing the call. It is
 * required, not optional: a search tool added later could otherwise omit it and
 * silently strand its clients without pagination for that one tool.
 */
export async function executeSearchTool(
  searchFn: SearchFunction,
  params: Record<string, unknown>,
  responseFormat: 'markdown' | 'json',
  signal: AbortSignal | undefined,
  queryEcho: Record<string, unknown>,
): Promise<McpToolResponse<[TextContent]>> {
  try {
    const apiResponse = await searchFn(params, undefined, signal);
    const searchResult = parseSearchResults(apiResponse as NormalizedSearchResults);
    const formatted = formatSearchResults(searchResult, responseFormat);
    const result = truncateResponse(formatted);
    return {
      ...createMcpResponse(result),
      structuredContent: { ...searchResult, query: queryEcho },
    };
  } catch (e) {
    if (signal?.aborted) {
      throw e;
    }
    return createErrorResponse(formatErrorResponse(e));
  }
}
