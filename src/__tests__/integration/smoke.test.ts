/**
 * Integration smoke tests against the real RIS API.
 *
 * These tests hit the live Austrian Legal Information System API at
 * https://data.bka.gv.at/ris/api/v2.6/ and require network access. The last
 * case fetches from the RIS *website* (www.ris.bka.gv.at) instead: what it
 * pins is a rendered page, which the API does not serve.
 *
 * They are NOT included in the standard `pnpm test` run.
 * Run explicitly with: pnpm run test:integration
 *
 * Keep assertions focused on response structure, not exact content
 * (which changes as laws are amended).
 */

import { describe, it, expect } from 'vitest';

import {
  searchBundesrecht,
  searchJudikatur,
  getDocumentByNumber,
  getDocumentContent,
} from '../../client.js';
import { loadDocument } from '../../document-loader.js';
import { extractOutline } from '../../formatting.js';
import { parseSearchResults } from '../../parser.js';

describe('RIS API Smoke Tests', () => {
  describe('searchBundesrecht', () => {
    it('should return results when searching for ABGB', async () => {
      const result = await searchBundesrecht({
        Suchworte: 'ABGB',
        Applikation: 'BrKons',
        DokumenteProSeite: 'Ten',
      });

      expect(result).toBeDefined();
      expect(typeof result.hits).toBe('number');
      expect(result.hits).toBeGreaterThan(0);
      expect(typeof result.page_number).toBe('number');
      expect(typeof result.page_size).toBe('number');
      expect(Array.isArray(result.documents)).toBe(true);
      expect(result.documents.length).toBeGreaterThan(0);
    });

    it('should return results when searching by titel for ABGB', async () => {
      const result = await searchBundesrecht({
        Titel: 'ABGB',
        Applikation: 'BrKons',
        DokumenteProSeite: 'Ten',
      });

      expect(result.hits).toBeGreaterThan(0);
      expect(result.documents.length).toBeGreaterThan(0);
    });

    it('should return empty results for nonsensical query', async () => {
      const result = await searchBundesrecht({
        Suchworte: 'xyzzy999nonexistent888qqq',
        Applikation: 'BrKons',
        DokumenteProSeite: 'Ten',
      });

      expect(result).toBeDefined();
      expect(typeof result.hits).toBe('number');
      expect(result.hits).toBe(0);
      expect(result.documents).toHaveLength(0);
    });
  });

  describe('searchJudikatur', () => {
    it('should return results for Justiz court type', async () => {
      const result = await searchJudikatur({
        Applikation: 'Justiz',
        DokumenteProSeite: 'Ten',
      });

      expect(result).toBeDefined();
      expect(typeof result.hits).toBe('number');
      expect(result.hits).toBeGreaterThan(0);
      expect(typeof result.page_number).toBe('number');
      expect(typeof result.page_size).toBe('number');
      expect(Array.isArray(result.documents)).toBe(true);
      expect(result.documents.length).toBeGreaterThan(0);
    });

    it('should populate the court fields on live Justiz documents', async () => {
      const result = await searchJudikatur({
        Applikation: 'Justiz',
        Suchworte: 'Gewährleistung',
        DokumenteProSeite: 'Ten',
      });

      const { documents } = parseSearchResults(result);
      expect(documents.length).toBeGreaterThan(0);

      for (const doc of documents) {
        expect(doc.citation_display, doc.dokumentnummer).toBeTruthy();
        expect(doc.gericht, doc.dokumentnummer).toBeTruthy();
        expect(doc.geschaeftszahl, doc.dokumentnummer).toBeTruthy();
        // RIS dates are ISO; assert the shape, not a value that moves.
        expect(doc.entscheidungsdatum, doc.dokumentnummer).toMatch(/^\d{4}-\d{2}-\d{2}/);
      }

      // Justiz Rechtssätze carry an RS number; Entscheidungstexte do not.
      const rechtssaetze = documents.filter((doc) => doc.rechtssatznummer);
      expect(rechtssaetze.length).toBeGreaterThan(0);
      expect(rechtssaetze[0].rechtssatznummer).toMatch(/^RS\d+/);
    });

    it('should leave the court fields off live Bundesrecht documents', async () => {
      const result = await searchBundesrecht({
        Titel: 'ABGB',
        Applikation: 'BrKons',
        DokumenteProSeite: 'Ten',
      });

      const { documents } = parseSearchResults(result);
      expect(documents.length).toBeGreaterThan(0);

      for (const doc of documents) {
        expect(doc.citation_display, doc.dokumentnummer).toBeTruthy();
        expect(doc, doc.dokumentnummer).not.toHaveProperty('gericht');
      }
    });
  });

  describe('getDocumentByNumber', () => {
    it('should fetch a known ABGB norm by document number', async () => {
      const result = await getDocumentByNumber('NOR40045103');

      expect(result).toBeDefined();
      expect(result.success).toBe(true);

      if (result.success) {
        expect(typeof result.html).toBe('string');
        expect(result.html.length).toBeGreaterThan(0);
        expect(typeof result.url).toBe('string');
        expect(result.url).toContain('NOR40045103');
      }
    });

    it('should return error for non-existent document number', async () => {
      const result = await getDocumentByNumber('NOR00000001');

      // May succeed (if the number happens to exist) or fail with a 404 —
      // we just verify the response shape is correct
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');

      if (result.success) {
        expect(typeof result.html).toBe('string');
        expect(typeof result.url).toBe('string');
      } else {
        expect(typeof result.error).toBe('string');
      }
    });
  });

  describe('loadDocument with a rendered RIS page (issue #94)', () => {
    /** "Gesamte Rechtsvorschrift" for the Datenschutzgesetz — the live page. */
    const GF_URL =
      'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10001597';

    it('should scope a live GeltendeFassung page to the law itself', async () => {
      // Fetched through the same client function the loader uses, so this is the
      // markup scoping will actually see. It is the *raw* page: the wrapper the
      // scoping keys on has to be pinned before the loader removes everything
      // around it, or a rename at RIS would read as "the chrome is gone" in
      // every assertion below instead of failing here, by name.
      const rawHtml = await getDocumentContent(GF_URL);
      expect(rawHtml).toContain('class="documentContent"');

      const loaded = await loadDocument(
        { url: GF_URL, responseFormat: 'markdown' },
        new AbortController().signal,
      );
      expect(loaded.success).toBe(true);
      if (!loaded.success) {
        return;
      }

      const { text, html } = loaded.document;
      const content = text.split('## Inhalt\n\n')[1];
      expect(content).toBeDefined();

      // Structure, not content: the skip links open every RIS page and the
      // copyright closes it, so what is named here is the chrome, never a
      // sentence of the law — which gets amended.
      expect(content).not.toContain('Seitenbereiche');
      expect(content).not.toContain('Bundeskanzleramt der Republik');

      // The outline is the viewer's jump rail, built the way both document
      // tools build it. "Über diese Seite" is the footer's screenreader
      // heading — the first entry a reader would see if scoping missed.
      const outline = extractOutline(html, text);
      expect(outline.length).toBeGreaterThan(0);
      expect(outline.map((entry) => entry.label)).not.toContain('Über diese Seite');
    });
  });
});
