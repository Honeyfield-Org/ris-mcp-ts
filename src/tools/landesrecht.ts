/**
 * Tool: ris_landesrecht — Search Austrian state/provincial laws (Landesrecht).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { searchLandesrecht } from '../client.js';
import { BUNDESLAND_MAPPING } from '../constants.js';
import {
  addOptionalParams,
  buildBaseParams,
  createValidationErrorResponse,
  executeSearchTool,
  hasAnyParam,
} from '../helpers.js';
import {
  AbschnittTypSchema,
  DateSchema,
  LandesrechtBundeslandSchema,
  LimitSchema,
  SeiteSchema,
} from '../types.js';

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
  server.registerTool(
    'ris_landesrecht',
    {
      title: 'Landesrecht durchsuchen',
      description: `Search Austrian state/provincial laws (Landesrecht).

Use this tool to find laws enacted by Austrian federal states (Bundeslaender).

Example queries:
  - suchworte="Bauordnung", bundesland="Salzburg" -> Find state building law
  - titel="Bauordnung", bundesland="Wien", paragraph="1" -> Specific section
  - suchworte="Naturschutz", bundesland="Tirol", fassung_vom="2020-01-01" -> Version as of a date`,
      inputSchema: {
        suchworte: z.string().max(1000).optional().describe('Full-text search terms'),
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
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
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

      return executeSearchTool(searchLandesrecht, params, response_format);
    },
  );
}
