import { expect, test } from '@playwright/test';

import { VIEWER_HTML } from '../../src/generated/viewer-html.js';
import {
  BIG_DOKUMENTNUMMER,
  BIG_MOUNT_PROGRESS,
  BIG_MOUNT_TEXT,
  BIG_SOURCE_URL,
  BIG_TOTAL,
  bigChunk,
} from '../../ui/__fixtures__/document-chunks.js';
import type { DocumentChunk } from '../../ui/viewer/viewmodel.js';

import { recordedToolCalls } from './helpers.js';
import { installHostSim } from './host-stub.js';

/**
 * The #95 scenario class: a document far over the 25k budget whose outline
 * travels only in the offset-0 section. The mount is therefore blind — no
 * rail, progress at the mount share — and everything else must be earned by
 * scrolling and clicking, which only this harness can do.
 */
const BIG_MOUNT_RESULT = {
  content: [{ type: 'text', text: BIG_MOUNT_TEXT }],
  structuredContent: {
    text: BIG_MOUNT_TEXT,
    total_length: BIG_TOTAL,
    dokumentnummer: BIG_DOKUMENTNUMMER,
    source_url: BIG_SOURCE_URL,
    // No outline: its JSON is over the mount budget for a document this size.
  },
};

/** Wraps a chunk the way the tool answers: text block plus structured payload. */
function sectionResult(section: DocumentChunk) {
  return {
    content: [{ type: 'text', text: section.text }],
    structuredContent: section,
  };
}

async function callOffsets(page: Parameters<typeof recordedToolCalls>[0]): Promise<number[]> {
  const calls = await recordedToolCalls(page);
  return calls.map((call) => (call.params as { arguments: { offset: number } }).arguments.offset);
}

test('mounting a big document shows the mount share, no rail, no section call', async ({
  page,
}) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: VIEWER_HTML,
    mountResult: BIG_MOUNT_RESULT,
    callAnswers: [],
  });

  const widget = page.frameLocator('iframe');
  await expect(widget.locator('.ris-doc-text')).toContainText('Abschnitt 1 — Geltungsbereich');
  // The mount is provisional: progress states exactly the truncated share.
  await expect(widget.locator('.ris-doc-progress')).toHaveText(BIG_MOUNT_PROGRESS);
  // The outline only exists in the offset-0 section, which nothing asked for:
  // the sentinel is in the DOM but thousands of pixels below the fold.
  await expect(widget.locator('.ris-outline')).toHaveCount(0);
  await expect(widget.locator('.ris-doc-sentinel')).toHaveCount(1);
  expect(await recordedToolCalls(page)).toHaveLength(0);
  await expect(widget.locator('.ris-notice-title')).toHaveCount(0);
});

test('scrolling to the end fires the section call, adopts the rail, grows the progress', async ({
  page,
}) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: VIEWER_HTML,
    mountResult: BIG_MOUNT_RESULT,
    // Offset 0 answers the sentinel the scroll pushes into the margin; offset
    // 25000 answers the cascade — after adoption the restored scroll position
    // is still at the bottom, so the follow-up sentinel intersects at once.
    callAnswers: [
      { result: sectionResult(bigChunk(0)) },
      { result: sectionResult(bigChunk(25_000)) },
    ],
  });

  const widget = page.frameLocator('iframe');
  const textPane = widget.locator('.ris-doc-text');
  await expect(textPane).toContainText('Abschnitt 1 — Geltungsbereich');
  await expect(widget.locator('.ris-outline')).toHaveCount(0);

  await textPane.evaluate((pane) => {
    pane.scrollTop = pane.scrollHeight;
  });

  // The offset-0 section brings the outline: only now is there a rail.
  await expect(widget.locator('.ris-outline-summary')).toHaveText('Gliederung');
  await expect(widget.locator('.ris-outline-jump')).toHaveCount(10);

  // The cascade settles at half the document, one sentinel still waiting.
  await expect(widget.locator('.ris-doc-progress')).toHaveText('50,0 % geladen');
  await expect(widget.locator('.ris-doc-sentinel')).toHaveCount(1);

  expect(await callOffsets(page)).toEqual([0, 25_000]);
  const [first] = await recordedToolCalls(page);
  const params = first?.params as { name: string; arguments: Record<string, unknown> };
  expect(params.name).toBe('ris_dokument_abschnitt');
  expect(params.arguments).toMatchObject({ dokumentnummer: BIG_DOKUMENTNUMMER, offset: 0 });
  await expect(widget.locator('.ris-notice-title')).toHaveCount(0);
});

test('a rail click jumps, fetching an unloaded target with visible loading feedback', async ({
  page,
}) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: VIEWER_HTML,
    mountResult: BIG_MOUNT_RESULT,
    callAnswers: [
      { result: sectionResult(bigChunk(0)) },
      { result: sectionResult(bigChunk(25_000)) },
      { delayMs: 1_200, result: sectionResult(bigChunk(70_000)) },
    ],
  });

  const widget = page.frameLocator('iframe');
  const textPane = widget.locator('.ris-doc-text');
  await expect(textPane).toContainText('Abschnitt 1 — Geltungsbereich');
  await textPane.evaluate((pane) => {
    pane.scrollTop = pane.scrollHeight;
  });
  await expect(widget.locator('.ris-doc-progress')).toHaveText('50,0 % geladen');

  // Sections ≥ 50000 are unloaded: the click must fetch, and while the
  // delayed answer is in flight the reader sees the section skeleton.
  await widget.locator('.ris-outline-jump[data-offset="70000"]').click();
  await expect(widget.locator('.ris-skeleton-label')).toHaveText('Abschnitt wird geladen …');

  // Arrival: the target section renders and the clicked entry is current.
  await expect(textPane).toContainText('Abschnitt 8 — Datensicherheit');
  await expect(widget.locator('.ris-outline-jump[data-offset="70000"]')).toHaveAttribute(
    'aria-current',
    'true',
  );
  // The adoption is non-contiguous: the hole between 50000 and 70000 stays
  // visible as a gap the reader can close by hand.
  await expect(widget.locator('.ris-doc-gap')).toHaveCount(1);

  // A loaded target jumps without a fetch.
  await widget.locator('.ris-outline-jump[data-offset="10000"]').click();
  await expect(widget.locator('.ris-outline-jump[data-offset="10000"]')).toHaveAttribute(
    'aria-current',
    'true',
  );

  expect(await callOffsets(page)).toEqual([0, 25_000, 70_000]);
  await expect(widget.locator('.ris-notice-title')).toHaveCount(0);
});
