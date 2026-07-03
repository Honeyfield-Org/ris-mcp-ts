/**
 * Tool 11: ris_history — Search document change history.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { searchHistory } from '../client.js';
import { VALID_HISTORY_APPLICATIONS } from '../constants.js';
import {
  addOptionalParams,
  createValidationErrorResponse,
  executeSearchTool,
  hasAnyParam,
} from '../helpers.js';
import { DateSchema, LimitSchema, limitToDokumenteProSeite, SeiteSchema } from '../types.js';

export function registerHistoryTool(server: McpServer): void {
  server.registerTool(
    'ris_history',
    {
      title: 'Änderungshistorie durchsuchen',
      description: `Search document change history (Aenderungshistorie).

Use this tool to track changes to legal documents over time.
Shows when documents were created, modified, or deleted.

Available applications (30 total):
  - Bundesrecht: Bundesnormen, BgblAuth, BgblAlt, BgblPdf, RegV
  - Landesrecht: Landesnormen, LgblAuth, Lgbl, LgblNO, Vbl, Gemeinderecht, GemeinderechtAuth
  - Judikatur: Justiz, Vfgh, Vwgh, Bvwg, Lvwg, Dsk, Gbk, Pvak, AsylGH
  - Sonstige: Bvb, Mrp, Erlaesse, PruefGewO, Avsv, Spg, KmGer, Dok, Normenliste

Example queries:
  - applikation="Bundesnormen", aenderungen_von="2024-01-01", aenderungen_bis="2024-01-31"
  - applikation="Justiz", aenderungen_von="2024-06-01"`,
      inputSchema: {
        applikation: z
          .enum(VALID_HISTORY_APPLICATIONS)
          .describe(
            'Application to search history for - categories: Bundesrecht (Bundesnormen, BgblAuth, BgblAlt, BgblPdf, RegV), ' +
              'Landesrecht (Landesnormen, LgblAuth, Lgbl, LgblNO, Vbl, Gemeinderecht), ' +
              'Judikatur (Justiz, Vfgh, Vwgh, Bvwg, Lvwg, Dsk, Gbk, Pvak, AsylGH), ' +
              'Sonstige (Bvb, Mrp, Erlaesse, PruefGewO, Avsv, Spg, KmGer, Dok, Normenliste)',
          ),
        aenderungen_von: DateSchema.optional().describe('Changes from date (YYYY-MM-DD)'),
        aenderungen_bis: DateSchema.optional().describe('Changes to date (YYYY-MM-DD)'),
        include_deleted: z
          .boolean()
          .default(false)
          .describe('Include deleted documents in results (default: false)'),
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
        applikation,
        aenderungen_von,
        aenderungen_bis,
        include_deleted,
        seite,
        limit,
        response_format,
      } = args;

      if (!hasAnyParam(args, ['aenderungen_von', 'aenderungen_bis'])) {
        return createValidationErrorResponse([
          'aenderungen_von` fuer Aenderungen ab Datum',
          'aenderungen_bis` fuer Aenderungen bis Datum',
        ]);
      }

      // Note: History endpoint uses "Anwendung" not "Applikation"
      const params: Record<string, unknown> = {
        Anwendung: applikation,
        DokumenteProSeite: limitToDokumenteProSeite(limit),
        Seitennummer: seite,
      };

      addOptionalParams(params, [
        [aenderungen_von, 'AenderungenVon'],
        [aenderungen_bis, 'AenderungenBis'],
      ]);
      if (include_deleted) params['IncludeDeletedDocuments'] = 'true';

      return executeSearchTool(searchHistory, params, response_format);
    },
  );
}
