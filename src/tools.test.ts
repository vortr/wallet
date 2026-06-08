import { describe, expect, it, vi } from 'vitest';
import {
  walletAddressHandler,
  prepareSwapHandler,
  executeSwapHandler,
  swapStatusHandler,
  searchTokensHandler,
  getQuoteHandler,
  type ToolDeps,
} from './tools.js';
import { PendingStore } from './pending.js';
import type { Address, Hex } from 'viem';
import type { BuildSwapResult, Call } from '@vortr/core';

const TAKER = '0x0000000000000000000000000000000000000001' as Address;
const CALLS: Call[] = [{ to: '0x4200000000000000000000000000000000000006', data: '0xswap', value: '0x0' }];
function buildResult(amount: string): BuildSwapResult {
  return {
    payload: { chain: 'base', from: TAKER, calls: CALLS },
    summary: {
      sell: { token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount },
      buyMin: { token: '0x4200000000000000000000000000000000000006', amount: '1880000000000000' },
      taker: TAKER,
      expiresAt: 9_999_999_999_999,
    },
  };
}

function makeDeps(over: Partial<ToolDeps> = {}): ToolDeps {
  return {
    signer: {
      address: TAKER,
      balanceOf: vi.fn(async () => 10n ** 36n), // funded by default
      sendCallsSequential: vi.fn(async () => '0xfinal' as Hex),
      getStatus: vi.fn(async () => ({ status: 'confirmed' as const, blockNumber: '7' })),
    },
    connector: {
      buildSwap: vi.fn(async (args) => buildResult(args.amount)),
      priceUsd: vi.fn(async () => 2500),
      getQuote: vi.fn(async (args) => ({ buyAmount: '1900000000000000', minBuyAmount: '1880000000000000', taker: args.taker, amount: args.amount })),
    },
    pending: new PendingStore(() => 1000),
    ...over,
  };
}

function parse(content: { content: { type: 'text'; text: string }[] }): any {
  return JSON.parse(content.content[0]!.text);
}

describe('walletAddressHandler', () => {
  it('returns the signer address on Base', async () => {
    const out = parse(await walletAddressHandler(makeDeps()));
    expect(out).toEqual({ address: TAKER, chain: 'base' });
  });
});

describe('prepareSwapHandler', () => {
  it('amount path: calls build_swap with taker = signer.address, stores a token', async () => {
    const deps = makeDeps();
    const out = parse(await prepareSwapHandler({ sellToken: 'USDC', buyToken: 'ETH', amount: '5000000' }, deps));
    expect(deps.connector.buildSwap).toHaveBeenCalledWith(
      expect.objectContaining({ sellToken: 'USDC', buyToken: 'ETH', amount: '5000000', taker: TAKER }),
    );
    expect(typeof out.confirm_token).toBe('string');
    expect(out.summary.buyMin.amount).toBe('1880000000000000');
    expect(out.expiresAt).toBe(9_999_999_999_999);
  });

  it('usd path: prices the sell token then sizes base units (USDC ~1:1)', async () => {
    const deps = makeDeps({
      connector: { buildSwap: vi.fn(async (a) => buildResult(a.amount)), priceUsd: vi.fn(async () => 1), getQuote: vi.fn(async () => ({})) },
    });
    await prepareSwapHandler({ sellToken: 'USDC', buyToken: 'ETH', usd: 5 }, deps);
    expect(deps.connector.buildSwap).toHaveBeenCalledWith(expect.objectContaining({ amount: '5000000' }));
  });

  it('usd path with native ETH sell: prices via WETH', async () => {
    const priceUsd = vi.fn(async () => 2500);
    const deps = makeDeps({ connector: { buildSwap: vi.fn(async (a) => buildResult(a.amount)), priceUsd, getQuote: vi.fn(async () => ({})) } });
    await prepareSwapHandler({ sellToken: 'ETH', buyToken: 'USDC', usd: 5 }, deps);
    expect(priceUsd).toHaveBeenCalledWith('0x4200000000000000000000000000000000000006');
    expect(deps.connector.buildSwap).toHaveBeenCalledWith(expect.objectContaining({ amount: '2000000000000000' }));
  });

  it('rejects when neither amount nor usd is provided', async () => {
    const out = parse(await prepareSwapHandler({ sellToken: 'USDC', buyToken: 'ETH' }, makeDeps()));
    expect(out.error).toMatch(/amount.*usd/i);
  });

  it('defaults slippage to 25 bps when the caller omits it, but respects an explicit value', async () => {
    const deps = makeDeps();
    await prepareSwapHandler({ sellToken: 'USDC', buyToken: 'ETH', amount: '5000000' }, deps);
    expect(deps.connector.buildSwap).toHaveBeenCalledWith(expect.objectContaining({ slippageBps: 25 }));

    const deps2 = makeDeps();
    await prepareSwapHandler({ sellToken: 'USDC', buyToken: 'ETH', amount: '5000000', slippageBps: 100 }, deps2);
    expect(deps2.connector.buildSwap).toHaveBeenCalledWith(expect.objectContaining({ slippageBps: 100 }));
  });

  it('preflight: rejects when wallet balance < sell amount, without building or storing', async () => {
    const deps = makeDeps({
      signer: {
        address: TAKER,
        balanceOf: vi.fn(async () => 0n),
        sendCallsSequential: vi.fn(async () => '0xfinal' as Hex),
        getStatus: vi.fn(async () => ({ status: 'confirmed' as const, blockNumber: '7' })),
      },
    });
    const out = parse(await prepareSwapHandler({ sellToken: 'USDC', buyToken: 'ETH', amount: '5000000' }, deps));
    expect(out.error).toMatch(/insufficient/i);
    expect(out.error).toMatch(/USDC/);
    expect(deps.connector.buildSwap).not.toHaveBeenCalled();
  });

  it('preflight is best-effort: a failing balance read does NOT block the swap', async () => {
    const deps = makeDeps({
      signer: {
        address: TAKER,
        balanceOf: vi.fn(async () => { throw new Error('rpc down'); }),
        sendCallsSequential: vi.fn(async () => '0xfinal' as Hex),
        getStatus: vi.fn(async () => ({ status: 'confirmed' as const, blockNumber: '7' })),
      },
    });
    const out = parse(await prepareSwapHandler({ sellToken: 'USDC', buyToken: 'ETH', amount: '5000000' }, deps));
    expect(typeof out.confirm_token).toBe('string');
    expect(deps.connector.buildSwap).toHaveBeenCalled();
  });
});

