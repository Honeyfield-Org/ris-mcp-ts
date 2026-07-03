/**
 * Tests for parser functions in the RIS MCP Server.
 *
 * This module tests the various parsing utilities used to transform
 * raw RIS API responses into structured Document and SearchResult models.
 */

import { describe, it, expect } from 'vitest';

import {
  extractText,
  extractContentUrls,
  parseDocumentFromApiResponse,
  parseSearchResults,
} from '../parser.js';
import type {
  RawContentReference,
  RawDocumentReference,
  NormalizedSearchResults,
} from '../types.js';

// =============================================================================
// Tests for extractText()
// =============================================================================

describe('extractText', () => {
  describe('string input', () => {
    it('should return trimmed string for normal string input', () => {
      expect(extractText('Hello World')).toBe('Hello World');
    });

    it('should trim leading whitespace', () => {
      expect(extractText('   Hello')).toBe('Hello');
    });

    it('should trim trailing whitespace', () => {
      expect(extractText('Hello   ')).toBe('Hello');
    });

    it('should trim both leading and trailing whitespace', () => {
      expect(extractText('   Hello World   ')).toBe('Hello World');
    });

    it('should return null for empty string', () => {
      expect(extractText('')).toBeNull();
    });

    it('should return null for whitespace-only string', () => {
      expect(extractText('   ')).toBeNull();
    });

    it('should return null for tabs and newlines only', () => {
      expect(extractText('\t\n\r')).toBeNull();
    });
  });

  describe('null/undefined input', () => {
    it('should return null for null input', () => {
      expect(extractText(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(extractText(undefined)).toBeNull();
    });
  });

  describe('object with #text property', () => {
    it('should extract string from #text property', () => {
      expect(extractText({ '#text': 'Extracted Text' })).toBe('Extracted Text');
    });

    it('should trim #text value', () => {
      expect(extractText({ '#text': '  Trimmed  ' })).toBe('Trimmed');
    });

    it('should return null for empty #text', () => {
      expect(extractText({ '#text': '' })).toBeNull();
    });

    it('should return null for whitespace-only #text', () => {
      expect(extractText({ '#text': '   ' })).toBeNull();
    });
  });

  describe('object with item property', () => {
    it('should extract string from item property', () => {
      expect(extractText({ item: 'Item Text' })).toBe('Item Text');
    });

    it('should trim item value', () => {
      expect(extractText({ item: '  Trimmed Item  ' })).toBe('Trimmed Item');
    });

    it('should join array items with comma separator', () => {
      expect(extractText({ item: ['First', 'Second', 'Third'] })).toBe('First, Second, Third');
    });

    it('should handle single-element array in item', () => {
      expect(extractText({ item: ['Single'] })).toBe('Single');
    });

    it('should handle empty array in item', () => {
      expect(extractText({ item: [] })).toBe('');
    });
  });

  describe('priority handling', () => {
    it('should prefer #text over item when both exist', () => {
      expect(extractText({ '#text': 'Text Value', item: 'Item Value' })).toBe('Text Value');
    });

    it('should fall back to item when #text is undefined', () => {
      expect(extractText({ '#text': undefined, item: 'Item Value' })).toBe('Item Value');
    });
  });

  describe('edge cases', () => {
    it('should return null for empty object', () => {
      expect(extractText({})).toBeNull();
    });

    it('should return null for object without #text or item', () => {
      expect(extractText({ other: 'value' })).toBeNull();
    });

    it('should return null for number input', () => {
      expect(extractText(123)).toBeNull();
    });

    it('should return null for boolean input', () => {
      expect(extractText(true)).toBeNull();
    });

    it('should return null for array input', () => {
      expect(extractText(['a', 'b'])).toBeNull();
    });
  });
});

// =============================================================================
// Tests for extractContentUrls()
// =============================================================================

describe('extractContentUrls', () => {
  describe('finding URLs by DataType', () => {
    it('should extract Html URL', () => {
      const contentRef: RawContentReference = {
        Urls: {
          ContentUrl: [{ DataType: 'Html', Url: 'https://example.com/doc.html' }],
        },
      };

      const result = extractContentUrls(contentRef);
      expect(result.html).toBe('https://example.com/doc.html');
    });

    it('should extract Pdf URL', () => {
      const contentRef: RawContentReference = {
        Urls: {
          ContentUrl: [{ DataType: 'Pdf', Url: 'https://example.com/doc.pdf' }],
        },
      };

      const result = extractContentUrls(contentRef);
      expect(result.pdf).toBe('https://example.com/doc.pdf');
    });

    it('should extract Xml URL', () => {
      const contentRef: RawContentReference = {
        Urls: {
          ContentUrl: [{ DataType: 'Xml', Url: 'https://example.com/doc.xml' }],
        },
      };

      const result = extractContentUrls(contentRef);
      expect(result.xml).toBe('https://example.com/doc.xml');
    });

    it('should extract Rtf URL', () => {
      const contentRef: RawContentReference = {
        Urls: {
          ContentUrl: [{ DataType: 'Rtf', Url: 'https://example.com/doc.rtf' }],
        },
      };

      const result = extractContentUrls(contentRef);
      expect(result.rtf).toBe('https://example.com/doc.rtf');
    });

    it('should extract all URL types when all are present', () => {
      const contentRef: RawContentReference = {
        Urls: {
          ContentUrl: [
            { DataType: 'Html', Url: 'https://example.com/doc.html' },
            { DataType: 'Pdf', Url: 'https://example.com/doc.pdf' },
            { DataType: 'Xml', Url: 'https://example.com/doc.xml' },
            { DataType: 'Rtf', Url: 'https://example.com/doc.rtf' },
          ],
        },
      };

      const result = extractContentUrls(contentRef);
      expect(result.html).toBe('https://example.com/doc.html');
      expect(result.pdf).toBe('https://example.com/doc.pdf');
      expect(result.xml).toBe('https://example.com/doc.xml');
      expect(result.rtf).toBe('https://example.com/doc.rtf');
    });

    it('should return null for URL type not found', () => {
      const contentRef: RawContentReference = {
        Urls: {
          ContentUrl: [{ DataType: 'Html', Url: 'https://example.com/doc.html' }],
        },
      };

      const result = extractContentUrls(contentRef);
      expect(result.html).toBe('https://example.com/doc.html');
      expect(result.pdf).toBeNull();
      expect(result.xml).toBeNull();
      expect(result.rtf).toBeNull();
    });

    it('should return first URL when multiple of same type exist', () => {
      const contentRef: RawContentReference = {
        Urls: {
          ContentUrl: [
            { DataType: 'Html', Url: 'https://example.com/first.html' },
            { DataType: 'Html', Url: 'https://example.com/second.html' },
          ],
        },
      };

      const result = extractContentUrls(contentRef);
      expect(result.html).toBe('https://example.com/first.html');
    });
  });

  describe('handling single vs array ContentUrl', () => {
    it('should handle single ContentUrl object (not array)', () => {
      const contentRef: RawContentReference = {
        Urls: {
          ContentUrl: { DataType: 'Html', Url: 'https://example.com/single.html' },
        },
      };

      const result = extractContentUrls(contentRef);
      expect(result.html).toBe('https://example.com/single.html');
    });

    it('should handle ContentUrl array with one element', () => {
      const contentRef: RawContentReference = {
        Urls: {
          ContentUrl: [{ DataType: 'Pdf', Url: 'https://example.com/one.pdf' }],
        },
      };

      const result = extractContentUrls(contentRef);
      expect(result.pdf).toBe('https://example.com/one.pdf');
    });

    it('should handle ContentUrl array with multiple elements', () => {
      const contentRef: RawContentReference = {
        Urls: {
          ContentUrl: [
            { DataType: 'Html', Url: 'https://example.com/doc.html' },
            { DataType: 'Pdf', Url: 'https://example.com/doc.pdf' },
          ],
        },
      };

      const result = extractContentUrls(contentRef);
      expect(result.html).toBe('https://example.com/doc.html');
      expect(result.pdf).toBe('https://example.com/doc.pdf');
    });
  });

  describe('handling null/missing values', () => {
    it('should return all nulls for undefined contentRef', () => {
      const result = extractContentUrls(undefined);
      expect(result).toEqual({
        html: null,
        xml: null,
        pdf: null,
        rtf: null,
      });
    });

    it('should return all nulls when Urls is undefined', () => {
      const contentRef: RawContentReference = {};
      const result = extractContentUrls(contentRef);
      expect(result).toEqual({
        html: null,
        xml: null,
        pdf: null,
        rtf: null,
      });
    });

    it('should return all nulls when ContentUrl is undefined', () => {
      const contentRef: RawContentReference = {
        Urls: {},
      };
      const result = extractContentUrls(contentRef);
      expect(result).toEqual({
        html: null,
        xml: null,
        pdf: null,
        rtf: null,
      });
    });

    it('should return null when ContentUrl item has no Url property', () => {
      const contentRef: RawContentReference = {
        Urls: {
          ContentUrl: [{ DataType: 'Html' }],
        },
      };

      const result = extractContentUrls(contentRef);
      expect(result.html).toBeNull();
    });

    it('should return null when ContentUrl item has no DataType', () => {
      const contentRef: RawContentReference = {
        Urls: {
          ContentUrl: [{ Url: 'https://example.com/doc.html' }],
        },
      };

      const result = extractContentUrls(contentRef);
      expect(result.html).toBeNull();
      expect(result.pdf).toBeNull();
    });

    it('should handle empty ContentUrl array', () => {
      const contentRef: RawContentReference = {
        Urls: {
          ContentUrl: [],
        },
      };

      const result = extractContentUrls(contentRef);
      expect(result).toEqual({
        html: null,
        xml: null,
        pdf: null,
        rtf: null,
      });
    });
  });
});

// =============================================================================
// Tests for parseDocumentFromApiResponse()
// =============================================================================

describe('parseDocumentFromApiResponse', () => {
  describe('Bundesrecht document parsing', () => {
    it('should parse complete Bundesrecht document', () => {
      const rawDoc: RawDocumentReference = {
        Data: {
          Metadaten: {
            Technisch: {
              ID: 'NOR40250169',
              Applikation: 'BrKons',
            },
            Allgemein: {
              DokumentUrl:
                'https://ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer=NOR40250169',
            },
            Bundesrecht: {
              Kurztitel: 'ABGB',
              Langtitel: 'Allgemeines Buergerliches Gesetzbuch',
              Eli: 'https://eli.bgbl.gv.at/abc',
              BrKons: {
                Kundmachungsorgan: 'BGBl. Nr. 1/1812',
                ArtikelParagraphAnlage: 'Para 1',
                Inkrafttretensdatum: '1812-01-01',
                Ausserkrafttretensdatum: undefined,
                GesamteRechtsvorschriftUrl:
                  'https://ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10001622',
              },
            },
          },
          Dokumentliste: {
            ContentReference: {
              ContentType: 'MainDocument',
              Name: 'ABGB Para 1',
              Urls: {
                ContentUrl: [
                  { DataType: 'Html', Url: 'https://ris.bka.gv.at/doc.html' },
                  { DataType: 'Pdf', Url: 'https://ris.bka.gv.at/doc.pdf' },
                ],
              },
            },
          },
        },
      };

      const result = parseDocumentFromApiResponse(rawDoc);

      expect(result.dokumentnummer).toBe('NOR40250169');
      expect(result.applikation).toBe('BrKons');
      expect(result.titel).toBe('ABGB');
      expect(result.kurztitel).toBe('ABGB');
      expect(result.dokument_url).toBe(
        'https://ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer=NOR40250169',
      );
      expect(result.gesamte_rechtsvorschrift_url).toBe(
        'https://ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10001622',
      );
      expect(result.content_urls.html).toBe('https://ris.bka.gv.at/doc.html');
      expect(result.content_urls.pdf).toBe('https://ris.bka.gv.at/doc.pdf');
      expect(result.citation.kurztitel).toBe('ABGB');
      expect(result.citation.langtitel).toBe('Allgemeines Buergerliches Gesetzbuch');
      expect(result.citation.kundmachungsorgan).toBe('BGBl. Nr. 1/1812');
      expect(result.citation.paragraph).toBe('Para 1');
      expect(result.citation.eli).toBe('https://eli.bgbl.gv.at/abc');
      expect(result.citation.inkrafttreten).toBe('1812-01-01');
      expect(result.citation.ausserkrafttreten).toBeNull();
    });

    it('should use Titel as fallback when Langtitel is missing', () => {
      const rawDoc: RawDocumentReference = {
        Data: {
          Metadaten: {
            Technisch: {
              ID: 'NOR40000001',
              Applikation: 'BrKons',
            },
            Bundesrecht: {
              Kurztitel: 'TestG',
              Titel: 'Fallback Title',
              BrKons: {},
            },
          },
        },
      };

      const result = parseDocumentFromApiResponse(rawDoc);
      expect(result.citation.langtitel).toBe('Fallback Title');
    });

    it('should handle Bundesrecht with #text in Kurztitel', () => {
      const rawDoc: RawDocumentReference = {
        Data: {
          Metadaten: {
            Technisch: {
              ID: 'NOR40000001',
              Applikation: 'BrKons',
            },
            Bundesrecht: {
              Kurztitel: { '#text': 'TestG with #text' } as unknown as string,
              BrKons: {},
            },
          },
        },
      };

      const result = parseDocumentFromApiResponse(rawDoc);
      expect(result.kurztitel).toBe('TestG with #text');
      expect(result.titel).toBe('TestG with #text');
    });
  });

  describe('Landesrecht document parsing', () => {
    it('should parse complete Landesrecht document', () => {
      const rawDoc: RawDocumentReference = {
        Data: {
          Metadaten: {
            Technisch: {
              ID: 'LNO40001234',
              Applikation: 'LrKons',
            },
            Allgemein: {
              DokumentUrl:
                'https://ris.bka.gv.at/Dokument.wxe?Abfrage=LrW&Dokumentnummer=LNO40001234',
            },
            Landesrecht: {
              Kurztitel: 'Wiener Bauordnung',
              Langtitel: 'Bauordnung fuer Wien',
              Eli: 'https://eli.bgbl.gv.at/xyz',
              LrKons: {
                Kundmachungsorgan: 'LGBl. Nr. 11/1930',
                ArtikelParagraphAnlage: 'Para 1',
                Inkrafttretensdatum: '1930-01-01',
                Ausserkrafttretensdatum: '2025-12-31',
                GesamteRechtsvorschriftUrl:
                  'https://ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrW&Gesetzesnummer=20000006',
              },
            },
          },
          Dokumentliste: {
            ContentReference: {
              ContentType: 'MainDocument',
              Name: 'Wiener Bauordnung',
              Urls: {
                ContentUrl: [{ DataType: 'Html', Url: 'https://ris.bka.gv.at/lr.html' }],
              },
            },
          },
        },
      };

      const result = parseDocumentFromApiResponse(rawDoc);

      expect(result.dokumentnummer).toBe('LNO40001234');
      expect(result.applikation).toBe('LrKons');
      expect(result.titel).toBe('Wiener Bauordnung');
      expect(result.kurztitel).toBe('Wiener Bauordnung');
      expect(result.gesamte_rechtsvorschrift_url).toBe(
        'https://ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrW&Gesetzesnummer=20000006',
      );
      expect(result.citation.kurztitel).toBe('Wiener Bauordnung');
      expect(result.citation.langtitel).toBe('Bauordnung fuer Wien');
      expect(result.citation.kundmachungsorgan).toBe('LGBl. Nr. 11/1930');
      expect(result.citation.eli).toBe('https://eli.bgbl.gv.at/xyz');
      expect(result.citation.inkrafttreten).toBe('1930-01-01');
      expect(result.citation.ausserkrafttreten).toBe('2025-12-31');
    });

    it('should use Titel as fallback when Langtitel is missing in Landesrecht', () => {
      const rawDoc: RawDocumentReference = {
        Data: {
          Metadaten: {
            Technisch: {
              ID: 'LNO40000001',
              Applikation: 'LrKons',
            },
            Landesrecht: {
              Kurztitel: 'TestLR',
              Titel: 'Landesrecht Fallback Title',
              LrKons: {},
            },
          },
        },
      };

      const result = parseDocumentFromApiResponse(rawDoc);
      expect(result.citation.langtitel).toBe('Landesrecht Fallback Title');
    });
  });

  describe('Judikatur document parsing', () => {
    it('should parse Judikatur document with string Geschaeftszahl', () => {
      const rawDoc: RawDocumentReference = {
        Data: {
          Metadaten: {
            Technisch: {
              ID: 'JWR_2024010001',
              Applikation: 'Vwgh',
            },
            Allgemein: {
              DokumentUrl:
                'https://ris.bka.gv.at/Dokument.wxe?Abfrage=Vwgh&Dokumentnummer=JWR_2024010001',
            },
            Judikatur: {
              Geschaeftszahl: 'Ra 2024/01/0001',
              Entscheidungsdatum: '2024-03-15',
              Vwgh: {
                Leitsatz: 'Dies ist der Leitsatz der Entscheidung',
              },
            },
          },
          Dokumentliste: {
            ContentReference: {
              ContentType: 'MainDocument',
              Name: 'VwGH Entscheidung',
              Urls: {
                ContentUrl: [{ DataType: 'Html', Url: 'https://ris.bka.gv.at/jud.html' }],
              },
            },
          },
        },
      };

      const result = parseDocumentFromApiResponse(rawDoc);

      expect(result.dokumentnummer).toBe('JWR_2024010001');
      expect(result.applikation).toBe('Vwgh');
      expect(result.titel).toBe('Ra 2024/01/0001');
      expect(result.kurztitel).toBe('Ra 2024/01/0001');
      expect(result.citation.kurztitel).toBe('Ra 2024/01/0001');
      expect(result.citation.langtitel).toBe('Dies ist der Leitsatz der Entscheidung');
      expect(result.citation.inkrafttreten).toBe('2024-03-15');
    });

    it('should parse Judikatur document with object Geschaeftszahl containing string item', () => {
      const rawDoc: RawDocumentReference = {
        Data: {
          Metadaten: {
            Technisch: {
              ID: 'JFR_2024000001',
              Applikation: 'Vfgh',
            },
            Judikatur: {
              Geschaeftszahl: { item: 'G 123/2024' },
              Entscheidungsdatum: '2024-06-01',
              Vfgh: {
                Leitsatz: 'VfGH Leitsatz',
              },
            },
          },
        },
      };

      const result = parseDocumentFromApiResponse(rawDoc);

      expect(result.dokumentnummer).toBe('JFR_2024000001');
      expect(result.titel).toBe('G 123/2024');
      expect(result.kurztitel).toBe('G 123/2024');
    });

    it('should parse Judikatur document with object Geschaeftszahl containing array item', () => {
      const rawDoc: RawDocumentReference = {
        Data: {
          Metadaten: {
            Technisch: {
              ID: 'JJT_2024000001',
              Applikation: 'Justiz',
            },
            Judikatur: {
              Geschaeftszahl: { item: ['1 Ob 123/24k', '1 Ob 124/24g'] },
              Entscheidungsdatum: '2024-07-01',
              Justiz: {
                Leitsatz: 'OGH Leitsatz',
              },
            },
          },
        },
      };

      const result = parseDocumentFromApiResponse(rawDoc);

      expect(result.dokumentnummer).toBe('JJT_2024000001');
      expect(result.titel).toBe('1 Ob 123/24k, 1 Ob 124/24g');
      expect(result.kurztitel).toBe('1 Ob 123/24k, 1 Ob 124/24g');
    });

    it('should parse Bvwg Judikatur document', () => {
      const rawDoc: RawDocumentReference = {
        Data: {
          Metadaten: {
            Technisch: {
              ID: 'BVWGT_2024000001',
              Applikation: 'Bvwg',
            },
            Judikatur: {
              Geschaeftszahl: 'W123 2024567/1',
              Entscheidungsdatum: '2024-08-15',
              Bvwg: {
                Leitsatz: 'BVwG Leitsatz der Entscheidung',
              },
            },
          },
        },
      };

      const result = parseDocumentFromApiResponse(rawDoc);

      expect(result.dokumentnummer).toBe('BVWGT_2024000001');
      expect(result.applikation).toBe('Bvwg');
      expect(result.citation.langtitel).toBe('BVwG Leitsatz der Entscheidung');
    });

    it('should read Kurzinformation as head-note for Dsk decisions (N1)', () => {
      // Dsk/Pvak/Dok expose "Kurzinformation" instead of "Leitsatz" (verified
      // against RIS API v2.6). The head-note block is keyed by the applikation.
      const rawDoc = {
        Data: {
          Metadaten: {
            Technisch: { ID: 'PDKT_20260519_2026', Applikation: 'Dsk' },
            Judikatur: {
              Geschaeftszahl: 'DSB-D123.456',
              Entscheidungsdatum: '2026-05-19',
              Dsk: { Kurzinformation: 'Kurzinfo zur Datenschutz-Entscheidung' },
            },
          },
        },
      } as unknown as RawDocumentReference;

      const result = parseDocumentFromApiResponse(rawDoc);
      expect(result.citation.langtitel).toBe('Kurzinfo zur Datenschutz-Entscheidung');
      expect(result.kurztitel).toBe('DSB-D123.456');
    });

    it('should read Kurzinformation as head-note for Pvak decisions (N1)', () => {
      const rawDoc = {
        Data: {
          Metadaten: {
            Technisch: { ID: 'PVABT_20260213_B10', Applikation: 'Pvak' },
            Judikatur: {
              Geschaeftszahl: 'B 10-PVAB/25',
              Entscheidungsdatum: '2026-02-13',
              Pvak: { Kurzinformation: 'PVAB Kurzinformation' },
            },
          },
        },
      } as unknown as RawDocumentReference;

      const result = parseDocumentFromApiResponse(rawDoc);
      expect(result.citation.langtitel).toBe('PVAB Kurzinformation');
    });

    it('should leave langtitel null for courts without a head-note field (Lvwg)', () => {
      const rawDoc = {
        Data: {
          Metadaten: {
            Technisch: { ID: 'LVWGT_NI_20260630', Applikation: 'Lvwg' },
            Judikatur: {
              Geschaeftszahl: 'LVwG-AV-757/001/2026',
              Entscheidungsdatum: '2026-06-30',
              Lvwg: { Entscheidungsart: 'Erkenntnis' },
            },
          },
        },
      } as unknown as RawDocumentReference;

      const result = parseDocumentFromApiResponse(rawDoc);
      expect(result.citation.langtitel).toBeNull();
      expect(result.kurztitel).toBe('LVwG-AV-757/001/2026');
    });

    it('should use GZ prefix when kurztitel is empty but Geschaeftszahl exists', () => {
      const rawDoc: RawDocumentReference = {
        Data: {
          Metadaten: {
            Technisch: {
              ID: 'JWR_2024000002',
              Applikation: 'Vwgh',
            },
            Judikatur: {
              Geschaeftszahl: 'Ro 2024/01/0002',
              Entscheidungsdatum: '2024-01-15',
            },
          },
        },
      };

      const result = parseDocumentFromApiResponse(rawDoc);
      // kurztitel should be Geschaeftszahl
      expect(result.kurztitel).toBe('Ro 2024/01/0002');
      expect(result.titel).toBe('Ro 2024/01/0002');
    });
  });

  describe('Citation extraction', () => {
    it('should extract all citation fields from Bundesrecht', () => {
      const rawDoc: RawDocumentReference = {
        Data: {
          Metadaten: {
            Technisch: { ID: 'NOR40000001', Applikation: 'BrKons' },
            Bundesrecht: {
              Kurztitel: 'TestG',
              Langtitel: 'Testgesetz',
              Eli: 'https://eli.example.com/test',
              BrKons: {
                Kundmachungsorgan: 'BGBl. Nr. 123/2024',
                ArtikelParagraphAnlage: 'Para 42',
                Inkrafttretensdatum: '2024-01-01',
                Ausserkrafttretensdatum: '2099-12-31',
              },
            },
          },
        },
      };

      const result = parseDocumentFromApiResponse(rawDoc);

      expect(result.citation).toEqual({
        kurztitel: 'TestG',
        langtitel: 'Testgesetz',
        kundmachungsorgan: 'BGBl. Nr. 123/2024',
        paragraph: 'Para 42',
        eli: 'https://eli.example.com/test',
        inkrafttreten: '2024-01-01',
        ausserkrafttreten: '2099-12-31',
      });
    });

    it('should use Entscheidungsdatum as inkrafttreten for Judikatur', () => {
      const rawDoc: RawDocumentReference = {
        Data: {
          Metadaten: {
            Technisch: { ID: 'JWR_2024000001', Applikation: 'Vwgh' },
            Judikatur: {
              Geschaeftszahl: 'Ra 2024/01/0001',
              Entscheidungsdatum: '2024-05-20',
              Vwgh: {},
            },
          },
        },
      };

      const result = parseDocumentFromApiResponse(rawDoc);
      expect(result.citation.inkrafttreten).toBe('2024-05-20');
    });
  });

  describe('Content reference handling', () => {
    it('should handle array of ContentReference and find MainDocument', () => {
      const rawDoc: RawDocumentReference = {
        Data: {
          Metadaten: {
            Technisch: { ID: 'NOR40000001', Applikation: 'BrKons' },
            Bundesrecht: { Kurztitel: 'Test', BrKons: {} },
          },
          Dokumentliste: {
            ContentReference: [
              {
                ContentType: 'Attachment',
                Name: 'Anlage',
                Urls: {
                  ContentUrl: [{ DataType: 'Pdf', Url: 'https://example.com/attachment.pdf' }],
                },
              },
              {
                ContentType: 'MainDocument',
                Name: 'Hauptdokument',
                Urls: {
                  ContentUrl: [
                    { DataType: 'Html', Url: 'https://example.com/main.html' },
                    { DataType: 'Pdf', Url: 'https://example.com/main.pdf' },
                  ],
                },
              },
            ],
          },
        },
      };

      const result = parseDocumentFromApiResponse(rawDoc);

      // Should use MainDocument, not Attachment
      expect(result.content_urls.html).toBe('https://example.com/main.html');
      expect(result.content_urls.pdf).toBe('https://example.com/main.pdf');
    });

    it('should use first ContentReference when no MainDocument found', () => {
      const rawDoc: RawDocumentReference = {
        Data: {
          Metadaten: {
            Technisch: { ID: 'NOR40000001', Applikation: 'BrKons' },
            Bundesrecht: { Kurztitel: 'Test', BrKons: {} },
          },
          Dokumentliste: {
            ContentReference: [
              {
                ContentType: 'Attachment',
                Name: 'First Attachment',
                Urls: {
                  ContentUrl: [{ DataType: 'Html', Url: 'https://example.com/first.html' }],
                },
              },
              {
                ContentType: 'Attachment',
                Name: 'Second Attachment',
                Urls: {
                  ContentUrl: [{ DataType: 'Html', Url: 'https://example.com/second.html' }],
                },
              },
            ],
          },
        },
      };

      const result = parseDocumentFromApiResponse(rawDoc);
      expect(result.content_urls.html).toBe('https://example.com/first.html');
    });

    it('should use ContentReference Name as titel when kurztitel is empty', () => {
      const rawDoc: RawDocumentReference = {
        Data: {
          Metadaten: {
            Technisch: { ID: 'NOR40000001', Applikation: 'BrKons' },
          },
          Dokumentliste: {
            ContentReference: {
              ContentType: 'MainDocument',
              Name: 'Document Title from Name',
              Urls: {},
            },
          },
        },
      };

      const result = parseDocumentFromApiResponse(rawDoc);
      expect(result.titel).toBe('Document Title from Name');
    });

    it('should extract Name from #text property when Name is object', () => {
      const rawDoc: RawDocumentReference = {
        Data: {
          Metadaten: {
            Technisch: { ID: 'NOR40000001', Applikation: 'BrKons' },
          },
          Dokumentliste: {
            ContentReference: {
              ContentType: 'MainDocument',
              Name: { '#text': 'Title from #text' },
              Urls: {},
            },
          },
        },
      };

      const result = parseDocumentFromApiResponse(rawDoc);
      expect(result.titel).toBe('Title from #text');
    });
  });

  describe('edge cases', () => {
    it('should handle completely empty document reference', () => {
      const rawDoc: RawDocumentReference = {};

      const result = parseDocumentFromApiResponse(rawDoc);

      expect(result.dokumentnummer).toBe('');
      expect(result.applikation).toBe('');
      expect(result.titel).toBe('');
      expect(result.kurztitel).toBeNull();
      expect(result.dokument_url).toBeNull();
      expect(result.gesamte_rechtsvorschrift_url).toBeNull();
      expect(result.content_urls).toEqual({
        html: null,
        xml: null,
        pdf: null,
        rtf: null,
      });
    });

    it('should handle document with only Technisch data', () => {
      const rawDoc: RawDocumentReference = {
        Data: {
          Metadaten: {
            Technisch: {
              ID: 'NOR40000001',
              Applikation: 'BrKons',
            },
          },
        },
      };

      const result = parseDocumentFromApiResponse(rawDoc);

      expect(result.dokumentnummer).toBe('NOR40000001');
      expect(result.applikation).toBe('BrKons');
      expect(result.titel).toBe('');
    });

    it('should return null gesamte_rechtsvorschrift_url when empty string', () => {
      const rawDoc: RawDocumentReference = {
        Data: {
          Metadaten: {
            Technisch: { ID: 'NOR40000001', Applikation: 'BrKons' },
            Bundesrecht: {
              Kurztitel: 'Test',
              BrKons: {
                GesamteRechtsvorschriftUrl: '',
              },
            },
          },
        },
      };

      const result = parseDocumentFromApiResponse(rawDoc);
      expect(result.gesamte_rechtsvorschrift_url).toBeNull();
    });
  });
});

// =============================================================================
// Tests for parseSearchResults()
// =============================================================================

describe('parseSearchResults', () => {
  /**
   * Helper to create mock raw document reference for search results.
   */
  function createMockRawDoc(dokumentnummer: string, kurztitel: string): RawDocumentReference {
    return {
      Data: {
        Metadaten: {
          Technisch: {
            ID: dokumentnummer,
            Applikation: 'BrKons',
          },
          Bundesrecht: {
            Kurztitel: kurztitel,
            BrKons: {},
          },
        },
      },
    };
  }

  describe('pagination calculation', () => {
    it('should correctly calculate pagination for first page', () => {
      const apiResponse: NormalizedSearchResults = {
        hits: 100,
        page_number: 1,
        page_size: 20,
        documents: [
          createMockRawDoc('NOR40000001', 'Doc 1'),
          createMockRawDoc('NOR40000002', 'Doc 2'),
        ],
      };

      const result = parseSearchResults(apiResponse);

      expect(result.total_hits).toBe(100);
      expect(result.page).toBe(1);
      expect(result.page_size).toBe(20);
    });

    it('should correctly parse page number from response', () => {
      const apiResponse: NormalizedSearchResults = {
        hits: 50,
        page_number: 3,
        page_size: 10,
        documents: [createMockRawDoc('NOR40000001', 'Doc 1')],
      };

      const result = parseSearchResults(apiResponse);

      expect(result.page).toBe(3);
    });

    it('should correctly parse page size from response', () => {
      const apiResponse: NormalizedSearchResults = {
        hits: 200,
        page_number: 1,
        page_size: 50,
        documents: [createMockRawDoc('NOR40000001', 'Doc 1')],
      };

      const result = parseSearchResults(apiResponse);

      expect(result.page_size).toBe(50);
    });
  });

  describe('has_more flag logic', () => {
    it('should set has_more to true when more pages exist', () => {
      // 100 hits, page 1, 20 per page = 5 pages total, so has_more = true
      const apiResponse: NormalizedSearchResults = {
        hits: 100,
        page_number: 1,
        page_size: 20,
        documents: Array(20)
          .fill(null)
          .map((_, i) => createMockRawDoc('NOR4000000' + i, 'Doc ' + i)),
      };

      const result = parseSearchResults(apiResponse);

      expect(result.has_more).toBe(true);
    });

    it('should set has_more to false when on last page', () => {
      // 50 hits, page 5, 10 per page = exactly 50 items covered
      const apiResponse: NormalizedSearchResults = {
        hits: 50,
        page_number: 5,
        page_size: 10,
        documents: Array(10)
          .fill(null)
          .map((_, i) => createMockRawDoc('NOR4000000' + i, 'Doc ' + i)),
      };

      const result = parseSearchResults(apiResponse);

      expect(result.has_more).toBe(false);
    });

    it('should set has_more to false when page covers all results', () => {
      // 15 hits, page 1, 20 per page = all covered
      const apiResponse: NormalizedSearchResults = {
        hits: 15,
        page_number: 1,
        page_size: 20,
        documents: Array(15)
          .fill(null)
          .map((_, i) => createMockRawDoc('NOR4000000' + i, 'Doc ' + i)),
      };

      const result = parseSearchResults(apiResponse);

      expect(result.has_more).toBe(false);
    });

    it('should set has_more to true when partial last page', () => {
      // 25 hits, page 1, 20 per page = 5 more on page 2
      const apiResponse: NormalizedSearchResults = {
        hits: 25,
        page_number: 1,
        page_size: 20,
        documents: Array(20)
          .fill(null)
          .map((_, i) => createMockRawDoc('NOR4000000' + i, 'Doc ' + i)),
      };

      const result = parseSearchResults(apiResponse);

      expect(result.has_more).toBe(true);
    });

    it('should handle exact boundary correctly', () => {
      // 20 hits, page 1, 20 per page = exactly one page
      const apiResponse: NormalizedSearchResults = {
        hits: 20,
        page_number: 1,
        page_size: 20,
        documents: Array(20)
          .fill(null)
          .map((_, i) => createMockRawDoc('NOR4000000' + i, 'Doc ' + i)),
      };

      const result = parseSearchResults(apiResponse);

      // page * page_size = 20, totalHits = 20, so 20 < 20 = false
      expect(result.has_more).toBe(false);
    });

    it('should handle zero total hits', () => {
      const apiResponse: NormalizedSearchResults = {
        hits: 0,
        page_number: 1,
        page_size: 20,
        documents: [],
      };

      const result = parseSearchResults(apiResponse);

      expect(result.has_more).toBe(false);
      expect(result.total_hits).toBe(0);
    });
  });

  describe('document array mapping', () => {
    it('should map all documents from raw to parsed format', () => {
      const apiResponse: NormalizedSearchResults = {
        hits: 3,
        page_number: 1,
        page_size: 20,
        documents: [
          createMockRawDoc('NOR40000001', 'First Doc'),
          createMockRawDoc('NOR40000002', 'Second Doc'),
          createMockRawDoc('NOR40000003', 'Third Doc'),
        ],
      };

      const result = parseSearchResults(apiResponse);

      expect(result.documents).toHaveLength(3);
      expect(result.documents[0].dokumentnummer).toBe('NOR40000001');
      expect(result.documents[0].kurztitel).toBe('First Doc');
      expect(result.documents[1].dokumentnummer).toBe('NOR40000002');
      expect(result.documents[1].kurztitel).toBe('Second Doc');
      expect(result.documents[2].dokumentnummer).toBe('NOR40000003');
      expect(result.documents[2].kurztitel).toBe('Third Doc');
    });

    it('should handle empty documents array', () => {
      const apiResponse: NormalizedSearchResults = {
        hits: 0,
        page_number: 1,
        page_size: 20,
        documents: [],
      };

      const result = parseSearchResults(apiResponse);

      expect(result.documents).toHaveLength(0);
      expect(result.documents).toEqual([]);
    });

    it('should handle single document', () => {
      const apiResponse: NormalizedSearchResults = {
        hits: 1,
        page_number: 1,
        page_size: 20,
        documents: [createMockRawDoc('NOR40000001', 'Only Doc')],
      };

      const result = parseSearchResults(apiResponse);

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].dokumentnummer).toBe('NOR40000001');
    });

    it('should preserve document order from API response', () => {
      const apiResponse: NormalizedSearchResults = {
        hits: 4,
        page_number: 1,
        page_size: 20,
        documents: [
          createMockRawDoc('NOR40000004', 'Fourth'),
          createMockRawDoc('NOR40000001', 'First'),
          createMockRawDoc('NOR40000003', 'Third'),
          createMockRawDoc('NOR40000002', 'Second'),
        ],
      };

      const result = parseSearchResults(apiResponse);

      expect(result.documents[0].kurztitel).toBe('Fourth');
      expect(result.documents[1].kurztitel).toBe('First');
      expect(result.documents[2].kurztitel).toBe('Third');
      expect(result.documents[3].kurztitel).toBe('Second');
    });
  });

  describe('integration with document parsing', () => {
    it('should correctly parse complex documents in search results', () => {
      const apiResponse: NormalizedSearchResults = {
        hits: 2,
        page_number: 1,
        page_size: 20,
        documents: [
          {
            Data: {
              Metadaten: {
                Technisch: { ID: 'NOR40250169', Applikation: 'BrKons' },
                Allgemein: {
                  DokumentUrl: 'https://ris.bka.gv.at/doc1',
                },
                Bundesrecht: {
                  Kurztitel: 'ABGB',
                  Langtitel: 'Allgemeines Buergerliches Gesetzbuch',
                  BrKons: {
                    Kundmachungsorgan: 'BGBl. Nr. 1/1812',
                  },
                },
              },
              Dokumentliste: {
                ContentReference: {
                  Urls: {
                    ContentUrl: [{ DataType: 'Html', Url: 'https://ris.bka.gv.at/abgb.html' }],
                  },
                },
              },
            },
          },
          {
            Data: {
              Metadaten: {
                Technisch: { ID: 'JWR_2024010001', Applikation: 'Vwgh' },
                Judikatur: {
                  Geschaeftszahl: 'Ra 2024/01/0001',
                  Entscheidungsdatum: '2024-03-15',
                  Vwgh: {
                    Leitsatz: 'Leitsatz der Entscheidung',
                  },
                },
              },
            },
          },
        ],
      };

      const result = parseSearchResults(apiResponse);

      expect(result.documents).toHaveLength(2);

      // First document - Bundesrecht
      expect(result.documents[0].dokumentnummer).toBe('NOR40250169');
      expect(result.documents[0].kurztitel).toBe('ABGB');
      expect(result.documents[0].content_urls.html).toBe('https://ris.bka.gv.at/abgb.html');

      // Second document - Judikatur
      expect(result.documents[1].dokumentnummer).toBe('JWR_2024010001');
      expect(result.documents[1].kurztitel).toBe('Ra 2024/01/0001');
      expect(result.documents[1].citation.inkrafttreten).toBe('2024-03-15');
    });
  });
});
