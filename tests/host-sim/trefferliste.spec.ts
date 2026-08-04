import { expect, test } from '@playwright/test';

import { TREFFERLISTE_HTML } from '../../src/generated/trefferliste-html.js';
import { LAW_RESULT } from '../../ui/__fixtures__/search-results.js';

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
