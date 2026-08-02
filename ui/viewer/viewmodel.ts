/**
 * Pure display rules for the document viewer.
 *
 * No DOM, no host calls. Everything the viewer decides about a document —
 * how its text splits into blocks, whether its outline is worth a rail, which
 * sections are loaded and what to fetch next — is decided here so it can be
 * tested without a browser.
 */

/**
 * Largest text a single chunk carries, mirroring `CHARACTER_LIMIT` in
 * `src/formatting.ts`.
 *
 * Duplicated rather than imported: the widget is a self-contained bundle and
 * may not reach into the server's module graph. It is used for exactly one
 * decision — whether the document was too long for a single response, which is
 * the only situation with anything to navigate (§3.2 of the design). Every
 * other length in this file comes from the server's own `total_length` /
 * `next_offset`.
 */
export const CHUNK_LIMIT = 25_000;

/**
 * Smallest share of a document a level-1 heading must span to reach the rail.
 *
 * Level 1 is RIS's record layer: in a court decision `Gericht`, `Geschäftszahl`
 * and `Spruch` are all `h1`, and only the last of them is a section a reader
 * would jump to. An absolute floor cannot separate them — a `Geschäftszahl`
 * spanning 338 characters is larger than a whole `Rechtssatz` spanning 113 —
 * but a share of the document does: in the measured 259k decision the metadata
 * labels span 0.012 %, `Geschäftszahl` 0.13 % and `Spruch` 0.25 %.
 */
const MIN_LEVEL_1_SHARE = 0.002;

/**
 * Share above which a single entry means the outline does not divide anything.
 *
 * A long decision's real structure is `Spruch` plus `Text`, where `Text` is
 * 99.6 % of the document. Two entries are enough to draw a rail and not enough
 * to navigate with, so that case renders single-pane instead of promising
 * navigation that does not exist.
 */
const MIN_DOMINANT_SHARE = 0.8;

/** Fewer entries than this leave nothing to choose between. */
const MIN_RAIL_ENTRIES = 2;

/** One jump target, exactly as `ris_dokument_abschnitt` delivers it. */
export interface OutlineEntry {
  level: number;
  label: string;
  offset: number;
  span: number;
}

/**
 * The `structuredContent` of one `ris_dokument_abschnitt` response.
 *
 * `dokumentnummer` is optional on the wire — a document opened by URL has none
 * to echo — so the viewer never treats it as its identity. What it called the
 * tool with is what identifies the document.
 */
export interface DocumentChunk {
  text: string;
  total_length: number;
  next_offset: number | null;
  outline?: OutlineEntry[];
  source_url?: string;
  dokumentnummer?: string;
}

/**
 * The `structuredContent` of the `ris_dokument` response that mounts the viewer.
 *
 * Shares `text`, `total_length`, `outline` and `source_url` with a chunk and
 * carries no `next_offset`, deliberately: this text is the *truncated* rendering
 * with a German notice appended, so where it ends is not where the document
 * continues. It renders immediately and the canonical series replaces it.
 */
export interface DocumentResult {
  text: string;
  total_length: number;
  outline?: OutlineEntry[];
  source_url?: string;
  dokumentnummer?: string;
}

/** How the viewer addresses its document — whichever identifier it was given. */
export interface DocumentKey {
  dokumentnummer?: string;
  url?: string;
}

/**
 * The mounting result as the viewer works with it, from either source.
 *
 * `totalLength` and `outline` are null when only the text block arrived: a text
 * block says nothing about the document it was cut from, and inventing a length
 * would arm the refetch check in {@link ViewerState} against a number the viewer
 * made up.
 */
export interface MountDocument {
  text: string;
  totalLength: number | null;
  outline: OutlineEntry[] | null;
  key: DocumentKey;
  sourceUrl: string | null;
}

/**
 * Normalise a validated `ris_dokument` payload into what the viewer renders.
 *
 * Exactly one identifier travels on, never both: `ris_dokument_abschnitt` given
 * a `url` resolves through the URL branch of the shared loader even when a
 * Dokumentnummer is also present, which builds a different metadata header — and
 * a header of a different length shifts every offset the viewer holds.
 */
