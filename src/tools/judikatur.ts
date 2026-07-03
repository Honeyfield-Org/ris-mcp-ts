/**
 * Tool: ris_judikatur — Search Austrian court decisions (Judikatur).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { searchJudikatur } from '../client.js';
import { JUDIKATUR_FACHGEBIETE } from '../constants.js';
import {
  addOptionalParams,
  buildBaseParams,
  createValidationErrorResponse,
  executeSearchTool,
  hasAnyParam,
} from '../helpers.js';
import {
  DateSchema,
  JudikaturDokumenttypSchema,
  JudikaturGerichtSchema,
  JudikaturRechtsgebietSchema,
  JudikaturSortierungSchema,
  LimitSchema,
  SeiteSchema,
} from '../types.js';

/** Resolved arguments for building Judikatur API params (after Zod defaults). */
export interface JudikaturParamsArgs {
  gerichtsbarkeit: string;
  dokumenttyp: 'rechtssatz' | 'entscheidungstext' | 'beide';
  suchworte?: string;
  norm?: string;
  geschaeftszahl?: string;
  gericht?: string;
  rechtsgebiet?: string;
  fachgebiet?: string;
  entscheidungsart?: string;
  sammlungsnummer?: string;
  sortierung?: 'datum_auf' | 'datum_ab';
  entscheidungsdatum_von?: string;
  entscheidungsdatum_bis?: string;
  seite: number;
  limit: number;
}

/**
 * Build the RIS API parameter object for a Judikatur search.
 *
 * Note: filters that only apply to certain jurisdictions (e.g. Gericht,
 * Rechtsgebiet, Fachgebiet for Justiz; Sammlungsnummer for Vfgh/Vwgh) are
 * passed through as-is — the API silently ignores inapplicable ones rather
 * than erroring, so no per-jurisdiction gating is needed.
 */
export function buildJudikaturParams(args: JudikaturParamsArgs): Record<string, unknown> {
  const {
    gerichtsbarkeit,
    dokumenttyp,
    suchworte,
    norm,
    geschaeftszahl,
    gericht,
    rechtsgebiet,
    fachgebiet,
    entscheidungsart,
    sammlungsnummer,
    sortierung,
    entscheidungsdatum_von,
    entscheidungsdatum_bis,
    seite,
    limit,
  } = args;

  const params = buildBaseParams(gerichtsbarkeit, limit, seite);

  addOptionalParams(params, [
    [suchworte, 'Suchworte'],
    [norm, 'Norm'],
    [geschaeftszahl, 'Geschaeftszahl'],
    [gericht, 'Gericht'],
    [rechtsgebiet, 'Rechtsgebiet'],
    [fachgebiet, 'Fachgebiet'],
    [entscheidungsart, 'Entscheidungsart'],
    [sammlungsnummer, 'Sammlungsnummer'],
    [entscheidungsdatum_von, 'EntscheidungsdatumVon'],
    [entscheidungsdatum_bis, 'EntscheidungsdatumBis'],
  ]);

  // The API searches only Rechtssätze by default; enable the requested corpora.
  if (dokumenttyp === 'rechtssatz' || dokumenttyp === 'beide') {
    params['Dokumenttyp.SucheInRechtssaetzen'] = 'true';
  }
  if (dokumenttyp === 'entscheidungstext' || dokumenttyp === 'beide') {
    params['Dokumenttyp.SucheInEntscheidungstexten'] = 'true';
  }

  if (sortierung) {
    params['Sortierung.SortDirection'] = sortierung === 'datum_auf' ? 'Ascending' : 'Descending';
    params['Sortierung.SortedByColumn'] = 'Datum';
  }

  return params;
}

