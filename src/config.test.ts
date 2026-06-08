import { describe, expect, it } from 'vitest';
import { readConfig } from './config.js';

const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

describe('readConfig', () => {
  it('throws a clear error when the signing key is missing', () => {
    expect(() => readConfig({})).toThrow(/VORTR_SIGNER_KEY/);
  });

  it('throws when the signing key is malformed', () => {
    expect(() => readConfig({ VORTR_SIGNER_KEY: '0xnothex' })).toThrow(/VORTR_SIGNER_KEY/);
  });

  it('applies defaults and derives the REST site from the connector URL', () => {
    const cfg = readConfig({ VORTR_SIGNER_KEY: KEY });
    expect(cfg.signerKey).toBe(KEY);
    expect(cfg.apiBase).toBe('https://www.vortragents.com/mcp');
    expect(cfg.site).toBe('https://www.vortragents.com');
    expect(cfg.rpcUrl).toBe('https://mainnet.base.org');
  });

  it('honors overrides and strips a trailing slash, deriving site from /mcp', () => {
    const cfg = readConfig({
      VORTR_SIGNER_KEY: KEY,
      VORTR_API_BASE: 'https://staging.vortragents.com/mcp/',
      VORTR_BASE_RPC_URL: 'https://my.rpc',
    });
    expect(cfg.apiBase).toBe('https://staging.vortragents.com/mcp');
    expect(cfg.site).toBe('https://staging.vortragents.com');
    expect(cfg.rpcUrl).toBe('https://my.rpc');
  });

  it('never includes the raw key in the thrown message', () => {
    expect(() => readConfig({ VORTR_SIGNER_KEY: '0xBADKEY' })).toThrowError(
      expect.not.stringContaining('0xBADKEY'),
    );
  });
});
