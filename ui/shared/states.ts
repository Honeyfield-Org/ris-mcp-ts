/**
 * The non-result states every RIS widget can end up in.
 *
 * Each one is a visible German notice rather than an empty box: the widget is
 * progressive enhancement over a chat answer that always exists, and silence
 * would read as "the search found nothing".
 */

/** User-facing copy, collected so the wording is reviewable in one place. */
export const COPY = {
  loading: 'Suche läuft …',
  emptyTitle: 'Keine Treffer',
  emptyDetail: 'Die Suche hat keine Dokumente geliefert. Andere Suchworte könnten helfen.',
  degradedTitle: 'Keine strukturierten Daten vom Host erhalten.',
  degradedDetail: 'Die vollständige Antwort steht im Chat.',
  connectFailedTitle: 'Trefferliste konnte nicht geladen werden.',
  connectFailedDetail: 'Die vollständige Antwort steht im Chat.',
  toolErrorTitle: 'Die Suche ist fehlgeschlagen.',
  sessionExpired: 'Verbindung abgelaufen — Suche im Chat erneut ausführen.',
  invalidPayloadTitle: 'Unerwartete Daten vom Host erhalten.',
  invalidPayloadDetail: 'Die vollständige Antwort steht im Chat.',
  linkRefused: 'Der Host hat das Öffnen des Links abgelehnt.',
  promptRefused: 'Der Host hat die Nachricht nicht angenommen.',
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
 * Placeholder rows shown while a search is running.
 *
 * RIS answers in seconds and may take up to 30, so every request the widget
 * issues itself needs something on screen in the meantime.
 */
export function createSkeleton(rows = 3): HTMLElement {
  const skeleton = element('div', 'ris-skeleton');
  skeleton.setAttribute('aria-busy', 'true');
  skeleton.append(element('p', 'ris-skeleton-label', COPY.loading));

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
