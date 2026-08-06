import type { Page } from '@playwright/test';

import type { HostSimCall } from './host-stub.js';

/** The `tools/call` requests the stub recorded, in the order they arrived. */
export async function recordedToolCalls(page: Page): Promise<HostSimCall[]> {
  const calls = await page.evaluate(
    () => (window as unknown as { __hostSim: { calls: HostSimCall[] } }).__hostSim.calls,
  );

  return calls.filter((call) => call.method === 'tools/call');
}
