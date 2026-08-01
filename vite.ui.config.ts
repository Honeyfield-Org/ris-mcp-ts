import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const uiRoot = fileURLToPath(new URL('./ui', import.meta.url));
const outDir = fileURLToPath(new URL('./dist-ui', import.meta.url));

// Every ui/<widget>/index.html is a build entry, so adding a widget means
// adding a directory instead of editing this config.
const widgetEntries = Object.fromEntries(
  readdirSync(uiRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(uiRoot, entry.name, 'index.html')))
    .map((entry) => [entry.name, join(uiRoot, entry.name, 'index.html')]),
);

if (Object.keys(widgetEntries).length === 0) {
  throw new Error(`No widget entries found — expected at least one ${uiRoot}/<widget>/index.html`);
}

export default defineConfig({
  root: uiRoot,
  // useRecommendedBuildConfig assumes a single entry: it sets
  // output.inlineDynamicImports, which Rollup rejects outright as soon as a
  // second widget exists. Opting out and setting the parts we need ourselves —
  // the inlining itself happens in the plugin's generateBundle hook, which is
  // unaffected. Deliberately NOT adopted from the recommended set:
  // cssCodeSplit: false, which merges every widget's CSS into one file and
  // would inline all of it into each widget; Vite's per-entry default keeps a
  // widget's CSS to itself.
  plugins: [viteSingleFile({ useRecommendedBuildConfig: false })],
  build: {
    outDir,
    emptyOutDir: true,
    // Inline assets regardless of size, so none is left behind as a loose file.
    assetsInlineLimit: () => true,
    // A single-file bundle can never carry modulepreload links, so the
    // polyfill would only ship dead code and a MutationObserver.
    modulePreload: { polyfill: false },
    rollupOptions: { input: widgetEntries },
  },
});