describe('executeSwapHandler', () => {
  it('broadcasts the stored calls and returns the hash, single-use', async () => {
    const deps = makeDeps();
    const prep = parse(await prepareSwapHandler({ sellToken: 'USDC', buyToken: 'ETH', amount: '5000000' }, deps));
    const out = parse(await executeSwapHandler({ confirm_token: prep.confirm_token }, deps));
    expect(deps.signer.sendCallsSequential).toHaveBeenCalledWith(CALLS);
    expect(out).toEqual({ hash: '0xfinal', status: 'pending' });

    const again = parse(await executeSwapHandler({ confirm_token: prep.confirm_token }, deps));
    expect(again.error).toMatch(/expired|unknown/);
  });

  it('rejects an unknown/expired token without signing', async () => {
    const deps = makeDeps();
    const out = parse(await executeSwapHandler({ confirm_token: 'nope' }, deps));
    expect(out.error).toMatch(/expired|unknown/);
    expect(deps.signer.sendCallsSequential).not.toHaveBeenCalled();
  });
});

describe('swapStatusHandler', () => {
  it('returns the signer status for a hash', async () => {
    const out = parse(await swapStatusHandler({ hash: '0xfinal' }, makeDeps()));
    expect(out).toEqual({ status: 'confirmed', blockNumber: '7' });
  });
});

describe('searchTokensHandler', () => {
  it('returns Base registry tokens for a query', () => {
    const out = parse(searchTokensHandler({ query: 'usdc' }));
    expect(JSON.stringify(out)).toMatch(/USDC/);
  });
});

describe('getQuoteHandler', () => {
  it('amount path: quotes with taker = signer.address (read-only, no signing)', async () => {
    const deps = makeDeps();
    const out = parse(await getQuoteHandler({ sellToken: 'USDC', buyToken: 'ETH', amount: '5000000' }, deps));
    expect(deps.connector.getQuote).toHaveBeenCalledWith(expect.objectContaining({ amount: '5000000', taker: TAKER }));
    expect(deps.signer.sendCallsSequential).not.toHaveBeenCalled();
    expect(out.minBuyAmount).toBe('1880000000000000');
  });

  it('usd path: prices the sell token then sizes base units', async () => {
    const deps = makeDeps({
      connector: {
        buildSwap: vi.fn(async (a) => buildResult(a.amount)),
        priceUsd: vi.fn(async () => 1),
        getQuote: vi.fn(async (a) => ({ amount: a.amount })),
      },
    });
    await getQuoteHandler({ sellToken: 'USDC', buyToken: 'ETH', usd: 5 }, deps);
    expect(deps.connector.getQuote).toHaveBeenCalledWith(expect.objectContaining({ amount: '5000000' }));
  });
});
