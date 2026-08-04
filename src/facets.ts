/**
 * Shared vocabulary between the server schemas and the widgets.
 *
 * Deliberately zod-free and dependency-free: the widget bundle imports this
 * file across the tsconfig boundary, and the server builds its `z.enum()`s from
 * it — one home, so the two sides cannot drift (they were found drifting both
 * ways in the #84 final review).
 */

/**
 * Court/jurisdiction types for case law searches in RIS.
 *
 * This value selects the RIS "Applikation" (data collection), i.e. which
 * court's decisions to search — not an individual court within a collection.
 */
export const JUDIKATUR_GERICHTSBARKEITEN = [
  'Justiz', // Ordinary courts (OGH, OLG, LG, BG)
  'Vfgh', // Constitutional Court
  'Vwgh', // Supreme Administrative Court
  'Bvwg', // Federal Administrative Court
  'Lvwg', // State Administrative Courts
  'Dsk', // Data Protection Authority
  'AsylGH', // Asylum Court (historical, until 2013)
  'Normenliste', // Court norm lists (judicial review)
  'Pvak', // Personnel Representation Supervision Commission
  'Gbk', // Equal Treatment Commission
  'Dok', // Disciplinary Commission
  // Historical jurisdictions dissolved on 2014-01-01 (case stock still searchable).
  'Verg', // Federal Procurement Office (Bundesvergabeamt)
  'Uvs', // Independent Administrative Senates (Unabhängige Verwaltungssenate)
  'Ubas', // Independent Federal Asylum Senate (Unabhängiger Bundesasylsenat)
  'Umse', // Environmental Senate (Umweltsenat)
  'Bks', // Federal Communications Board (Bundeskommunikationssenat)
] as const;

/**
 * Document type filter for Judikatur searches.
 *
 * The RIS API only searches Rechtssätze (abstract legal principles) by default.
 * "entscheidungstext" additionally/instead searches the full decision texts,
 * and "beide" (the default here) searches both for the most complete results.
 */
export const JUDIKATUR_DOKUMENTTYPEN = ['rechtssatz', 'entscheidungstext', 'beide'] as const;

/** Broad legal area filter (Justiz only). */
export const JUDIKATUR_RECHTSGEBIETE = ['Zivilrecht', 'Strafrecht'] as const;

/** Tools whose consolidated documents have dated legal states (`fassung_vom`). */
export const FASSUNG_TOOLS = ['ris_bundesrecht', 'ris_landesrecht'] as const;

/** Applikationen the server silently drops FassungVom for (bundesrecht.ts Erv branch). */
export const FASSUNG_EXCLUDED_APPLIKATIONEN = ['Erv'] as const;
