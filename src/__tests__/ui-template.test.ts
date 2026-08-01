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
    // If this ever trips on a genuinely inert URL — an SVG `xmlns`, say, which
    // browsers never fetch — narrow it to the fetching contexts rather than
    // deleting it, and widen the CSP if the reference really is a network one.
    expect(TREFFERLISTE_HTML).not.toMatch(/\bhttps?:\/\//i);
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
