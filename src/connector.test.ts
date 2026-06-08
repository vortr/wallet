import { describe, expect, it } from 'vitest';
import { createConnector, parseBuildSwap, type ToolCallResult } from './connector.js';

const BUILD_BODY = {
  payload: { chain: 'base', from: '0x0000000000000000000000000000000000000001', calls: [{ to: '0xabc', data: '0x', value: '0x0' }] },
  summary: {
    sell: { token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '5000000' },
    buyMin: { token: '0x4200000000000000000000000000000000000006', amount: '1880000000000000' },
    taker: '0x0000000000000000000000000000000000000001',
    expiresAt: 9999999999999,
  },
};

function okResult(body: unknown): ToolCallResult {
  return { content: [{ type: 'text', text: JSON.stringify(body) }] };
}

describe('parseBuildSwap', () => {
  it('extracts payload + summary from a tool result', () => {
    const r = parseBuildSwap(okResult(BUILD_BODY));
    expect(r.payload.calls).toHaveLength(1);
    expect(r.summary.expiresAt).toBe(9999999999999);
  });

  it('throws on an error result', () => {
    expect(() => parseBuildSwap({ content: [{ type: 'text', text: 'no route' }], isError: true })).toThrow();
  });

  it('throws when the body lacks payload/summary', () => {
    expect(() => parseBuildSwap(okResult({ nope: true }))).toThrow(/payload/);
  });
});

describe('createConnector', () => {
  it('buildSwap forwards args to the injected tool caller and parses the result', async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const connector = createConnector(
      { apiBase: 'https://x/mcp', site: 'https://x' },
      {
        callTool: async (name, args) => {
          calls.push({ name, args });
          return okResult(BUILD_BODY);
        },
      },
    );
    const r = await connector.buildSwap({ sellToken: 'USDC', buyToken: 'ETH', amount: '5000000', taker: '0x0000000000000000000000000000000000000001' });
    expect(calls[0]?.name).toBe('build_swap');
    expect(calls[0]?.args.sellToken).toBe('USDC');
    expect(r.summary.sell.amount).toBe('5000000');
  });

  it('priceUsd fetches /api/prices and returns the single token price', async () => {
    let url = '';
    const connector = createConnector(
      { apiBase: 'https://x/mcp', site: 'https://x' },
      {
        fetchImpl: async (u) => {
          url = u;
          return { ok: true, json: async () => ({ prices: { '0x4200000000000000000000000000000000000006': { price: 2500 } } }) };
        },
      },
    );
    const price = await connector.priceUsd('0x4200000000000000000000000000000000000006');
    expect(price).toBe(2500);
    expect(url).toBe('https://x/api/prices?tokens=0x4200000000000000000000000000000000000006');
  });

  it('getQuote forwards to the get_quote tool and parses the JSON result', async () => {
    const connector = createConnector(
      { apiBase: 'https://x/mcp', site: 'https://x' },
      { callTool: async (name) => okResult({ tool: name, minBuyAmount: '1880000000000000' }) },
    );
    const q = (await connector.getQuote({
      sellToken: 'USDC', buyToken: 'ETH', amount: '5000000',
      taker: '0x0000000000000000000000000000000000000001',
    })) as { tool: string; minBuyAmount: string };
    expect(q.tool).toBe('get_quote');
    expect(q.minBuyAmount).toBe('1880000000000000');
  });

  it('priceUsd throws when no price is returned', async () => {
    const connector = createConnector(
      { apiBase: 'https://x/mcp', site: 'https://x' },
      { fetchImpl: async () => ({ ok: true, json: async () => ({ prices: {} }) }) },
    );
    await expect(connector.priceUsd('0xdead')).rejects.toThrow(/price/);
  });
});
