import { describe, expect, it } from 'vitest';
import { resolveToken, usdToBaseUnits, isNativeToken } from './amounts.js';
import { NATIVE_TOKEN_ADDRESS } from '@vortr/core';

describe('resolveToken', () => {
  it('resolves a symbol to address + decimals + symbol', () => {
    expect(resolveToken('usdc')).toEqual({
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      decimals: 6,
      symbol: 'USDC',
    });
  });

  it('resolves native ETH (symbol) to the 0x sentinel, 18 decimals', () => {
    expect(resolveToken('eth')).toEqual({ address: NATIVE_TOKEN_ADDRESS, decimals: 18, symbol: 'ETH' });
  });

  it('resolves a known address (any case) to its decimals', () => {
    expect(resolveToken('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913').decimals).toBe(6);
  });

  it('throws for an unknown token', () => {
    expect(() => resolveToken('FOO')).toThrow(/unknown token/);
  });
});

describe('isNativeToken', () => {
  it('is true for the sentinel regardless of case', () => {
    expect(isNativeToken(NATIVE_TOKEN_ADDRESS.toLowerCase())).toBe(true);
    expect(isNativeToken('0x4200000000000000000000000000000000000006')).toBe(false);
  });
});

describe('usdToBaseUnits', () => {
  it('sizes a stablecoin ~1:1 at 6 decimals', () => {
    expect(usdToBaseUnits(5, 1, 6)).toBe('5000000');
  });

  it('sizes a non-stable by dividing USD by price at 18 decimals', () => {
    expect(usdToBaseUnits(5, 2500, 18)).toBe('2000000000000000'); // 0.002 ETH
  });

  it('floors fractional base units', () => {
    expect(usdToBaseUnits(1, 3, 6)).toBe('333333');
  });

  it('throws on a non-positive price', () => {
    expect(() => usdToBaseUnits(5, 0, 6)).toThrow(/price/);
  });
});
