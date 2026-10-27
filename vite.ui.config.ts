import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, type Plugin } from 'vite';
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

/**
 * Ships zod's English error messages and none of its 49 translations.
 *
 * ext-apps validates host messages with `z.…`, and a namespace used as a value
 * keeps every member alive for Rollup — `z.locales` included, which was half of
 * each widget (~187 000 of ~360 000 characters with zod 4.3) and grew past the
 * bundle budget with 4.6. Nothing in a widget reads a translation: zod installs
 * `en` itself, from its own `../locales/en.js` import, which this leaves alone.
 * Only the barrel behind `z.locales` / `core.locales` is replaced, by one that
 * exports `en`. If zod moves the barrel, nothing matches and the bundle grows
 * back — `ui-template.test.ts` fails on a Japanese literal when that happens.
 */
const ZOD_LOCALES_PREFIX = '\0zod-locales-en:';

function zodEnglishOnly(): Plugin {
  return {
    name: 'ris-zod-english-only',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source !== '../locales/index.js' || !importer || !/[\\/]zod[\\/]v4[\\/]/.test(importer)) {
        return null;
      }
      return ZOD_LOCALES_PREFIX + join(dirname(importer), '..', 'locales', 'en.js');
    },
    load(id) {
      if (!id.startsWith(ZOD_LOCALES_PREFIX)) return null;
      return `export { default as en } from ${JSON.stringify(id.slice(ZOD_LOCALES_PREFIX.length))};`;
    },
  };
}

export default defineConfig({
  root: uiRoot,
  // useRecommendedBuildConfig would set output.inlineDynamicImports, which is
  // the right idea for a single entry but also flips settings we want to own —
  // notably cssCodeSplit: false, which merges every widget's CSS into one file.
  // The inlining itself happens in the plugin's generateBundle hook and is
  // unaffected by opting out.
  plugins: [zodEnglishOnly(), viteSingleFile({ useRecommendedBuildConfig: false })],
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
