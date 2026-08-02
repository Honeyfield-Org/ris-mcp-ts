/**
 * Tests for formatting utilities in the RIS MCP Server.
 *
 * These tests verify the formatting functions used to convert RIS API
 * responses into readable formats for LLM consumption, including
 * date formatting, HTML processing, citation formatting, and response truncation.
 */

import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

import {
  formatDate,
  htmlToText,
  formatCitation,
  formatSearchResults,
  formatDocument,
  truncateResponse,
  type DocumentMetadata,
} from '../formatting.js';
import type { Document, SearchResult } from '../types.js';

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create a mock Document with the given properties.
 */
function createMockDocument(overrides: Partial<Document> = {}): Document {
  return {
    dokumentnummer: 'NOR40000001',
    applikation: 'BrKons',
    titel: 'Test Document Title',
    kurztitel: 'TestDoc',
    citation: {
      kurztitel: 'TestDoc',
      langtitel: 'Test Document Full Title',
      kundmachungsorgan: 'BGBl. I Nr. 1/2024',
      paragraph: '§ 1',
      eli: 'eli/bgbl/2024/1',
      inkrafttreten: '2024-01-01',
      ausserkrafttreten: null,
    },
    citation_display: '§ 1 TestDoc (BGBl. I Nr. 1/2024)',
    content_urls: {
      html: 'https://example.com/doc.html',
      xml: null,
      pdf: null,
      rtf: null,
    },
    dokument_url: 'https://ris.bka.gv.at/Dokument.wxe?Dokumentnummer=NOR40000001',
    gesamte_rechtsvorschrift_url: null,
    ...overrides,
  };
}

/**
 * Create a mock SearchResult with the given documents.
 */
function createMockSearchResult(
  documents: Document[],
  overrides: Partial<SearchResult> = {},
): SearchResult {
  return {
    total_hits: documents.length,
    page: 1,
    page_size: 20,
    has_more: false,
    documents,
    ...overrides,
  };
}

// =============================================================================
// formatDate() Tests
// =============================================================================

describe('formatDate', () => {
  describe('converts YYYY-MM-DD to DD.MM.YYYY', () => {
    it('should convert standard ISO date format', () => {
      expect(formatDate('2024-01-15')).toBe('15.01.2024');
    });

    it('should convert date with single digit day and month', () => {
      expect(formatDate('2024-01-01')).toBe('01.01.2024');
    });

    it('should convert date at end of year', () => {
      expect(formatDate('2024-12-31')).toBe('31.12.2024');
    });

    it('should handle ISO date with time component by taking only date part', () => {
      expect(formatDate('2024-01-15T10:30:00Z')).toBe('15.01.2024');
    });
  });

  describe('handles null/undefined', () => {
    it('should return empty string for null', () => {
      expect(formatDate(null)).toBe('');
    });

    it('should return empty string for undefined', () => {
      expect(formatDate(undefined)).toBe('');
    });

    it('should return empty string for empty string', () => {
      expect(formatDate('')).toBe('');
    });
  });

  describe('handles invalid format', () => {
    it('should return rearranged parts for string with dashes', () => {
      // "not-a-date" splits into ["not", "a", "date"] which becomes "date.a.not"
      expect(formatDate('not-a-date')).toBe('date.a.not');
    });

    it('should return original string for partial date', () => {
      expect(formatDate('2024')).toBe('2024');
    });

    it('should return original string for incomplete date', () => {
      expect(formatDate('2024-01')).toBe('2024-01');
    });

    it('should handle date with different separator by treating as non-standard', () => {
      expect(formatDate('01/15/2024')).toBe('01/15/2024');
    });
  });
});

// =============================================================================
// htmlToText() Tests
// =============================================================================