export function toMountDocument(result: DocumentResult): MountDocument {
  const key: DocumentKey = result.dokumentnummer
    ? { dokumentnummer: result.dokumentnummer }
    : result.source_url
      ? { url: result.source_url }
      : {};

  return {
    text: result.text,
    totalLength: result.total_length,
    outline: result.outline ?? null,
    key,
    sourceUrl: result.source_url ?? null,
  };
}

/** A section of text the viewer holds, addressed by its offset. */
export interface LoadedChunk {
  offset: number;
  text: string;
  nextOffset: number | null;
}

/** A maximal stretch of contiguous text the viewer can render as one run. */
export interface ChunkRun {
  offset: number;
  text: string;
  nextOffset: number | null;
}

/**
 * One rendered piece of document text.
 *
 * `anchorOffset` is set from the server's outline, never recognised from the
 * text: heading wording is arbitrary (`Spruch`, `§ 1295.`, `Von der
 * Verbindlichkeit zum Schadenersatze:`) and the widget carries no pattern for
 * it.
 */
export type Block = {
  offset: number;
  anchorOffset: number | null;
} & (
  | { kind: 'title'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'meta'; label: string; value: string; url: string | null }
  | { kind: 'paragraph'; text: string }
);

/** One row of the outline rail. */
export interface OutlineRow {
  level: number;
  label: string;
  offset: number;
  /** Share of the document this entry spans, as `12,4 %`. */
  shareLabel: string;
  /** Whether the section is on screen, which decides what a jump costs. */
  loaded: boolean;
}

/** One contiguous stretch of text, with what follows it. */
export interface RunView {
  offset: number;
  blocks: Block[];
  /** Offset the gap after this run starts at, `null` when nothing is missing. */
  gapOffset: number | null;
}

/** Everything the viewer needs to render a document. */
export interface DocumentView {
  title: string;
  dokumentnummer: string | null;
  sourceUrl: string | null;
  /** `43 % geladen`, or empty while the document fits in one response. */
  progressLabel: string;
  /** `null` renders single-pane: no outline, or none that divides anything. */
  rail: OutlineRow[] | null;
  runs: RunView[];
  /** Offset the sentinel fetches when it scrolls into view. */
  sentinelOffset: number | null;
  /**
   * True once the session is gone.
   *
   * Everything already read stays on screen; every control that would issue
   * another call is rendered disabled, because they would all fail the same way
   * and a button that cannot work is worse than none.
   */
  expired: boolean;
  /**
   * Whether the widget ever reached its host.
   *
   * Separate from {@link expired} because the two failures cost different
   * things: an evicted session still opens links, a handshake that never
   * completed leaves nothing on the other end of `openLink` either.
   */
  connected: boolean;
}

/** What the viewer knows about the document currently open. */
export interface ViewerState {
  key: DocumentKey;
  chunks: LoadedChunk[];
  /** `null` until a chunk response has said how long the document is. */
  totalLength: number | null;
  outline: OutlineEntry[];
  sourceUrl: string | null;
  /** Header line, from the snapshot before any text has arrived. */
  title: string;
  /**
   * True while the text on screen is the mount result rather than a chunk.
   *
   * The mounting `ris_dokument` response is a truncated prefix: it renders
   * immediately and costs nothing, but it carries no length, no outline and no
   * offset to continue from. The first chunk call replaces it with the
   * canonical series.
   */
  provisional: boolean;
  /**
   * Offset whose last load failed, or `null`.
   *
   * The automatic sentinel gets exactly one attempt per offset: re-arming it on
   * the same offset would request the failing section again the moment it is
   * back in view, forever. The retry becomes a gap marker the reader presses.
   */
  failedOffset: number | null;
  /** Mirrors the session state, so the rendered controls follow from the model. */
  expired: boolean;
  /** Mirrors whether the handshake ever completed — see {@link DocumentView.connected}. */
  connected: boolean;
}

const META_LINE = /^\*\*(.+?):\*\* ?(.*)$/;
const LINK_VALUE = /^\[(.+?)\]\((.+?)\)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Group thousands with a dot and decimals with a comma, Austrian style. */
function formatShare(share: number): string {
  return `${(share * 100).toFixed(1).replace('.', ',')} %`;
}

/** The DOM id of a section, derived from its offset so it survives a re-render. */
export function sectionId(offset: number): string {
  return `ris-sec-${offset}`;
}

