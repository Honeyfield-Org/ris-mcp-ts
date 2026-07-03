/**
 * Constants for the RIS MCP Server tools.
 *
 * Contains all static mappings, enum values, and configuration constants
 * used by the individual tool handlers.
 */

/**
 * Mapping of Bundesland names to their API parameter suffixes.
 * The RIS API expects boolean flags in the format `Bundesland.SucheIn[StateName]=true`.
 */
export const BUNDESLAND_MAPPING: Record<string, string> = {
  Wien: 'SucheInWien',
  Niederoesterreich: 'SucheInNiederoesterreich',
  Oberoesterreich: 'SucheInOberoesterreich',
  Salzburg: 'SucheInSalzburg',
  Tirol: 'SucheInTirol',
  Vorarlberg: 'SucheInVorarlberg',
  Kaernten: 'SucheInKaernten',
  Steiermark: 'SucheInSteiermark',
  Burgenland: 'SucheInBurgenland',
};

/**
 * Index categories for Gemeinden (Gr) application.
 * Used to filter municipal law by subject area.
 * Values from API documentation: OGD_Gemeinderecht_Request.xsd
 */
export const GEMEINDEN_INDEX_VALUES = [
  'Undefined',
  'VertretungskoerperUndAllgemeineVerwaltung',
  'OeffentlicheOrdnungUndSicherheit',
  'UnterrichtErziehungSportUndWissenschaft',
  'KunstKulturUndKultus',
  'SozialeWohlfahrtUndWohnbaufoerderung',
  'Gesundheit',
  'StraßenUndWasserbauVerkehr',
  'Wirtschaftsfoerderung',
  'Dienstleistungen',
  'Finanzwirtschaft',
] as const;

/**
 * ImRisSeit values for time-based filtering.
 */
export const IM_RIS_SEIT_VALUES = [
  'EinerWoche',
  'ZweiWochen',
  'EinemMonat',
  'DreiMonaten',
  'SechsMonaten',
  'EinemJahr',
] as const;

/**
 * Political parties for UPTS (Parteien-Transparenz-Senat) application.
 */
export const UPTS_PARTEIEN = [
  'SPÖ - Sozialdemokratische Partei Österreichs',
  'ÖVP - Österreichische Volkspartei',
  'FPÖ - Freiheitliche Partei Österreichs',
  'GRÜNE - Die Grünen - Die Grüne Alternative',
  'NEOS - NEOS – Das Neue Österreich und Liberales Forum',
  'BZÖ - Bündnis Zukunft Österreich',
] as const;

/**
 * Federal ministries for Erlaesse (decrees) application.
 * Values from API documentation - full names without abbreviations.
 */
export const BUNDESMINISTERIEN = [
  'Bundeskanzleramt',
  'Bundesministerium für Kunst, Kultur, öffentlichen Dienst und Sport',
  'Bundesministerium für europäische und internationale Angelegenheiten',
  'Bundesministerium für Arbeit und Wirtschaft',
  'Bundesministerium für Bildung, Wissenschaft und Forschung',
  'Bundesministerium für Finanzen',
  'Bundesministerium für Inneres',
  'Bundesministerium für Justiz',
  'Bundesministerium für Klimaschutz, Umwelt, Energie, Mobilität, Innovation und Technologie',
  'Bundesministerium für Landesverteidigung',
  'Bundesministerium für Land- und Forstwirtschaft, Regionen und Wasserwirtschaft',
  'Bundesministerium für Soziales, Gesundheit, Pflege und Konsumentenschutz',
] as const;

/**
 * Document types for KmGer (court announcements) application.
 * Values from API documentation page 53-54: Geschaeftsordnung, Geschaeftsverteilung
 */
export const KMGER_TYP_VALUES = ['Geschaeftsordnung', 'Geschaeftsverteilung'] as const;

/**
 * Authors (Urheber) for Avsv application.
 * Values from API documentation - full names WITH abbreviations in parentheses.
 */
export const AVSV_URHEBER_VALUES = [
  'Dachverband der Sozialversicherungsträger (DVSV)',
  'Pensionsversicherungsanstalt (PVA)',
  'Österreichische Gesundheitskasse (ÖGK)',
  'Allgemeine Unfallversicherungsanstalt (AUVA)',
  'Sozialversicherungsanstalt der Selbständigen (SVS)',
  'Versicherungsanstalt öffentlich Bediensteter, Eisenbahnen und Bergbau (BVAEB)',
] as const;

/**
 * Type values for Avn (veterinary notices) application.
 */
