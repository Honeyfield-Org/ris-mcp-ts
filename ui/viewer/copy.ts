/**
 * User-facing copy of the document viewer, collected so the wording is
 * reviewable in one place.
 *
 * Deliberately its own file rather than an extension of `shared/states.ts`:
 * almost every string a viewer shows differs from the Trefferliste's, down to
 * the one the issue names explicitly — "Dokument im Chat erneut anfordern"
 * against "Suche im Chat erneut ausführen". Parameterising a flat constant for
 * the two it shares would trade a greppable string for indirection.
 */

import { COPY as SHARED } from '../shared/states.js';

export const COPY = {
  loading: 'Dokument wird geladen …',
  loadingSection: 'Abschnitt wird geladen …',
  /**
   * Shown at the foot of the text while the *next* section is being fetched.
   * Shorter than {@link loadingSection}, which replaces the whole pane and has
   * the room: this one sits under text that stays readable throughout.
   */
  loadingMore: 'Abschnitt lädt …',

  documentErrorTitle: 'Das Dokument konnte nicht geladen werden.',
  degradedTitle: 'Keine Dokumentdaten erhalten.',
  invalidPayloadTitle: 'Unerwartete Daten erhalten.',
  connectFailedTitle: 'Der Dokument-Viewer konnte nicht geladen werden.',

  /**
   * Detail for a failure at mount. True only there: the call that opened the
   * viewer always put the document text into the chat as well.
   */
  textInChat: 'Der vollständige Text steht im Chat.',
  /**
   * Detail for a failure while loading a section. The section the viewer asked
   * for has no chat answer to fall back on — what it does have is the text
   * already on screen.
   */
  sectionUnchanged: 'Der angezeigte Abschnitt bleibt unverändert.',

  sessionExpired: 'Verbindung abgelaufen — Dokument im Chat erneut anfordern.',
  linkRefused: SHARED.linkRefused,

  gapMarker: 'Abschnitt nachladen',
  outlineLabel: 'Gliederung',
  openInRis: 'Im RIS öffnen',
} as const;
