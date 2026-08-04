import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // ui/** belongs to vitest.ui.config.ts — it needs a DOM environment, which
    // this project deliberately does not provide. tests/host-sim/** belongs to
    // playwright.host.config.ts; its *.spec.ts files match vitest's default
    // glob but only Playwright's runner can execute them. Scoped to that one
    // directory rather than tests/**, so a future tests/<other>/*.test.ts is
    // picked up here instead of falling through both runners unnoticed.
    exclude: [
      "dist/**",
      "node_modules/**",
      "src/__tests__/integration/**",
      "tests/host-sim/**",
      "ui/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/__tests__/**", "src/types.ts", "src/index.ts"],
      thresholds: {
        statements: 65,
        branches: 55,
        functions: 75,
        lines: 65,
      },
    },
  },
});
