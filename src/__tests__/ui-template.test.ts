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

  it('stays under the bundle budget', () => {
    expect(TREFFERLISTE_HTML.length).toBeLessThan(400_000);
  });
});
