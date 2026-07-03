/**
 * Tool 9: ris_gemeinden — Search Austrian municipal law.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { searchGemeinden } from '../client.js';
import { GEMEINDEN_INDEX_VALUES, IM_RIS_SEIT_VALUES } from '../constants.js';
import {
  addOptionalParams,
  buildBaseParams,
  createValidationErrorResponse,
  executeSearchTool,
  hasAnyParam,
} from '../helpers.js';
import { DateSchema, LimitSchema, SeiteSchema } from '../types.js';

export function registerGemeindenTool(server: McpServer): void {
  server.registerTool(
    'ris_gemeinden',
    {
      title: 'Gemeinderecht durchsuchen',
      description: `Search Austrian municipal law (Gemeinderecht).

Use this tool to find municipal regulations and local ordinances.

Applications:
  - Gr: Municipal law (Gemeinderecht) - default
  - GrA: Cross-border municipal law (Gemeinderecht Authentisch/Amtsblätter)

Example queries:
  - gemeinde="Graz", suchworte="Parkgebuehren"
  - bundesland="Tirol", titel="Gebuehrenordnung"
  - applikation="Gr", index="Baurecht"
  - applikation="GrA", bezirk="Bregenz"`,
      inputSchema: {
        suchworte: z.string().max(1000).optional().describe('Full-text search terms'),
        titel: z.string().max(500).optional().describe('Search in titles'),
        bundesland: z
          .string()
          .max(200)
          .optional()
          .describe(
            'Filter by state - Burgenland, Kärnten, Niederösterreich, Oberösterreich, Salzburg, Steiermark, Tirol, Vorarlberg, Wien',
          ),
        gemeinde: z.string().max(200).optional().describe('Municipality name (e.g., "Graz")'),
        applikation: z
          .enum(['Gr', 'GrA'])
          .default('Gr')
          .describe('"Gr" (municipal law, default) or "GrA" (cross-border/Amtsblätter)'),
        // Parameters for Gr application
        geschaeftszahl: z
          .string()
          .max(200)
          .optional()
          .describe('File number/Aktenzeichen (Gr only)'),
        index: z
          .enum(GEMEINDEN_INDEX_VALUES)
          .optional()
          .describe(
            'Subject area index (Gr only) - VertretungskoerperUndAllgemeineVerwaltung, OeffentlicheOrdnungUndSicherheit, UnterrichtErziehungSportUndWissenschaft, KunstKulturUndKultus, SozialeWohlfahrtUndWohnbaufoerderung, Gesundheit, StraßenUndWasserbauVerkehr, Wirtschaftsfoerderung, Dienstleistungen, Finanzwirtschaft',
          ),
        fassung_vom: DateSchema.optional().describe(
          'Historical version date (YYYY-MM-DD, Gr only)',
        ),
        // Parameters for GrA application
        bezirk: z
          .string()
          .max(200)
          .optional()
          .describe('District name (GrA only, e.g., "Bregenz")'),
        gemeindeverband: z
          .string()
          .max(200)
          .optional()
          .describe('Municipal association name (GrA only)'),
        kundmachungsnummer: z
          .string()
          .max(100)
          .optional()
          .describe('Announcement number (GrA only)'),
        kundmachungsdatum_von: DateSchema.optional().describe(
          'Announcement date from (YYYY-MM-DD, GrA only)',
        ),
        kundmachungsdatum_bis: DateSchema.optional().describe(
          'Announcement date to (YYYY-MM-DD, GrA only)',
        ),
        // Common parameters
        im_ris_seit: z
          .enum(IM_RIS_SEIT_VALUES)
          .optional()
          .describe(
            'Filter by time in RIS - EinerWoche, ZweiWochen, EinemMonat, DreiMonaten, SechsMonaten, EinemJahr',
          ),
        sortierung_richtung: z
          .enum(['Ascending', 'Descending'])
          .optional()
          .describe('Sort direction'),
        sortierung_spalte_gr: z
          .enum(['Geschaeftszahl', 'Bundesland', 'Gemeinde'])
          .optional()
          .describe('Sort column (Gr only)'),
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
        gemeinde,
        applikation,
        geschaeftszahl,
        index,
        fassung_vom,
        bezirk,
        gemeindeverband,
        kundmachungsnummer,
        kundmachungsdatum_von,
        kundmachungsdatum_bis,
        im_ris_seit,
        sortierung_richtung,
        sortierung_spalte_gr,
        seite,
        limit,
        response_format,
      } = args;

      if (
        !hasAnyParam(args, [
          'suchworte',
          'titel',
          'bundesland',
          'gemeinde',
          'geschaeftszahl',
          'index',
          'bezirk',
          'kundmachungsnummer',
        ])
      ) {
        return createValidationErrorResponse([
          'suchworte` fuer Volltextsuche',
          'titel` fuer Suche in Titeln',
          'bundesland` fuer Bundesland',
          'gemeinde` fuer Gemeinde',
          'geschaeftszahl` fuer Aktenzeichen (Gr)',
          'index` fuer Sachgebiet (Gr)',
          'bezirk` fuer Bezirk (GrA)',
          'kundmachungsnummer` fuer Kundmachungsnummer (GrA)',
        ]);
      }

      const params = buildBaseParams(applikation, limit, seite);
      addOptionalParams(params, [
        [suchworte, 'Suchworte'],
        [titel, 'Titel'],
        [gemeinde, 'Gemeinde'],
        [bundesland, 'Bundesland'],
        [im_ris_seit, 'ImRisSeit'],
        [sortierung_richtung, 'Sortierung.SortDirection'],
      ]);

      // Gr-specific parameters
      if (applikation === 'Gr') {
        addOptionalParams(params, [
          [geschaeftszahl, 'Geschaeftszahl'],
          [index, 'Index'],
          [fassung_vom, 'FassungVom'],
          [sortierung_spalte_gr, 'Sortierung.SortedByColumn'],
        ]);
      }

      // GrA-specific parameters
      if (applikation === 'GrA') {
        addOptionalParams(params, [
          [bezirk, 'Bezirk'],
          [gemeindeverband, 'Gemeindeverband'],
          [kundmachungsnummer, 'Kundmachungsnummer'],
          [kundmachungsdatum_von, 'Kundmachungsdatum.Von'],
          [kundmachungsdatum_bis, 'Kundmachungsdatum.Bis'],
        ]);
      }

      return executeSearchTool(searchGemeinden, params, response_format);
    },
  );
}
