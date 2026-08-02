import { describe, expect, it } from 'vitest';

import {
  DECISION_OUTLINE,
  GAZETTE_OUTLINE,
  GAZETTE_TOTAL,
  LONG_TOTAL,
  NORM_MARKDOWN,
  NORM_PARAGRAPH_OFFSET,
  NORM_SECTION_OFFSET,
  SHORT_CHUNK,
} from '../__fixtures__/document-chunks.js';

import {
  anchorFor,
  anchorLabelFor,
  buildBlocks,
  buildDocumentView,
  buildOutline,
  classifyLines,
  CHUNK_LIMIT,
  mergeChunks,
  parseChunkResult,
  parseSnapshot,
  relocateAnchor,
  type Block,
  type OutlineEntry,
  type ViewerState,
} from './viewmodel.js';

function kinds(blocks: Block[]): string[] {
  return blocks.map((block) => block.kind);
}

function state(overrides: Partial<ViewerState> = {}): ViewerState {
  return {
    key: { dokumentnummer: 'NOR12019037' },
    chunks: [],
    totalLength: null,
    outline: [],
    sourceUrl: null,
    title: '',
    provisional: false,
    failedOffset: null,
    expired: false,
    connected: true,
    ...overrides,
  };
}

// =============================================================================
// Line classifier
// =============================================================================

describe('classifyLines', () => {
  it.each([
    ['the citation on the first line', '# § 1295 ABGB', 'title'],
    ['a section heading', '## Inhalt', 'heading'],
    ['a metadata pair', '**Titel:** Allgemeines bürgerliches Gesetzbuch', 'meta'],
    ['a linked metadata pair', '**Quelle:** [https://ris.gv.at/x](https://ris.gv.at/x)', 'meta'],
    ['ordinary prose', 'Der Beschädiger hat den Schaden zu ersetzen.', 'paragraph'],
  ])('classifies %s', (_label, line, kind) => {
    expect(classifyLines(line, 0)[0].kind).toBe(kind);
  });

  it('classifies a §-line as an ordinary paragraph', () => {
    // The widget carries no §-rule at all: over 19 measured court decisions
    // every §-line the pattern found was a citation of a foreign law, and an
    // outline built from those would send jumps to the wrong places. Section
    // anchors come from the server's outline instead.
    const line =
      '§ 57. (1) Im Bundesgebiet aufhältigen Drittstaatsangehörigen ist von Amts wegen …';

    expect(classifyLines(line, 4000)[0].kind).toBe('paragraph');
  });

  it('treats a hash deeper in the document as prose, not as the title', () => {
    expect(classifyLines('# Nummer 3 der Beilagen', 4000)[0].kind).toBe('paragraph');
  });

  it('separates blocks on blank lines and joins the lines of one block', () => {
    const blocks = classifyLines('erste Zeile\nzweite Zeile\n\ndritter Absatz', 0);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: 'paragraph', text: 'erste Zeile\nzweite Zeile' });
    expect(blocks[1]).toMatchObject({ offset: 26, text: 'dritter Absatz' });
  });

  it('offsets every block against the start of the run it came from', () => {
    const blocks = classifyLines('erster Absatz\n\nzweiter Absatz', 10_000);

    expect(blocks.map((block) => block.offset)).toEqual([10_000, 10_015]);
  });

  it('splits a metadata value into label, value and link', () => {
    const [block] = classifyLines('**Quelle:** [RIS](https://www.ris.bka.gv.at/x)', 0);

    expect(block).toMatchObject({ kind: 'meta', label: 'Quelle', value: 'RIS' });
    expect(block).toHaveProperty('url', 'https://www.ris.bka.gv.at/x');
  });

  it('unwraps the code fence around a Dokumentnummer', () => {
    const [block] = classifyLines('**Dokumentnummer:** `NOR12019037`', 0);

    expect(block).toMatchObject({ value: 'NOR12019037', url: null });
  });

  it('starts a new block at every anchor, so a jump target is never buried', () => {
    // Two headings on consecutive lines is the normal RIS shape: a
    // §-Überschrift sits directly above its `§ n.` line, with no blank line.
    const blocks = classifyLines('Steuersätze\n§ 16.\nText dazu', 0, new Set([0, 12]));

    expect(blocks.map((block) => block.offset)).toEqual([0, 12]);
    expect(blocks[1]).toMatchObject({ text: '§ 16.\nText dazu' });
  });
});

