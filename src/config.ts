import type { Hex } from 'viem';

export interface WalletConfig {
  /** EOA private key. Local only — never sent to Vortr or echoed. */
  signerKey: Hex;
  /** Public Vortr MCP connector (keyless build_swap source). */
  apiBase: string;
  /** REST origin derived from apiBase (apiBase without the /mcp suffix). */
  site: string;
  /** Base RPC used to broadcast + read receipts. */
  rpcUrl: string;
}

const KEY_RE = /^0x[0-9a-fA-F]{64}$/;

export function readConfig(source: Record<string, string | undefined> = process.env): WalletConfig {
  const signerKey = source.VORTR_SIGNER_KEY;
  if (!signerKey || !KEY_RE.test(signerKey)) {
    // Note: never interpolate the value — it's a secret.
    throw new Error('Missing or malformed VORTR_SIGNER_KEY (expected a 0x-prefixed 32-byte hex private key).');
  }
  const apiBase = (source.VORTR_API_BASE ?? 'https://www.vortragents.com/mcp').replace(/\/$/, '');
  const site = apiBase.replace(/\/mcp$/, '');
  const rpcUrl = source.VORTR_BASE_RPC_URL ?? 'https://mainnet.base.org';
  return { signerKey: signerKey as Hex, apiBase, site, rpcUrl };
}
