/**
 * MCP Apps widget registration.
 *
 * Two HTML resources: the search tools point at an interactive Trefferliste,
 * `ris_dokument` at a document viewer. Registering them switches the
 * `resources` capability on in the initialize handshake; non-UI clients simply
 * ignore both.
 */

import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  type McpUiAppResourceConfig,
} from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { TREFFERLISTE_HTML } from './generated/trefferliste-html.js';
import { VIEWER_HTML } from './generated/viewer-html.js';

/** URI of the Trefferliste widget, referenced by every search tool. */
export const SEARCH_WIDGET_RESOURCE_URI = 'ui://ris-mcp/trefferliste';

/** URI of the document viewer, referenced by `ris_dokument`. */
export const VIEWER_WIDGET_RESOURCE_URI = 'ui://ris-mcp/viewer';

/**
 * UI metadata for the search tools.
 *
 * `csp` and `permissions` deliberately do not appear here: `McpUiToolMeta`
 * types both as `never` because hosts read them from the resource and ignore
 * them on the tool. `registerAppTool` mirrors `resourceUri` onto the legacy
 * flat `ui/resourceUri` key for older hosts.
 *
 * `openai/widgetAccessible` is ChatGPT's own gate for tool calls the widget
 * issues itself — the pagination buttons. The standard field for that is
 * `_meta.ui.visibility`, which defaults to `["model", "app"]` and therefore
 * already grants it (ext-apps `McpUiToolMeta.visibility`), but ChatGPT's
 * compatibility field defaults to `false` and is documented as the one
 * "existing UI integrations" use ("`_meta` fields on tool descriptor",
 * developers.openai.com/plugins/reference). Hosts that do not know the key
 * ignore it, so the standard path stays untouched.
 */
export const SEARCH_WIDGET_META = {
  ui: { resourceUri: SEARCH_WIDGET_RESOURCE_URI },
  'openai/widgetAccessible': true,
};

/**
 * UI metadata for the document viewer's chunk tool.
 *
 * `visibility: ["app"]` is the standard way to say "only the app may call this,
 * the model must not see it" (ext-apps `McpUiToolMeta.visibility`, default
 * `["model", "app"]`). It is a declaration, not an enforcement: nothing in the
 * SDK or ext-apps removes the tool from `tools/list`, so a host that does not
 * know the key shows it to the model like any other tool. That is survivable
 * here — the tool answers a model call with real document text — but it is why
 * its description points at `ris_dokument` instead.
 *
 * `openai/widgetAccessible` is ChatGPT's own gate for widget-initiated calls and
 * defaults to `false`; without it the viewer could not load a single further
 * section there.
 *
 * No `resourceUri`: this tool feeds the viewer that is already open, it does not
 * open one. Pointing it at the resource would invite hosts to render a fresh
 * widget per section.
 */
export const DOCUMENT_CHUNK_META = {
  ui: { visibility: ['app'] },
  'openai/widgetAccessible': true,
};

/**
 * UI metadata for `ris_dokument`.
 *
 * No `openai/widgetAccessible`: that flag gates the calls a widget issues
 * *itself*, and the viewer never calls `ris_dokument` — it loads further
 * sections through `ris_dokument_abschnitt`, which carries the flag. Putting it
 * here would grant an access nothing uses.
 *
 * Attaching this changes the `tools/list` entry and nothing else:
 * `registerAppTool` normalises `_meta` and hands the handler through untouched,
 * so the tool's response stays byte for byte what it was.
 */
export const VIEWER_WIDGET_META = {
  ui: { resourceUri: VIEWER_WIDGET_RESOURCE_URI },
};

/**
 * The policy the widgets need: nothing.
 *
 * Both bundles are fully self-contained (Vite singlefile), so every directive is
 * declared empty rather than omitted: hosts flag an undeclared policy as "CSP
 * off" instead of treating it as "needs nothing".
 */
const WIDGET_CSP = {
  connectDomains: [],
  resourceDomains: [],
  frameDomains: [],
  baseUriDomains: [],
};

/**
 * The same policy under ChatGPT's own key, which is what it reads.
 *
 * `_meta["openai/widgetCSP"]` is documented as the legacy compatibility key
 * with snake_case field names, superseded by `_meta.ui.csp` but still the one
 * ChatGPT honours — with `_meta.ui.csp` alone the widget kept its "CSP off"
 * badge there (live measurement #60), while claude.ai reads the standard key.
 *
 * Two fields of {@link WIDGET_CSP} have no counterpart here and are therefore
 * left out rather than invented: `baseUriDomains`, which the legacy key does not
 * define, and `redirect_domains`, which is not a mirror of anything — it
 * allowlists targets for ChatGPT's `openExternal`, so declaring it empty would
 * newly forbid what the host currently decides for itself, and „Im RIS öffnen"
 * is exactly such a link.
 *
 * Source: "Component resource `_meta` fields", developers.openai.com/plugins/reference.
 */
const WIDGET_CSP_CHATGPT = {
  connect_domains: [],
  resource_domains: [],
  frame_domains: [],
};

/**
 * Resource declaration for a widget.
 *
 * Carries both spellings of the same empty policy — every host that reads one
 * of them ends up applying the identical rules. No `domain`: omitting it is
 * verified safe, and a wrong value stops the widget rendering at all.
 */
function widgetResourceConfig(description: string): McpUiAppResourceConfig {
  return {
    description,
    _meta: {
      ui: { csp: WIDGET_CSP },
      'openai/widgetCSP': WIDGET_CSP_CHATGPT,
    },
  };
}

const SEARCH_WIDGET_RESOURCE_CONFIG = widgetResourceConfig(
  'Interactive result list for RIS search results',
);

const VIEWER_WIDGET_RESOURCE_CONFIG = widgetResourceConfig(
  'Reader for a single RIS document, with an outline and lazily loaded sections',
);

/**
 * Register the widget resources on the given MCP server.
 *
 * Hosts read the CSP from the `resources/read` content item and fall back to
 * the `resources/list` entry, so both carry the same declaration.
 */
export function registerWidgetResources(server: McpServer): void {
  const widgets: [string, string, McpUiAppResourceConfig, string][] = [
    [
      'RIS Trefferliste',
      SEARCH_WIDGET_RESOURCE_URI,
      SEARCH_WIDGET_RESOURCE_CONFIG,
      TREFFERLISTE_HTML,
    ],
    ['RIS Dokument', VIEWER_WIDGET_RESOURCE_URI, VIEWER_WIDGET_RESOURCE_CONFIG, VIEWER_HTML],
  ];

  for (const [name, uri, config, html] of widgets) {
    registerAppResource(server, name, uri, config, () => ({
      contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: html, _meta: config._meta }],
    }));
  }
}
