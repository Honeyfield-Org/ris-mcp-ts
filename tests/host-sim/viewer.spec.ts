import { expect, test } from '@playwright/test';

import { VIEWER_HTML } from '../../src/generated/viewer-html.js';
import { NORM_MARKDOWN, SHORT_CHUNK } from '../../ui/__fixtures__/document-chunks.js';

import { recordedToolCalls } from './helpers.js';
import { installHostSim } from './host-stub.js';

/**
 * The § 1295 Abs 2 line the mount text stops short of.
 *
 * The mounting text is a *truncated* rendering, so the canonical first section
 * legitimately carries more than it — and here that difference is also what
 * makes adoption observable: this line can only be on screen because the
 * `ris_dokument_abschnitt` answer replaced the provisional run.
 */
const SECTION_ONLY_LINE =
  '(2) Auch wer in einer gegen die guten Sitten verstoßenden Weise absichtlich Schaden zufügt, ist dafür verantwortlich.';

/** The canonical first section: the mount text plus the line it was cut before. */
const SECTION_TEXT = `${NORM_MARKDOWN}\n${SECTION_ONLY_LINE}`;

/**
 * A `ris_dokument` result as the server emits it: the same text in the text
 * block and in the structured payload, which is what lets a host deliver either
 * one, alongside the document's *untruncated* length.
 */
const MOUNT_RESULT = {
  content: [{ type: 'text', text: NORM_MARKDOWN }],
  structuredContent: {
    text: NORM_MARKDOWN,
    total_length: SECTION_TEXT.length,
    dokumentnummer: SHORT_CHUNK.dokumentnummer,
    source_url: SHORT_CHUNK.source_url,
  },
};

/**
 * The `ris_dokument_abschnitt` answer that supersedes the provisional mount.
 *
 * `total_length` agrees with the mount's, so the viewer treats this as the same
 * document rather than as one refetched at a different length, and
 * `next_offset: null` ends the series.
 */
const SECTION_RESULT = {
  content: [{ type: 'text', text: SECTION_TEXT }],
  structuredContent: { ...SHORT_CHUNK, text: SECTION_TEXT, total_length: SECTION_TEXT.length },
};

test('mounts the viewer and renders the document text', async ({ page }) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: VIEWER_HTML,
    mountResult: MOUNT_RESULT,
    // The mount text is a truncated prefix, so the viewer continues it with the
    // canonical first section — since #92 eagerly, at mount, for every document
    // it can name. Without an answer for that call the smoke would measure the
    // expired-session branch instead.
    callAnswers: [{ result: SECTION_RESULT }],
  });

  const widget = page.frameLocator('iframe');
  await expect(widget.locator('.ris-doc-title')).toHaveText(
    '§ 1295 Allgemeines bürgerliches Gesetzbuch (JGS Nr. 946/1811)',
  );
  await expect(widget.locator('.ris-doc-text')).toContainText('Jedermann ist berechtigt');
  // The nojs marker answers "did the bundle run at all" — it must be gone.
  await expect(widget.locator('#nojs-marker')).toBeHidden();

  // Only the canonical section carries this line: the answer was adopted, not
  // merely fetched.
  await expect(widget.locator('.ris-doc-text')).toContainText(SECTION_ONLY_LINE);
  // And the series ended — `next_offset: null` takes the sentinel away.
  await expect(widget.locator('.ris-doc-sentinel')).toHaveCount(0);

  // Exactly one: the mount asks for offset 0 by itself, and a document that ends
  // with that section — `next_offset: null` — has nothing left to ask for. That
  // the observer is disconnected while a call runs only matters for the
  // documents that do continue.
  const sectionCalls = await recordedToolCalls(page);
  expect(sectionCalls).toHaveLength(1);

  const params = sectionCalls[0]?.params as { name: string; arguments: Record<string, unknown> };
  expect(params.name).toBe('ris_dokument_abschnitt');
  expect(params.arguments).toMatchObject({ dokumentnummer: 'NOR12019037', offset: 0 });

  // Nothing degraded on the way: every failure state of the viewer is a notice.
  await expect(widget.locator('.ris-notice-title')).toHaveCount(0);
});

test('a slow section call keeps the mount text on screen until it arrives', async ({ page }) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: VIEWER_HTML,
    mountResult: MOUNT_RESULT,
    callAnswers: [{ delayMs: 1_500, result: SECTION_RESULT }],
  });

  const widget = page.frameLocator('iframe');
  // While the eager section is in flight: the sentinel is on screen, and —
  // unlike the Trefferliste's paging — nothing is replaced by a skeleton. A
  // section is appended, so the mount text must survive the wait.
  await expect(widget.locator('.ris-doc-sentinel')).toHaveCount(1);
  await expect(widget.locator('.ris-doc-text')).toContainText('Jedermann ist berechtigt');

  await expect(widget.locator('.ris-doc-text')).toContainText(SECTION_ONLY_LINE);
  await expect(widget.locator('.ris-doc-sentinel')).toHaveCount(0);
});
