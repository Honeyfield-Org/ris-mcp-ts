/**
 * Tool 8: ris_bezirke — Search district administrative authority announcements.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { searchBezirke } from '../client.js';
import { IM_RIS_SEIT_VALUES } from '../constants.js';
import {
  addOptionalParams,
  buildBaseParams,
  createValidationErrorResponse,
  executeSearchTool,
  hasAnyParam,
} from '../helpers.js';
import { BundeslandSchema, DateSchema, LimitSchema, SeiteSchema } from '../types.js';

export function registerBezirkeTool(server: McpServer): void {
  server.registerTool(
    'ris_bezirke',
    {
      title: 'Bezirksverwaltungsbehörden durchsuchen',
      description: `Search Austrian district administrative authority announcements (Kundmachungen der Bezirksverwaltungsbehörden).

Use this tool to find announcements and ordinances from district administrative authorities.

Note: Only certain states publish here: Niederösterreich, Oberösterreich, Tirol, Vorarlberg, Burgenland, Steiermark.

Example queries:
  - bundesland="Niederösterreich", suchworte="Bauordnung"
  - bezirksverwaltungsbehoerde="Bezirkshauptmannschaft Innsbruck"`,
      inputSchema: {
        suchworte: z.string().max(1000).optional().describe('Full-text search terms'),
        titel: z.string().max(500).optional().describe('Search in titles'),
        bundesland: BundeslandSchema.optional().describe(
          'Filter by state - Burgenland, Kärnten, Niederösterreich, Oberösterreich, Salzburg, Steiermark, Tirol, Vorarlberg, Wien',
        ),
        bezirksverwaltungsbehoerde: z
          .string()
          .max(200)
          .optional()
          .describe(
            'District authority name (e.g., "Bezirkshauptmannschaft Innsbruck", "Bezirkshauptmannschaft Amstetten")',
          ),
        kundmachungsnummer: z.string().max(100).optional().describe('Announcement number'),
        kundmachungsdatum_von: DateSchema.optional().describe(
          'Announcement date from (YYYY-MM-DD)',
        ),
        kundmachungsdatum_bis: DateSchema.optional().describe('Announcement date to (YYYY-MM-DD)'),
        im_ris_seit: z.enum(IM_RIS_SEIT_VALUES).optional().describe('Filter by time in RIS'),
        seite: SeiteSchema.describe('Page number (default: 1)'),
        limit: LimitSchema.describe('Results per page: 10, 20, 50, or 100 (default: 20)'),
        response_format: z
          .enum(['markdown', 'json'])
          .default('markdown')
          .describe('"markdown" (default) or "json"'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const {
        suchworte,
        titel,
        bundesland,
        bezirksverwaltungsbehoerde,
        kundmachungsnummer,
        kundmachungsdatum_von,
        kundmachungsdatum_bis,
        im_ris_seit,
        seite,
        limit,
        response_format,
      } = args;

      if (
        !hasAnyParam(args, [
          'suchworte',
          'titel',
          'bundesland',
          'bezirksverwaltungsbehoerde',
          'kundmachungsnummer',
        ])
      ) {
        return createValidationErrorResponse([
          'suchworte` für Volltextsuche',
          'titel` für Titelsuche',
          'bundesland` für Bundesland',
          'bezirksverwaltungsbehoerde` für Bezirksverwaltungsbehörde',
          'kundmachungsnummer` für Kundmachungsnummer',
        ]);
      }

      const params = buildBaseParams('Bvb', limit, seite);
      addOptionalParams(params, [
        [suchworte, 'Suchworte'],
        [titel, 'Titel'],
        [bundesland, 'Bundesland'],
        [bezirksverwaltungsbehoerde, 'Bezirksverwaltungsbehoerde'],
        [kundmachungsnummer, 'Kundmachungsnummer'],
        [kundmachungsdatum_von, 'Kundmachungsdatum.Von'],
        [kundmachungsdatum_bis, 'Kundmachungsdatum.Bis'],
        [im_ris_seit, 'ImRisSeit'],
      ]);

      return executeSearchTool(searchBezirke, params, response_format);
    },
  );
}