describe('htmlToText', () => {
  describe('extracts text from HTML', () => {
    it('should extract plain text from simple HTML', () => {
      const html = '<p>Hello World</p>';
      expect(htmlToText(html)).toBe('Hello World');
    });

    it('should extract text from nested HTML elements', () => {
      const html = '<div><p>First</p><p>Second</p></div>';
      expect(htmlToText(html)).toContain('First');
      expect(htmlToText(html)).toContain('Second');
    });

    it('should handle HTML with attributes', () => {
      const html = '<p class="test" id="main">Content</p>';
      expect(htmlToText(html)).toBe('Content');
    });

    it('should handle HTML entities', () => {
      const html = '<p>Test &amp; Demo &lt;tag&gt;</p>';
      expect(htmlToText(html)).toBe('Test & Demo <tag>');
    });

    it('should extract text from full HTML document', () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head><title>Test</title></head>
          <body><p>Body Content</p></body>
        </html>
      `;
      expect(htmlToText(html)).toBe('Body Content');
    });
  });

  describe('removes script/style tags', () => {
    it('should remove script tag content', () => {
      const html = '<p>Before</p><script>alert("test");</script><p>After</p>';
      const result = htmlToText(html);
      expect(result).toContain('Before');
      expect(result).toContain('After');
      expect(result).not.toContain('alert');
    });

    it('should remove style tag content', () => {
      const html = '<p>Before</p><style>.test { color: red; }</style><p>After</p>';
      const result = htmlToText(html);
      expect(result).toContain('Before');
      expect(result).toContain('After');
      expect(result).not.toContain('color');
    });

    it('should remove head tag content', () => {
      const html = "<head><meta charset='utf-8'><title>Title</title></head><body>Body</body>";
      const result = htmlToText(html);
      expect(result).toBe('Body');
      expect(result).not.toContain('Title');
    });

    it('should handle inline scripts', () => {
      const html = '<div onclick="alert()">Click me</div>';
      expect(htmlToText(html)).toBe('Click me');
    });
  });

  describe('removes screen-reader duplicates', () => {
    it('should drop a .sr-only twin and keep its visible partner', () => {
      expect(htmlToText('<span aria-hidden="true">X</span><span class="sr-only">Y</span>')).toBe(
        'X',
      );
    });

    it('should drop .sr-only without requiring an aria-hidden partner', () => {
      // Guards the recorded decision that the removal stays unconditional: a
      // pairing check would silently reinstate #64 the moment RIS drops or
      // renames the aria-hidden attribute on the visible half.
      expect(htmlToText('<span>X</span><span class="sr-only">Y</span>')).toBe('X');
    });
  });

  describe('normalizes whitespace', () => {
    it('should normalize multiple spaces to single space', () => {
      const html = '<p>Hello     World</p>';
      expect(htmlToText(html)).toBe('Hello World');
    });

    it('should normalize multiple newlines to double newlines', () => {
      const html = '<p>Line1</p>\n\n\n\n<p>Line2</p>';
      const result = htmlToText(html);
      expect(result).not.toMatch(/\n{3,}/);
    });

    it('should trim leading and trailing whitespace', () => {
      const html = '   <p>  Content  </p>   ';
      expect(htmlToText(html)).toBe('Content');
    });

    it('should handle tabs and normalize them', () => {
      const html = '<p>Hello\t\t\tWorld</p>';
      expect(htmlToText(html)).toBe('Hello World');
    });
  });

  describe('handles edge cases', () => {
    it('should return empty string for null/undefined input', () => {
      expect(htmlToText('')).toBe('');
      expect(htmlToText(null as unknown as string)).toBe('');
      expect(htmlToText(undefined as unknown as string)).toBe('');
    });

    it('should handle plain text without HTML tags', () => {
      expect(htmlToText('Just plain text')).toBe('Just plain text');
    });

    it('should handle empty HTML tags', () => {
      expect(htmlToText('<p></p><div></div>')).toBe('');
    });
  });
});

// =============================================================================
// htmlToText() against real RIS document HTML (issue #64)
// =============================================================================

/**
 * RIS renders every structural marker twice: a visible form carrying
 * `aria-hidden="true"` and a redundant spoken form in `class="sr-only"`
 * ("Vorlesefassung"). It also emits adjacent block elements without any
 * whitespace between them. The fixture is a trimmed but byte-exact excerpt of
 * the live § 1295 ABGB document (NOR12019037) containing both.
 */
describe('htmlToText with real RIS document HTML (issue #64)', () => {
  const html = readFileSync(
    new URL('./fixtures/nor12019037-excerpt.html', import.meta.url),
    'utf8',
  );
  const text = htmlToText(html);

  function countOf(needle: string): number {
    return text.split(needle).length - 1;
  }

  it('should keep each visible Absatz marker once and drop its spoken duplicate', () => {
    expect(countOf('(1)')).toBe(1);
    expect(countOf('(2)')).toBe(1);
    expect(text).not.toContain('Absatz eins,');
    expect(text).not.toContain('Absatz 2,');
  });

  it('should drop the spoken duplicates of the paragraph symbol', () => {
    expect(text).not.toMatch(/Paragraph \d+,/);
    expect(text).not.toContain('Paragraph/Artikel/Anlage');
    expect(text).toContain('§ 1295');
    expect(text).toContain('§/Artikel/Anlage');
  });

  it('should drop the spoken duplicate of the Kundmachungsorgan', () => {
    expect(text).toContain('JGS Nr. 946/1811 zuletzt geändert durch RGBl. Nr. 69/1916');
    expect(text).not.toContain('JGS Nr. 946 aus 1811');
  });

  it('should separate metadata labels from their values', () => {
    expect(text).not.toContain('KurztitelAllgemeines');
    expect(text).toMatch(/^Kurztitel$/m);
    expect(text).toMatch(/^Allgemeines bürgerliches Gesetzbuch$/m);
    expect(text).not.toContain('TypBG');
    expect(text).not.toContain('AbkürzungABGB');
    expect(text).not.toContain('DokumentnummerNOR12019037');
  });

  it('should preserve the visible legal text verbatim', () => {
    expect(text).toContain(
      'Jedermann ist berechtigt, von dem Beschädiger den Ersatz des Schadens, ' +
        'welchen dieser ihm aus Verschulden zugefügt hat, zu fordern; der Schaden mag durch ' +
        'Übertretung einer Vertragspflicht oder ohne Beziehung auf einen Vertrag verursacht ' +
        'worden sein.',
    );
    expect(text).toContain(
      'Auch wer in einer gegen die guten Sitten verstoßenden Weise absichtlich Schaden zufügt',
    );
    expect(text).toContain('Von der Verbindlichkeit zum Schadenersatze:');
    expect(text).toContain('20/01 Allgemeines bürgerliches Gesetzbuch (ABGB)');
  });

  it('should not leak stylesheet rules or the fixture provenance comment', () => {
    expect(text).not.toContain('position: absolute');
    expect(text).not.toContain('Fixture:');
  });
});

// =============================================================================
// htmlToText() table and <br> separators (issue #65)
// =============================================================================

describe('htmlToText separators (issue #65)', () => {
  describe('separates table cells with a space', () => {
    it('should join the cells of a row with a single space', () => {
      expect(htmlToText('<table><tr><td>Tarifpost</td><td>152,60</td></tr></table>')).toBe(
        'Tarifpost 152,60',
      );
    });

    it('should join header cells with a single space', () => {
      expect(htmlToText('<table><tr><th>Gebühr</th><th>Zeitgebühr</th></tr></table>')).toBe(
        'Gebühr Zeitgebühr',
      );
    });

    it('should keep a row together when RIS wraps each cell content in a block', () => {
      // The shape RIS actually emits: <td><p class="TabText">…</p></td>. Leaving
      // the inner <p> on the block pass would split the row into one paragraph
      // per cell again, so the space rule has to reach into the cell.
      const html = '<table><tr><td><p>Tarifpost</p></td><td><p>152,60</p></td></tr></table>';
      expect(htmlToText(html)).toBe('Tarifpost 152,60');
    });

    it('should never glue two cells together (regression guard for issue #64)', () => {
      const html = '<table><tr><td>Zelle1</td><td>Zelle2</td></tr></table>';
      expect(htmlToText(html)).not.toContain('Zelle1Zelle2');
    });
  });

  describe('separates table rows with a line break', () => {
    it('should put each row on its own line', () => {
      // A row is a block boundary like any other, so it keeps the blank-line
      // spacing the rest of the output uses — single newlines would be swallowed
      // when the text is rendered as Markdown, re-gluing the rows visually.
      expect(htmlToText('<table><tr><td>Zeile1</td></tr><tr><td>Zeile2</td></tr></table>')).toBe(
        'Zeile1\n\nZeile2',
      );
    });

    it('should not let a value leak into the neighbouring row', () => {
      const text = htmlToText(
        '<table><tr><td>1</td><td>152,60</td></tr><tr><td>2</td><td>178,80</td></tr></table>',
      );
      const lines = text.split('\n').filter((line) => line.length > 0);

      expect(lines).toEqual(['1 152,60', '2 178,80']);
    });
  });

  describe('turns <br> into a single newline', () => {
    it('should break the line without opening a paragraph', () => {
      expect(htmlToText('<p>BUNDESGESETZBLATT<br />FÜR DIE REPUBLIK ÖSTERREICH</p>')).toBe(
        'BUNDESGESETZBLATT\nFÜR DIE REPUBLIK ÖSTERREICH',
      );
    });

    it('should separate the two halves even without surrounding whitespace', () => {
      expect(htmlToText('<div>A<br>B</div>')).toBe('A\nB');
    });
  });
});

// =============================================================================
// htmlToText() against a real RIS BGBl fee table (issue #65)
// =============================================================================

/**
 * BGBl documents carry their fee and rate schedules as HTML tables, and every
 * one of them opens with the masthead row (Jahrgang / Ausgegeben am / Teil) and
 * a `<br />` inside the BUNDESGESETZBLATT heading. The fixture is a trimmed but
 * byte-exact excerpt of BGBl. II Nr. 371/2012 (Anhang 3 "Gebührentarif") holding
 * all three.
 */
describe('htmlToText with real RIS BGBl table HTML (issue #65)', () => {
  const html = readFileSync(
    new URL('./fixtures/bgbla-2012-ii-371-excerpt.html', import.meta.url),
    'utf8',
  );
  const text = htmlToText(html);

  /**
   * RIS glues citations together with U+00A0 ("§ 14 Pflanzenschutzgesetz")
   * and htmlToText deliberately leaves those bytes alone. Folding them to plain
   * spaces keeps the assertions below about the separators under test rather
   * than about RIS's use of non-breaking spaces.
   */
  function line(needle: string): string | undefined {
    return text
      .replace(/\u00a0/g, ' ')
      .split('\n')
      .find((candidate) => candidate.includes(needle));
  }

  it('should keep the masthead row on one line', () => {
    expect(line('Jahrgang 2012')).toBe('Jahrgang 2012 Ausgegeben am 9. November 2012 Teil II');
  });

  it('should keep the Kurztitel row on one line', () => {
    expect(line('371. Verordnung:')).toBe(
      '371. Verordnung: Änderung der Pflanzenschutzverordnung 2011',
    );
  });

  it('should keep the fee table header row on one line', () => {
    expect(line('Tarifpost')).toBe(
      'Tarifpost Art der Tätigkeit Pauschalgebühr ' +
        'Zuzüglich Zeitgebühr je angefangener halben Stunde Untersuchungsdauer',
    );
  });

  it('should keep each fee row together with its amounts', () => {
    expect(line('Verfahren zur Aufnahme')).toBe(
      '1 Verfahren zur Aufnahme von Betrieben in das amtliche Verzeichnis gemäß § 14 ' +
        'Pflanzenschutzgesetz 2011 (Registrierung) 152,60 26,20',
    );
    expect(line('Kombiniertes Registrierungs')).toBe(
      '3 Kombiniertes Registrierungs- und Autorisierungsverfahren 178,80 26,20',
    );
  });

  it('should put every fee row on its own line', () => {
    const headerLine = line('Tarifpost');

    expect(headerLine).not.toContain('152,60');
    expect(line('Kombiniertes Registrierungs')).not.toContain('Pflanzenpässen');
  });

  it('should break the BUNDESGESETZBLATT heading without a blank line', () => {
    expect(text).toContain('BUNDESGESETZBLATT\nFÜR DIE REPUBLIK ÖSTERREICH');
  });

  it('should not glue any cell to its neighbour', () => {
    expect(text).not.toContain('TarifpostArt');
    expect(text).not.toContain('152,6026,20');
    expect(text).not.toContain('Jahrgang 2012Ausgegeben');
    expect(text).not.toContain('Autorisierungsverfahren178,80');
  });

  it('should separate the Absatz marker from the Absatz text', () => {
    expect(text).not.toContain('„(2)Die Bezeichnung');
    expect(text).toContain('„(2) Die Bezeichnung des §');
  });

  it('should not leak stylesheet rules or the fixture provenance comment', () => {
    expect(text).not.toContain('position: absolute');
    expect(text).not.toContain('Fixture:');
  });
});

// =============================================================================
// formatDocument() against real RIS document HTML (issue #64)
// =============================================================================

describe('formatDocument with real RIS document HTML (issue #64)', () => {
  const html = readFileSync(
    new URL('./fixtures/nor12019037-excerpt.html', import.meta.url),
    'utf8',
  );
  const metadata: DocumentMetadata = {
    dokumentnummer: 'NOR12019037',
    applikation: 'BrKons',
    titel: '§ 1295 ABGB',
    kurztitel: 'ABGB',
    citation: {
      kurztitel: 'ABGB',
      langtitel: 'Allgemeines bürgerliches Gesetzbuch',
      kundmachungsorgan: 'JGS Nr. 946/1811',
      paragraph: '§ 1295',
      inkrafttreten: '1917-01-01',
    },
  };

  it('should keep the metadata block ahead of the content block', () => {
    const output = formatDocument(html, metadata);

    expect(output.indexOf('## Dokumentinformation')).toBeGreaterThan(-1);
    expect(output.indexOf('## Dokumentinformation')).toBeLessThan(output.indexOf('## Inhalt'));
    expect(output).toContain('**Dokumentnummer:** `NOR12019037`');
  });

  it('should render markdown content free of spoken duplicates and glued metadata', () => {
    const output = formatDocument(html, metadata);

    expect(output).not.toContain('Absatz eins,');
    expect(output).not.toContain('KurztitelAllgemeines');
    expect(output).toContain('Jedermann ist berechtigt');
  });

  it('should render json content free of spoken duplicates and glued metadata', () => {
    const parsed = JSON.parse(formatDocument(html, metadata, 'json')) as { content: string };

    expect(parsed.content).not.toContain('Absatz eins,');
    expect(parsed.content).not.toContain('KurztitelAllgemeines');
    expect(parsed.content).toContain('Jedermann ist berechtigt');
  });
});

// =============================================================================
// formatCitation() Tests
// =============================================================================

describe('formatCitation', () => {
  describe('routes to correct formatter based on applikation', () => {
    it('should route Justiz to formatCourtCitation', () => {
      const doc = createMockDocument({
        applikation: 'Justiz',
        titel: 'OGH 5 Ob 123/23t',
      });
      const citation = formatCitation(doc);
      expect(citation).toBe('OGH 5 Ob 123/23t');
    });

    it('should route Vfgh to formatCourtCitation', () => {
      const doc = createMockDocument({
        applikation: 'Vfgh',
        titel: 'VfGH 01.01.2024, E 123/2024',
      });
      const citation = formatCitation(doc);
      expect(citation).toContain('VfGH');
    });

    it('should route Vwgh to formatCourtCitation', () => {
      const doc = createMockDocument({
        applikation: 'Vwgh',
        titel: 'VwGH 15.03.2024, Ra 2024/01/0001',
      });
      const citation = formatCitation(doc);
      expect(citation).toContain('VwGH');
    });

    it('should route Bvwg to formatCourtCitation', () => {
      const doc = createMockDocument({
        applikation: 'Bvwg',
        titel: 'BVwG Decision',
      });
      const citation = formatCitation(doc);
      expect(citation).toBeTruthy();
    });

    it('should route Bundesrecht to formatLawCitation', () => {
      const doc = createMockDocument({
        applikation: 'BrKons',
        kurztitel: 'ABGB',
        citation: {
          paragraph: '§ 1',
          kurztitel: 'ABGB',
          kundmachungsorgan: 'BGBl. Nr. 1/1811',
        },
      });
      const citation = formatCitation(doc);
      expect(citation).toContain('§ 1');
      expect(citation).toContain('ABGB');
    });

    it('should route Lvwg to formatCourtCitation', () => {
      const doc = createMockDocument({
        applikation: 'Lvwg',
        titel: 'LVwG Decision 2024',
      });
      const citation = formatCitation(doc);
      expect(citation).toBeTruthy();
    });

    it('should route Dsk to formatCourtCitation', () => {
      const doc = createMockDocument({
        applikation: 'Dsk',
        titel: 'DSK Decision',
      });
      const citation = formatCitation(doc);
      expect(citation).toBeTruthy();
    });

    // N1: previously only Justiz/Vfgh/Vwgh/Bvwg/Lvwg/Dsk were treated as court
    // decisions; every other Judikatur applikation was wrongly formatted as a law.
    describe('routes ALL judikatur applikationen to court formatter (N1)', () => {
      const courtApps = [
        'Gbk',
        'Pvak',
        'Dok',
        'AsylGH',
        'Normenliste',
        'Verg',
        'Uvs',
        'Ubas',
        'Umse',
        'Bks',
      ];

      for (const app of courtApps) {
        it(`should route ${app} to court formatter, not law formatter`, () => {
          const doc = createMockDocument({
            applikation: app,
            titel: 'Fallzahl 12/24',
            kurztitel: 'LawKurztitel',
            citation: {
              paragraph: '§ 5',
              kurztitel: 'LawKurztitel',
              kundmachungsorgan: 'BGBl. I Nr. 1/2024',
            },
          });
          const citation = formatCitation(doc);
          // A law citation would contain the paragraph and kurztitel; a court
          // citation is built from the title / Geschaeftszahl instead.
          expect(citation).not.toContain('§ 5');
          expect(citation).not.toContain('LawKurztitel');
        });
      }
    });
  });
});

// =============================================================================
// formatCourtCitation() Tests (via formatCitation)
// =============================================================================

describe('formatCourtCitation (via formatCitation)', () => {
  describe('OGH format', () => {
    it('should extract OGH citation from title', () => {
      const doc = createMockDocument({
        applikation: 'Justiz',
        titel: 'OGH 5 Ob 123/23t - Some description',
      });
      expect(formatCitation(doc)).toBe('OGH 5 Ob 123/23t');
    });

    it('should handle OGH with comma separator', () => {
      const doc = createMockDocument({
        applikation: 'Justiz',
        titel: 'OGH, 5 Ob 123/23t',
      });
      expect(formatCitation(doc)).toBe('OGH 5 Ob 123/23t');
    });

    it('should handle OGH with colon separator', () => {
      const doc = createMockDocument({
        applikation: 'Justiz',
        titel: 'OGH: 5 Ob 123/23t',
      });
      expect(formatCitation(doc)).toBe('OGH 5 Ob 123/23t');
    });
  });

  describe('VfGH, VwGH formats', () => {
    it('should format VfGH citation with date and case number', () => {
      const doc = createMockDocument({
        applikation: 'Vfgh',
        titel: 'Erkenntnis vom 01.01.2024, E 123/2024',
      });
      const citation = formatCitation(doc);
      expect(citation).toBe('VfGH 01.01.2024, E 123/2024');
    });

    it('should format VwGH citation with case number only', () => {
      const doc = createMockDocument({
        applikation: 'Vwgh',
        titel: 'Entscheidung E 456/2024',
      });
      const citation = formatCitation(doc);
      expect(citation).toBe('VwGH E 456/2024');
    });

    it('should format BVwG citation', () => {
      const doc = createMockDocument({
        applikation: 'Bvwg',
        titel: '15.05.2024, W 789/2024',
      });
      const citation = formatCitation(doc);
      expect(citation).toBe('BVwG 15.05.2024, W 789/2024');
    });
  });

  describe('extracts case numbers from title', () => {
    it('should extract case number pattern from various formats', () => {
      const doc = createMockDocument({
        applikation: 'Vfgh',
        titel: 'G 100/2024',
      });
      const citation = formatCitation(doc);
      expect(citation).toBe('VfGH G 100/2024');
    });

    it('should handle uppercase case types', () => {
      const doc = createMockDocument({
        applikation: 'Vfgh',
        titel: 'B 123/2024',
      });
      const citation = formatCitation(doc);
      expect(citation).toBe('VfGH B 123/2024');
    });
  });

  describe('fallback to dokumentnummer', () => {
    it('should use title if no pattern matches and title is short', () => {
      const doc = createMockDocument({
        applikation: 'Justiz',
        titel: 'Short Title',
        // Use a dokumentnummer that doesn't match the OGH/OLG/LG/BG pattern
        dokumentnummer: 'JJT_20240101_UNKNOWN_0010XX00001_24T0000_000',
      });
      const citation = formatCitation(doc);
      expect(citation).toBe('Short Title');
    });

    it('should use dokumentnummer if title is too long', () => {
      const doc = createMockDocument({
        applikation: 'Justiz',
        titel:
          'This is a very long title that exceeds sixty characters and should be replaced with dokumentnummer',
        dokumentnummer: 'JJT_20240101_DOC123',
      });
      const citation = formatCitation(doc);
      expect(citation).toBe('JJT_20240101_DOC123');
    });
  });
});

// =============================================================================
// formatLawCitation() Tests (via formatCitation)
// =============================================================================

describe('formatLawCitation (via formatCitation)', () => {
  describe('with paragraph + kurztitel', () => {
    it('should format citation with paragraph and kurztitel', () => {
      const doc = createMockDocument({
        applikation: 'BrKons',
        kurztitel: 'ABGB',
        citation: {
          paragraph: '§ 1',
          kurztitel: 'ABGB',
        },
      });
      const citation = formatCitation(doc);
      expect(citation).toContain('§ 1');
      expect(citation).toContain('ABGB');
    });

    it('should format citation with only kurztitel when no paragraph', () => {
      const doc = createMockDocument({
        applikation: 'BrKons',
        kurztitel: 'StGB',
        citation: {
          kurztitel: 'StGB',
          paragraph: null,
        },
      });
      const citation = formatCitation(doc);
      expect(citation).toContain('StGB');
    });
  });

  describe('with kundmachungsorgan', () => {
    it('should include kundmachungsorgan in parentheses', () => {
      const doc = createMockDocument({
        applikation: 'BrKons',
        kurztitel: 'ABGB',
        citation: {
          paragraph: '§ 1',
          kurztitel: 'ABGB',
          kundmachungsorgan: 'BGBl. I Nr. 1',
        },
      });
      const citation = formatCitation(doc);
      expect(citation).toBe('§ 1 ABGB (BGBl. I Nr. 1)');
    });

    it('should omit kundmachungsorgan if too long', () => {
      const doc = createMockDocument({
        applikation: 'BrKons',
        kurztitel: 'TestLaw',
        citation: {
          paragraph: '§ 1',
          kurztitel: 'TestLaw',
          kundmachungsorgan:
            'This is a very long kundmachungsorgan reference that exceeds thirty characters',
        },
      });
      const citation = formatCitation(doc);
      expect(citation).toBe('§ 1 TestLaw');
    });
  });

  describe('fallback handling', () => {
    it('should fallback to titel when no citation parts available', () => {
      const doc = createMockDocument({
        applikation: 'BrKons',
        titel: 'Some Law Title',
        kurztitel: null,
        citation: {
          paragraph: null,
          kurztitel: null,
          kundmachungsorgan: null,
        },
      });
      const citation = formatCitation(doc);
      expect(citation).toBe('Some Law Title');
    });

    it('should fallback to dokumentnummer when no titel or citation', () => {
      const doc = {
        applikation: 'BrKons',
        dokumentnummer: 'NOR40000001',
        kurztitel: null,
        citation: {},
      };
      const citation = formatCitation(doc);
      expect(citation).toBe('NOR40000001');
    });

    it('should return empty string as last resort', () => {
      const doc = {
        applikation: 'BrKons',
        citation: {},
      };
      const citation = formatCitation(doc);
      expect(citation).toBe('');
    });
  });
});

// =============================================================================
// formatSearchResults() Tests
// =============================================================================

describe('formatSearchResults', () => {
  describe('markdown format', () => {
    it('should format results in markdown by default', () => {
      const doc = createMockDocument();
      const results = createMockSearchResult([doc]);
      const formatted = formatSearchResults(results);

      expect(formatted).toContain('**Gefunden:');
      expect(formatted).toContain('Treffer**');
    });

    it('should explicitly use markdown format', () => {
      const doc = createMockDocument();
      const results = createMockSearchResult([doc]);
      const formatted = formatSearchResults(results, 'markdown');

      expect(formatted).toContain('**Gefunden:');
    });
  });

  describe('JSON format', () => {
    it('should format results as JSON when specified', () => {
      const doc = createMockDocument();
      const results = createMockSearchResult([doc]);
      const formatted = formatSearchResults(results, 'json');

      const parsed = JSON.parse(formatted);
      expect(parsed.total_hits).toBe(1);
      expect(parsed.documents).toHaveLength(1);
    });

    it('should include all document fields in JSON format', () => {
      const doc = createMockDocument();
      const results = createMockSearchResult([doc]);
      const formatted = formatSearchResults(results, 'json');

      const parsed = JSON.parse(formatted);
      expect(parsed.documents[0].dokumentnummer).toBe('NOR40000001');
      expect(parsed.documents[0].applikation).toBe('BrKons');
    });
  });

  describe('handles plain object input', () => {
    it('should handle Record<string, unknown> format', () => {
      const data = {
        total_hits: 5,
        page: 1,
        page_size: 20,
        has_more: false,
        documents: [
          {
            dokumentnummer: 'TEST001',
            titel: 'Test',
          },
        ],
      };
      const formatted = formatSearchResults(data, 'markdown');
      expect(formatted).toContain('5 Treffer');
    });
  });
});

// =============================================================================
// formatSearchResultsMarkdown() Tests (via formatSearchResults)
// =============================================================================

describe('formatSearchResultsMarkdown (via formatSearchResults)', () => {
  describe('header with hit count', () => {
    it('should display total hits and page info', () => {
      const doc = createMockDocument();
      const results = createMockSearchResult([doc], {
        total_hits: 100,
        page: 3,
        page_size: 20,
      });
      const formatted = formatSearchResults(results, 'markdown');

      expect(formatted).toContain('**Gefunden: 100 Treffer**');
      expect(formatted).toContain('(Seite 3 von 5)');
    });

    it('should calculate total pages correctly', () => {
      const doc = createMockDocument();
      const results = createMockSearchResult([doc], {
        total_hits: 55,
        page: 1,
        page_size: 10,
      });
      const formatted = formatSearchResults(results, 'markdown');

      expect(formatted).toContain('(Seite 1 von 6)');
    });
  });

  describe('no results message', () => {
    it('should display no documents message when empty', () => {
      const results = createMockSearchResult([], { total_hits: 0 });
      const formatted = formatSearchResults(results, 'markdown');

      expect(formatted).toContain('_Keine Dokumente gefunden._');
    });
  });

  describe('document list formatting', () => {
    it('should format each document with numbered heading', () => {
      const docs = [createMockDocument(), createMockDocument({ dokumentnummer: 'NOR40000002' })];
      const results = createMockSearchResult(docs, { total_hits: 2 });
      const formatted = formatSearchResults(results, 'markdown');

      expect(formatted).toContain('### 1.');
      expect(formatted).toContain('### 2.');
    });

    it('should include dokumentnummer for retrieval', () => {
      const doc = createMockDocument({ dokumentnummer: 'NOR40000123' });
      const results = createMockSearchResult([doc]);
      const formatted = formatSearchResults(results, 'markdown');

      expect(formatted).toContain('`Dokumentnummer: NOR40000123`');
    });

    it('should show pagination hint when has_more is true', () => {
      const doc = createMockDocument();
      const results = createMockSearchResult([doc], {
        has_more: true,
        page: 1,
      });
      const formatted = formatSearchResults(results, 'markdown');

      expect(formatted).toContain('Weitere Treffer verfügbar');
      expect(formatted).toContain('`seite: 2`');
    });

    it('should not show pagination hint when has_more is false', () => {
      const doc = createMockDocument();
      const results = createMockSearchResult([doc], { has_more: false });
      const formatted = formatSearchResults(results, 'markdown');

      expect(formatted).not.toContain('Weitere Treffer verfügbar');
    });

    it('should include inkrafttreten date', () => {
      const doc = createMockDocument({
        citation: {
          inkrafttreten: '2024-01-15',
        },
      });
      const results = createMockSearchResult([doc]);
      const formatted = formatSearchResults(results, 'markdown');

      expect(formatted).toContain('In Kraft seit: 15.01.2024');
    });

    it('should include ausserkrafttreten date when not 9999-12-31', () => {
      const doc = createMockDocument({
        citation: {
          ausserkrafttreten: '2024-12-31',
        },
      });
      const results = createMockSearchResult([doc]);
      const formatted = formatSearchResults(results, 'markdown');

      expect(formatted).toContain('Außer Kraft: 31.12.2024');
    });

    it('should not include ausserkrafttreten when 9999-12-31', () => {
      const doc = createMockDocument({
        citation: {
          ausserkrafttreten: '9999-12-31',
        },
      });
      const results = createMockSearchResult([doc]);
      const formatted = formatSearchResults(results, 'markdown');

      expect(formatted).not.toContain('Außer Kraft:');
    });
  });
});

// =============================================================================
// formatDocument() / formatDocumentMarkdown() Tests
// =============================================================================

describe('formatDocument', () => {
  describe('markdown format', () => {
    it('should format document as markdown by default', () => {
      const metadata: DocumentMetadata = {
        dokumentnummer: 'NOR40000001',
        applikation: 'BrKons',
        titel: 'Test Law',
        kurztitel: 'TL',
        citation: {
          paragraph: '§ 1',
          kurztitel: 'TL',
        },
      };
      const content = '<p>Document content</p>';
      const formatted = formatDocument(content, metadata);

      expect(formatted).toContain('# ');
      expect(formatted).toContain('## Dokumentinformation');
      expect(formatted).toContain('## Inhalt');
    });
  });

  describe('JSON format', () => {
    it('should format document as JSON when specified', () => {
      const metadata: DocumentMetadata = {
        dokumentnummer: 'NOR40000001',
        applikation: 'BrKons',
        titel: 'Test Law',
      };
      const content = '<p>Content</p>';
      const formatted = formatDocument(content, metadata, 'json');

      const parsed = JSON.parse(formatted);
      expect(parsed.metadata.dokumentnummer).toBe('NOR40000001');
      expect(parsed.content).toBe('Content');
    });

    it('should convert HTML to text in JSON content', () => {
      const metadata: DocumentMetadata = {};
      const content = '<p>Paragraph 1</p><p>Paragraph 2</p>';
      const formatted = formatDocument(content, metadata, 'json');

      const parsed = JSON.parse(formatted);
      expect(parsed.content).toContain('Paragraph 1');
      expect(parsed.content).toContain('Paragraph 2');
      expect(parsed.content).not.toContain('<p>');
    });
  });
});

describe('formatDocumentMarkdown (via formatDocument)', () => {
  describe('metadata section', () => {
    it('should include title in metadata', () => {
      const metadata: DocumentMetadata = {
        citation: {
          langtitel: 'Full Title of the Law',
        },
      };
      const formatted = formatDocument('<p>Content</p>', metadata);

      expect(formatted).toContain('**Titel:** Full Title of the Law');
    });

    it('should fallback to titel when no langtitel', () => {
      const metadata: DocumentMetadata = {
        titel: 'Short Title',
        citation: {},
      };
      const formatted = formatDocument('<p>Content</p>', metadata);

      expect(formatted).toContain('**Titel:** Short Title');
    });

    it('should include paragraph', () => {
      const metadata: DocumentMetadata = {
        citation: {
          paragraph: '§ 42',
        },
      };
      const formatted = formatDocument('<p>Content</p>', metadata);

      expect(formatted).toContain('**Paragraph:** § 42');
    });

    it('should include kundmachungsorgan', () => {
      const metadata: DocumentMetadata = {
        citation: {
          kundmachungsorgan: 'BGBl. I Nr. 100/2024',
        },
      };
      const formatted = formatDocument('<p>Content</p>', metadata);

      expect(formatted).toContain('**Kundmachungsorgan:** BGBl. I Nr. 100/2024');
    });

    it('should include inkrafttreten date formatted', () => {
      const metadata: DocumentMetadata = {
        citation: {
          inkrafttreten: '2024-06-15',
        },
      };
      const formatted = formatDocument('<p>Content</p>', metadata);

      expect(formatted).toContain('**In Kraft seit:** 15.06.2024');
    });

    it('should include ausserkrafttreten when not perpetual', () => {
      const metadata: DocumentMetadata = {
        citation: {
          ausserkrafttreten: '2025-12-31',
        },
      };
      const formatted = formatDocument('<p>Content</p>', metadata);

      expect(formatted).toContain('**Außer Kraft:** 31.12.2025');
    });

    it('should not include ausserkrafttreten when perpetual (9999-12-31)', () => {
      const metadata: DocumentMetadata = {
        citation: {
          ausserkrafttreten: '9999-12-31',
        },
      };
      const formatted = formatDocument('<p>Content</p>', metadata);

      expect(formatted).not.toContain('**Außer Kraft:**');
    });

    it('should include ELI', () => {
      const metadata: DocumentMetadata = {
        citation: {
          eli: 'eli/bgbl/2024/100',
        },
      };
      const formatted = formatDocument('<p>Content</p>', metadata);

      expect(formatted).toContain('**ELI:** eli/bgbl/2024/100');
    });

    it('should include dokumentnummer in code format', () => {
      const metadata: DocumentMetadata = {
        dokumentnummer: 'NOR40000001',
      };
      const formatted = formatDocument('<p>Content</p>', metadata);

      expect(formatted).toContain('**Dokumentnummer:** `NOR40000001`');
    });

    it('should include dokument_url as link', () => {
      const metadata: DocumentMetadata = {
        dokument_url: 'https://ris.bka.gv.at/doc',
      };
      const formatted = formatDocument('<p>Content</p>', metadata);

      expect(formatted).toContain(
        '**Quelle:** [https://ris.bka.gv.at/doc](https://ris.bka.gv.at/doc)',
      );
    });

    it('should include gesamte_rechtsvorschrift_url as link', () => {
      const metadata: DocumentMetadata = {
        gesamte_rechtsvorschrift_url: 'https://ris.bka.gv.at/full',
      };
      const formatted = formatDocument('<p>Content</p>', metadata);

      expect(formatted).toContain(
        '**Gesamte Rechtsvorschrift:** [https://ris.bka.gv.at/full](https://ris.bka.gv.at/full)',
      );
    });
  });

  describe('content section', () => {
    it('should include content section header', () => {
      const metadata: DocumentMetadata = {};
      const formatted = formatDocument('<p>Test content</p>', metadata);

      expect(formatted).toContain('## Inhalt');
    });

    it('should convert HTML content to text', () => {
      const metadata: DocumentMetadata = {};
      const content = '<div><p>Paragraph one.</p><p>Paragraph two.</p></div>';
      const formatted = formatDocument(content, metadata);

      expect(formatted).toContain('Paragraph one.');
      expect(formatted).toContain('Paragraph two.');
      expect(formatted).not.toContain('<p>');
      expect(formatted).not.toContain('<div>');
    });

    it('should remove script and style from content', () => {
      const metadata: DocumentMetadata = {};
      const content = '<p>Visible</p><script>hidden()</script><style>.hidden{}</style>';
      const formatted = formatDocument(content, metadata);

      expect(formatted).toContain('Visible');
      expect(formatted).not.toContain('hidden()');
      expect(formatted).not.toContain('.hidden');
    });
  });
});

// =============================================================================
// truncateResponse() Tests
// =============================================================================

describe('truncateResponse', () => {
  describe('under limit unchanged', () => {
    it('should return text unchanged when under limit', () => {
      const text = 'Short text';
      expect(truncateResponse(text)).toBe(text);
    });

    it('should return text unchanged when exactly at limit', () => {
      const text = 'x'.repeat(25000);
      expect(truncateResponse(text)).toBe(text);
    });

    it('should respect custom limit', () => {
      const text = 'x'.repeat(100);
      expect(truncateResponse(text, 100)).toBe(text);
    });
  });

  describe('over limit truncated with message', () => {
    it('should truncate text exceeding limit', () => {
      const text = 'x'.repeat(30000);
      const result = truncateResponse(text);

      expect(result.length).toBeLessThan(text.length);
      expect(result).toContain('Antwort gekuerzt');
    });

    it('should include original and new length in message', () => {
      const text = 'x'.repeat(30000);
      const result = truncateResponse(text);

      expect(result).toContain('30000 ->');
    });

    it('should suggest using specific search', () => {
      const text = 'x'.repeat(30000);
      const result = truncateResponse(text);

      expect(result).toContain('ris_dokument');
    });
  });

  describe('boundary detection (paragraph, sentence)', () => {
    it('should try to truncate at paragraph boundary', () => {
      const paragraphs = [];
      for (let i = 0; i < 100; i++) {
        paragraphs.push('This is paragraph ' + i + '. It has some content.');
      }
      const text = paragraphs.join('\n\n');
      const result = truncateResponse(text, 500);

      // Should end cleanly at a paragraph boundary
      const truncatedContent = result.split('\n\n---')[0];
      expect(truncatedContent).not.toMatch(/paragraph \d+\. It h$/);
    });

    it('should fallback to sentence boundary when no paragraph found', () => {
      const sentences = [];
      for (let i = 0; i < 100; i++) {
        sentences.push('Sentence number ' + i + '.');
      }
      const text = sentences.join(' ');
      const result = truncateResponse(text, 500);

      // Should end at a sentence
      const truncatedContent = result.split('\n\n---')[0];
      expect(truncatedContent.endsWith('.')).toBe(true);
    });

    it('should handle question mark as sentence boundary', () => {
      const text = 'Is this a question? ' + 'x'.repeat(500);
      const result = truncateResponse(text, 100);

      expect(result).toContain('Antwort gekuerzt');
    });

    it('should handle exclamation mark as sentence boundary', () => {
      const text = 'This is exciting! ' + 'x'.repeat(500);
      const result = truncateResponse(text, 100);

      expect(result).toContain('Antwort gekuerzt');
    });

    it('should handle text with no natural boundaries', () => {
      const text = 'x'.repeat(30000);
      const result = truncateResponse(text);

      expect(result).toContain('Antwort gekuerzt');
      expect(result.length).toBeLessThan(30000);
    });
  });

  describe('custom limits', () => {
    it('should respect custom character limit', () => {
      const text = 'x'.repeat(200);
      const result = truncateResponse(text, 100);

      // The truncation includes a message, so total may exceed original limit
      // but the content before the message should be truncated
      expect(result).toContain('Antwort gekuerzt');
      expect(result.length).toBeLessThan(text.length + 200); // Allow for message
    });

    it('should use default limit of 25000 when not specified', () => {
      const text = 'x'.repeat(26000);
      const result = truncateResponse(text);

      expect(result).toContain('Antwort gekuerzt');
    });
  });
});
