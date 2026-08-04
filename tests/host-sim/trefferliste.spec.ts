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

test('picking a Rechtslage date re-issues the search with fassung_vom and page 1', async ({
  page,
}) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: TREFFERLISTE_HTML,
    mountResult: toolResult(LAW_RESULT),
    // What a re-issued `ris_bundesrecht` really answers with: law results whose
    // echo carries the new date. A judikatur payload would do to prove the
    // round trip, but it renders no control — and `focusFassung` is silent
    // where the new page has none, so focus would have nothing to return to.
    callAnswers: [
      {
        result: toolResult({
          ...LAW_RESULT,
          total_hits: 7,
          query: { ...LAW_RESULT.query, fassung_vom: '2020-01-01' },
        }),
      },
    ],
  });

  const widget = page.frameLocator('iframe');
  // A real `input[type=date]` in a real browser: `fill` sets the value and
  // fires the `change` the control listens for, which is the whole point of
  // running this scenario outside jsdom.
  await widget.locator('.ris-fassung-input').fill('2020-01-01');

  // The answer's own hit count — the mount payload says 2.570, so this is what
  // separates the new page from the one the user was looking at.
  await expect(widget.locator('.ris-hits')).toHaveText('7 Treffer');
  await expect(widget.locator('.ris-row-title')).toHaveCount(2);
  await expect(widget.locator('.ris-fassung-input')).toHaveValue('2020-01-01');
  // The header was replaced along with the list, so the field the user just
  // left is a different element — restoring focus is not a no-op.
  await expect(widget.locator('.ris-fassung-input')).toBeFocused();

  const calls = await page.evaluate(
    () => (window as unknown as { __hostSim: { calls: HostSimCall[] } }).__hostSim.calls,
  );
  const toolCalls = calls.filter((call) => call.method === 'tools/call');
  expect(toolCalls).toHaveLength(1);
  // The date rides on the whole echo, and `seite` resets: page 4 of a different
  // Rechtslage is not the page the user was on.
  expect((toolCalls[0]?.params as { arguments: Record<string, unknown> }).arguments).toMatchObject({
    fassung_vom: '2020-01-01',
    suchworte: 'Schadenersatz',
    seite: 1,
  });
  // Same guard as the pagination scenario: a second call would consume the
  // stub's default rpcError and leave a notice behind.
  await expect(widget.locator('.ris-notice-title')).toHaveCount(0);
});

test('clearing the date re-issues the search without fassung_vom', async ({ page }) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: TREFFERLISTE_HTML,
    mountResult: toolResult({
      ...LAW_RESULT,
      query: { ...LAW_RESULT.query, fassung_vom: '2020-01-01' },
    }),
    callAnswers: [{ result: toolResult(COURT_RESULT) }],
  });

  const widget = page.frameLocator('iframe');
  await expect(widget.locator('.ris-fassung-input')).toHaveValue('2020-01-01');
  await widget.locator('.ris-fassung-input').fill('');

  await expect(widget.locator('.ris-row-title').first()).toHaveText('2Ob535/90');

  const calls = await page.evaluate(
    () => (window as unknown as { __hostSim: { calls: HostSimCall[] } }).__hostSim.calls,
  );
  const toolCalls = calls.filter((call) => call.method === 'tools/call');
  expect(toolCalls).toHaveLength(1);
  const args = (toolCalls[0]?.params as { arguments: Record<string, unknown> }).arguments;
  // Not `fassung_vom: ''` — that would reach the server as a date and fail its
  // validation; an emptied field means "current version", i.e. no argument.
  expect(args).not.toHaveProperty('fassung_vom');
  expect(args).toMatchObject({ seite: 1 });
});

test('the judikatur list has no Rechtslage control', async ({ page }) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: TREFFERLISTE_HTML,
    mountResult: toolResult(COURT_RESULT),
  });

  const widget = page.frameLocator('iframe');
  await expect(widget.locator('.ris-row-title').first()).toHaveText('2Ob535/90');
  // Court decisions have no dated Fassung, so a date field would promise a
  // filter the results do not honour.
  await expect(widget.locator('.ris-fassung')).toHaveCount(0);
});

test('a failed Rechtslage change keeps the list on screen', async ({ page }) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: TREFFERLISTE_HTML,
    mountResult: toolResult(LAW_RESULT),
    callAnswers: [{ rpcError: 'session evicted' }],
  });

  const widget = page.frameLocator('iframe');
  await widget.locator('.ris-fassung-input').fill('2020-01-01');

  await expect(widget.locator('.ris-notice-title')).toHaveText(COPY.sessionExpired);
  await expect(widget.locator('.ris-row-title')).toHaveCount(2);
  // The restored render is a new header too, so focus has to be put back on
  // the failure path as much as on the successful one.
  await expect(widget.locator('.ris-fassung-input')).toBeFocused();
});
