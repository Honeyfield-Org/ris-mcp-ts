import { describe, expect, it } from 'vitest';

import {
  BIG_MOUNT_PROGRESS,
  BIG_MOUNT_TEXT,
  BIG_OUTLINE,
  BIG_TEXT,
  BIG_TOTAL,
  bigChunk,
} from './document-chunks.js';

describe('big-document fixture (#95)', () => {
  it('is exactly BIG_TOTAL characters long', () => {
    expect(BIG_TOTAL).toBe(100_000);
    expect(BIG_TEXT).toHaveLength(BIG_TOTAL);
  });

  it('starts every outline entry at a line start that carries its label', () => {
    for (const entry of BIG_OUTLINE) {
      if (entry.offset > 0) {
        expect(BIG_TEXT[entry.offset - 1]).toBe('\n');
      }
      expect(BIG_TEXT.slice(entry.offset, entry.offset + entry.label.length)).toBe(entry.label);
    }
  });

  it('spans the whole document with rail-worthy entries', () => {
    expect(BIG_OUTLINE).toHaveLength(10);
    const spanSum = BIG_OUTLINE.reduce((sum, entry) => sum + entry.span, 0);
    expect(spanSum).toBe(BIG_TOTAL);
    const maxShare = Math.max(...BIG_OUTLINE.map((entry) => entry.span / BIG_TOTAL));
    expect(maxShare).toBeLessThanOrEqual(0.8);
  });

  it('ships the outline only with the offset-0 chunk, like the server does', () => {
    expect(bigChunk(0).outline).toEqual(BIG_OUTLINE);
    expect(bigChunk(0).next_offset).toBe(25_000);
    expect(bigChunk(0).text).toHaveLength(25_000);
    expect(bigChunk(25_000).outline).toBeUndefined();
    expect(bigChunk(25_000).next_offset).toBe(50_000);
    expect(bigChunk(75_000).next_offset).toBeNull();
  });

  it('mounts as a truncated prefix without outline data', () => {
    expect(BIG_MOUNT_TEXT.startsWith(BIG_TEXT.slice(0, 25_000))).toBe(true);
    expect(BIG_MOUNT_TEXT).toContain('Antwort gekuerzt');
    expect(BIG_MOUNT_PROGRESS).toMatch(/^\d+,\d % geladen$/);
    expect(BIG_MOUNT_PROGRESS).not.toBe('100,0 % geladen');
  });
});
