/**
 * Guards the Claude Desktop extension manifest (mcpb/manifest.json).
 *
 * The manifest lists the tools by hand, because Claude Desktop shows that list
 * before the server has ever run. A tool added to the server without a manifest
 * entry, or one renamed, would leave the extension page lying — so the list is
 * compared with what a real Client sees on `tools/list`.
 *
 * The version is not checked: `scripts/build-mcpb.mjs` takes it from package.json
 * when it packs, so the template carries a placeholder on purpose.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { server } from '../server.js';

const MCPB_DIR = resolve(import.meta.dirname, '../../mcpb');

interface Manifest {
  manifest_version: string;
  name: string;
  icon: string;
  server: { type: string; entry_point: string; mcp_config: { command: string; args: string[] } };
  tools: { name: string; description: string }[];
  tools_generated: boolean;
  compatibility: { runtimes: { node: string } };
}

const manifest = JSON.parse(readFileSync(resolve(MCPB_DIR, 'manifest.json'), 'utf8')) as Manifest;

let client: Client;

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await server.close();
});

describe('mcpb manifest', () => {
  it('lists exactly the tools the server registers', async () => {
    const { tools } = await client.listTools();

    expect(manifest.tools.map((t) => t.name).sort()).toEqual(tools.map((t) => t.name).sort());
    expect(manifest.tools_generated).toBe(false);
  });

  it('describes every tool', () => {
    for (const tool of manifest.tools) {
      expect(tool.description.length, tool.name).toBeGreaterThan(10);
    }
  });

  it('starts the compiled stdio entry point from the extension directory', () => {
    expect(manifest.server.type).toBe('node');
    expect(manifest.server.entry_point).toBe('dist/index.js');
    expect(manifest.server.mcp_config.command).toBe('node');
    expect(manifest.server.mcp_config.args).toEqual(['${__dirname}/dist/index.js']);
  });

  it('ships its icon', () => {
    expect(existsSync(resolve(MCPB_DIR, manifest.icon))).toBe(true);
  });

  it('asks for a Node version the server really runs on', () => {
    // AbortSignal.any (cancellation) needs 20.3; the 20.19 in package.json is
    // the build floor for vite and does not apply to a packaged server.
    expect(manifest.compatibility.runtimes.node).toBe('>=20.3.0');
  });
});
