import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const uiRoot = fileURLToPath(new URL('./ui', import.meta.url));
const outDir = fileURLToPath(new URL('./dist-ui', import.meta.url));

/**
 * Every `ui/<widget>/index.html` is a widget, so adding one means adding a
 * directory instead of editing this config.
 */
export const WIDGETS = readdirSync(uiRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(uiRoot, entry.name, 'index.html')))
  .map((entry) => entry.name);

if (WIDGETS.length === 0) {
  throw new Error(`No widget entries found — expected at least one ${uiRoot}/<widget>/index.html`);
}

/**
 * One build produces exactly one widget, named by `RIS_UI_WIDGET`.
 *
 * Building all of them in one pass looks like it should work and does not: with
 * a second entry Rollup extracts everything the two share — `ui/shared/` and the
 * whole ext-apps SDK — into chunks, and `vite-plugin-singlefile` inlines only
 * what an entry pulls in directly. Both bundles then ship a bare
 * `import … from "./widget-state-<hash>.js"` for a file that is never written,
 * which no assertion about `<script src=…>` can see and which breaks the widget
 * in every host. `pnpm run gen:ui` runs this config once per widget.
 */
const widget = process.env.RIS_UI_WIDGET ?? (WIDGETS.length === 1 ? WIDGETS[0] : undefined);

if (!widget || !WIDGETS.includes(widget)) {
  throw new Error(
    `Set RIS_UI_WIDGET to one of ${WIDGETS.join(', ')} — or run \`pnpm run gen:ui\`, which builds every widget in turn.`,
  );
}

export default defineConfig({
  root: uiRoot,
  // useRecommendedBuildConfig would set output.inlineDynamicImports, which is
  // the right idea for a single entry but also flips settings we want to own —
  // notably cssCodeSplit: false, which merges every widget's CSS into one file.
  // The inlining itself happens in the plugin's generateBundle hook and is
  // unaffected by opting out.
  plugins: [viteSingleFile({ useRecommendedBuildConfig: false })],
  build: {
    outDir,
    // Each widget is built in its own pass into the same directory, so only the
    // caller may clear it — gen:ui does, once, before the first pass.
    emptyOutDir: false,
    // Inline assets regardless of size, so none is left behind as a loose file.
    assetsInlineLimit: () => true,
    // A single-file bundle can never carry modulepreload links, so the
    // polyfill would only ship dead code and a MutationObserver.
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: { [widget]: join(uiRoot, widget, 'index.html') },
      // One entry per pass makes this legal (Rollup rejects it outright for
      // several), and it is what closes the last hole in the bundle: ext-apps
      // reaches for zod's JSON-Schema converter through a dynamic import, which
      // otherwise stays a reference to a chunk that is never written.
      output: { inlineDynamicImports: true },
    },
  },
});
