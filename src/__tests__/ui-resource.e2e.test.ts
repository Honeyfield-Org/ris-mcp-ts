/**
 * E2E tests for the MCP Apps registration: the widget resource and the UI
 * metadata that points the 11 search tools at it.
 *
 * These assertions pin the wire contract #49 builds on, so they go through a
 * real Client over InMemoryTransport rather than inspecting the registry.
 *
 * On CSP: the ext-apps typings put `csp` on the *resource*, not the tool —
 * `McpUiToolMeta.csp` is declared `never` with the note that hosts read the
 * value from the `resources/read` content item (falling back to the
 * `resources/list` entry) and ignore it on the tool. We therefore declare it in
 * both of those places and assert it is absent from the tools.
 */

import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { server } from '../server.js';

// =============================================================================
// Setup: MCP Client connected to server via InMemoryTransport
// =============================================================================

let client: Client;
let clientTransport: InMemoryTransport;
let serverTransport: InMemoryTransport;

beforeAll(async () => {
  [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  client = new Client({ name: 'test-client', version: '1.0.0' });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await server.close();
});

const WIDGET_URI = 'ui://ris-mcp/trefferliste';

/** The 11 search tools that render the Trefferliste widget. */
const SEARCH_TOOLS = [
  'ris_bundesrecht',
  'ris_landesrecht',
  'ris_judikatur',
  'ris_bundesgesetzblatt',
  'ris_landesgesetzblatt',
  'ris_regierungsvorlagen',
  'ris_bezirke',
  'ris_gemeinden',
  'ris_sonstige',
  'ris_history',
  'ris_verordnungen',
];

/** The CSP every host should apply: the widget is fully self-contained. */
const EXPECTED_CSP = {
  connectDomains: [],
  resourceDomains: [],
  frameDomains: [],
  baseUriDomains: [],
};

/** `_meta.ui` as it arrives over the wire, before narrowing. */
interface WireUiMeta {
  resourceUri?: string;
  csp?: unknown;
  domain?: unknown;
}

interface WireMetaCarrier {
  _meta?: Record<string, unknown>;
}

function uiMeta(carrier: WireMetaCarrier | undefined): WireUiMeta | undefined {
  return carrier?._meta?.ui as WireUiMeta | undefined;
}

// =============================================================================
// 1. Widget Resource
// =============================================================================

describe('widget resource', () => {
  it('should list the Trefferliste widget', async () => {
    const { resources } = await client.listResources();

    const widget = resources.find((resource) => resource.uri === WIDGET_URI);
    expect(widget).toBeDefined();
  });

  it('should serve the generated single-file document under the MCP Apps MIME type', async () => {
    const content = await client.readResource({ uri: WIDGET_URI });

    expect(content.contents[0].mimeType).toBe(RESOURCE_MIME_TYPE);
    // Inlining itself is guarded by ui-template.test.ts — this only proves the
    // generated template is what gets served.
    expect((content.contents[0] as { text: string }).text).toContain('nojs-marker');
  });

  it('should declare an explicit CSP on the resource content item', async () => {
    const content = await client.readResource({ uri: WIDGET_URI });

    expect(uiMeta(content.contents[0] as WireMetaCarrier)?.csp).toEqual(EXPECTED_CSP);
  });

  it('should declare the same CSP on the listing entry hosts fall back to', async () => {
    const { resources } = await client.listResources();
    const widget = resources.find((resource) => resource.uri === WIDGET_URI);

    expect(uiMeta(widget)?.csp).toEqual(EXPECTED_CSP);
  });

  it('should set no domain on the resource', async () => {
    const { resources } = await client.listResources();
    const widget = resources.find((resource) => resource.uri === WIDGET_URI);
    const content = await client.readResource({ uri: WIDGET_URI });

    expect(uiMeta(widget)).not.toHaveProperty('domain');
    expect(uiMeta(content.contents[0] as WireMetaCarrier)).not.toHaveProperty('domain');
  });
});

// =============================================================================
// 2. Tool UI Metadata
// =============================================================================

describe('tool ui metadata', () => {
  it('should point every search tool at the widget resource', async () => {
    const { tools } = await client.listTools();

    expect(tools).toHaveLength(12);
    for (const name of SEARCH_TOOLS) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(uiMeta(tool)?.resourceUri, `${name} is missing _meta.ui.resourceUri`).toBe(WIDGET_URI);
    }
  });

  it('should mirror the resource URI onto the legacy flat key for older hosts', async () => {
    const { tools } = await client.listTools();

    for (const name of SEARCH_TOOLS) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool?._meta?.['ui/resourceUri'], `${name} is missing the legacy key`).toBe(WIDGET_URI);
    }
  });

  it('should declare no widget on ris_dokument', async () => {
    const { tools } = await client.listTools();
    const dokument = tools.find((tool) => tool.name === 'ris_dokument');

    expect(dokument).toBeDefined();
    expect(uiMeta(dokument)).toBeUndefined();
    expect(dokument?._meta?.['ui/resourceUri']).toBeUndefined();
  });

  it('should carry no csp on the tools — hosts read it from the resource', async () => {
    const { tools } = await client.listTools();

    for (const tool of tools) {
      // A tool without `_meta.ui` at all satisfies this just as well.
      expect(uiMeta(tool) ?? {}, `${tool.name} declares csp the host ignores`).not.toHaveProperty(
        'csp',
      );
    }
  });

  it('should set no domain on any tool', async () => {
    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(uiMeta(tool) ?? {}, `${tool.name} declares a domain`).not.toHaveProperty('domain');
    }
  });
});

// =============================================================================
// 3. Annotations
// =============================================================================

describe('tool annotations', () => {
  it('should mark all 12 tools read-only, open-world and non-destructive', async () => {
    const { tools } = await client.listTools();

    expect(tools).toHaveLength(12);
    for (const tool of tools) {
      expect(tool.annotations, `${tool.name} has wrong annotations`).toMatchObject({
        readOnlyHint: true,
        openWorldHint: true,
        destructiveHint: false,
      });
    }
  });
});
