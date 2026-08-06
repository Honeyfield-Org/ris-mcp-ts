import { expect, test, type Locator, type Page } from '@playwright/test';

import { VIEWER_HTML } from '../../src/generated/viewer-html.js';
import {
  BIG_DOKUMENTNUMMER,
  BIG_MOUNT_TEXT,
  BIG_SOURCE_URL,
  BIG_TOTAL,
  NORM_MARKDOWN,
  SHORT_CHUNK,
  bigChunk,
} from '../../ui/__fixtures__/document-chunks.js';

import { recordedMessages, recordedToolCalls } from './helpers.js';
import { installHostSim, type HostSimDisplayModeAnswer } from './host-stub.js';

/**
 * The #80 scenario class: everything about fullscreen that only a real host can
 * answer — what the widget declares in the handshake, what the host answers a
 * request with, and what a re-layout does to the pane the reader is in. The unit
 * tests cover the branches; these cover the protocol and the geometry.
 */

const TITLE = '§ 1295 Allgemeines bürgerliches Gesetzbuch (JGS Nr. 946/1811)';

/** The mounting `ris_dokument` result: the same text in both channels. */
const MOUNT_RESULT = {
  content: [{ type: 'text', text: NORM_MARKDOWN }],
  structuredContent: {
    text: NORM_MARKDOWN,
    total_length: SHORT_CHUNK.total_length,
    dokumentnummer: SHORT_CHUNK.dokumentnummer,
    source_url: SHORT_CHUNK.source_url,
  },
};

/**
 * The answer to the eager offset-0 call every mount makes for a document it can
 * name. Without it the stub's default rpcError would put the expired-session
 * notice on screen and every „nothing degraded“ guard below would be measuring
 * that instead.
 */
const SECTION_RESULT = {
  content: [{ type: 'text', text: SHORT_CHUNK.text }],
  structuredContent: SHORT_CHUNK,
};

/**
 * A host that offers fullscreen. `availableDisplayModes` is the *only* feature
 * detection there is — the widget declares what it can render, the host answers
 * with what it has, and the toggle follows the answer.
 */
const OFFERING_HOST = {
  theme: 'light',
  displayMode: 'inline',
  availableDisplayModes: ['inline', 'fullscreen'],
};

/** A host that gives the mode it was asked for. */
const GRANTS_FULLSCREEN: HostSimDisplayModeAnswer[] = [{ mode: 'fullscreen' }];

/**
 * A host that refuses — by answering with the mode already in effect, which is
 * the only way a refusal ever arrives. Typed rather than inline because the mode
 * would otherwise widen to `string` on its way through `page.evaluate`.
 */
const REFUSES_FULLSCREEN: HostSimDisplayModeAnswer[] = [{ mode: 'inline' }];

/** The big-document mount of the #95 class: outline only in the offset-0 section. */
const BIG_MOUNT_RESULT = {
  content: [{ type: 'text', text: BIG_MOUNT_TEXT }],
  structuredContent: {
    text: BIG_MOUNT_TEXT,
    total_length: BIG_TOTAL,
    dokumentnummer: BIG_DOKUMENTNUMMER,
    source_url: BIG_SOURCE_URL,
  },
};

/** Its first section, the one the eager mount call asks for. */
const BIG_SECTION = bigChunk(0);
const FIRST_BIG_SECTION = {
  content: [{ type: 'text', text: BIG_SECTION.text }],
  structuredContent: BIG_SECTION,
};

/** What the widget declared in the handshake, as the stub recorded it. */
async function declaredDisplayModes(page: Page): Promise<unknown> {
  const handshakes = await recordedMessages(page, 'ui/initialize');
  expect(handshakes).toHaveLength(1);

  const params = handshakes[0]?.params as
    | { appCapabilities?: { availableDisplayModes?: unknown } }
    | undefined;

  return params?.appCapabilities?.availableDisplayModes;
}

/** Change the host context mid-test, as a host does when it re-lays the widget out. */
async function pushHostContext(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate((delta) => {
    (
      window as unknown as {
        __hostSim: { pushHostContext: (patch: Record<string, unknown>) => void };
      }
    ).__hostSim.pushHostContext(delta);
  }, patch);
}

/**
 * The reading pane's scroll state and where one section heading sits in it.
 *
 * `heading` is pixels below the top of the pane, so negative means the reader
 * has scrolled past it; `NaN` when the heading is not rendered at all, which
 * fails every comparison rather than passing one. Layout is synchronous, so all
 * three numbers are read in the same pass and describe the same moment.
 */
