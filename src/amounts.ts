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

/**
 * Validate a caller-supplied `amount` as positive base units and return it as a
 * bigint. Base units are a whole integer of the token's smallest unit (1 USDC =
 * "1000000"), so a decimal ("1.5"), sign ("-100"), exponent ("5e6") or empty
 * string is a mistake — reject it loudly here instead of letting BigInt("1.5")
 * throw deep inside the (best-effort, error-swallowing) balance preflight, or
 * letting BigInt("-100") = -100n sail past the `> balance` check into a built tx.
 */
export function parseBaseUnits(s: string): bigint {
  const q = s.trim();
  if (!/^\d+$/.test(q)) {
    throw new Error(
      `amount must be in base units — a whole integer string like "1000000" (= 1 USDC), not "${s}". ` +
        `Don't pass a decimal such as "1.5"; to size by dollars use the usd field instead.`,
    );
  }
  const v = BigInt(q);
  if (v <= 0n) throw new Error(`amount must be greater than 0 base units (got "${s}")`);
  return v;
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
