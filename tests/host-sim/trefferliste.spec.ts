import { expect, test, type Page } from '@playwright/test';

import { TREFFERLISTE_HTML } from '../../src/generated/trefferliste-html.js';
import { COURT_RESULT, LAW_RESULT, VWGH_DOCUMENT } from '../../ui/__fixtures__/search-results.js';
import { COPY } from '../../ui/shared/states.js';
import type { SearchResultPayload } from '../../ui/trefferliste/viewmodel.js';

import { installHostSim, type HostSimCall } from './host-stub.js';

/** A CallToolResult as the host would deliver it to the widget. */
function toolResult(structuredContent: unknown): unknown {
  return { content: [{ type: 'text', text: 'Gefunden' }], structuredContent };
}

/** The `tools/call` requests the stub recorded, in the order they arrived. */
async function recordedToolCalls(page: Page): Promise<HostSimCall[]> {
  const calls = await page.evaluate(
    () => (window as unknown as { __hostSim: { calls: HostSimCall[] } }).__hostSim.calls,
  );

  return calls.filter((call) => call.method === 'tools/call');
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

  // Exactly one: the `pending` guard in `goToPage` must keep a re-render of the
  // pagination buttons from firing the same page a second time.
  const pageCalls = await recordedToolCalls(page);
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

  const toolCalls = await recordedToolCalls(page);
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

  const toolCalls = await recordedToolCalls(page);
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

/**
 * A Judikatur page whose echo carries both Justiz-only filters — the state a
 * change of jurisdiction has to prune.
 *
 * `tool` is spelled out because spreading an optional echo loses exactly the
 * one key the payload type requires.
 */
const JUSTIZ_FILTERED_RESULT: SearchResultPayload = {
  ...COURT_RESULT,
  query: {
    ...COURT_RESULT.query,
    tool: 'ris_judikatur',
    gericht: 'OGH',
    rechtsgebiet: 'Zivilrecht',
  },
};

/**
 * What `ris_judikatur` answers once the jurisdiction is VwGH: a VwGH document,
 * page 1, and an echo that no longer names the two Justiz-only filters — the
 * same pruning the widget asked for. An answer that echoed them back would let
 * the re-rendered row claim filters the results never had.
 */
const VWGH_RESULT: SearchResultPayload = {
  total_hits: 9,
  page: 1,
  page_size: 20,
  has_more: false,
  documents: [VWGH_DOCUMENT],
  query: {
    tool: 'ris_judikatur',
    gerichtsbarkeit: 'Vwgh',
    suchworte: 'Verjährung',
    seite: 1,
    limit: 20,
  },
};

/**
 * What the same search answers with the court filter taken off: more hits, page
 * 1 again — and `rechtsgebiet` still in the echo, because removing the chip
 * removes one argument, not every filter beside it.
 */
const WITHOUT_GERICHT_RESULT: SearchResultPayload = {
  ...COURT_RESULT,
  total_hits: 41,
  page: 1,
  has_more: true,
  query: {
    ...COURT_RESULT.query,
    tool: 'ris_judikatur',
    rechtsgebiet: 'Zivilrecht',
    seite: 1,
  },
};

test('changing the Gerichtsbarkeit re-issues the search without the Justiz-only filters', async ({
  page,
}) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: TREFFERLISTE_HTML,
    mountResult: toolResult(JUSTIZ_FILTERED_RESULT),
    callAnswers: [{ result: toolResult(VWGH_RESULT) }],
  });

  const widget = page.frameLocator('iframe');
  // The state the change starts from: Justiz, with both of its filters shown.
  await expect(widget.locator('.ris-facet-rechtsgebiet .ris-facet-select')).toHaveValue(
    'Zivilrecht',
  );
  await expect(widget.locator('.ris-facet-chip')).toContainText('OGH');

  // A real <select> in a real browser: `selectOption` sets the value and fires
  // the `change` the control listens for.
  await widget.locator('.ris-facet-gerichtsbarkeit .ris-facet-select').selectOption('Vwgh');

  // The answer's own numbers and its own row — the mount page says 24 hits and
  // leads with an OGH Rechtssatz, so this is the new page, not the old one.
  await expect(widget.locator('.ris-hits')).toHaveText('9 Treffer');
  await expect(widget.locator('.ris-row-title')).toHaveText(['Ra 2025/09/0038']);
  await expect(widget.locator('.ris-facet-gerichtsbarkeit .ris-facet-select')).toHaveValue('Vwgh');
  // Both Justiz-only controls went with the arguments behind them: the
  // Rechtsgebiet select because RIS honours it in no other jurisdiction, the
  // chip because the re-issue dropped `gericht`.
  await expect(widget.locator('.ris-facet-rechtsgebiet')).toHaveCount(0);
  await expect(widget.locator('.ris-facet-chip')).toHaveCount(0);
  // The whole row was replaced, so the select the user just used is a different
  // element — restoring focus is not a no-op.
  await expect(widget.locator('.ris-facet-gerichtsbarkeit .ris-facet-select')).toBeFocused();

  const toolCalls = await recordedToolCalls(page);
  expect(toolCalls).toHaveLength(1);
  const params = toolCalls[0]?.params as { name: string; arguments: Record<string, unknown> };
  expect(params.name).toBe('ris_judikatur');
  expect(params.arguments).toMatchObject({
    gerichtsbarkeit: 'Vwgh',
    suchworte: 'Verjährung',
    seite: 1,
  });
  // Dropped rather than carried along: RIS ignores both outside Justiz, and an
  // argument that rides the echo forever keeps narrowing a search nobody can
  // see it narrowing.
  expect(params.arguments).not.toHaveProperty('gericht');
  expect(params.arguments).not.toHaveProperty('rechtsgebiet');
  // Same guard as the pagination scenario: a second call would consume the
  // stub's default rpcError and leave a notice behind.
  await expect(widget.locator('.ris-notice-title')).toHaveCount(0);
});

