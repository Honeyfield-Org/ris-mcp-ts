/**
 * Single source of truth for the server version.
 *
 * Read once at startup from package.json, resolved relative to this module so
 * it works identically from src/ (via tsx), the compiled dist/ build, and
 * inside the Docker image. Both entry points (index.ts/server.ts and http.ts)
 * import VERSION from here instead of duplicating the readFileSync block.
 *
 * dist/version.js sits at the same depth as dist/server.js and dist/http.js,
 * so `../package.json` resolves to the package root in every layout.
 */

import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

export const VERSION = pkg.version;
