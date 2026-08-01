import { describe, expect, it } from 'vitest';

import { TREFFERLISTE_HTML } from '../generated/trefferliste-html.js';

describe('generated widget template', () => {
  it('is a non-trivial single-file document', () => {
    expect(TREFFERLISTE_HTML.length).toBeGreaterThan(500);
    expect(TREFFERLISTE_HTML).toContain('nojs-marker');
  });

  it('references no external resources', () => {
    expect(TREFFERLISTE_HTML).not.toMatch(/src\s*=\s*["']https?:/i);
    expect(TREFFERLISTE_HTML).not.toMatch(/href\s*=\s*["']https?:/i);
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

    const remaining = INERT_ORIGINS.reduce(
      (html, origin) => html.split(origin).join(''),
      TREFFERLISTE_HTML,
    );

    expect(remaining).not.toMatch(/\bhttps?:\/\//i);
  });

  it('inlines every script and stylesheet', () => {
    // The realistic break is not an http(s) URL but silent non-inlining: the
    // document keeps relative asset paths like src="/assets/main.js", renders
    // blank wherever those do not resolve, and still satisfies every other
    // assertion in this file.
    expect(TREFFERLISTE_HTML).not.toMatch(/<script[^>]+\bsrc\s*=/i);
    expect(TREFFERLISTE_HTML).not.toMatch(/<link[^>]+rel\s*=\s*["']?stylesheet/i);
    expect(TREFFERLISTE_HTML).not.toMatch(/<link[^>]+rel\s*=\s*["']?modulepreload/i);
  });

  it('stays under the bundle budget', () => {
    expect(TREFFERLISTE_HTML.length).toBeLessThan(400_000);
  });
});
