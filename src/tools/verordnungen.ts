/**
 * Tool 12: ris_verordnungen — Search Austrian state ordinance gazettes.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { searchLandesrecht } from '../client.js';
import { VALID_VBL_BUNDESLAENDER } from '../constants.js';
import {
  addOptionalParams,
  buildBaseParams,
  createValidationErrorResponse,
  executeSearchTool,
  hasAnyParam,
} from '../helpers.js';
import { DateSchema, LimitSchema, SeiteSchema } from '../types.js';

export function registerVerordnungenTool(server: McpServer): void {
  server.registerTool(
    'ris_verordnungen',
    {
      title: 'Verordnungsblätter durchsuchen',
      description: `Search Austrian state ordinance gazettes (Verordnungsblaetter der Laender).

Use this tool to find official publications of state/provincial ordinances.
NOTE: Currently only Tirol data is available (since January 1, 2022).
Other federal states have not yet published their ordinance gazettes in RIS.

Example queries:
  - suchworte="Wolf" -> Full-text search
  - titel="Verordnung" -> Search in title
  - bundesland="Tirol" -> Filter by state (currently only Tirol has data)
  - kundmachungsnummer="25" -> Search by publication number
  - kundmachungsdatum_von="2024-01-01", kundmachungsdatum_bis="2024-12-31" -> Date range`,
      inputSchema: {
        suchworte: z.string().max(1000).optional().describe('Full-text search terms'),
        titel: z.string().max(500).optional().describe('Search in title'),
        bundesland: z
          .enum(VALID_VBL_BUNDESLAENDER)
          .optional()
          .describe('Filter by state (currently only Tirol has data)'),
        kundmachungsnummer: z.string().max(100).optional().describe('Publication number'),
        kundmachungsdatum_von: DateSchema.optional().describe('Publication date from (YYYY-MM-DD)'),
        kundmachungsdatum_bis: DateSchema.optional().describe('Publication date to (YYYY-MM-DD)'),
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
        kundmachungsnummer,
        kundmachungsdatum_von,
        kundmachungsdatum_bis,
        seite,
        limit,
        response_format,
      } = args;

      if (
        !hasAnyParam(args, [
          'suchworte',
          'titel',
          'bundesland',
          'kundmachungsnummer',
          'kundmachungsdatum_von',
        ])
      ) {
        return createValidationErrorResponse([
          'suchworte` fuer Volltextsuche',
          'titel` fuer Titelsuche',
          'bundesland` fuer Bundesland-Filter',
          'kundmachungsnummer` fuer Verordnungsnummer',
          'kundmachungsdatum_von` fuer Datum ab',
        ]);
      }

      // Uses Landesrecht endpoint with Applikation="Vbl"
      // Note: Vbl uses direct Bundesland values, NOT the SucheIn format used by Lgbl
      const params = buildBaseParams('Vbl', limit, seite);
      addOptionalParams(params, [
        [suchworte, 'Suchworte'],
        [titel, 'Titel'],
        [bundesland, 'Bundesland'],
        [kundmachungsnummer, 'Kundmachungsnummer'],
        [kundmachungsdatum_von, 'Kundmachungsdatum.Von'],
        [kundmachungsdatum_bis, 'Kundmachungsdatum.Bis'],
      ]);

      return executeSearchTool(searchLandesrecht, params, response_format);
    },
  );
}
