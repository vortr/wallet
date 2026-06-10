import { z } from 'zod';
import { formatUnits } from 'viem';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveToken, usdToBaseUnits, isNativeToken, parseBaseUnits } from './amounts.js';
import type { Signer } from './signer.js';
import type { Connector } from './connector.js';
import type { PendingStore } from './pending.js';
import { searchTokens, DEFAULT_SLIPPAGE_BPS } from '@vortr/core';

export interface ToolDeps {
  signer: Signer;
  connector: Connector;
  pending: PendingStore;
}

type Content = { content: { type: 'text'; text: string }[]; isError?: boolean };
const json = (v: unknown): Content => ({ content: [{ type: 'text', text: JSON.stringify(v, null, 2) }] });
const fail = (m: string): Content => ({ content: [{ type: 'text', text: JSON.stringify({ error: m }) }], isError: true });

const WETH = '0x4200000000000000000000000000000000000006';

export const prepareSchema = {
  sellToken: z.string().describe('Base token to SELL — symbol (e.g. "USDC", "ETH") or 0x address.'),
  buyToken: z.string().describe('Base token to BUY — symbol or 0x address.'),
  amount: z.string().optional().describe('Sell amount in BASE UNITS (stringified integer). Provide this OR usd.'),
  usd: z.number().positive().optional().describe('Sell notional in USD (e.g. 5). Provide this OR amount.'),
  slippageBps: z.number().int().min(0).max(1000).optional().describe('Slippage in basis points; default 25 (0.25%), max 1000.'),
};
export const confirmSchema = { confirm_token: z.string().describe('Token from prepare_swap.') };
export const statusSchema = { hash: z.string().describe('Transaction hash from execute_swap.') };
export const searchSchema = { query: z.string().describe('Symbol, name, or 0x address to search (Base). "" returns all.') };

export type PrepareArgs = {
  sellToken: string;
  buyToken: string;
  amount?: string;
  usd?: number;
  slippageBps?: number;
};

/** Resolve the sell amount to base units (uses the connector price for the usd path). */
async function resolveSellAmount(args: PrepareArgs, deps: ToolDeps): Promise<string> {
  if (args.amount !== undefined && args.amount.trim() !== '') return parseBaseUnits(args.amount).toString();
  if (args.usd === undefined) throw new Error('provide either amount (base units) or usd');
  const sell = resolveToken(args.sellToken);
  const priceToken = isNativeToken(sell.address) ? WETH : sell.address;
  const price = await deps.connector.priceUsd(priceToken);
  return usdToBaseUnits(args.usd, price, sell.decimals);
}

export function searchTokensHandler(args: { query: string }): Content {
  return json({ tokens: searchTokens(args.query) });
}

export async function getQuoteHandler(args: PrepareArgs, deps: ToolDeps): Promise<Content> {
  let amount: string;
  try {
    amount = await resolveSellAmount(args, deps);
  } catch (e) {
    return fail((e as Error).message);
  }
  try {
    const quote = await deps.connector.getQuote({
      sellToken: args.sellToken,
      buyToken: args.buyToken,
      amount,
      taker: deps.signer.address,
      slippageBps: args.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
    });
    return json(quote);
  } catch (e) {
    // stderr only (stdout is the JSON-RPC channel); safe — connector errors never contain the key.
    console.error('[vortr-wallet] get_quote failed:', e instanceof Error ? e.message : e);
    return fail('no quote available for this pair/amount right now (no route or insufficient liquidity) — try again');
  }
}

export async function walletAddressHandler(deps: ToolDeps): Promise<Content> {
  return json({ address: deps.signer.address, chain: 'base' });
}