async function paneGeometry(
  textPane: Locator,
  offset: number,
): Promise<{ heading: number; scrollTop: number; scrollHeight: number }> {
  return textPane.evaluate((pane, id) => {
    const heading = pane.querySelector(`#${id}`);
    const top = heading
      ? heading.getBoundingClientRect().top - pane.getBoundingClientRect().top
      : Number.NaN;

    return {
      heading: Math.round(top),
      scrollTop: Math.round(pane.scrollTop),
      scrollHeight: Math.round(pane.scrollHeight),
    };
  }, `ris-sec-${offset}`);
}

test('declares fullscreen at initialize and shows the toggle when the host offers it', async ({
  page,
}) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: VIEWER_HTML,
    mountResult: MOUNT_RESULT,
    hostContext: OFFERING_HOST,
    callAnswers: [{ result: SECTION_RESULT }],
  });

  const widget = page.frameLocator('iframe');
  await expect(widget.locator('.ris-doc-title')).toHaveText(TITLE);
  await expect(widget.getByRole('button', { name: 'Vollbild' })).toHaveCount(1);

  // The declaration is what makes a host offer the mode in the first place, and
  // it travels in the handshake — nothing later in the session can add it.
  expect(await declaredDisplayModes(page)).toEqual(['inline', 'fullscreen']);

  await expect(widget.locator('.ris-notice-title')).toHaveCount(0);
});

test('a host that offers no fullscreen mode gets the same declaration and no toggle', async ({
  page,
}) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: VIEWER_HTML,
    mountResult: MOUNT_RESULT,
    // The stub's default context: a theme and nothing else, i.e. every host that
    // has no fullscreen surface to give.
    callAnswers: [{ result: SECTION_RESULT }],
  });

  const widget = page.frameLocator('iframe');
  await expect(widget.locator('.ris-doc-title')).toHaveText(TITLE);
  // The header's other action, so „no Vollbild button“ below is a statement
  // about that button rather than about a header that failed to render.
  await expect(widget.getByRole('button', { name: 'Im RIS öffnen' })).toHaveCount(1);
  await expect(widget.getByRole('button', { name: 'Vollbild' })).toHaveCount(0);

  // Unchanged by the answer: the widget states what it can render, not what it
  // expects to get. A declaration that followed the host would be circular.
  expect(await declaredDisplayModes(page)).toEqual(['inline', 'fullscreen']);

  await expect(widget.locator('.ris-notice-title')).toHaveCount(0);
});

test('a granted fullscreen request hides the toggle and keeps the document', async ({ page }) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: VIEWER_HTML,
    mountResult: MOUNT_RESULT,
    hostContext: OFFERING_HOST,
    callAnswers: [{ result: SECTION_RESULT }],
    displayModeAnswers: GRANTS_FULLSCREEN,
  });

  const widget = page.frameLocator('iframe');
  const toggle = widget.getByRole('button', { name: 'Vollbild' });
  const textPane = widget.locator('.ris-doc-text');
  await expect(textPane).toContainText('Jedermann ist berechtigt');
  await expect(toggle).toHaveCount(1);

  await toggle.click();

  // Granted, so the widget is in the mode and the button that asks for it has
  // nothing left to ask: the host renders its own way back out.
  await expect(toggle).toHaveCount(0);
  // And the document went nowhere. A mode switch re-renders the pane, which is
  // exactly the moment a viewer could lose what the reader was reading.
  await expect(textPane).toContainText('Jedermann ist berechtigt');

  const requests = await recordedMessages(page, 'ui/request-display-mode');
  expect(requests).toHaveLength(1);
  expect(requests[0]?.params).toMatchObject({ mode: 'fullscreen' });

  await expect(widget.locator('.ris-notice-title')).toHaveCount(0);
});

test('a silently declined request shows the German notice and keeps everything', async ({
  page,
}) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: VIEWER_HTML,
    mountResult: MOUNT_RESULT,
    hostContext: OFFERING_HOST,
    callAnswers: [{ result: SECTION_RESULT }],
    // A refusal is an answer, not an error: the host replies with the mode still
    // in effect, and the widget has to read the answer rather than its own wish.
    displayModeAnswers: REFUSES_FULLSCREEN,
  });

  const widget = page.frameLocator('iframe');
  const toggle = widget.getByRole('button', { name: 'Vollbild' });
  const textPane = widget.locator('.ris-doc-text');
  await expect(textPane).toContainText('Jedermann ist berechtigt');

  await toggle.click();

  // The literal wording rather than the COPY constant: what a refusal says to
  // the reader is the whole user-visible contract of this branch.
  await expect(widget.locator('#ris-status .ris-notice-title')).toHaveText(
    'Vollbild ist hier nicht verfügbar.',
  );
  // Nothing was taken away for a request that changed nothing: the reader can
  // try again, and the document is untouched.
  await expect(toggle).toHaveCount(1);
  await expect(textPane).toContainText('Jedermann ist berechtigt');

  const requests = await recordedMessages(page, 'ui/request-display-mode');
  expect(requests).toHaveLength(1);
  // That one notice and no other — a second one would mean the refusal also
  // broke something it merely reported on.
  await expect(widget.locator('.ris-notice-title')).toHaveCount(1);
});

