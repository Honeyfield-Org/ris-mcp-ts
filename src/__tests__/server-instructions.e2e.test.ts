/**
 * The server-level instructions travel in the `initialize` result, so they are
 * checked through a real Client rather than by reading the constant.
 *
 * Two guards beyond "they arrive": every `ris_*` name the text mentions has to
 * be a tool the server really registers (a renamed tool must not leave the model
 * with a dead pointer), and the text stays small, because every conversation of
 * every host that honours instructions pays for it in tokens.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { SERVER_INSTRUCTIONS } from '../instructions.js';
import { server } from '../server.js';

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

describe('server instructions', () => {
  it('are delivered in the initialize result', () => {
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
  });

  it('only name tools that exist', async () => {
    const { tools } = await client.listTools();
    const registered = new Set(tools.map((tool) => tool.name));
    const mentioned = SERVER_INSTRUCTIONS.match(/ris_[a-z_]+/g) ?? [];

    expect(mentioned.length).toBeGreaterThan(0);
    for (const name of mentioned) {
      expect(registered, `${name} is mentioned in the instructions`).toContain(name);
    }
  });

  it('keep the viewer-only chunk tool out of the model’s sight', () => {
    expect(SERVER_INSTRUCTIONS).not.toContain('ris_dokument_abschnitt');
  });

  it('stay within a token budget worth paying on every conversation', () => {
    expect(SERVER_INSTRUCTIONS.length).toBeLessThan(2000);
  });
});
