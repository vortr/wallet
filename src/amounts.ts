import type { Address } from 'viem';
import { BASE_TOKENS, getToken, NATIVE_TOKEN_ADDRESS } from '@vortr/core';

export function isNativeToken(address: string): boolean {
  return address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();
}

/** Resolve a Base symbol or 0x address to its canonical address + decimals + symbol. */
export function resolveToken(s: string): { address: Address; decimals: number; symbol: string } {
  const q = s.trim();
  const byAddr = getToken(q);
  if (byAddr) return { address: byAddr.address, decimals: byAddr.decimals, symbol: byAddr.symbol };
  const bySym = BASE_TOKENS.find((t) => t.symbol.toLowerCase() === q.toLowerCase());
  if (bySym) return { address: bySym.address, decimals: bySym.decimals, symbol: bySym.symbol };
  throw new Error(`unknown token "${s}" — use a Base symbol (e.g. USDC, ETH) or 0x address`);
}

/** Convert a USD notional to integer base-units of a token priced at `priceUsd`. */
export function usdToBaseUnits(usd: number, priceUsd: number, decimals: number): string {
  if (!(priceUsd > 0)) throw new Error('cannot size by USD: no positive price for the sell token');
  // Take 9 decimals of the (float) USD/price ratio, then scale to base-units with
  // BigInt. This avoids Math.floor(x * 10**decimals) silently corrupting amounts
  // above 2^53 (10**18 isn't exact as a double). Floor to never over-spend.
  const PRECISION = 1_000_000_000n; // 1e9
  const tokenAmount = usd / priceUsd;
  const scaledRatio = BigInt(Math.floor(tokenAmount * Number(PRECISION)));
  return ((scaledRatio * 10n ** BigInt(decimals)) / PRECISION).toString();
}
