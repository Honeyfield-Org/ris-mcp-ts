/**
 * Test-only payloads mirroring what `ris_dokument` and `ris_dokument_abschnitt`
 * deliver to the viewer.
 *
 * The markdown follows `formatDocumentMarkdown()` exactly — one `# ` citation,
 * a `## Dokumentinformation` block of `**Label:** value` pairs, then `## Inhalt`
 * and `htmlToText()` output. The outline shapes are the measured ones from the
 * design docs, so the rail-gating cases here are the cases that actually occur.
 * Nothing in this file is imported by a widget entry, so the bundle never sees
 * it.
 */

import type { DocumentChunk, OutlineEntry } from '../viewer/viewmodel.js';

/**
 * The text block of a `ris_dokument` mount, for a document that fits in one
 * response. Line offsets matter: the first line starts at 0.
 */
export const NORM_MARKDOWN = [
  '# § 1295 Allgemeines bürgerliches Gesetzbuch (JGS Nr. 946/1811)',
  '',
  '## Dokumentinformation',
  '',
  '**Titel:** Allgemeines bürgerliches Gesetzbuch',
  '**Paragraph:** § 1295',
  '**Dokumentnummer:** `NOR12019037`',
  '**Quelle:** [https://www.ris.bka.gv.at/eli/jgs/1811/946/P1295](https://www.ris.bka.gv.at/eli/jgs/1811/946/P1295)',
  '',
  '## Inhalt',
  '',
  'Von der Verbindlichkeit zum Schadenersatze:',
  '',
  '§ 1295.',
  '',
  '(1) Jedermann ist berechtigt, von dem Beschädiger den Ersatz des Schadens zu fordern.',
  'Der Schade mag durch Übertretung einer Vertragspflicht verursacht worden sein.',
].join('\n');

/** Offset of the `Von der Verbindlichkeit …` line in {@link NORM_MARKDOWN}. */
export const NORM_SECTION_OFFSET = NORM_MARKDOWN.indexOf(
  'Von der Verbindlichkeit zum Schadenersatze:',
);

/** Offset of the `§ 1295.` line in {@link NORM_MARKDOWN}. */
export const NORM_PARAGRAPH_OFFSET = NORM_MARKDOWN.indexOf('§ 1295.');

/** A document that fits in a single section: no continuation, no outline worth a rail. */
export const SHORT_CHUNK: DocumentChunk = {
  text: NORM_MARKDOWN,
  total_length: NORM_MARKDOWN.length,
  next_offset: null,
  outline: [
    { level: 1, label: 'Text', offset: 0, span: NORM_SECTION_OFFSET },
    {
      level: 2,
      label: 'Von der Verbindlichkeit zum Schadenersatze:',
      offset: NORM_SECTION_OFFSET,
      span: NORM_PARAGRAPH_OFFSET - NORM_SECTION_OFFSET,
    },
    {
      level: 3,
      label: '§ 1295.',
      offset: NORM_PARAGRAPH_OFFSET,
      span: NORM_MARKDOWN.length - NORM_PARAGRAPH_OFFSET,
    },
  ],
  source_url: 'https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR12019037/NOR12019037.html',
  dokumentnummer: 'NOR12019037',
};

/** Length of the measured BVwG decision the design docs are built on. */
export const LONG_TOTAL = 259_284;

/**
 * The outline of that decision: metadata labels, `Spruch`, and a `Text` that is
 * 99.6 % of the document. Every entry is level 1 — Judikatur carries no `h2`.
 */
export const DECISION_OUTLINE: OutlineEntry[] = [
  { level: 1, label: 'Gericht', offset: 333, span: 31 },
  { level: 1, label: 'Entscheidungsdatum', offset: 364, span: 35 },
  { level: 1, label: 'Geschäftszahl', offset: 399, span: 338 },
  { level: 1, label: 'Spruch', offset: 737, span: 639 },
  { level: 1, label: 'Text', offset: 1376, span: 257_908 },
];

/** Length of the gazette whose 13 substantial level-2/3 entries earn a rail. */
export const GAZETTE_TOTAL = 29_000;

/**
 * A gazette outline: a level-1 masthead plus real structure below it.
 *
 * The §-Überschriften span 13–21 characters and the `§ 16` entry six, because a
 * RIS §-Überschrift sits directly before its `§ n.` line. They are genuine
 * structure all the same — which is why an absolute span floor cannot work and
 * level 2 and below is never filtered.
 */
export const GAZETTE_OUTLINE: OutlineEntry[] = [
  { level: 1, label: 'BUNDESGESETZBLATT FÜR DIE REPUBLIK ÖSTERREICH', offset: 300, span: 120 },
  { level: 2, label: 'Allgemeines', offset: 420, span: 18 },
  { level: 3, label: '§ 1', offset: 438, span: 4300 },
  { level: 2, label: 'Steuersätze', offset: 4738, span: 21 },
  { level: 3, label: '§ 2', offset: 4759, span: 5503 },
  { level: 2, label: 'Anlagenbezeichnung', offset: 10_262, span: 13 },
  { level: 3, label: '§ 16', offset: 10_275, span: 6 },
  { level: 2, label: 'Übergangsbestimmungen', offset: 10_281, span: 15 },
  { level: 3, label: '§ 17', offset: 10_296, span: 3800 },
  { level: 2, label: 'Schlussbestimmungen', offset: 14_096, span: 21 },
  { level: 3, label: '§ 18', offset: 14_117, span: 5100 },
  { level: 3, label: '§ 19', offset: 19_217, span: 4900 },
  { level: 3, label: '§ 20', offset: 24_117, span: 4883 },
];

/** One section of a long document, as the chunk tool returns it. */
export function chunk(overrides: Partial<DocumentChunk> = {}): DocumentChunk {
  return {
    text: 'Erster Abschnitt des Dokuments.',
    total_length: LONG_TOTAL,
    next_offset: 31,
    source_url: 'https://www.ris.bka.gv.at/Dokumente/Bvwg/BVWGT_1/BVWGT_1.html',
    ...overrides,
  };
}
