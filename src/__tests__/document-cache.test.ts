/**
 * Tests for the document cache backing the viewer's chunk tool (issue #51).
 *
 * The cache is what makes a document's character offsets survive between tool
 * calls, so the properties under test are the ones a viewer session depends on:
 * a hit returns the *same* string, the memory it holds is bounded by a number
 * rather than an estimate, and a document reached under either of its two names
 * is one entry, not two.
 */

import { describe, it, expect } from 'vitest';

import { createDocumentCache, type CachedDocument } from '../document-cache.js';

// =============================================================================
// Fixtures
// =============================================================================

function doc(text: string, sourceUrl = 'https://ris.bka.gv.at/x.html'): CachedDocument {
  return { text, outline: [], sourceUrl };
}

/** A controllable clock, so TTL expiry needs no timers and no waiting. */
function fakeClock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

// =============================================================================
// 1. Storing and retrieving
// =============================================================================

describe('document cache basics', () => {
  it('should return the stored document verbatim', () => {
    const cache = createDocumentCache();
    const value = doc('Der vollstaendige Text.');

    cache.set('NOR12019037', value);

    expect(cache.get('NOR12019037')).toBe(value);
    expect(cache.size).toBe(1);
    expect(cache.chars).toBe(value.text.length);
  });

  it('should miss on an unknown key', () => {
    const cache = createDocumentCache();

    expect(cache.get('NOR12019037')).toBeUndefined();
    expect(cache.size).toBe(0);
    expect(cache.chars).toBe(0);
  });

  it('should replace an entry stored under the same key without double-counting', () => {
    const cache = createDocumentCache();

    cache.set('NOR1', doc('x'.repeat(100)));
    cache.set('NOR1', doc('y'.repeat(30)));

    expect(cache.size).toBe(1);
    expect(cache.chars).toBe(30);
    expect(cache.get('NOR1')?.text).toBe('y'.repeat(30));
  });
});

// =============================================================================
// 2. Alias keys
// =============================================================================

describe('alias keys', () => {
  const URL_KEY = 'https://ris.bka.gv.at/Dokumente/Bundesnormen/NOR12019037.html';

  it('should find a document under its content URL as well as its number', () => {
    // ris_dokument may be called with either identifier and so may the chunk
    // tool; nothing guarantees the viewer holds the one that opened the
    // document. A single key would miss on that crossing and refetch silently.
    const cache = createDocumentCache();
    const value = doc('Text');

    cache.set('NOR12019037', value, URL_KEY);

    expect(cache.get('NOR12019037')).toBe(value);
    expect(cache.get(URL_KEY)).toBe(value);
  });

  it('should count the text once, not once per name', () => {
    const cache = createDocumentCache();

    cache.set('NOR12019037', doc('x'.repeat(500)), URL_KEY);

    expect(cache.size).toBe(1);
    expect(cache.chars).toBe(500);
  });

  it('should ignore an alias identical to the primary key', () => {
    const cache = createDocumentCache();

    cache.set(URL_KEY, doc('Text'), URL_KEY);

    expect(cache.get(URL_KEY)?.text).toBe('Text');
    expect(cache.size).toBe(1);
  });

  it('should fold an entry that was stored under the URL alone into the new one', () => {
    // The document was opened by URL and is now loaded by number: the two are
    // the same document, so the older copy goes rather than lingering as a
    // second entry with its own character cost.
    const cache = createDocumentCache();

    cache.set(URL_KEY, doc('x'.repeat(400)));
    cache.set('NOR12019037', doc('y'.repeat(400)), URL_KEY);

    expect(cache.size).toBe(1);
    expect(cache.chars).toBe(400);
    expect(cache.get(URL_KEY)?.text).toBe('y'.repeat(400));
  });

  it('should drop an alias together with the entry it points at', () => {
    const cache = createDocumentCache({ maxEntries: 1 });

    cache.set('NOR1', doc('a'), URL_KEY);
    cache.set('NOR2', doc('b'));

    expect(cache.get('NOR1')).toBeUndefined();
    expect(cache.get(URL_KEY)).toBeUndefined();
  });
});

// =============================================================================
// 3. Eviction
// =============================================================================

