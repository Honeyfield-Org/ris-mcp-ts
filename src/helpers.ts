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

/** MCP tool response type with index signature for SDK compatibility */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type McpToolResponse = {
  [x: string]: unknown;
  content: [{ type: 'text'; text: string }];
  isError?: boolean;
};

/**
 * Create a standard MCP text response.
 */
export function createMcpResponse(text: string): McpToolResponse {
  return { content: [{ type: 'text' as const, text }] };
}

/**
 * Create an MCP error response.
 *
 * Per the MCP spec, errors during tool execution are reported inside the result
 * with `isError: true` (not as JSON-RPC protocol errors), so the model sees the
 * message and can self-correct. A search without hits is not an error.
 */
export function createErrorResponse(text: string): McpToolResponse {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

/**
 * Create a validation error response listing required parameters.
 */
export function createValidationErrorResponse(requiredParams: string[]): McpToolResponse {
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

/** Search function type for API calls */
export type SearchFunction = (params: Record<string, unknown>) => Promise<unknown>;

/**
 * Execute a search tool and return formatted results.
 * Handles the common try-catch, parsing, formatting, and truncation logic.
 */
export async function executeSearchTool(
  searchFn: SearchFunction,
  params: Record<string, unknown>,
  responseFormat: 'markdown' | 'json',
): Promise<McpToolResponse> {
  try {
    const apiResponse = await searchFn(params);
    const searchResult = parseSearchResults(apiResponse as NormalizedSearchResults);
    const formatted = formatSearchResults(searchResult, responseFormat);
    const result = truncateResponse(formatted);
    return createMcpResponse(result);
  } catch (e) {
    return createErrorResponse(formatErrorResponse(e));
  }
}
