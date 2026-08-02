/**
 * Tool: ris_bundesrecht — Search Austrian federal laws (Bundesrecht).
 */

import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { searchBundesrecht } from '../client.js';
import {
  addOptionalParams,
  buildBaseParams,
  buildQueryEcho,
  createValidationErrorResponse,
  executeSearchTool,
  hasAnyParam,
} from '../helpers.js';
import {
  AbschnittTypSchema,
  BundesrechtApplikationSchema,
  DateSchema,
  LimitSchema,
  SearchResultOutputShape,
  SeiteSchema,
} from '../types.js';
import { SEARCH_WIDGET_META } from '../widgets.js';

/** Resolved arguments for building Bundesrecht API params (after Zod defaults). */
export interface BundesrechtParamsArgs {
  applikation: string;
  suchworte?: string;
  titel?: string;
  paragraph?: string;
  abschnitt_typ: 'Paragraph' | 'Artikel' | 'Anlage';
  fassung_vom?: string;
  seite: number;
  limit: number;
}

/**
 * Build the RIS API parameter object for a Bundesrecht search.
 *
 * The "Erv" application (English translations) uses a different parameter
 * vocabulary (SearchTerms/Title) than the German consolidated laws
 * (Suchworte/Titel); sending Suchworte to Erv is silently ignored by the API
 * and returns all documents instead of a filtered result.
 */
export function buildBundesrechtParams(args: BundesrechtParamsArgs): Record<string, unknown> {
  const { applikation, suchworte, titel, paragraph, abschnitt_typ, fassung_vom, seite, limit } =
    args;

  const params = buildBaseParams(applikation, limit, seite);

  if (applikation === 'Erv') {
    // English translations: distinct parameter names, no Abschnitt/Fassung support.
    addOptionalParams(params, [
      [suchworte, 'SearchTerms'],
      [titel, 'Title'],
    ]);
    return params;
  }

  addOptionalParams(params, [
    [suchworte, 'Suchworte'],
    [titel, 'Titel'],
    [fassung_vom, 'FassungVom'],
  ]);

  if (paragraph) {
    params['Abschnitt.Von'] = paragraph;
    params['Abschnitt.Bis'] = paragraph;
    params['Abschnitt.Typ'] = abschnitt_typ;
  }

  return params;
}

export function registerBundesrechtTool(server: McpServer): void {
  registerAppTool(
    server,
    'ris_bundesrecht',
    {
      title: 'Bundesrecht durchsuchen',
      description: `Search Austrian federal laws (Bundesrecht).

Use this tool to find Austrian federal legislation like ABGB, StGB, UGB, etc.

Search strategy: "titel" and "paragraph" are the precise entry points — prefer them
whenever the law or the section is known. "suchworte" runs a broad full-text search
and the RIS API returns those hits ordered alphabetically by law title, not by
relevance, so a common term buries the relevant law under thousands of results.
Austrian law often splits one topic across several statutes, so look for a companion
law: warranty, for example, is covered both by the VGG (consumer sales, B2C, in force
since 2022) and by §§ 922 ff ABGB (general warranty law, including B2B).

Example queries:
  - suchworte="Mietrecht" -> Find laws mentioning rent law
  - titel="ABGB", paragraph="1295" -> Find specific ABGB section
  - titel="B-VG", paragraph="7", abschnitt_typ="Artikel" -> Article-based laws
  - titel="ABGB", fassung_vom="2015-01-01" -> Consolidated version as of a date
  - applikation="Begut" -> Search draft legislation`,
      inputSchema: {
        suchworte: z
          .string()
          .max(1000)
          .optional()
          .describe(
            'Broad full-text search terms (e.g., "Mietrecht", "Schadenersatz"). Hits come back ordered alphabetically by law title, not by relevance — prefer "titel" and/or "paragraph" whenever the law or the section is known.',
          ),
        titel: z
          .string()
          .max(500)
          .optional()
          .describe('Search in law titles (e.g., "ABGB", "Strafgesetzbuch")'),
        paragraph: z
          .string()
          .max(100)
          .optional()
          .describe('Section number to search for (e.g., "1295" for §1295, "7" for Art 7)'),
        abschnitt_typ: AbschnittTypSchema.default('Paragraph').describe(
          'Type of section that "paragraph" refers to: "Paragraph" (default), "Artikel" (article-based laws like B-VG), or "Anlage" (annex). "Art 7 B-VG" requires "Artikel".',
        ),
        applikation: BundesrechtApplikationSchema.default('BrKons').describe(
          'Data source - "BrKons" (consolidated, default), "Begut" (drafts), "BgblAuth" (gazette), "Erv" (English translations)',
        ),
        fassung_vom: DateSchema.optional().describe(
          'Consolidated version as of this date (YYYY-MM-DD) — retrieves the law text as it stood on that day. Not supported for "Erv".',
        ),
        seite: SeiteSchema.describe('Page number (default: 1)'),
        limit: LimitSchema.describe('Results per page: 10, 20, 50, or 100 (default: 20)'),
        response_format: z
          .enum(['markdown', 'json'])
          .default('markdown')
          .describe('"markdown" (default) or "json"'),
      },
      outputSchema: SearchResultOutputShape,
      // `destructiveHint` is redundant per spec once `readOnlyHint` is true, but
      // OpenAI lists it as a required annotation for app submissions — all 12
      // tools carry it deliberately; do not drop it as noise.
      annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
      _meta: SEARCH_WIDGET_META,
    },
    async (args, extra) => {
      const {
        suchworte,
        titel,
        paragraph,
        abschnitt_typ,
        applikation,
        fassung_vom,
        seite,
        limit,
        response_format,
      } = args;

      if (!hasAnyParam(args, ['suchworte', 'titel', 'paragraph'])) {
        return createValidationErrorResponse([
          'suchworte` fuer Volltextsuche',
          'titel` fuer Suche in Gesetzesnamen',
          'paragraph` fuer Suche nach Paragraphen',
        ]);
      }

      const params = buildBundesrechtParams({
        applikation,
        suchworte,
        titel,
        paragraph,
        abschnitt_typ,
        fassung_vom,
        seite,
        limit,
      });

      return executeSearchTool(
        searchBundesrecht,
        params,
        response_format,
        extra.signal,
        buildQueryEcho('ris_bundesrecht', args),
      );
    },
  );
}
