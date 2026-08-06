import type { Page } from '@playwright/test';

import type { HostSimCall } from './host-stub.js';

/** The requests the stub recorded for one method, in the order they arrived. */
export async function recordedMessages(page: Page, method: string): Promise<HostSimCall[]> {
  const calls = await page.evaluate(
    () => (window as unknown as { __hostSim: { calls: HostSimCall[] } }).__hostSim.calls,
  );

  return calls.filter((call) => call.method === method);
}

/** The `tools/call` requests the stub recorded, in the order they arrived. */
export async function recordedToolCalls(page: Page): Promise<HostSimCall[]> {
  return recordedMessages(page, 'tools/call');
}