/** Strip the code fence `formatDocumentMarkdown` wraps a Dokumentnummer in. */
function unfence(value: string): string {
  return value.length > 1 && value.startsWith('`') && value.endsWith('`')
    ? value.slice(1, -1)
    : value;
}

function isOutline(value: unknown): value is OutlineEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isRecord(entry) &&
        isFiniteNumber(entry.level) &&
        typeof entry.label === 'string' &&
        isFiniteNumber(entry.offset) &&
        isFiniteNumber(entry.span),
    )
  );
}

/**
 * Validate a chunk response before anything renders from it.
 *
 * Checks the fields the viewer reads and nothing else — a server that adds one
 * must not be rejected — and is deliberately strict about `next_offset`, which
 * decides whether the viewer keeps paging or stops.
 */
export function parseChunkResult(value: unknown): DocumentChunk | null {
  if (!isRecord(value)) return null;
  if (typeof value.text !== 'string') return null;
  if (!isFiniteNumber(value.total_length)) return null;
  if (value.next_offset !== null && !isFiniteNumber(value.next_offset)) return null;
  if (value.outline !== undefined && !isOutline(value.outline)) return null;

  return value as unknown as DocumentChunk;
}

/**
 * Validate the structured payload of the mounting `ris_dokument` response.
 *
 * The one channel claude.ai was measured to deliver to a widget at all, which
 * is why the text has to arrive through it rather than only through the content
 * blocks. Empty text is rejected rather than rendered: the caller then falls
 * through to the text block, and an empty document is not a document.
 */
export function parseDocumentResult(value: unknown): DocumentResult | null {
  if (!isRecord(value)) return null;
  if (typeof value.text !== 'string' || value.text === '') return null;
  if (!isFiniteNumber(value.total_length)) return null;
  if (value.outline !== undefined && !isOutline(value.outline)) return null;

  return value as unknown as DocumentResult;
}

/**
 * Split document text into renderable blocks.
 *
 * The payload is `htmlToText()` output, not CommonMark: apart from the three
 * headings `formatDocument()` writes itself, every line is plain text. A line
 * classifier is therefore the whole grammar, and it keeps the bundle free of a
 * markdown parser — which is what lets the widget claim an empty CSP.
 *
 * `anchors` are the offsets the server's outline points at; a line that starts
 * one always begins a block of its own, so a jump target is never buried in the
 * middle of a paragraph.
 */
export function classifyLines(
  text: string,
  baseOffset: number,
  anchors: ReadonlySet<number> = new Set(),
): Block[] {
  const blocks: Block[] = [];
  let paragraph: { offset: number; lines: string[] } | null = null;

  const flush = (): void => {
    if (!paragraph) return;
    blocks.push({
      kind: 'paragraph',
      offset: paragraph.offset,
      anchorOffset: null,
      text: paragraph.lines.join('\n'),
    });
    paragraph = null;
  };

  let offset = baseOffset;

  for (const line of text.split('\n')) {
    const lineOffset = offset;
    offset += line.length + 1; // the '\n' that split() consumed
    const trimmed = line.trim();

    if (trimmed === '') {
      flush();
      continue;
    }

    if (anchors.has(lineOffset)) flush();

    // The document title is the very first line and nothing else: a `# ` deeper
    // in the text is prose, and treating it as chrome would hide a line.
    if (lineOffset === 0 && trimmed.startsWith('# ')) {
      flush();
      blocks.push({
        kind: 'title',
        offset: lineOffset,
        anchorOffset: null,
        text: trimmed.slice(2),
      });
      continue;
    }

    if (trimmed.startsWith('## ')) {
      flush();
      blocks.push({
        kind: 'heading',
        offset: lineOffset,
        anchorOffset: null,
        text: trimmed.slice(3),
      });
      continue;
    }

    const meta = META_LINE.exec(trimmed);
    if (meta) {
      flush();
      const value = unfence(meta[2].trim());
      const link = LINK_VALUE.exec(value);

      blocks.push({
        kind: 'meta',
        offset: lineOffset,
        anchorOffset: null,
        label: meta[1].trim(),
        value: link ? link[1] : value,
        url: link ? link[2] : null,
      });
      continue;
    }

    paragraph ??= { offset: lineOffset, lines: [] };
    paragraph.lines.push(line);
  }

  flush();
  return blocks;
}

