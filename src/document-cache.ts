/**
 * In-memory cache for documents the viewer pages through.
 *
 * The chunk tool addresses a document by character offset, so it has to keep
 * reading the *same* string the first response was cut from — a re-fetch can
 * produce a different metadata header and shift every offset. The cache is what
 * makes that string outlive a single tool call.
 *
 * It is created per `registerAllTools()` call, which means per session on HTTP
 * and per process on stdio, and is bounded by a character budget rather than by
 * entry count alone: with `MAX_SESSIONS = 100` any per-session entry limit is
 * multiplied by a hundred, and RIS documents differ in size by two orders of
 * magnitude.
 */

import type { OutlineEntry } from './formatting.js';

/** A document as the viewer consumes it: rendered text plus its jump targets. */
export interface CachedDocument {
  /** Markdown rendering, exactly as ris_dokument produced it — before truncation. */
  text: string;
  outline: OutlineEntry[];
  /** URL the HTML came from. */
  sourceUrl: string;
}

export interface DocumentCache {
  /** Looks up `key` directly, then as an alias. */
  get(key: string): CachedDocument | undefined;
  /** `alias` is the resolved content URL; ignored when equal to `key`. */
  set(key: string, value: CachedDocument, alias?: string): void;
  /** Live entries — for tests and diagnostics. */
  readonly size: number;
  /** Characters currently held — the bound that actually matters. */
  readonly chars: number;
}

export interface DocumentCacheOptions {
  maxEntries?: number;
  maxChars?: number;
  ttlMs?: number;
  /** Injectable clock; tests drive TTL expiry without timers. */
  now?: () => number;
}

interface CacheEntry {
  value: CachedDocument;
  storedAt: number;
}

const DEFAULT_MAX_ENTRIES = 10;
const DEFAULT_MAX_CHARS = 1_000_000;
const DEFAULT_TTL_MS = 600_000;

/**
 * Create a bounded, least-recently-used document cache.
 *
 * A document is reachable under two keys: its Dokumentnummer and its resolved
 * content URL. `ris_dokument` and the chunk tool may each be called with either
 * one, and nothing guarantees the viewer holds the same identifier the document
 * was opened with — a single key would miss on exactly that crossing and turn
 * every chunk into a fetch, which looks correct and is merely slow.
 */
export function createDocumentCache(options: DocumentCacheOptions = {}): DocumentCache {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now;

  /** Insertion order doubles as LRU order: oldest first. */
  const entries = new Map<string, CacheEntry>();
  /** alias → primary key. Holds no copy of the text, so it costs no budget. */
  const aliases = new Map<string, string>();
  let chars = 0;

  function drop(key: string): void {
    const entry = entries.get(key);
    if (!entry) {
      return;
    }
    entries.delete(key);
    chars -= entry.value.text.length;
    for (const [alias, primary] of aliases) {
      if (primary === key) {
        aliases.delete(alias);
      }
    }
  }

  return {
    get(key: string): CachedDocument | undefined {
      const primary = entries.has(key) ? key : aliases.get(key);
      if (primary === undefined) {
        return undefined;
      }

      const entry = entries.get(primary);
      if (!entry) {
        // A dangling alias — its entry was evicted. Nothing else refers to it.
        aliases.delete(key);
        return undefined;
      }

      // TTL is checked on read rather than on a timer: a timer would keep the
      // process alive and buy nothing, since an unread entry costs only memory
      // the eviction below reclaims anyway.
      if (now() - entry.storedAt > ttlMs) {
        drop(primary);
        return undefined;
      }

      // Re-insert to move the entry to the young end of the map.
      entries.delete(primary);
      entries.set(primary, entry);
      return entry.value;
    },

    set(key: string, value: CachedDocument, alias?: string): void {
      // Caching a document larger than the whole budget would evict everything
      // else and still overshoot, so it is not cached at all. The chunk path
      // stays correct, it just re-fetches per call.
      if (value.text.length > maxChars) {
        return;
      }

      drop(key);
      aliases.delete(key);
      entries.set(key, { value, storedAt: now() });
      chars += value.text.length;

      if (alias !== undefined && alias !== key) {
        // The alias may have been a primary key of its own before (the document
        // was opened by URL, now it arrives by Dokumentnummer); that entry is
        // the same document under a second copy, so it goes.
        drop(alias);
        aliases.set(alias, key);
      }

      while (entries.size > maxEntries || chars > maxChars) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        drop(oldest);
      }
    },

    get size(): number {
      return entries.size;
    },

    get chars(): number {
      return chars;
    },
  };
}
