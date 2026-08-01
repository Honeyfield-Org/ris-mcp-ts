import { defineConfig } from 'vitest/config';

/**
 * Separate project for the widget sources under `ui/`.
 *
 * The widget runs in a browser, so its tests need a DOM; the server tests in
 * `vitest.config.ts` run in node and exclude `ui/**` so neither suite inherits
 * the other's globals.
 */
export default defineConfig({
  test: {
    include: ['ui/**/*.test.ts'],
    environment: 'jsdom',
  },
});