/**
 * Index of the block that holds `offset`, or `-1` when none does.
 *
 * Blocks are in ascending offset order, so the last one starting at or before
 * the target is the one containing it.
 */
export function anchorFor(blocks: Block[], offset: number): number {
  let found = -1;

  for (let index = 0; index < blocks.length; index += 1) {
    if (blocks[index].offset > offset) break;
    found = index;
  }

  return found;
}

/** Classify one run of text and mark the blocks the outline points at. */
export function buildBlocks(text: string, baseOffset: number, outline: OutlineEntry[]): Block[] {
  const end = baseOffset + text.length;
  const inRun = outline.filter((entry) => entry.offset >= baseOffset && entry.offset < end);
  const blocks = classifyLines(text, baseOffset, new Set(inRun.map((entry) => entry.offset)));

  for (const entry of inRun) {
    const index = anchorFor(blocks, entry.offset);
    if (index >= 0 && blocks[index].anchorOffset === null) {
      blocks[index].anchorOffset = entry.offset;
    }
  }

  return blocks;
}

/**
 * Join the sections held into the fewest possible contiguous runs.
 *
 * A section that continues the previous one extends it; one that starts inside
 * what is already held adds nothing and is dropped, which is what makes loading
 * the same offset twice idempotent.
 */
export function mergeChunks(chunks: Iterable<LoadedChunk>): ChunkRun[] {
  const sorted = [...chunks].sort((left, right) => left.offset - right.offset);
  const runs: ChunkRun[] = [];

  for (const chunk of sorted) {
    const last = runs[runs.length - 1];

    if (last && last.nextOffset === chunk.offset) {
      last.text += chunk.text;
      last.nextOffset = chunk.nextOffset;
      continue;
    }

    if (last && chunk.offset < last.offset + last.text.length) continue;

    runs.push({ ...chunk });
  }

  return runs;
}

/**
 * Decide whether the outline earns a navigation rail, and with which entries.
 *
 * Returns `null` for single-pane. The gating runs on `level` and on `span`
 * relative to the document, never on an absolute character floor: a genuine
 * `§ 16` heading spans 6 characters while a `Geschäftszahl` metadata label
 * spans 338, so any absolute threshold gets one of the two wrong.
 */
export function buildOutline(
  outline: OutlineEntry[],
  totalLength: number | null,
  loaded: (offset: number) => boolean = () => false,
): OutlineRow[] | null {
  // Nothing to navigate while the document fits in a single response — which is
  // also every document the measured counterexamples came from.
  if (totalLength === null || totalLength <= CHUNK_LIMIT) return null;

  // Level 2 and below is `UeberschrArt`, `UeberschrPara`, `GldSymbol`: always
  // genuine legal structure, whatever it spans. Only level 1 needs filtering,
  // and only level 1 is RIS's record layer.
  const kept = outline.filter(
    (entry) => entry.level >= 2 || entry.span / totalLength >= MIN_LEVEL_1_SHARE,
  );

  if (kept.length < MIN_RAIL_ENTRIES) return null;
  if (Math.max(...kept.map((entry) => entry.span)) / totalLength > MIN_DOMINANT_SHARE) return null;

  return kept.map((entry) => ({
    level: entry.level,
    label: entry.label,
    offset: entry.offset,
    shareLabel: formatShare(entry.span / totalLength),
    loaded: loaded(entry.offset),
  }));
}

