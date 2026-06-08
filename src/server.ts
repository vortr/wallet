import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readConfig } from './config.js';
import { createSigner, makeClients } from './signer.js';
import { createConnector } from './connector.js';
import { PendingStore } from './pending.js';
import { registerWalletTools, type ToolDeps } from './tools.js';
import { VERSION } from './version.js';

export function createServer(): McpServer {
  const cfg = readConfig();
  const deps: ToolDeps = {
    signer: createSigner(makeClients(cfg.signerKey, cfg.rpcUrl)),
    connector: createConnector({ apiBase: cfg.apiBase, site: cfg.site }),
    pending: new PendingStore(),
  };
  const server = new McpServer({ name: 'vortr-wallet', version: VERSION });
  registerWalletTools(server, deps);
  return server;
}
