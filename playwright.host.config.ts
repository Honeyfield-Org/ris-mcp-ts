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
  // Unconditional, not `!!process.env.CI`: this suite has no CI gate behind it,
  // so a committed `test.only` would shrink the run to one spec and still exit 0.
  forbidOnly: true,
  use: { browserName: 'chromium' },
});