describe('buildBlocks', () => {
  const outline: OutlineEntry[] = [
    { level: 2, label: 'Von der Verbindlichkeit zum Schadenersatze:', offset: 20, span: 10 },
  ];

  it('marks exactly the block that holds an outline offset', () => {
    const blocks = buildBlocks('erster Absatz\n\nzweiter Absatz\n\ndritter', 0, [
      { level: 2, label: 'zweiter', offset: 15, span: 16 },
    ]);

    expect(blocks.map((block) => block.anchorOffset)).toEqual([null, 15, null]);
  });

  it('ignores outline entries that lie outside the run', () => {
    const blocks = buildBlocks('nur dieser Absatz', 1000, outline);

    expect(blocks.every((block) => block.anchorOffset === null)).toBe(true);
  });

  it('marks every heading of a real document exactly once', () => {
    const blocks = buildBlocks(NORM_MARKDOWN, 0, SHORT_CHUNK.outline ?? []);
    const anchors = blocks
      .map((block) => block.anchorOffset)
      .filter((offset): offset is number => offset !== null);

    expect(anchors).toEqual([0, NORM_SECTION_OFFSET, NORM_PARAGRAPH_OFFSET]);
  });
});

describe('anchorFor', () => {
  const blocks = classifyLines('eins\n\nzwei\n\ndrei', 0);

  it.each([
    ['before the first block', -1, -1],
    ['at a block start', 6, 1],
    ['inside a block', 8, 1],
    ['past the last block', 999, 2],
  ])('resolves an offset %s', (_label, offset, expected) => {
    expect(anchorFor(blocks, offset)).toBe(expected);
  });
});

// =============================================================================
// Chunk parsing and merging
// =============================================================================

describe('parseChunkResult', () => {
  it('accepts a chunk and keeps unknown extra fields', () => {
    const parsed = parseChunkResult({ ...SHORT_CHUNK, kommt_spaeter: 42 });

    expect(parsed).toMatchObject({ text: SHORT_CHUNK.text, next_offset: null });
  });

  it('accepts a document with no headings at all', () => {
    const empty = { text: 'x', total_length: 1, next_offset: null, outline: [] };

    expect(parseChunkResult(empty)).not.toBeNull();
  });

  it('accepts a chunk without a Dokumentnummer, which a URL-opened document has none of', () => {
    const { dokumentnummer: _dropped, ...rest } = SHORT_CHUNK;

    expect(parseChunkResult(rest)).not.toBeNull();
  });

  it.each([
    ['no object at all', 'Abschnitt'],
    ['no text', { total_length: 10, next_offset: null }],
    ['no length', { text: 'x', next_offset: null }],
    ['a next offset that is neither a number nor null', { text: 'x', total_length: 1 }],
    [
      'an outline that is not a list',
      { text: 'x', total_length: 1, next_offset: null, outline: 'keine' },
    ],
    [
      'an outline entry without an offset',
      {
        text: 'x',
        total_length: 1,
        next_offset: null,
        outline: [{ level: 1, label: 'a', span: 2 }],
      },
    ],
  ])('rejects %s', (_label, value) => {
    expect(parseChunkResult(value)).toBeNull();
  });
});