test('removing the Gericht chip re-issues the search without that filter', async ({ page }) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: TREFFERLISTE_HTML,
    mountResult: toolResult(JUSTIZ_FILTERED_RESULT),
    callAnswers: [{ result: toolResult(WITHOUT_GERICHT_RESULT) }],
  });

  const widget = page.frameLocator('iframe');
  // The chip says which filter it is, not just its value — „OGH" alone would
  // not tell the reader what is being filtered by.
  await expect(widget.locator('.ris-facet-chip')).toContainText('Gericht:');

  await widget.getByRole('button', { name: 'Gericht-Filter entfernen' }).click();

  await expect(widget.locator('.ris-hits')).toHaveText('41 Treffer');
  await expect(widget.locator('.ris-row-title')).toHaveCount(2);
  await expect(widget.locator('.ris-facet-chip')).toHaveCount(0);
  // The neighbouring filter survives: the chip removes its own argument only.
  await expect(widget.locator('.ris-facet-rechtsgebiet .ris-facet-select')).toHaveValue(
    'Zivilrecht',
  );
  // Nothing is focused in its place, deliberately: the chip that carried the
  // button is gone, and grabbing a neighbouring select would drop the user
  // somewhere they never asked to be.
  await expect(widget.locator('.ris-facet-gerichtsbarkeit .ris-facet-select')).not.toBeFocused();

  const toolCalls = await recordedToolCalls(page);
  expect(toolCalls).toHaveLength(1);
  const args = (toolCalls[0]?.params as { arguments: Record<string, unknown> }).arguments;
  expect(args).not.toHaveProperty('gericht');
  expect(args).toMatchObject({ gerichtsbarkeit: 'Justiz', rechtsgebiet: 'Zivilrecht', seite: 1 });
  await expect(widget.locator('.ris-notice-title')).toHaveCount(0);
});

test('a bundesrecht list has the Rechtslage control and no facet row', async ({ page }) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: TREFFERLISTE_HTML,
    mountResult: toolResult(LAW_RESULT),
  });

  const widget = page.frameLocator('iframe');
  await expect(widget.locator('.ris-row-title')).toHaveCount(2);
  // Facets are Judikatur vocabulary — Gerichtsbarkeit and Rechtsgebiet mean
  // nothing to a statute search, and the API ignores them there.
  await expect(widget.locator('.ris-facets')).toHaveCount(0);
  // The counterpart of „the judikatur list has no Rechtslage control" above:
  // the two rows are independent, and one being absent must not take the other
  // with it.
  await expect(widget.locator('.ris-fassung-input')).toHaveCount(1);
});

test('a failed facet change keeps the list and puts the select back', async ({ page }) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: TREFFERLISTE_HTML,
    mountResult: toolResult(COURT_RESULT),
    callAnswers: [{ rpcError: 'session evicted' }],
  });

  const widget = page.frameLocator('iframe');
  await widget.locator('.ris-facet-gerichtsbarkeit .ris-facet-select').selectOption('Vwgh');

  await expect(widget.locator('.ris-notice-title')).toHaveText(COPY.sessionExpired);
  await expect(widget.locator('.ris-row-title')).toHaveCount(2);
  // The restored render is the echo of the list on screen, so the select shows
  // Justiz again — a control left on „VwGH" would claim a filter these results
  // do not have.
  await expect(widget.locator('.ris-facet-gerichtsbarkeit .ris-facet-select')).toHaveValue(
    'Justiz',
  );
  await expect(widget.locator('.ris-facet-gerichtsbarkeit .ris-facet-select')).toBeFocused();
});
