/**
 * Tool: ris_landesrecht — Search Austrian state/provincial laws (Landesrecht).
 */

import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { searchLandesrecht } from '../client.js';
import { BUNDESLAND_MAPPING } from '../constants.js';
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
  DateSchema,
  LandesrechtBundeslandSchema,
  LimitSchema,
  SearchResultOutputShape,
  SeiteSchema,
} from '../types.js';
import { SEARCH_WIDGET_META } from '../widgets.js';

/** Resolved arguments for building Landesrecht API params (after Zod defaults). */
export interface LandesrechtParamsArgs {
  applikation: string;
  suchworte?: string;
  titel?: string;
  bundesland?: string;
  paragraph?: string;
  abschnitt_typ: 'Paragraph' | 'Artikel' | 'Anlage';
  fassung_vom?: string;
  gesetzesnummer?: string;
  seite: number;
  limit: number;
}

/**
 * Build the RIS API parameter object for a Landesrecht (LrKons) search.
 *
 * LrKons accepts the same parameter set as BrKons, so the consolidated state
 * laws support paragraph/section, historical-version and law-number filters.
 */
export function buildLandesrechtParams(args: LandesrechtParamsArgs): Record<string, unknown> {
  const {
    applikation,
    suchworte,
    titel,
    bundesland,
    paragraph,
    abschnitt_typ,
    fassung_vom,
    gesetzesnummer,
    seite,
    limit,
  } = args;

  const params = buildBaseParams(applikation, limit, seite);

  addOptionalParams(params, [
    [suchworte, 'Suchworte'],
    [titel, 'Titel'],
    [fassung_vom, 'FassungVom'],
    [gesetzesnummer, 'Gesetzesnummer'],
  ]);

  if (bundesland) {
    const apiKey = BUNDESLAND_MAPPING[bundesland];
    if (apiKey) {
      params[`Bundesland.${apiKey}`] = 'true';
    }
  }

  if (paragraph) {
    params['Abschnitt.Von'] = paragraph;
    params['Abschnitt.Bis'] = paragraph;
    params['Abschnitt.Typ'] = abschnitt_typ;
  }

  return params;
}

export function registerLandesrechtTool(server: McpServer): void {
  registerAppTool(
    server,
    'ris_landesrecht',
    {
      title: 'Landesrecht durchsuchen',
      description: `Search Austrian state/provincial laws (Landesrecht).

Use this tool to find laws enacted by Austrian federal states (Bundeslaender).

Search strategy: "titel" and "paragraph" (together with "bundesland") are the precise
entry points — prefer them whenever the law or the section is known. "suchworte" runs a
broad full-text search and the RIS API returns those hits ordered alphabetically by law
title, not by relevance, so a common term buries the relevant law under thousands of
results. Austrian law often splits one topic across several statutes and across the
federal/state divide — when the topic turns out to be federal rather than state law
(warranty, for example, sits in the VGG and in §§ 922 ff ABGB), search it with
ris_bundesrecht instead.

Example queries:
  - suchworte="Bauordnung", bundesland="Salzburg" -> Find state building law
  - titel="Bauordnung", bundesland="Wien", paragraph="1" -> Specific section
  - suchworte="Naturschutz", bundesland="Tirol", fassung_vom="2020-01-01" -> Version as of a date`,
      inputSchema: {
        suchworte: z
          .string()
          .max(1000)
          .optional()
          .describe(
            'Broad full-text search terms. Hits come back ordered alphabetically by law title, not by relevance — prefer "titel" and/or "paragraph" whenever the law or the section is known.',
          ),
        titel: z.string().max(500).optional().describe('Search in law titles'),
        bundesland: LandesrechtBundeslandSchema.optional().describe(
          'Filter by state - Wien, Niederoesterreich, Oberoesterreich, Salzburg, Tirol, Vorarlberg, Kaernten, Steiermark, Burgenland',
        ),
        paragraph: z
          .string()
          .max(100)
          .optional()
          .describe('Section number to search for (e.g., "1" for §1, "7" for Art 7)'),
        abschnitt_typ: AbschnittTypSchema.default('Paragraph').describe(
          'Type of section that "paragraph" refers to: "Paragraph" (default), "Artikel", or "Anlage" (annex).',
        ),
        fassung_vom: DateSchema.optional().describe(
          'Consolidated version as of this date (YYYY-MM-DD) — retrieves the law text as it stood on that day.',
        ),
        gesetzesnummer: z
          .string()
          .max(100)
          .optional()
          .describe('Exact law number (Gesetzesnummer) for a specific state law'),
        applikation: z
          .enum(['LrKons'])
          .default('LrKons')
          .describe('"LrKons" (consolidated, default)'),
        seite: SeiteSchema.describe('Page number'),
        limit: LimitSchema.describe('Results per page: 10, 20, 50, or 100 (default: 20)'),
        response_format: z
          .enum(['markdown', 'json'])
          .default('markdown')
          .describe('"markdown" or "json"'),
      },
      outputSchema: SearchResultOutputShape,
      annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
      _meta: SEARCH_WIDGET_META,
    },
    async (args, extra) => {
      const {
        suchworte,
        titel,
        bundesland,
        paragraph,
        abschnitt_typ,
        fassung_vom,
        gesetzesnummer,
        applikation,
        seite,
        limit,
        response_format,
      } = args;

      if (!hasAnyParam(args, ['suchworte', 'titel', 'bundesland', 'paragraph', 'gesetzesnummer'])) {
        return createValidationErrorResponse([
          'suchworte` fuer Volltextsuche',
          'titel` fuer Suche in Gesetzesnamen',
          'bundesland` fuer Suche nach Bundesland',
          'paragraph` fuer Suche nach Paragraphen',
          'gesetzesnummer` fuer Suche nach Gesetzesnummer',
        ]);
      }

      const params = buildLandesrechtParams({
        applikation,
        suchworte,
        titel,
        bundesland,
        paragraph,
        abschnitt_typ,
        fassung_vom,
        gesetzesnummer,
        seite,
        limit,
      });

      return executeSearchTool(
        searchLandesrecht,
        params,
        response_format,
        extra.signal,
        buildQueryEcho('ris_landesrecht', args),
      );
    },
  );
}
