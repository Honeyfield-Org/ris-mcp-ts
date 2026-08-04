import { expect, test } from '@playwright/test';

import { VIEWER_HTML } from '../../src/generated/viewer-html.js';
import { NORM_MARKDOWN, SHORT_CHUNK } from '../../ui/__fixtures__/document-chunks.js';

import { installHostSim, type HostSimCall } from './host-stub.js';

/**
 * A `ris_dokument` result as the server emits it: the same text in the text
 * block and in the structured payload, which is what lets a host deliver either
 * one. `total_length` matches the text, so this document needs no further
 * section beyond the canonical first one.
 */
const MOUNT_RESULT = {
  content: [{ type: 'text', text: NORM_MARKDOWN }],
  structuredContent: {
    text: NORM_MARKDOWN,
    total_length: NORM_MARKDOWN.length,
    dokumentnummer: SHORT_CHUNK.dokumentnummer,
    source_url: SHORT_CHUNK.source_url,
  },
};

/** The `ris_dokument_abschnitt` answer that supersedes the provisional mount. */
const SECTION_RESULT = {
  content: [{ type: 'text', text: SHORT_CHUNK.text }],
  structuredContent: SHORT_CHUNK,
};

test('mounts the viewer and renders the document text', async ({ page }) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: VIEWER_HTML,
    mountResult: MOUNT_RESULT,
    // The mount text is a truncated prefix, so the viewer always continues it
    // with the canonical first section. Without an answer for that call the
    // smoke would measure the expired-session branch instead.
    callAnswers: [{ result: SECTION_RESULT }],
  });

  const widget = page.frameLocator('iframe');
  await expect(widget.locator('.ris-doc-title')).toHaveText(
    '§ 1295 Allgemeines bürgerliches Gesetzbuch (JGS Nr. 946/1811)',
  );
  await expect(widget.locator('.ris-doc-text')).toContainText('Jedermann ist berechtigt');
  // The nojs marker answers "did the bundle run at all" — it must be gone.
  await expect(widget.locator('#nojs-marker')).toBeHidden();

  // The provisional run always carries a sentinel; the canonical section says
  // `next_offset: null` and takes it away. Its absence is what tells the two
  // renders apart, since both hold the same text.
  await expect(widget.locator('.ris-doc-sentinel')).toHaveCount(0);

  const calls = await page.evaluate(
    () => (window as unknown as { __hostSim: { calls: HostSimCall[] } }).__hostSim.calls,
  );
  // Exactly one: the observer is disconnected while a call runs, and a document
  // that ends with its first section must not keep asking for more.
  const sectionCalls = calls.filter((call) => call.method === 'tools/call');
  expect(sectionCalls).toHaveLength(1);

  const params = sectionCalls[0]?.params as { name: string; arguments: Record<string, unknown> };
  expect(params.name).toBe('ris_dokument_abschnitt');
  expect(params.arguments).toMatchObject({ dokumentnummer: 'NOR12019037', offset: 0 });

  // Nothing degraded on the way: every failure state of the viewer is a notice.
  await expect(widget.locator('.ris-notice-title')).toHaveCount(0);
});