/** Assemble everything on screen from what the viewer currently holds. */
export function buildDocumentView(state: ViewerState): DocumentView {
  const runs = mergeChunks(state.chunks);

  // While the text is the mount result the viewer does not know where it ends,
  // so the continuation is the canonical first section rather than an offset it
  // would have to guess at.
  const continuation = state.provisional ? 0 : (runs[runs.length - 1]?.nextOffset ?? null);
  // A continuation that already failed is offered as a gap marker instead: the
  // reader decides whether to try again, and the sentinel cannot loop on it.
  const stalled = state.failedOffset !== null && state.failedOffset === continuation;

  const views: RunView[] = runs.map((run, index) => ({
    offset: run.offset,
    blocks: buildBlocks(run.text, run.offset, state.outline),
    // Every run but the last is followed by text the viewer skipped over; the
    // last one's continuation is the sentinel's job unless that failed.
    gapOffset: index < runs.length - 1 ? run.nextOffset : stalled ? continuation : null,
  }));

  // The title is chrome, not body text: it goes in the header and is removed
  // from the run that carried it.
  let title = state.title;
  const first = views[0]?.blocks[0];
  if (first?.kind === 'title') {
    title = first.text;
    views[0].blocks = views[0].blocks.slice(1);
  }

  const loadedChars = runs.reduce((sum, run) => sum + run.text.length, 0);
  const chunked = state.totalLength !== null && state.totalLength > CHUNK_LIMIT;

  // Jumpable means "a block on screen carries this anchor", not "the offset
  // falls inside loaded text". The two differ: an entry whose offset is not a
  // line of its own — a blank line, or a second entry landing in a block that
  // already has an anchor — is inside the text and still has nothing to scroll
  // to. Once the session is gone that difference is the whole answer, because
  // the fetch that would have resolved it can no longer happen.
  const anchored = new Set(
    views
      .flatMap((run) => run.blocks.map((block) => block.anchorOffset))
      .filter((offset): offset is number => offset !== null),
  );

  // A document the viewer cannot name is a document it cannot fetch more of:
  // that happens when a host delivers the mounting result but never its
  // arguments. The text stays and the chat keeps the rest — but a sentinel
  // whose call could not be made would be a control that silently does nothing.
  const addressable = Boolean(state.key.dokumentnummer ?? state.key.url);

  return {
    title,
    dokumentnummer: state.key.dokumentnummer ?? null,
    sourceUrl: state.sourceUrl ?? state.key.url ?? null,
    progressLabel:
      chunked && state.totalLength
        ? `${formatShare(Math.min(1, loadedChars / state.totalLength))} geladen`
        : '',
    rail: buildOutline(state.outline, state.totalLength, (offset) => anchored.has(offset)),
    runs: views,
    sentinelOffset: addressable && !stalled && !state.expired ? continuation : null,
    expired: state.expired,
    connected: state.connected,
  };
}

/**
 * What the viewer stores for a reopen: structure, never text.
 *
 * A 260 000-character document is far past the 64k snapshot budget, and even a
 * long outline is uncomfortably close to it. The offset is a *content* offset
 * rather than a `scrollTop`: pixel scroll means nothing after a re-render with
 * different sections loaded, while a character offset is exactly what the chunk
 * tool takes as input.
 */
export interface ViewerSnapshot {
  dokumentnummer?: string;
  url?: string;
  title: string;
  totalLength: number | null;
  anchorOffset: number;
  anchorLabel: string | null;
  outline?: OutlineEntry[];
}

/**
 * Validate a stored snapshot before anything is restored from it.
 *
 * Unvalidated input like any other: the host hands back whatever it kept, and a
 * snapshot without an identifier could not be refetched anyway.
 */
export function parseSnapshot(value: unknown): ViewerSnapshot | null {
  if (!isRecord(value)) return null;

  const { dokumentnummer, url, title, totalLength, anchorOffset, anchorLabel, outline } = value;

  if (typeof dokumentnummer !== 'string' && typeof url !== 'string') return null;
  if (typeof title !== 'string') return null;
  if (totalLength !== null && !isFiniteNumber(totalLength)) return null;
  if (!isFiniteNumber(anchorOffset)) return null;
  if (anchorLabel !== null && typeof anchorLabel !== 'string') return null;
  if (outline !== undefined && !isOutline(outline)) return null;

  return value as unknown as ViewerSnapshot;
}

/**
 * The section a reopen should return to, from the outline entries on screen.
 *
 * The label travels with the offset because the offset alone does not survive a
 * refetch: the same document measures differently depending on whether the
 * direct fetch or the search fallback supplied its metadata header, and a stored
 * number would then land several thousand characters off.
 */
export function anchorLabelFor(outline: OutlineEntry[], offset: number): string | null {
  let label: string | null = null;

  for (const entry of outline) {
    if (entry.offset > offset) break;
    label = entry.label;
  }

  return label;
}

/** Where a restored anchor actually sits in a freshly fetched outline. */
export function relocateAnchor(
  outline: OutlineEntry[],
  label: string | null,
  fallback: number,
): number {
  const match = label === null ? undefined : outline.find((entry) => entry.label === label);
  return match ? match.offset : fallback;
}