describe('mergeChunks', () => {
  it('joins contiguous sections into one run', () => {
    const runs = mergeChunks([
      { offset: 0, text: 'eins', nextOffset: 4 },
      { offset: 4, text: 'zwei', nextOffset: null },
    ]);

    expect(runs).toEqual([{ offset: 0, text: 'einszwei', nextOffset: null }]);
  });

  it('keeps a gap between sections that do not meet', () => {
    const runs = mergeChunks([
      { offset: 0, text: 'eins', nextOffset: 4 },
      { offset: 100, text: 'weit weg', nextOffset: 108 },
    ]);

    expect(runs.map((run) => run.offset)).toEqual([0, 100]);
  });

  it('sorts sections that arrived out of order', () => {
    const runs = mergeChunks([
      { offset: 4, text: 'zwei', nextOffset: null },
      { offset: 0, text: 'eins', nextOffset: 4 },
    ]);

    expect(runs).toEqual([{ offset: 0, text: 'einszwei', nextOffset: null }]);
  });

  it('is idempotent for a section that arrived twice', () => {
    const twice = { offset: 0, text: 'eins', nextOffset: 4 };

    expect(mergeChunks([twice, { ...twice }])).toEqual([twice]);
  });
});

// =============================================================================
// Rail gating
// =============================================================================

