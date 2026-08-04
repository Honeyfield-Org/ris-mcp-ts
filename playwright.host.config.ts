import { defineConfig } from '@playwright/test';

/**
 * Host-simulation suite: real Chromium, real iframes, real clicks against the
 * built single-file widget bundles. Deliberately NOT part of `pnpm run check`
 * — it needs installed Playwright browsers (`pnpm exec playwright install
 * chromium`), which CI does not provide.
 */
export default defineConfig({
  testDir: 'tests/host-sim',
  timeout: 30_000,
  use: { browserName: 'chromium' },
});
