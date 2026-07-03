/**
 * Tool 10: ris_sonstige — Search miscellaneous Austrian legal collections.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { searchSonstige } from '../client.js';
import {
  AVSV_URHEBER_VALUES,
  AVN_TYP_VALUES,
  BUNDESMINISTERIEN,
  IM_RIS_SEIT_VALUES,
  KMGER_TYP_VALUES,
  PRUEFGEWO_TYP_VALUES,
  SPG_OSG_TYP_VALUES,
  SPG_RSG_TYP_VALUES,
  UPTS_PARTEIEN,
} from '../constants.js';
import {
  addOptionalParams,
  buildBaseParams,
  createValidationErrorResponse,
  executeSearchTool,
  hasAnyParam,
} from '../helpers.js';
import { DateSchema, LimitSchema, SeiteSchema } from '../types.js';

export function registerSonstigeTool(server: McpServer): void {
  server.registerTool(
    'ris_sonstige',
    {
      title: 'Sonstige Sammlungen durchsuchen',
      description: `Search miscellaneous Austrian legal collections (Sonstige).

Use this tool for specialized legal documents and historical materials.

Available applications:
  - PruefGewO: Trade licensing examinations (Gewerbeordnung)
  - Avsv: Social insurance announcements (Sozialversicherung)
  - Spg: Health structure plans (Strukturpläne Gesundheit)
  - Avn: Official veterinary notices (Amtliche Veterinärnachrichten)
  - KmGer: Court announcements (Kundmachungen der Gerichte)
  - Upts: Party transparency decisions (Parteien-Transparenz-Senat)
  - Mrp: Council of Ministers protocols (Ministerratsprotokolle)
  - Erlaesse: Ministerial decrees (Erlässe der Bundesministerien)

Example queries:
  - applikation="Mrp", suchworte="Budget", einbringer="BMF..."
  - applikation="Erlaesse", bundesministerium="Bundesministerium für Finanzen"
  - applikation="Upts", partei="SPÖ - Sozialdemokratische Partei Österreichs"
  - applikation="KmGer", kmger_typ="Geschaeftsordnung"
  - applikation="Avsv", dokumentart="Richtlinie"`,
      inputSchema: {
        applikation: z
          .enum(['PruefGewO', 'Avsv', 'Spg', 'Avn', 'KmGer', 'Upts', 'Mrp', 'Erlaesse'])
          .describe(
            'Collection to search - "PruefGewO" (trade exams), "Avsv" (social insurance), "Spg" (health plans), "Avn" (veterinary notices), "KmGer" (court announcements), "Upts" (party transparency), "Mrp" (cabinet protocols), "Erlaesse" (decrees)',
          ),
        suchworte: z.string().max(1000).optional().describe('Full-text search terms'),
        titel: z.string().max(500).optional().describe('Search in titles'),
        datum_von: DateSchema.optional().describe('Date from (YYYY-MM-DD)'),
        datum_bis: DateSchema.optional().describe('Date to (YYYY-MM-DD)'),
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
        geschaeftszahl: z
          .string()
          .max(200)
          .optional()
          .describe('File number/Aktenzeichen (for Mrp, Upts, KmGer)'),
        norm: z.string().max(500).optional().describe('Legal norm reference (for Erlaesse, Upts)'),
        fassung_vom: DateSchema.optional().describe(
          'Historical version date (YYYY-MM-DD, for Erlaesse)',
        ),
        // Mrp-specific parameters
        einbringer: z
          .string()
          .max(200)
          .optional()
          .describe('Submitter (Mrp only, e.g., ministry abbreviation)'),
        sitzungsnummer: z.string().max(50).optional().describe('Session number (Mrp only)'),
        gesetzgebungsperiode: z
          .string()
          .max(10)
          .optional()
          .describe("Legislative period (Mrp only, e.g., '27')"),
        // Erlaesse-specific parameters
        bundesministerium: z
          .enum(BUNDESMINISTERIEN)
          .optional()
          .describe('Federal ministry (Erlaesse only)'),
        abteilung: z.string().max(200).optional().describe('Department/division (Erlaesse only)'),
        fundstelle: z.string().max(200).optional().describe('Source reference (Erlaesse only)'),
        // Upts-specific parameters
        partei: z.enum(UPTS_PARTEIEN).optional().describe('Political party (Upts only)'),
        // KmGer-specific parameters
        kmger_typ: z
          .enum(KMGER_TYP_VALUES)
          .optional()
          .describe('Announcement type (KmGer only) - Geschaeftsordnung, Geschaeftsverteilung'),
        gericht: z.string().max(200).optional().describe('Court name (KmGer only)'),
        // Avsv-specific parameters
        dokumentart: z
          .string()
          .max(200)
          .optional()
          .describe('Document type search (Avsv only) - free text search expression'),
        urheber: z.enum(AVSV_URHEBER_VALUES).optional().describe('Author/institution (Avsv only)'),
        avsvnummer: z.string().max(100).optional().describe('AVSV number (Avsv only)'),
        // Avn-specific parameters
        avnnummer: z.string().max(100).optional().describe('AVN number (Avn only)'),
        avn_typ: z
          .enum(AVN_TYP_VALUES)
          .optional()
          .describe('Notice type (Avn only) - Kundmachung, Verordnung, Erlass'),
        // Spg-specific parameters
        spgnummer: z.string().max(100).optional().describe('SPG number (Spg only)'),
        osg_typ: z
          .enum(SPG_OSG_TYP_VALUES)
          .optional()
          .describe('Austrian health structure plan type (Spg only) - ÖSG, ÖSG - Großgeräteplan'),
        rsg_typ: z
          .enum(SPG_RSG_TYP_VALUES)
          .optional()
          .describe('Regional health structure plan type (Spg only) - RSG, RSG - Großgeräteplan'),
        rsg_land: z.string().max(100).optional().describe('Federal state for RSG (Spg only)'),
        // PruefGewO-specific parameters
        pruefgewo_typ: z
          .enum(PRUEFGEWO_TYP_VALUES)
          .optional()
          .describe(
            'Examination type (PruefGewO only) - Befähigungsprüfung, Eignungsprüfung, Meisterprüfung',
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
        applikation,
        suchworte,
        titel,
        datum_von,
        datum_bis,
        im_ris_seit,
        sortierung_richtung,
        geschaeftszahl,
        norm,
        fassung_vom,
        einbringer,
        sitzungsnummer,
        gesetzgebungsperiode,
        bundesministerium,
        abteilung,
        fundstelle,
        partei,
        kmger_typ,
        gericht,
        dokumentart,
        urheber,
        avsvnummer,
        avnnummer,
        avn_typ,
        spgnummer,
        osg_typ,
        rsg_typ,
        rsg_land,
        pruefgewo_typ,
        seite,
        limit,
        response_format,
      } = args;

      // Validate at least one search parameter beyond applikation
      const searchParamKeys = [
        'suchworte',
        'titel',
        'geschaeftszahl',
        'norm',
        'einbringer',
        'sitzungsnummer',
        'gesetzgebungsperiode',
        'bundesministerium',
        'abteilung',
        'fundstelle',
        'partei',
        'kmger_typ',
        'gericht',
        'dokumentart',
        'urheber',
        'avsvnummer',
        'avnnummer',
        'avn_typ',
        'spgnummer',
        'osg_typ',
        'rsg_typ',
        'rsg_land',
        'pruefgewo_typ',
        'im_ris_seit',
        'datum_von',
        'datum_bis',
      ];

      if (!hasAnyParam(args, searchParamKeys)) {
        return createValidationErrorResponse([
          'suchworte` fuer Volltextsuche',
          'titel` fuer Suche in Titeln',
          'oder applikationsspezifische Parameter (siehe Tool-Beschreibung)',
        ]);
      }

      const params = buildBaseParams(applikation, limit, seite);
      addOptionalParams(params, [
        [suchworte, 'Suchworte'],
        [titel, 'Titel'],
        [im_ris_seit, 'ImRisSeit'],
        [sortierung_richtung, 'Sortierung.SortDirection'],
      ]);

      // Build date parameters based on application type
      if (datum_von || datum_bis) {
        switch (applikation) {
          case 'Mrp':
            if (datum_von) params['Sitzungsdatum.Von'] = datum_von;
            if (datum_bis) params['Sitzungsdatum.Bis'] = datum_bis;
            break;
          case 'Upts':
            if (datum_von) params['Entscheidungsdatum.Von'] = datum_von;
            if (datum_bis) params['Entscheidungsdatum.Bis'] = datum_bis;
            break;
          case 'Erlaesse':
            if (datum_von) params['VonInkrafttretensdatum'] = datum_von;
            if (datum_bis) params['BisInkrafttretensdatum'] = datum_bis;
            break;
          case 'PruefGewO':
          case 'Spg':
          case 'KmGer':
            if (datum_von) params['Kundmachungsdatum.Von'] = datum_von;
            if (datum_bis) params['Kundmachungsdatum.Bis'] = datum_bis;
            break;
          case 'Avsv':
          case 'Avn':
            if (datum_von) params['Kundmachung.Von'] = datum_von;
            if (datum_bis) params['Kundmachung.Bis'] = datum_bis;
            break;
        }
      }

      // Application-specific parameters
      switch (applikation) {
        case 'Mrp':
          if (geschaeftszahl) params['Geschaeftszahl'] = geschaeftszahl;
          if (einbringer) params['Einbringer'] = einbringer;
          if (sitzungsnummer) params['Sitzungsnummer'] = sitzungsnummer;
          if (gesetzgebungsperiode) params['Gesetzgebungsperiode'] = gesetzgebungsperiode;
          break;
        case 'Erlaesse':
          if (norm) params['Norm'] = norm;
          if (fassung_vom) params['FassungVom'] = fassung_vom;
          if (bundesministerium) params['Bundesministerium'] = bundesministerium;
          if (abteilung) params['Abteilung'] = abteilung;
          if (fundstelle) params['Fundstelle'] = fundstelle;
          break;
        case 'Upts':
          if (geschaeftszahl) params['Geschaeftszahl'] = geschaeftszahl;
          if (norm) params['Norm'] = norm;
          if (partei) params['Partei'] = partei;
          break;
        case 'KmGer':
          if (geschaeftszahl) params['Geschaeftszahl'] = geschaeftszahl;
          if (kmger_typ) params['Typ'] = kmger_typ;
          if (gericht) params['Gericht'] = gericht;
          break;
        case 'Avsv':
          if (dokumentart) params['Dokumentart'] = dokumentart;
          if (urheber) params['Urheber'] = urheber;
          if (avsvnummer) params['Avsvnummer'] = avsvnummer;
          break;
        case 'Avn':
          if (avnnummer) params['Avnnummer'] = avnnummer;
          if (avn_typ) params['Typ'] = avn_typ;
          break;
        case 'Spg':
          if (spgnummer) params['Spgnummer'] = spgnummer;
          if (osg_typ) params['OsgTyp'] = osg_typ;
          if (rsg_typ) params['RsgTyp'] = rsg_typ;
          if (rsg_land) params['RsgLand'] = rsg_land;
          break;
        case 'PruefGewO':
          if (pruefgewo_typ) params['Typ'] = pruefgewo_typ;
          break;
      }

      return executeSearchTool(searchSonstige, params, response_format);
    },
  );
}
