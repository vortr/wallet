import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { privateKeyToAccount } from 'viem/accounts';
import { readConfig } from './config.js';
import { createServer } from './server.js';
import { VERSION } from './version.js';

const ART = [
  '  ██╗   ██╗ ██████╗ ██████╗ ████████╗██████╗',
  '  ██║   ██║██╔═══██╗██╔══██╗╚══██╔══╝██╔══██╗',
  '  ██║   ██║██║   ██║██████╔╝   ██║   ██████╔╝',
  '  ╚██╗ ██╔╝██║   ██║██╔══██╗   ██║   ██╔══██╗',
  '   ╚████╔╝ ╚██████╔╝██║  ██║   ██║   ██║  ██║',
  '    ╚═══╝   ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝',
];

/** Branded boot banner — STDERR only (stdout is the JSON-RPC channel). Colors
 *  only when stderr is a TTY, so piped logs stay clean ASCII. Brand signal-red. */
function printBanner(info: string[]): void {
  const tty = process.stderr.isTTY ?? false;
  const red = (s: string) => (tty ? `\x1b[38;2;255;59;29m${s}\x1b[0m` : s);
  const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s);
  process.stderr.write(['', ...ART.map(red), ...info.map(dim), ''].join('\n') + '\n');
}

export async function main(): Promise<void> {
  const cfg = readConfig(); // validates VORTR_SIGNER_KEY (throws → fatal below)
  const { address } = privateKeyToAccount(cfg.signerKey);
  printBanner([
    '  non-custodial swaps on Base · you sign · Vortr never holds keys',
    `  v${VERSION} · signer ${address.slice(0, 6)}…${address.slice(-4)} · 6 tools ready`,
  ]);
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

export { createServer };

// Only run when executed as the binary, NOT when imported (e.g. by tests).
// realpathSync resolves npx/.bin symlinks so the guard works on real installs.
function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try { return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); }
  catch { return false; }
}

if (isMainModule()) {
  main().catch((err) => {
    // stderr only; stdout is the JSON-RPC channel. Never print the key.
    console.error('[vortr-wallet] fatal:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
