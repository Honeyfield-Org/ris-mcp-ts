/**
 * MCP Apps widget registration.
 *
 * The search tools point at a single HTML resource that hosts render as an
 * interactive Trefferliste. Registering it switches the `resources` capability
 * on in the initialize handshake; non-UI clients simply ignore it.
 */

import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  type McpUiAppResourceConfig,
} from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { TREFFERLISTE_HTML } from './generated/trefferliste-html.js';

/** URI of the Trefferliste widget, referenced by every search tool. */
export const SEARCH_WIDGET_RESOURCE_URI = 'ui://ris-mcp/trefferliste';

/**
 * UI metadata for the search tools.
 *
 * `csp` and `permissions` deliberately do not appear here: `McpUiToolMeta`
 * types both as `never` because hosts read them from the resource and ignore
 * them on the tool. `registerAppTool` mirrors `resourceUri` onto the legacy
 * flat `ui/resourceUri` key for older hosts.
 */
export const SEARCH_WIDGET_META = {
  ui: { resourceUri: SEARCH_WIDGET_RESOURCE_URI },
};

/**
 * Resource declaration for the widget.
 *
 * The bundle is fully self-contained (Vite singlefile), so every CSP directive
 * is declared empty rather than omitted: hosts flag an undeclared policy as
 * "CSP off" instead of treating it as "needs nothing".
 */
const SEARCH_WIDGET_RESOURCE_CONFIG: McpUiAppResourceConfig = {
  description: 'Interaktive Trefferliste fuer RIS-Suchergebnisse',
  _meta: {
    ui: {
      csp: {
        connectDomains: [],
        resourceDomains: [],
        frameDomains: [],
        baseUriDomains: [],
      },
    },
  },
};

/**
 * Register the widget resources on the given MCP server.
 *
 * Hosts read the CSP from the `resources/read` content item and fall back to
 * the `resources/list` entry, so both carry the same declaration.
 */
export function registerWidgetResources(server: McpServer): void {
  registerAppResource(
    server,
    'RIS Trefferliste',
    SEARCH_WIDGET_RESOURCE_URI,
    SEARCH_WIDGET_RESOURCE_CONFIG,
    () => ({
      contents: [
        {
          uri: SEARCH_WIDGET_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: TREFFERLISTE_HTML,
          _meta: SEARCH_WIDGET_RESOURCE_CONFIG._meta,
        },
      ],
    }),
  );
}