describe('buildOutline', () => {
  it('offers no rail while the document fits in one section', () => {
    // Nothing to navigate, whatever the outline says.
    expect(buildOutline(GAZETTE_OUTLINE, CHUNK_LIMIT)).toBeNull();
    expect(buildOutline(SHORT_CHUNK.outline ?? [], SHORT_CHUNK.total_length)).toBeNull();
  });

  it('offers no rail when a single entry covers the whole document', () => {
    // The measured 259k decision: `Text` spans 99.5 %, so a rail would promise
    // navigation that does not exist.
    expect(buildOutline(DECISION_OUTLINE, LONG_TOTAL)).toBeNull();
  });

  it('renders a rail for a gazette whose sections actually divide it', () => {
    const rail = buildOutline(GAZETTE_OUTLINE, GAZETTE_TOTAL);

    expect(rail).toHaveLength(GAZETTE_OUTLINE.length);
    expect(rail?.[0].shareLabel).toBe('0,4 %');
  });

  it('keeps a level-3 entry spanning six characters', () => {
    // A RIS §-Überschrift sits directly before its `§ n.` line, so genuine
    // structure can span almost nothing. Any rule that filters level 2 and
    // below by span alone loses it.
    const rail = buildOutline(GAZETTE_OUTLINE, GAZETTE_TOTAL);

    expect(rail?.map((row) => row.label)).toContain('§ 16');
  });

  it('drops a level-1 metadata label spanning 338 characters', () => {
    // Larger than a whole `Rechtssatz` at 113, and still a field label rather
    // than a section — which is why the filter is a share of the document and
    // not an absolute floor.
    const rail = buildOutline(
      [...DECISION_OUTLINE.slice(0, 4), { level: 1, label: 'Kurz', offset: 2000, span: 40_000 }],
      LONG_TOTAL,
    );

    expect(rail?.map((row) => row.label)).not.toContain('Geschäftszahl');
    expect(rail?.map((row) => row.label)).toContain('Spruch');
  });

  it('offers no rail when fewer than two entries survive', () => {
    expect(buildOutline([DECISION_OUTLINE[0]], LONG_TOTAL)).toBeNull();
    expect(buildOutline([], LONG_TOTAL)).toBeNull();
  });

  it('offers no rail before any section has said how long the document is', () => {
    expect(buildOutline(GAZETTE_OUTLINE, null)).toBeNull();
  });

  it('reports which sections are on screen', () => {
    const rail = buildOutline(GAZETTE_OUTLINE, GAZETTE_TOTAL, (offset) => offset < 5000);

    expect(rail?.map((row) => row.loaded).slice(0, 6)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it('counts a section as loaded only when something on screen anchors it', () => {
    // Two entries pointing into the same block: `buildBlocks` anchors the first
    // and has no second id to give, so the second has nothing to scroll to even
    // though its offset sits inside loaded text. Range containment would call
    // both loaded and leave an enabled button that does nothing.
    const outline: OutlineEntry[] = [
      { level: 2, label: 'erste', offset: 3, span: 3 },
      { level: 2, label: 'zweite', offset: 6, span: 20_000 },
    ];
    const model = buildDocumentView(
      state({
        expired: true,
        totalLength: GAZETTE_TOTAL,
        outline,
        chunks: [{ offset: 0, text: 'Absatz eins\n\nAbsatz zwei', nextOffset: null }],
      }),
    );

    expect(model.rail?.map((row) => row.loaded)).toEqual([true, false]);
  });
});

// =============================================================================
// The whole view
// =============================================================================

describe('buildDocumentView', () => {
  it('lifts the citation out of the body and into the header', () => {
    const model = buildDocumentView(
      state({ chunks: [{ offset: 0, text: NORM_MARKDOWN, nextOffset: null }] }),
    );

    expect(model.title).toBe('§ 1295 Allgemeines bürgerliches Gesetzbuch (JGS Nr. 946/1811)');
    expect(kinds(model.runs[0].blocks)).not.toContain('title');
  });

  it('points the sentinel at the opening section while the mount text is on screen', () => {
    // The mounting response is a truncated prefix: it says nothing about where
    // it ends, so the continuation has to come from the canonical series.
    const model = buildDocumentView(
      state({
        provisional: true,
        chunks: [{ offset: 0, text: NORM_MARKDOWN, nextOffset: null }],
      }),
    );

    expect(model.sentinelOffset).toBe(0);
  });

  it('points the sentinel at the next section of a chunked document', () => {
    const model = buildDocumentView(
      state({ totalLength: LONG_TOTAL, chunks: [{ offset: 0, text: 'x', nextOffset: 24_000 }] }),
    );

    expect(model.sentinelOffset).toBe(24_000);
  });

  it('turns a section that failed into a gap marker instead of a sentinel', () => {
    // One automatic attempt per offset: an unchanged sentinel would ask for the
    // failing section again the moment it scrolls back into view.
    const model = buildDocumentView(
      state({
        totalLength: LONG_TOTAL,
        chunks: [{ offset: 0, text: 'Anfang', nextOffset: 24_000 }],
        failedOffset: 24_000,
      }),
    );

    expect(model.sentinelOffset).toBeNull();
    expect(model.runs.at(-1)?.gapOffset).toBe(24_000);
  });

  it('keeps the sentinel when a different offset failed', () => {
    const model = buildDocumentView(
      state({
        totalLength: LONG_TOTAL,
        chunks: [{ offset: 0, text: 'Anfang', nextOffset: 24_000 }],
        failedOffset: 90_000,
      }),
    );

    expect(model.sentinelOffset).toBe(24_000);
  });

  it('offers no sentinel once the session is gone', () => {
    const model = buildDocumentView(
      state({
        expired: true,
        totalLength: LONG_TOTAL,
        chunks: [{ offset: 0, text: 'Anfang', nextOffset: 24_000 }],
      }),
    );

    expect(model.sentinelOffset).toBeNull();
    expect(model.expired).toBe(true);
  });

  it('offers no sentinel for a document it cannot name', () => {
    // A host that delivered the mounting result but never its arguments leaves
    // the viewer with text and no way to ask for more; a control that could not
    // make its call would silently do nothing.
    const model = buildDocumentView(
      state({
        key: {},
        provisional: true,
        chunks: [{ offset: 0, text: 'Text', nextOffset: null }],
      }),
    );

    expect(model.sentinelOffset).toBeNull();
  });

  it('drops the sentinel at the end of the document', () => {
    const model = buildDocumentView(
      state({ totalLength: 5, chunks: [{ offset: 0, text: 'kurz', nextOffset: null }] }),
    );

    expect(model.sentinelOffset).toBeNull();
  });

  it('marks the gap between two runs the reader jumped across', () => {
    const model = buildDocumentView(
      state({
        totalLength: LONG_TOTAL,
        chunks: [
          { offset: 0, text: 'Anfang', nextOffset: 6 },
          { offset: 50_000, text: 'Mitte', nextOffset: 50_005 },
        ],
      }),
    );

    expect(model.runs.map((run) => run.gapOffset)).toEqual([6, null]);
    expect(model.sentinelOffset).toBe(50_005);
  });

  it('reports how much of a chunked document is on screen', () => {
    const model = buildDocumentView(
      state({
        totalLength: 100_000,
        chunks: [{ offset: 0, text: 'x'.repeat(25_000), nextOffset: 25_000 }],
      }),
    );

    expect(model.progressLabel).toBe('25,0 % geladen');
  });

  it('says nothing about progress for a document that fits in one section', () => {
    const model = buildDocumentView(
      state({ totalLength: 400, chunks: [{ offset: 0, text: 'kurz', nextOffset: null }] }),
    );

    expect(model.progressLabel).toBe('');
  });

  it('falls back to the URL a document was opened with when no section named one', () => {
    const model = buildDocumentView(
      state({ key: { url: 'https://www.ris.bka.gv.at/Dokumente/x.html' } }),
    );

    expect(model.sourceUrl).toBe('https://www.ris.bka.gv.at/Dokumente/x.html');
    expect(model.dokumentnummer).toBeNull();
  });
});

// =============================================================================
// Reopen
// =============================================================================

describe('parseSnapshot', () => {
  const snapshot = {
    dokumentnummer: 'NOR12019037',
    title: '§ 1295 ABGB',
    totalLength: LONG_TOTAL,
    anchorOffset: 737,
    anchorLabel: 'Spruch',
  };

  it('accepts a snapshot identified by Dokumentnummer', () => {
    expect(parseSnapshot(snapshot)).toEqual(snapshot);
  });

  it('accepts a snapshot identified only by URL', () => {
    const { dokumentnummer: _dropped, ...byUrl } = snapshot;

    expect(parseSnapshot({ ...byUrl, url: 'https://www.ris.bka.gv.at/x' })).not.toBeNull();
  });

  it('accepts a snapshot that had to drop its outline', () => {
    expect(parseSnapshot({ ...snapshot, outline: undefined })).not.toBeNull();
  });

  it.each([
    ['a payload that is not an object', 'NOR12019037'],
    ['a snapshot with no identifier', { ...snapshot, dokumentnummer: undefined }],
    ['a snapshot with no reading position', { ...snapshot, anchorOffset: undefined }],
    ['a snapshot with a broken outline', { ...snapshot, outline: [{ label: 'Spruch' }] }],
    ['the payload of another widget', { total_hits: 3, documents: [] }],
  ])('refuses to restore %s', (_label, value) => {
    expect(parseSnapshot(value)).toBeNull();
  });
});

describe('anchorLabelFor and relocateAnchor', () => {
  it('names the section a reading position sits in', () => {
    expect(anchorLabelFor(DECISION_OUTLINE, 900)).toBe('Spruch');
    expect(anchorLabelFor(DECISION_OUTLINE, 0)).toBeNull();
  });

  it('finds the section again after the offsets shifted', () => {
    // The same document measures differently depending on which branch supplied
    // its metadata header, so a stored offset can land thousands of characters
    // off while the label still identifies the section.
    const shifted = DECISION_OUTLINE.map((entry) => ({ ...entry, offset: entry.offset + 4567 }));

    expect(relocateAnchor(shifted, 'Spruch', 737)).toBe(737 + 4567);
  });

  it('keeps the stored offset when no label matches', () => {
    expect(relocateAnchor(DECISION_OUTLINE, 'Gibt es nicht', 737)).toBe(737);
    expect(relocateAnchor(DECISION_OUTLINE, null, 737)).toBe(737);
  });
});
