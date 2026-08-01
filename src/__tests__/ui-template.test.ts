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
