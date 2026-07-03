/**
 * Tool: ris_landesgesetzblatt — Search Austrian State Law Gazettes (Landesgesetzblatt).
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
import { LandesrechtBundeslandSchema, LimitSchema, SeiteSchema } from '../types.js';

export function registerLandesgesetzblattTool(server: McpServer): void {
  server.registerTool(
    'ris_landesgesetzblatt',
    {
      title: 'Landesgesetzblatt durchsuchen',
      description: `Search Austrian State Law Gazettes (Landesgesetzblatt).

Use this tool to find official publications of state/provincial laws.
Covers all 9 federal states (Bundeslaender).

Example queries:
  - lgblnummer="50", jahrgang="2023", bundesland="Wien"
  - suchworte="Bauordnung", bundesland="Salzburg"`,
      inputSchema: {
        lgblnummer: z.string().max(100).optional().describe('Gazette number (e.g., "50")'),
        jahrgang: z.string().max(10).optional().describe('Year (e.g., "2023")'),
        bundesland: LandesrechtBundeslandSchema.optional().describe(
          'Filter by state - Wien, Niederoesterreich, Oberoesterreich, Salzburg, Tirol, Vorarlberg, Kaernten, Steiermark, Burgenland',
        ),
        suchworte: z.string().max(1000).optional().describe('Full-text search terms'),
        titel: z.string().max(500).optional().describe('Search in gazette titles'),
        applikation: z
          .enum(['LgblAuth', 'Lgbl', 'LgblNO'])
          .default('LgblAuth')
          .describe('"LgblAuth" (authentic, default), "Lgbl" (general), "LgblNO" (Lower Austria)'),
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
        lgblnummer,
        jahrgang,
        bundesland,
        suchworte,
        titel,
        applikation,
        seite,
        limit,
        response_format,
      } = args;

      if (!hasAnyParam(args, ['lgblnummer', 'jahrgang', 'bundesland', 'suchworte', 'titel'])) {
        return createValidationErrorResponse([
          'lgblnummer` fuer Gesetzblatt-Nummer',
          'jahrgang` fuer Jahr',
          'bundesland` fuer Bundesland',
          'suchworte` fuer Volltextsuche',
          'titel` fuer Suche in Titeln',
        ]);
      }

      const params = buildBaseParams(applikation, limit, seite);
      addOptionalParams(params, [
        [lgblnummer, 'Lgblnummer'],
        [jahrgang, 'Jahrgang'],
        [suchworte, 'Suchworte'],
        [titel, 'Titel'],
      ]);

      if (bundesland) {
        const apiKey = BUNDESLAND_MAPPING[bundesland];
        if (apiKey) {
          params[`Bundesland.${apiKey}`] = 'true';
        }
      }

      return executeSearchTool(searchLandesrecht, params, response_format);
    },
  );
}
