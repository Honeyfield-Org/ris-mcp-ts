/**
 * The non-result states every RIS widget can end up in.
 *
 * Each one is a visible German notice rather than an empty box: the widget is
 * progressive enhancement over a chat answer that always exists, and silence
 * would read as "the search found nothing".
 */

/**
 * User-facing copy, collected so the wording is reviewable in one place.
 *
 * Written for someone reading a legal search result, not for someone who knows
 * how MCP works: no "Host", no "structuredContent", no "Payload".
 */
export const COPY = {
  loading: 'Suche läuft …',
  emptyTitle: 'Keine Treffer',
  emptyDetail: 'Die Suche hat keine Dokumente geliefert. Andere Suchworte könnten helfen.',
  degradedTitle: 'Keine strukturierten Daten erhalten.',
  invalidPayloadTitle: 'Unerwartete Daten erhalten.',
  toolErrorTitle: 'Die Suche ist fehlgeschlagen.',
  connectFailedTitle: 'Die Trefferliste konnte nicht geladen werden.',
  /**
   * Detail for a failure at mount. True only there: the tool call that opened
   * the widget always produced a chat answer as well.
   */
  answerInChat: 'Die vollständige Antwort steht im Chat.',
  /**
   * Detail for a failure while paging. The page the widget asked for has no
   * chat answer to fall back on — what it does have is the list still on screen.
   */
  pageUnchanged: 'Die angezeigte Seite bleibt unverändert.',
  sessionExpired: 'Verbindung abgelaufen — Suche im Chat erneut ausführen.',
  linkRefused: 'Der Link konnte nicht geöffnet werden.',
  promptRefused: 'Die Nachricht konnte nicht gesendet werden.',
} as const;

/** Severity of a notice — decides how screen readers announce it. */
export type NoticeKind = 'info' | 'error';

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Placeholder rows shown while a request is running.
 *
 * RIS answers in seconds and may take up to 30, so every request the widget
 * issues itself needs something on screen in the meantime. `label` is what the
 * announcement says: the default names a search, and a widget that is loading
 * something else passes its own wording rather than announcing the wrong thing.
 */
export function createSkeleton(rows = 3, label: string = COPY.loading): HTMLElement {
  const skeleton = element('div', 'ris-skeleton');
  // aria-busy alone is only read when a screen reader happens to be on the
  // element; role="status" makes the label an announcement in its own right.
  skeleton.setAttribute('role', 'status');
  skeleton.setAttribute('aria-busy', 'true');
  skeleton.append(element('p', 'ris-skeleton-label', label));

  for (let index = 0; index < rows; index += 1) {
    const row = element('div', 'ris-skeleton-row');
    row.setAttribute('aria-hidden', 'true');
    row.append(element('span', 'ris-skeleton-line ris-skeleton-line-title'));
    row.append(element('span', 'ris-skeleton-line ris-skeleton-line-meta'));
    skeleton.append(row);
  }

  return skeleton;
}

/**
 * A titled notice.
 *
 * Both strings go in as `textContent`. `detail` frequently carries error prose
 * that originated at the RIS API, and markup from that far away has no business
 * being parsed.
 */
export function createNotice(kind: NoticeKind, title: string, detail?: string): HTMLElement {
  const notice = element('div', `ris-notice ris-notice-${kind}`);
  notice.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  notice.append(element('p', 'ris-notice-title', title));

  if (detail) notice.append(element('p', 'ris-notice-detail', detail));

  return notice;
}
