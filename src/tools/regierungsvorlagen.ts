/**
 * Tool: ris_regierungsvorlagen — Search Austrian Government Bills (Regierungsvorlagen).
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
import { DateSchema, LimitSchema, SeiteSchema } from '../types.js';

export function registerRegierungsvorlagenTool(server: McpServer): void {
  server.registerTool(
    'ris_regierungsvorlagen',
    {
      title: 'Regierungsvorlagen durchsuchen',
      description: `Search Austrian Government Bills (Regierungsvorlagen).

Use this tool for legislative history and parliamentary materials.
Contains government proposals submitted to parliament.

Example queries:
  - suchworte="Klimaschutz" -> Full-text search in bills
  - einbringende_stelle="BMF (Bundesministerium für Finanzen)" -> Bills from Finance Ministry
  - beschlussdatum_von="2024-01-01", beschlussdatum_bis="2024-12-31" -> Bills from 2024`,
      inputSchema: {
        suchworte: z.string().max(1000).optional().describe('Full-text search terms'),
        titel: z.string().max(500).optional().describe('Search in bill titles'),
        beschlussdatum_von: DateSchema.optional().describe('Decision date from (YYYY-MM-DD)'),
        beschlussdatum_bis: DateSchema.optional().describe('Decision date to (YYYY-MM-DD)'),
        einbringende_stelle: z
          .enum([
            'BKA (Bundeskanzleramt)',
            'BMFFIM (Bundesministerin für Frauen, Familie, Integration und Medien im Bundeskanzleramt)',
            'BMEUV (Bundesministerin für EU und Verfassung im Bundeskanzleramt)',
            'BMKOES (Bundesministerium für Kunst, Kultur, öffentlichen Dienst und Sport)',
            'BMEIA (Bundesministerium für europäische und internationale Angelegenheiten)',
            'BMAW (Bundesministerium für Arbeit und Wirtschaft)',
            'BMBWF (Bundesministerium für Bildung, Wissenschaft und Forschung)',
            'BMF (Bundesministerium für Finanzen)',
            'BMI (Bundesministerium für Inneres)',
            'BMJ (Bundesministerium für Justiz)',
            'BMK (Bundesministerium für Klimaschutz, Umwelt, Energie, Mobilität, Innovation und Technologie)',
            'BMLV (Bundesministerium für Landesverteidigung)',
            'BML (Bundesministerium für Land- und Forstwirtschaft, Regionen und Wasserwirtschaft)',
            'BMSGPK (Bundesministerium für Soziales, Gesundheit, Pflege und Konsumentenschutz)',
          ])
          .optional()
          .describe('Filter by submitting ministry'),
        im_ris_seit: z
          .enum([
            'EinerWoche',
            'ZweiWochen',
            'EinemMonat',
            'DreiMonaten',
            'SechsMonaten',
            'EinemJahr',
          ])
          .optional()
          .describe('Filter by time in RIS'),
        sortierung_richtung: z
          .enum(['Ascending', 'Descending'])
          .optional()
          .describe('Sort direction'),
        sortierung_spalte: z
          .enum(['Kurztitel', 'EinbringendeStelle', 'Beschlussdatum'])
          .optional()
          .describe('Sort by column'),
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
        beschlussdatum_von,
        beschlussdatum_bis,
        einbringende_stelle,
        im_ris_seit,
        sortierung_richtung,
        sortierung_spalte,
        seite,
        limit,
        response_format,
      } = args;

      if (
        !hasAnyParam(args, [
          'suchworte',
          'titel',
          'beschlussdatum_von',
          'einbringende_stelle',
          'im_ris_seit',
        ])
      ) {
        return createValidationErrorResponse([
          'suchworte` für Volltextsuche',
          'titel` für Suche in Titeln',
          'beschlussdatum_von/bis` für Datumsfilter',
          'einbringende_stelle` für Ministerium',
          'im_ris_seit` für Zeitfilter',
        ]);
      }

      const params = buildBaseParams('RegV', limit, seite);
      addOptionalParams(params, [
        [suchworte, 'Suchworte'],
        [titel, 'Titel'],
        [beschlussdatum_von, 'BeschlussdatumVon'],
        [beschlussdatum_bis, 'BeschlussdatumBis'],
        [einbringende_stelle, 'EinbringendeStelle'],
        [im_ris_seit, 'ImRisSeit'],
        [sortierung_richtung, 'Sortierung.SortDirection'],
        [sortierung_spalte, 'Sortierung.SortedByColumn'],
      ]);

      return executeSearchTool(searchBundesrecht, params, response_format);
    },
  );
}
