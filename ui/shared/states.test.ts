import { describe, expect, it } from 'vitest';

import { COPY, createNotice, createSkeleton } from './states.js';

describe('createSkeleton', () => {
  it('announces that something is loading', () => {
    const skeleton = createSkeleton();

    expect(skeleton.getAttribute('role')).toBe('status');
    expect(skeleton.getAttribute('aria-busy')).toBe('true');
    expect(skeleton.textContent).toContain(COPY.loading);
  });

  it('shows one placeholder per expected row', () => {
    expect(createSkeleton(5).querySelectorAll('.ris-skeleton-row')).toHaveLength(5);
  });
});

describe('createNotice', () => {
  it('renders title and detail as text', () => {
    const notice = createNotice('info', 'Keine Treffer', 'Bitte anders suchen.');

    expect(notice.querySelector('.ris-notice-title')?.textContent).toBe('Keine Treffer');
    expect(notice.querySelector('.ris-notice-detail')?.textContent).toBe('Bitte anders suchen.');
  });

  it('omits the detail element when there is no detail', () => {
    expect(createNotice('info', 'Keine Treffer').querySelector('.ris-notice-detail')).toBeNull();
  });

  it('gives an error notice an assertive role and an informational one a polite role', () => {
    expect(createNotice('error', 'Kaputt').getAttribute('role')).toBe('alert');
    expect(createNotice('info', 'Leer').getAttribute('role')).toBe('status');
  });

  it('never interprets server prose as markup', () => {
    const notice = createNotice('error', 'Fehler', '<img src=x onerror="alert(1)">');

    expect(notice.querySelector('img')).toBeNull();
    expect(notice.querySelector('.ris-notice-detail')?.textContent).toBe(
      '<img src=x onerror="alert(1)">',
    );
  });
});

describe('COPY', () => {
  it('offers a detail for each failure context', () => {
    expect(COPY.degradedTitle).toBe('Keine strukturierten Daten erhalten.');
    expect(COPY.answerInChat).toBe('Die vollständige Antwort steht im Chat.');
    expect(COPY.pageUnchanged).toBe('Die angezeigte Seite bleibt unverändert.');
  });

  it('uses the agreed wording for an evicted session', () => {
    expect(COPY.sessionExpired).toBe('Verbindung abgelaufen — Suche im Chat erneut ausführen.');
  });

  it('never explains the failure in protocol terms', () => {
    for (const [key, value] of Object.entries(COPY)) {
      expect(value, key).not.toMatch(/host|payload|structuredcontent|tool[- ]?call/i);
    }
  });
});