export const AVN_TYP_VALUES = ['Kundmachung', 'Verordnung', 'Erlass'] as const;

/**
 * OSG (Österreichischer Strukturplan Gesundheit) types for Spg application.
 */
export const SPG_OSG_TYP_VALUES = ['ÖSG', 'ÖSG - Großgeräteplan'] as const;

/**
 * RSG (Regionaler Strukturplan Gesundheit) types for Spg application.
 */
export const SPG_RSG_TYP_VALUES = ['RSG', 'RSG - Großgeräteplan'] as const;

/**
 * PruefGewO examination types.
 */
export const PRUEFGEWO_TYP_VALUES = [
  'Befähigungsprüfung',
  'Eignungsprüfung',
  'Meisterprüfung',
] as const;

/**
 * Subject areas (Fachgebiet) for Justiz (OGH) case law searches.
 *
 * These categorize full decision texts, so they only match when
 * Entscheidungstexte are included in the search (dokumenttyp
 * "entscheidungstext" or "beide"). All values below were verified against a
 * live API call; the documented value "Standes- und Disziplinarrecht für
 * Anwälte" is intentionally omitted because no working spelling could be
 * confirmed (it returned 0 hits for every variant tried).
 */
export const JUDIKATUR_FACHGEBIETE = [
  'Amtsdelikte/Korruption',
  'Amtshaftung inkl. StEG',
  'Anfechtungsrecht',
  'Arbeitsrecht',
  'Bestandrecht',
  'Datenschutzrecht',
  'Erbrecht und Verlassenschaftsverfahren',
  'Erwachsenenschutzrecht',
  'Exekutionsrecht',
  'Familienrecht (ohne Unterhalt)',
  'Finanzstrafsachen',
  'Gewerblicher Rechtsschutz',
  'Grundbuchsrecht',
  'Grundrechte',
  'Insolvenzrecht',
  'Internationales Privat- und Zivilverfahrensrecht',
  'Jugendstrafsachen',
  'Kartellrecht',
  'Klauselentscheidungen',
  'Konsumentenschutz und Produkthaftung',
  'Medienrecht',
  'Persönlichkeitsschutzrecht',
  'Schadenersatz nach Verkehrsunfall',
  'Schlepperei/FPG',
  'Schiedsverfahrensrecht',
  'Sexualdelikte',
  'Sozialrecht',
  'Suchtgiftdelikte',
  'Transportrecht',
  'Unionsrecht',
  'Unterbringungs- und Heimaufenthaltsrecht',
  'Unterhaltsrecht inkl. UVG',
  'Unternehmens-, Gesellschafts- und Wertpapierrecht',
  'Urheberrecht',
  'Versicherungsvertragsrecht',
  'Wirtschaftsstrafsachen',
  'Wohnungseigentumsrecht',
  'Zivilverfahrensrecht',
] as const;

/**
 * Valid application names for the History API endpoint.
 * The History API uses "Anwendung" parameter with specific application names.
 */
export const VALID_HISTORY_APPLICATIONS = [
  'Bundesnormen',
  'Landesnormen',
  'Justiz',
  'Vfgh',
  'Vwgh',
  'Bvwg',
  'Lvwg',
  'BgblAuth',
  'BgblAlt',
  'BgblPdf',
  'LgblAuth',
  'Lgbl',
  'LgblNO',
  'Gemeinderecht',
  'GemeinderechtAuth',
  'Bvb',
  'Vbl',
  'RegV',
  'Mrp',
  'Erlaesse',
  'PruefGewO',
  'Avsv',
  'Spg',
  'KmGer',
  'Dsk',
  'Gbk',
  'Dok',
  'Pvak',
  'Normenliste',
  'AsylGH',
  // Historical jurisdictions dissolved on 2014-01-01, still tracked by History.
  'Verg', // Federal Procurement Office
  'Upts', // Party Transparency Senate (search collection: ris_sonstige, NOT Judikatur)
  'Uvs', // Independent Administrative Senates
  'Ubas', // Independent Federal Asylum Senate
  'Umse', // Environmental Senate
  'Bks', // Federal Communications Board
] as const;

/**
 * Valid Bundesland values for Vbl (Verordnungsblätter) API.
 * Note: Vbl uses direct Bundesland values, NOT the SucheIn format used by Lgbl.
 */
export const VALID_VBL_BUNDESLAENDER = [
  'Burgenland',
  'Kaernten',
  'Niederoesterreich',
  'Oberoesterreich',
  'Salzburg',
  'Steiermark',
  'Tirol',
  'Vorarlberg',
  'Wien',
] as const;
