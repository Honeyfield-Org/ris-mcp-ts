import { expect, test } from '@playwright/test';

import { TREFFERLISTE_HTML } from '../../src/generated/trefferliste-html.js';
import { COURT_RESULT, LAW_RESULT } from '../../ui/__fixtures__/search-results.js';

import { installHostSim } from './host-stub.js';

/** A CallToolResult as the host would deliver it to the widget. */
function toolResult(structuredContent: unknown): unknown {
  return { content: [{ type: 'text', text: 'Gefunden' }], structuredContent };
}

test('mounts the bundle and renders the fixture rows', async ({ page }) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: TREFFERLISTE_HTML,
    mountResult: toolResult(LAW_RESULT),
  });

  const widget = page.frameLocator('iframe');
  await expect(widget.locator('.ris-row-title')).toHaveCount(2);
  // The nojs marker answers "did the bundle run at all" — it must be gone.
  await expect(widget.locator('#nojs-marker')).toBeHidden();
});

test('a pagination click issues tools/call with seite+1 and renders the answer', async ({
  page,
}) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: TREFFERLISTE_HTML,
    mountResult: toolResult(LAW_RESULT),
    callAnswers: [{ result: toolResult(COURT_RESULT) }],
  });

  const widget = page.frameLocator('iframe');
  await widget.getByRole('button', { name: 'Nächste Seite' }).click();

  await expect(widget.locator('.ris-row-title').first()).toHaveText('2Ob535/90');

  const calls = await page.evaluate(
    () =>
      (window as unknown as { __hostSim: { calls: { method: string; params: unknown }[] } })
        .__hostSim.calls,
  );
  const pageCall = calls.find((call) => call.method === 'tools/call');
  const params = pageCall?.params as { name: string; arguments: Record<string, unknown> };
  expect(params.name).toBe(String(LAW_RESULT.query?.tool));
  expect(params.arguments.seite).toBe(2);
});
