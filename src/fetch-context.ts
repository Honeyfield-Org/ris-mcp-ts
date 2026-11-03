/**
 * Per-call fetch override for RIS requests.
 *
 * The RIS client functions call {@link risFetch} instead of the global `fetch`.
 * A host that embeds the tools (see `library.ts`) runs each tool call inside
 * {@link runWithFetch}, so its fetch — with a shared cache or a global rate
 * limit in front of the RIS — applies to exactly that call. AsyncLocalStorage
 * keeps concurrent calls of different servers apart without threading the
 * function through every client signature.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const storage = new AsyncLocalStorage<FetchLike>();

/** Runs `fn` with `fetchImpl` as the RIS fetch for everything it awaits. */
export function runWithFetch<T>(
  fetchImpl: FetchLike | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return fetchImpl === undefined ? fn() : storage.run(fetchImpl, fn);
}

/** The fetch for the current call: the host's override, otherwise the global one. */
export function risFetch(url: string, init: RequestInit): Promise<Response> {
  const override = storage.getStore();
  return override === undefined ? fetch(url, init) : override(url, init);
}
