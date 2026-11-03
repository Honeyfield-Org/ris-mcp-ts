/**
 * Attribution required by the RIS OGD licence (CC BY 4.0) and the legal notice
 * every tool description carries.
 *
 * Added centrally in `library.ts` to every successful tool result — as a text
 * block (for clients that show the model the text) and as
 * `structuredContent.attribution` (for clients that show it the structured
 * payload) — so no tool can forget it. Error results carry none: they contain
 * no RIS data.
 */

export const ATTRIBUTION_TEXT = 'Datenquelle: RIS – Rechtsinformationssystem des Bundes, CC BY 4.0';
export const ATTRIBUTION_LICENSE = 'CC BY 4.0';
export const ATTRIBUTION_SOURCE_URL = 'https://www.ris.bka.gv.at';

export const LEGAL_NOTICE =
  'Rechtsverbindlich sind nur die authentischen Kundmachungen im RIS; diese Ergebnisse sind keine Rechtsberatung.';

export interface Attribution {
  text: string;
  license: string;
  source_url: string;
}

export const ATTRIBUTION: Attribution = {
  text: ATTRIBUTION_TEXT,
  license: ATTRIBUTION_LICENSE,
  source_url: ATTRIBUTION_SOURCE_URL,
};

/** Text block appended to every successful result. */
export const ATTRIBUTION_BLOCK = `${ATTRIBUTION_TEXT} – ${ATTRIBUTION_SOURCE_URL}`;
