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
 * travels only in the offset-0 section. Since #92 the viewer fetches that
 * section at mount, so the rail is on screen before anything is scrolled; the
 * mount run itself is still the truncated prefix it always was, and every
 * section past the first is still earned by scrolling and clicking, which only
 * this harness can do.
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

test('mounting a big document fetches the first section eagerly: rail and canonical progress without scrolling', async ({
  page,
}) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: VIEWER_HTML,
    mountResult: BIG_MOUNT_RESULT,
    // The delay is what makes the mount run assertable at all: without it the
    // eager answer lands before the first poll and the transient state below
    // could never be observed.
    callAnswers: [{ delayMs: 800, result: sectionResult(bigChunk(0)) }],
  });

  const widget = page.frameLocator('iframe');
  // While the eager answer is in flight the blind mount is still exactly what it
  // was before #92 — the truncated share, and no rail, because the outline
  // travels only in the offset-0 section. What changed is how long it lasts.
  await expect(widget.locator('.ris-doc-progress')).toHaveText(BIG_MOUNT_PROGRESS);
  await expect(widget.locator('.ris-outline')).toHaveCount(0);

  // Arrival, and not one scroll was needed for it: the rail is on screen and
  // the progress is the canonical first section's rather than the mount's.
  await expect(widget.locator('.ris-outline-jump')).toHaveCount(10);
  await expect(widget.locator('.ris-doc-progress')).toHaveText('25,0 % geladen');
  // The series continues, and the sentinel that continues it sits far below the
  // fold: eager means the first section, not a cascade through the document.
  await expect(widget.locator('.ris-doc-sentinel')).toHaveCount(1);

  expect(await callOffsets(page)).toEqual([0]);
  const [first] = await recordedToolCalls(page);
  const params = first?.params as { name: string; arguments: Record<string, unknown> };
  expect(params.name).toBe('ris_dokument_abschnitt');
  expect(params.arguments).toMatchObject({ dokumentnummer: BIG_DOKUMENTNUMMER, offset: 0 });
  await expect(widget.locator('.ris-notice-title')).toHaveCount(0);
});

test('scrolling to the end fetches the next section: progress grows past the eager first section', async ({
  page,
}) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: VIEWER_HTML,
    mountResult: BIG_MOUNT_RESULT,
    // Offset 0 answers the eager mount call; offset 25000 is the one the scroll
    // earns, when the sentinel below the adopted first section enters the
    // prefetch margin.
    callAnswers: [
      { result: sectionResult(bigChunk(0)) },
      { result: sectionResult(bigChunk(25_000)) },
    ],
  });

  const widget = page.frameLocator('iframe');
  const textPane = widget.locator('.ris-doc-text');
  // The rail before the scroll, so what follows measures the scroll alone.
  await expect(widget.locator('.ris-outline-summary')).toHaveText('Gliederung');
  await expect(widget.locator('.ris-outline-jump')).toHaveCount(10);
  await expect(widget.locator('.ris-doc-progress')).toHaveText('25,0 % geladen');

  await textPane.evaluate((pane) => {
    pane.scrollTop = pane.scrollHeight;
  });

  // One scroll, one section: half the document held, one sentinel still waiting.
  await expect(widget.locator('.ris-doc-progress')).toHaveText('50,0 % geladen');
  await expect(widget.locator('.ris-doc-sentinel')).toHaveCount(1);

  // What the offset-0 call carries is spec 1's business; here only the second
  // offset is new, and that it was never computed but read off `next_offset`.
  expect(await callOffsets(page)).toEqual([0, 25_000]);
  await expect(widget.locator('.ris-notice-title')).toHaveCount(0);
});

test('a rail click jumps, fetching an unloaded target with visible loading feedback', async ({
  page,
}) => {
  await page.goto('about:blank');
  await page.evaluate(installHostSim, {
    widgetHtml: VIEWER_HTML,
    mountResult: BIG_MOUNT_RESULT,
    // The mount's own offset-0 call, the scroll's offset-25000 one, and the
    // delayed answer to the click this spec is actually about.
    callAnswers: [
      { result: sectionResult(bigChunk(0)) },
      { result: sectionResult(bigChunk(25_000)) },
      { delayMs: 1_200, result: sectionResult(bigChunk(70_000)) },
    ],
  });

  const widget = page.frameLocator('iframe');
  const textPane = widget.locator('.ris-doc-text');
  // Getting to the starting position of the click: the eager section plus one
  // scrolled-for section, so everything from offset 50000 on is still unloaded.
  // The rail is the gate rather than the text — the mount run carries the same
  // opening line, so waiting on that would let the scroll land on either side of
  // the eager adoption. Waiting for the outline pins it to the side after.
  await expect(widget.locator('.ris-outline-jump')).toHaveCount(10);
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