test('a host-initiated mode delta without dimensions keeps the pane height', async ({ page }) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: VIEWER_HTML,
    mountResult: MOUNT_RESULT,
    hostContext: { ...OFFERING_HOST, containerDimensions: { height: 420, width: 800 } },
    callAnswers: [{ result: SECTION_RESULT }],
  });

  const widget = page.frameLocator('iframe');
  const root = widget.locator('.ris-doc-root');
  const toggle = widget.getByRole('button', { name: 'Vollbild' });
  await expect(widget.locator('.ris-doc-title')).toHaveText(TITLE);
  // The host sized the container and the viewer filled it. Everything below is
  // about that number surviving a change that says nothing about it.
  await expect(root).toHaveCSS('height', '420px');
  await expect(toggle).toHaveCount(1);

  // Only after the mount assertions above: a push before the handshake is
  // delivered to nobody and vanishes without a trace.
  await pushHostContext(page, { displayMode: 'fullscreen' });

  await expect(toggle).toHaveCount(0);
  // The regression this pins: recomputing the height from a delta that carries
  // no `containerDimensions` answered "no dimensions" with the 640px fallback
  // and resized a pane the host had sized.
  await expect(root).toHaveCSS('height', '420px');

  await pushHostContext(page, { displayMode: 'inline' });

  // Back out of fullscreen the same way — a host that takes the mode away is as
  // ordinary as one that grants it, and the toggle follows the mode either way.
  await expect(toggle).toHaveCount(1);
  await expect(root).toHaveCSS('height', '420px');

  await expect(widget.locator('.ris-notice-title')).toHaveCount(0);
});

test('a geometry change preserves the reading position by content offset', async ({ page }) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: VIEWER_HTML,
    mountResult: BIG_MOUNT_RESULT,
    hostContext: {
      theme: 'light',
      displayMode: 'inline',
      containerDimensions: { height: 420, width: 800 },
    },
    // The eager offset-0 call, whose section carries the outline and the anchors
    // the position is expressed in. Nothing here earns a second one.
    callAnswers: [{ result: FIRST_BIG_SECTION }],
  });

  const widget = page.frameLocator('iframe');
  const textPane = widget.locator('.ris-doc-text');
  const root = widget.locator('.ris-doc-root');
  // The rail rather than the text: the mount run carries the same opening line,
  // and waiting on the outline pins the scroll below to the side after adoption.
  await expect(widget.locator('.ris-outline-jump')).toHaveCount(10);
  await expect(root).toHaveCSS('height', '420px');

  // Read 200px into section 2 — past its heading, which is what makes the
  // measurement below say something: a pane whose pixel scroll is merely carried
  // over leaves the heading exactly where it is, above the fold.
  await textPane.evaluate((pane, id) => {
    const heading = pane.querySelector(`#${id}`);
    if (!heading) return;

    pane.scrollTop += heading.getBoundingClientRect().top - pane.getBoundingClientRect().top + 200;
  }, 'ris-sec-10000');
  const before = await paneGeometry(textPane, 10_000);
  expect(before.heading).toBeLessThan(-150);

  // The reading position is scroll-debounced (`ANCHOR_DEBOUNCE_MS` = 500 in
  // main.ts) and there is no host-visible signal when it lands — a snapshot
  // write is a no-op in a host with no `window.openai`. Pushing the geometry
  // before the timer fires would find the anchor still at offset 0, so the wait
  // is the measurement rather than a guess at one.
  await page.waitForTimeout(900);

  await pushHostContext(page, { containerDimensions: { height: 1100, width: 1400 } });
  // The re-render is synchronous inside the context handler and nothing here
  // scrolls smoothly, so the height arriving means the re-anchor has happened.
  await expect(root).toHaveCSS('height', '1100px');

  const after = await paneGeometry(textPane, 10_000);
  // What makes the assertion below say something: the text did not reflow — only
  // the pane's height changed — so a viewer that merely carried the pixel scroll
  // over would have left the heading where it was, 200px above the fold.
  expect(after.scrollHeight).toBe(before.scrollHeight);
  expect(after.scrollTop).not.toBe(before.scrollTop);
  // The claim itself: the reader is back at the top of the section they were in,
  // because the position travelled as a content offset rather than as pixels.
  // Measured 0 — the bound leaves room for subpixel layout, not for a line.
  expect(after.heading).toBeGreaterThanOrEqual(0);
  expect(after.heading).toBeLessThan(8);

  // The re-layout is not a reason to fetch anything: the text on screen is the
  // text that was on screen, and the sentinel stayed out of the prefetch margin.
  expect(await recordedToolCalls(page)).toHaveLength(1);
  await expect(widget.locator('.ris-notice-title')).toHaveCount(0);
});