export async function prepareSwapHandler(args: PrepareArgs, deps: ToolDeps): Promise<Content> {
  let amount: string;
  let sell: { address: `0x${string}`; decimals: number; symbol: string };
  try {
    sell = resolveToken(args.sellToken);
    amount = await resolveSellAmount(args, deps);
  } catch (e) {
    return fail((e as Error).message);
  }

  // Preflight: never build a swap the wallet can't fund. Fails fast with the
  // exact shortfall instead of letting the agent thrash through a revert to
  // discover an empty balance. Best-effort: a flaky balance read falls through
  // (the per-swap confirm gate and the chain itself remain the real guards).
  try {
    const have = await deps.signer.balanceOf(sell.address, isNativeToken(sell.address));
    if (BigInt(amount) > have) {
      return fail(
        `insufficient ${sell.symbol}: wallet ${deps.signer.address} holds ` +
          `${formatUnits(have, sell.decimals)} ${sell.symbol} but this swap needs ` +
          `${formatUnits(BigInt(amount), sell.decimals)} ${sell.symbol}. ` +
          `Send ${sell.symbol} to that address on Base, then prepare_swap again.`,
      );
    }
  } catch (e) {
    console.error('[vortr-wallet] balance preflight skipped (read failed):', e instanceof Error ? e.message : e);
  }

  try {
    const { payload, summary } = await deps.connector.buildSwap({
      sellToken: args.sellToken,
      buyToken: args.buyToken,
      amount,
      taker: deps.signer.address,
      slippageBps: args.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
    });
    const confirm_token = deps.pending.put({ calls: payload.calls, summary });
    return json({ confirm_token, summary, expiresAt: summary.expiresAt });
  } catch (e) {
    // stderr only (stdout is the JSON-RPC channel); safe to log — connector /
    // parse errors never contain the key. Lets operators tell a real bug from a
    // genuine no-route, which the opaque agent-facing message below hides.
    console.error('[vortr-wallet] prepare_swap failed:', e instanceof Error ? e.message : e);
    return fail('could not prepare the swap right now (no route, insufficient liquidity, or above the safety ceiling) — try again');
  }
}

export async function executeSwapHandler(args: { confirm_token: string }, deps: ToolDeps): Promise<Content> {
  const entry = deps.pending.take(args.confirm_token);
  if (!entry) return fail('quote_expired or unknown confirm_token — call prepare_swap again for a fresh price, then confirm');
  try {
    const hash = await deps.signer.sendCallsSequential(entry.calls);
    return json({ hash, status: 'pending' });
  } catch (e) {
    return fail(`broadcast failed: ${(e as Error).message}`);
  }
}

export async function swapStatusHandler(args: { hash: string }, deps: ToolDeps): Promise<Content> {
  return json(await deps.signer.getStatus(args.hash as `0x${string}`));
}

export function registerWalletTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'search_tokens',
    { description: 'Search the Vortr Base token registry by symbol, name, or address. Returns TokenInfo[]. Read-only.', inputSchema: searchSchema, annotations: { readOnlyHint: true } },
    (args) => searchTokensHandler(args as { query: string }),
  );
  server.registerTool(
    'get_quote',
    { description: 'Get a live 0x swap quote on Base for THIS wallet (taker auto-filled). Read-only preview — does not build or sign. amount in base units, OR pass usd.', inputSchema: prepareSchema, annotations: { readOnlyHint: true } },
    (args) => getQuoteHandler(args as PrepareArgs, deps),
  );
  server.registerTool(
    'wallet_address',
    { description: 'Return this signer’s Base wallet address. Use it as the taker — no need to ask the user for an address.', inputSchema: {}, annotations: { readOnlyHint: true } },
    () => walletAddressHandler(deps),
  );
  server.registerTool(
    'prepare_swap',
    { description: 'Quote + build a Base swap for THIS wallet (taker auto-filled). Returns { confirm_token, summary, expiresAt }. Does NOT broadcast — show the summary and get the user’s OK, then call execute_swap.', inputSchema: prepareSchema, annotations: { readOnlyHint: true } },
    (args) => prepareSwapHandler(args as PrepareArgs, deps),
  );
  server.registerTool(
    'execute_swap',
    { description: 'Broadcast the swap a prior prepare_swap returned. Pass its confirm_token AFTER the user approves. Signs locally with this wallet; the hosted Vortr never signs.', inputSchema: confirmSchema, annotations: { destructiveHint: true } },
    (args) => executeSwapHandler(args as { confirm_token: string }, deps),
  );
  server.registerTool(
    'swap_status',
    { description: 'Check a swap transaction: pending | confirmed | failed.', inputSchema: statusSchema, annotations: { readOnlyHint: true } },
    (args) => swapStatusHandler(args as { hash: string }, deps),
  );
}