describe('eviction', () => {
  it('should evict the least recently used entry once maxEntries is exceeded', () => {
    const cache = createDocumentCache({ maxEntries: 3 });

    cache.set('A', doc('a'));
    cache.set('B', doc('b'));
    cache.set('C', doc('c'));
    cache.set('D', doc('d'));

    expect(cache.get('A')).toBeUndefined();
    expect(cache.get('B')?.text).toBe('b');
    expect(cache.size).toBe(3);
  });

  it('should count a read as a use', () => {
    const cache = createDocumentCache({ maxEntries: 3 });

    cache.set('A', doc('a'));
    cache.set('B', doc('b'));
    cache.set('C', doc('c'));
    cache.get('A'); // A is now the youngest, B the oldest
    cache.set('D', doc('d'));

    expect(cache.get('A')?.text).toBe('a');
    expect(cache.get('B')).toBeUndefined();
  });

  it('should evict on the character budget before the entry count is reached', () => {
    // The bound that actually matters: ten entries of a quarter million
    // characters each, times a hundred sessions, is half a gigabyte.
    const cache = createDocumentCache({ maxEntries: 10, maxChars: 1000 });

    cache.set('A', doc('a'.repeat(600)));
    cache.set('B', doc('b'.repeat(600)));

    expect(cache.size).toBe(1);
    expect(cache.chars).toBe(600);
    expect(cache.get('A')).toBeUndefined();
  });

  it('should keep the character total consistent across evictions', () => {
    const cache = createDocumentCache({ maxEntries: 2 });

    cache.set('A', doc('a'.repeat(10)));
    cache.set('B', doc('b'.repeat(20)));
    cache.set('C', doc('c'.repeat(30)));

    expect(cache.size).toBe(2);
    expect(cache.chars).toBe(50);
  });

  it('should not store a document larger than the whole budget', () => {
    // Caching it would evict everything else and still overshoot the bound.
    // The chunk path stays correct, it just refetches per call.
    const cache = createDocumentCache({ maxChars: 1000 });

    cache.set('KEEP', doc('k'.repeat(100)));
    cache.set('HUGE', doc('h'.repeat(1001)));

    expect(cache.get('HUGE')).toBeUndefined();
    expect(cache.get('KEEP')?.text).toBe('k'.repeat(100));
    expect(cache.size).toBe(1);
    expect(cache.chars).toBe(100);
  });

  it('should drop the previous text when a document grows past the budget', () => {
    // The document was cached, then grew. Keeping the old entry would leave the
    // viewer paging a text that ris_dokument no longer renders — stale offsets
    // into a document nobody is looking at any more.
    const cache = createDocumentCache({ maxChars: 1000 });

    cache.set('NOR1', doc('a'.repeat(400)));
    cache.set('NOR1', doc('a'.repeat(1400)));

    expect(cache.get('NOR1')).toBeUndefined();
    expect(cache.size).toBe(0);
    expect(cache.chars).toBe(0);
  });

  it('should drop the previous text under the alias too when it grows past the budget', () => {
    const cache = createDocumentCache({ maxChars: 1000 });
    const url = 'https://ris.bka.gv.at/Dokumente/Bundesnormen/NOR12019037.html';

    cache.set('NOR1', doc('a'.repeat(400)), url);
    cache.set('NOR1', doc('a'.repeat(1400)), url);

    expect(cache.get('NOR1')).toBeUndefined();
    expect(cache.get(url)).toBeUndefined();
    expect(cache.size).toBe(0);
    expect(cache.chars).toBe(0);
  });

  it('should leave other documents alone when one grows past the budget', () => {
    const cache = createDocumentCache({ maxChars: 1000 });

    cache.set('KEEP', doc('k'.repeat(100)));
    cache.set('NOR1', doc('a'.repeat(400)));
    cache.set('NOR1', doc('a'.repeat(1400)));

    expect(cache.get('KEEP')?.text).toBe('k'.repeat(100));
    expect(cache.size).toBe(1);
    expect(cache.chars).toBe(100);
  });

  it('should never hold more characters than the budget allows', () => {
    const cache = createDocumentCache({ maxEntries: 100, maxChars: 500 });

    for (let i = 0; i < 20; i++) {
      cache.set(`DOC${i}`, doc('x'.repeat(120)));
      expect(cache.chars).toBeLessThanOrEqual(500);
    }
  });
});

// =============================================================================
// 4. Time to live
// =============================================================================

describe('time to live', () => {
  it('should serve an entry inside its lifetime', () => {
    const clock = fakeClock();
    const cache = createDocumentCache({ ttlMs: 1000, now: clock.now });

    cache.set('A', doc('a'));
    clock.advance(999);

    expect(cache.get('A')?.text).toBe('a');
  });

  it('should treat an expired entry as a miss and reclaim its characters', () => {
    const clock = fakeClock();
    const cache = createDocumentCache({ ttlMs: 1000, now: clock.now });

    cache.set('A', doc('a'.repeat(50)));
    clock.advance(1001);

    expect(cache.get('A')).toBeUndefined();
    expect(cache.size).toBe(0);
    expect(cache.chars).toBe(0);
  });

  it('should expire an entry reached through its alias too', () => {
    const clock = fakeClock();
    const cache = createDocumentCache({ ttlMs: 1000, now: clock.now });

    cache.set('A', doc('a'), 'https://ris.bka.gv.at/a.html');
    clock.advance(1001);

    expect(cache.get('https://ris.bka.gv.at/a.html')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('should not extend the lifetime by reading', () => {
    // Lazily checked, but not a sliding window: the text has to stay in step
    // with RIS, and a document read every nine minutes would never refresh.
    const clock = fakeClock();
    const cache = createDocumentCache({ ttlMs: 1000, now: clock.now });

    cache.set('A', doc('a'));
    clock.advance(600);
    expect(cache.get('A')).toBeDefined();
    clock.advance(600);

    expect(cache.get('A')).toBeUndefined();
  });
});

// =============================================================================
// 5. Defaults
// =============================================================================

describe('defaults', () => {
  it('should hold ten documents and a million characters for ten minutes', () => {
    const clock = fakeClock();
    const cache = createDocumentCache({ now: clock.now });

    for (let i = 0; i < 10; i++) {
      cache.set(`DOC${i}`, doc('x'.repeat(50_000)));
    }
    expect(cache.size).toBe(10);
    expect(cache.chars).toBe(500_000);

    cache.set('DOC10', doc('x'));
    expect(cache.size).toBe(10);
    expect(cache.get('DOC0')).toBeUndefined();

    clock.advance(600_001);
    expect(cache.get('DOC5')).toBeUndefined();
  });

  it('should reject a document above the default character budget', () => {
    const cache = createDocumentCache();

    cache.set('HUGE', doc('x'.repeat(1_000_001)));

    expect(cache.size).toBe(0);
  });
});
