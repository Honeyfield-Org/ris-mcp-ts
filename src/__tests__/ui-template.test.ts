import { describe, expect, it } from 'vitest';

import { TREFFERLISTE_HTML } from '../generated/trefferliste-html.js';
import { VIEWER_HTML } from '../generated/viewer-html.js';

/** Every widget bundle has to satisfy the same rules. */
const BUNDLES: [string, string][] = [
  ['trefferliste', TREFFERLISTE_HTML],
  ['viewer', VIEWER_HTML],
];

describe.each(BUNDLES)('generated widget template: %s', (_widget, html) => {
  it('is a non-trivial single-file document', () => {
    expect(html.length).toBeGreaterThan(500);
    expect(html).toContain('nojs-marker');
  });

  it('references no external resources', () => {
    expect(html).not.toMatch(/src\s*=\s*["']https?:/i);
    expect(html).not.toMatch(/href\s*=\s*["']https?:/i);
  });

  it('names no external origin at all', () => {
    // The widget resource declares an empty CSP (every domain list in
    // src/widgets.ts is `[]`), which stays truthful only while the bundle
    // reaches for nothing off-origin — including url(), fetch() and imports
    // that the attribute checks above would miss.
    //
    // The literals below are the ones the dependency bundle carries as data
    // rather than as a fetch target, verified one by one in their surrounding
    // code. They are stripped instead of the assertion being relaxed, so any
    // origin that is not on this list still fails. Before adding one, read the
    // code around it: if the reference really is a network one, widen the CSP
    // in src/widgets.ts instead.
    const INERT_ORIGINS = [
      // zod's JSON Schema dialect ids, assigned to a `$schema` property.
      'http://json-schema.org/draft-04/schema#',
      'http://json-schema.org/draft-07/schema#',
      'https://json-schema.org/draft/2020-12/schema',
      // Example value inside an ext-apps schema `.describe()` docstring.
      'https://*.example.com',
      // zod's IPv6 check, which parses `new URL("http://[…]")` to validate it.
      'http://[${',
    ];

    const remaining = INERT_ORIGINS.reduce((rest, origin) => rest.split(origin).join(''), html);

    expect(remaining).not.toMatch(/\bhttps?:\/\//i);
  });

  it('inlines every script and stylesheet', () => {
    // The realistic break is not an http(s) URL but silent non-inlining: the
    // document keeps relative asset paths like src="/assets/main.js", renders
    // blank wherever those do not resolve, and still satisfies every other
    // assertion in this file.
    expect(html).not.toMatch(/<script[^>]+\bsrc\s*=/i);
    expect(html).not.toMatch(/<link[^>]+rel\s*=\s*["']?stylesheet/i);
    expect(html).not.toMatch(/<link[^>]+rel\s*=\s*["']?modulepreload/i);
  });

  it('imports no chunk of its own that was left beside it', () => {
    // The break a second widget introduced: Rollup splits out everything two
    // entries share, the single-file plugin inlines only what an entry pulls in
    // directly, and the bundle ships `from"./widget-state-<hash>.js"` for a file
    // that is never written. The script tag is inline, so every assertion above
    // passes while the widget fails to start in every host.
    expect(html).not.toMatch(/\b(?:from|import)\s*["']\.[^"']*["']/);
  });

  it('carries the SDK it needs to talk to a host', () => {
    // The same failure seen from the other side: a bundle missing the ext-apps
    // client is small, self-consistent and completely inert.
    expect(html).toContain('ui/notifications/tool-result');
  });

  it('stays under the bundle budget', () => {
    expect(html.length).toBeLessThan(400_000);
  });
});