export function registerJudikaturTool(server: McpServer): void {
  server.registerTool(
    'ris_judikatur',
    {
      title: 'Judikatur durchsuchen',
      description: `Search Austrian court decisions (Judikatur).

Use this tool to find court decisions from Austrian courts. Choose the
jurisdiction via "gerichtsbarkeit" (which court system to search).

RIS distinguishes two document kinds, controlled by "dokumenttyp":
  - Rechtssatz: abstract legal principle / headnote (Leitsatz) distilled from a decision
  - Entscheidungstext: the full decision text including reasoning (Begruendung)
The default "beide" searches both for the most complete results.

Example queries:
  - gerichtsbarkeit="Vfgh", suchworte="Grundrecht" -> Constitutional Court decisions
  - suchworte="Schadenersatz", gericht="OGH" -> Only Supreme Court (OGH) decisions
  - norm="1295 ABGB" -> Which decisions cite §1295 ABGB?
  - gerichtsbarkeit="Justiz", fachgebiet="Arbeitsrecht", sortierung="datum_ab" -> Newest labor-law decisions`,
      inputSchema: {
        suchworte: z.string().max(1000).optional().describe('Full-text search in decisions'),
        gerichtsbarkeit: JudikaturGerichtSchema.default('Justiz').describe(
          'Court system / data collection to search (maps to the RIS "Applikation"): "Justiz" (OGH/OLG/LG/BG, default), "Vfgh" (Constitutional), "Vwgh" (Administrative), "Bvwg", "Lvwg", "Dsk" (Data Protection), "AsylGH", "Normenliste", "Pvak", "Gbk", "Dok", plus historical (dissolved 2014, stock still searchable): "Verg", "Uvs", "Ubas", "Umse", "Bks"',
        ),
        dokumenttyp: JudikaturDokumenttypSchema.default('beide').describe(
          'Which document kind to search: "rechtssatz" (abstract headnotes only), "entscheidungstext" (full decision texts only), or "beide" (both, default). The RIS API otherwise searches only Rechtssätze.',
        ),
        gericht: z
          .string()
          .max(100)
          .optional()
          .describe(
            'Filter by the actual court within the jurisdiction (e.g., "OGH", "OLG Wien"). Applies to gerichtsbarkeit="Justiz".',
          ),
        rechtsgebiet: JudikaturRechtsgebietSchema.optional().describe(
          'Broad legal area: "Zivilrecht" or "Strafrecht". Applies to gerichtsbarkeit="Justiz".',
        ),
        fachgebiet: z
          .enum(JUDIKATUR_FACHGEBIETE)
          .optional()
          .describe(
            'Subject area of OGH case law (e.g., "Arbeitsrecht", "Insolvenzrecht"). Applies to gerichtsbarkeit="Justiz" and only matches full decision texts (requires dokumenttyp "entscheidungstext" or "beide").',
          ),
        entscheidungsart: z
          .string()
          .max(100)
          .optional()
          .describe(
            'Type of decision. Allowed values differ by jurisdiction, e.g. Vfgh/Vwgh/Bvwg: "Beschluss", "Erkenntnis"; Lvwg also "Bescheid"; Justiz: "Verstärkter Senat", "Ordentliche Erledigung (Sachentscheidung)".',
          ),
        norm: z.string().max(500).optional().describe('Search by legal norm (e.g., "1319a ABGB")'),
        sammlungsnummer: z
          .string()
          .max(100)
          .optional()
          .describe(
            'Collection number: VfSlg (gerichtsbarkeit="Vfgh") or VwSlg (gerichtsbarkeit="Vwgh").',
          ),
        geschaeftszahl: z.string().max(200).optional().describe('Case number (e.g., "5Ob234/20b")'),
        entscheidungsdatum_von: DateSchema.optional().describe('Decision date from (YYYY-MM-DD)'),
        entscheidungsdatum_bis: DateSchema.optional().describe('Decision date to (YYYY-MM-DD)'),
        sortierung: JudikaturSortierungSchema.optional().describe(
          'Sort by decision date: "datum_auf" (oldest first) or "datum_ab" (newest first).',
        ),
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
        gerichtsbarkeit,
        dokumenttyp,
        gericht,
        rechtsgebiet,
        fachgebiet,
        entscheidungsart,
        norm,
        sammlungsnummer,
        geschaeftszahl,
        entscheidungsdatum_von,
        entscheidungsdatum_bis,
        sortierung,
        seite,
        limit,
        response_format,
      } = args;

      if (!hasAnyParam(args, ['suchworte', 'norm', 'geschaeftszahl'])) {
        return createValidationErrorResponse([
          'suchworte` fuer Volltextsuche',
          'norm` fuer Suche nach Rechtsnorm',
          'geschaeftszahl` fuer Suche nach Geschaeftszahl',
        ]);
      }

      const params = buildJudikaturParams({
        gerichtsbarkeit,
        dokumenttyp,
        suchworte,
        norm,
        geschaeftszahl,
        gericht,
        rechtsgebiet,
        fachgebiet,
        entscheidungsart,
        sammlungsnummer,
        sortierung,
        entscheidungsdatum_von,
        entscheidungsdatum_bis,
        seite,
        limit,
      });

      return executeSearchTool(searchJudikatur, params, response_format);
    },
  );
}
