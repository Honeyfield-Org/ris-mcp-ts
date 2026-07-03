/**
 * Tool: ris_bundesgesetzblatt — Search Austrian Federal Law Gazettes (Bundesgesetzblatt).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { searchBundesrecht } from '../client.js';
import {
  addOptionalParams,
  buildBaseParams,
  createValidationErrorResponse,
  executeSearchTool,
  hasAnyParam,
} from '../helpers.js';
import { LimitSchema, SeiteSchema } from '../types.js';

export function registerBundesgesetzblattTool(server: McpServer): void {
  server.registerTool(
    'ris_bundesgesetzblatt',
    {
      title: 'Bundesgesetzblatt durchsuchen',
      description: `Search Austrian Federal Law Gazettes (Bundesgesetzblatt).

Use this tool for historical research and tracking when laws were enacted.
Contains official publications of federal laws, ordinances, and treaties.

Example queries:
  - bgblnummer="120", jahrgang="2023", teil="1" -> Find specific gazette
  - suchworte="Klimaschutz" -> Full-text search in gazettes`,
      inputSchema: {
        bgblnummer: z.string().max(100).optional().describe('Gazette number (e.g., "120")'),
        teil: z
          .enum(['1', '2', '3'])
          .optional()
          .describe('Part - "1" (I=Laws), "2" (II=Ordinances), "3" (III=Treaties)'),
        jahrgang: z.string().max(10).optional().describe('Year (e.g., "2023")'),
        suchworte: z.string().max(1000).optional().describe('Full-text search terms'),
        titel: z.string().max(500).optional().describe('Search in gazette titles'),
        applikation: z
          .enum(['BgblAuth', 'BgblPdf', 'BgblAlt'])
          .default('BgblAuth')
          .describe(
            '"BgblAuth" (authentic 2004+, default), "BgblPdf" (PDF), "BgblAlt" (1945-2003)',
          ),
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
        bgblnummer,
        teil,
        jahrgang,
        suchworte,
        titel,
        applikation,
        seite,
        limit,
        response_format,
      } = args;

      if (!hasAnyParam(args, ['bgblnummer', 'jahrgang', 'suchworte', 'titel'])) {
        return createValidationErrorResponse([
          'bgblnummer` fuer Gesetzblatt-Nummer',
          'jahrgang` fuer Jahr',
          'suchworte` fuer Volltextsuche',
          'titel` fuer Suche in Titeln',
        ]);
      }

      const params = buildBaseParams(applikation, limit, seite);
      addOptionalParams(params, [
        [bgblnummer, 'Bgblnummer'],
        [teil, 'Teil'],
        [jahrgang, 'Jahrgang'],
        [suchworte, 'Suchworte'],
        [titel, 'Titel'],
      ]);

      return executeSearchTool(searchBundesrecht, params, response_format);
    },
  );
}
