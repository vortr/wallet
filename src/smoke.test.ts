import { afterEach, beforeEach, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from './server.js';

const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const saved = { ...process.env };
beforeEach(() => { process.env.VORTR_SIGNER_KEY = KEY; });
afterEach(() => { process.env = { ...saved }; });

it('constructs an McpServer when the key is set', () => {
  expect(createServer().constructor.name).toBe('McpServer');
});

it('throws without the signing key', () => {
  delete process.env.VORTR_SIGNER_KEY;
  expect(() => createServer()).toThrow(/VORTR_SIGNER_KEY/);
});

it('exposes exactly the 6 wallet tools over a transport', async () => {
  const server = createServer();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientT);
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name).sort()).toEqual(['execute_swap', 'get_quote', 'prepare_swap', 'search_tokens', 'swap_status', 'wallet_address']);
  await client.close();
});
