import { expect, test } from '@playwright/test';

import { TREFFERLISTE_HTML } from '../../src/generated/trefferliste-html.js';
import { COURT_RESULT, LAW_RESULT } from '../../ui/__fixtures__/search-results.js';
import { COPY } from '../../ui/shared/states.js';

import { installHostSim, type HostSimCall } from './host-stub.js';

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
    () => (window as unknown as { __hostSim: { calls: HostSimCall[] } }).__hostSim.calls,
  );
  // Exactly one: the `pending` guard in `goToPage` must keep a re-render of the
  // pagination buttons from firing the same page a second time.
  const pageCalls = calls.filter((call) => call.method === 'tools/call');
  expect(pageCalls).toHaveLength(1);

  const params = pageCalls[0]?.params as { name: string; arguments: Record<string, unknown> };
  expect(params.name).toBe(String(LAW_RESULT.query?.tool));
  // The whole echo travels, not just the page number — the next page of *this*
  // search is only the same search with `seite` incremented.
  expect(params.arguments).toMatchObject({ suchworte: 'Schadenersatz', seite: 2 });

  // The call count above is one snapshot in time. A second call arriving after
  // it would consume the stub's default rpcError and put a notice on screen, so
  // this retrying assertion is what makes "exactly one" hold for good.
  await expect(widget.locator('.ris-notice-title')).toHaveCount(0);
});

test('a rejected page call keeps the list and shows the notice beneath it', async ({ page }) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: TREFFERLISTE_HTML,
    mountResult: toolResult(LAW_RESULT),
    callAnswers: [{ rpcError: 'session evicted' }],
  });

  const widget = page.frameLocator('iframe');
  await widget.getByRole('button', { name: 'Nächste Seite' }).click();

  await expect(widget.locator('.ris-notice-title')).toHaveText(COPY.sessionExpired);
  // The rows are the point: the skeleton replaced them for the duration of the
  // call, and the failure has to put the page the user was reading back.
  await expect(widget.locator('.ris-row-title')).toHaveCount(2);
});

test('a server-side tool error keeps the list and reports the RIS message', async ({ page }) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: TREFFERLISTE_HTML,
    mountResult: toolResult(LAW_RESULT),
    // A different branch from the rejection above: the call itself succeeded and
    // the *tool* failed, so the widget has German prose from the server to show
    // rather than a transport failure to explain.
    callAnswers: [
      {
        result: {
          content: [{ type: 'text', text: 'RIS-Fehler: Upstream nicht erreichbar' }],
          isError: true,
        },
      },
    ],
  });

  const widget = page.frameLocator('iframe');
  await widget.getByRole('button', { name: 'Nächste Seite' }).click();

  await expect(widget.locator('.ris-notice-title')).toHaveText(COPY.toolErrorTitle);
  // The server's own words, not a generic failure line — that is what separates
  // this notice from the evicted-session one.
  await expect(widget.locator('.ris-notice-detail')).toHaveText(
    'RIS-Fehler: Upstream nicht erreichbar',
  );
  await expect(widget.locator('.ris-row-title')).toHaveCount(2);
});

test('a slow page call shows the skeleton until the answer arrives', async ({ page }) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: TREFFERLISTE_HTML,
    mountResult: toolResult(LAW_RESULT),
    callAnswers: [{ delayMs: 1_000, result: toolResult(COURT_RESULT) }],
  });

  const widget = page.frameLocator('iframe');
  await widget.getByRole('button', { name: 'Nächste Seite' }).click();

  await expect(widget.locator('.ris-skeleton')).toBeVisible();
  await expect(widget.locator('.ris-row-title').first()).toHaveText('2Ob535/90');
});
