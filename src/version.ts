import { createRequire } from 'node:module';

/**
 * Package version, read from package.json so the boot banner + MCP serverInfo
 * never drift from the published version again. tsup bundles this into
 * dist/index.js; `../package.json` resolves to the package root both in dev and
 * when published (package.json sits one level above dist/).
 */
export const VERSION: string = (
  createRequire(import.meta.url)('../package.json') as { version: string }
).version;
