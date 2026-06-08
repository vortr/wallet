import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { BuildSwapResult } from '@vortr/core';

export interface BuildSwapArgs {
  sellToken: string;
  buyToken: string;
  amount: string;
  taker: string;
  slippageBps?: number;
}

export interface ToolCallResult {
  content: { type: string; text?: string }[];
  isError?: boolean;
}

export type CallTool = (name: string, args: Record<string, unknown>) => Promise<ToolCallResult>;
export type FetchLike = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export interface Connector {
  buildSwap(args: BuildSwapArgs): Promise<BuildSwapResult>;
  priceUsd(token: string): Promise<number>;
  getQuote(args: BuildSwapArgs): Promise<unknown>;
}

/** Pure: pull { payload, summary } out of a build_swap tool result. */
export function parseBuildSwap(result: ToolCallResult): BuildSwapResult {
  if (result.isError) throw new Error('connector build_swap returned an error');
  const text = result.content.find((c) => c.type === 'text' && typeof c.text === 'string')?.text;
  if (!text) throw new Error('connector build_swap returned no text content');
  const body = JSON.parse(text) as Partial<BuildSwapResult>;
  if (!body.payload || !body.summary) throw new Error('connector build_swap response missing payload/summary');
  return { payload: body.payload, summary: body.summary };
}

export function createConnector(
  cfg: { apiBase: string; site: string },
  deps: { callTool?: CallTool; fetchImpl?: FetchLike } = {},
): Connector {
  const callTool = deps.callTool ?? defaultCallTool(cfg.apiBase);
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  return {
    async buildSwap(args) {
      return parseBuildSwap(await callTool('build_swap', { ...args }));
    },

    async getQuote(args) {
      const r = await callTool('get_quote', { ...args });
      if (r.isError) throw new Error('connector get_quote returned an error');
      const text = r.content.find((c) => c.type === 'text' && typeof c.text === 'string')?.text;
      if (!text) throw new Error('connector get_quote returned no text content');
      return JSON.parse(text);
    },

    async priceUsd(token) {
      const res = await fetchImpl(`${cfg.site}/api/prices?tokens=${encodeURIComponent(token)}`);
      if (!res.ok) throw new Error('connector price lookup failed');
      const body = (await res.json()) as { prices?: Record<string, { price?: number }> };
      // We request exactly one token, so take the single returned entry — this
      // sidesteps DefiLlama key casing and the route's native->WETH remap.
      const entry = Object.values(body.prices ?? {})[0];
      if (!entry || typeof entry.price !== 'number') throw new Error('no price available for the sell token');
      return entry.price;
    },
  };
}

/** Default: a fresh MCP client per call (the connector is stateless). */
function defaultCallTool(apiBase: string): CallTool {
  return async (name, args) => {
    const client = new Client({ name: 'vortr-wallet', version: '0.1.0' });
    const transport = new StreamableHTTPClientTransport(new URL(apiBase));
    await client.connect(transport);
    try {
      return (await client.callTool({ name, arguments: args })) as unknown as ToolCallResult;
    } finally {
      await client.close();
    }
  };
}
