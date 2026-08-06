import { describe, expect, it, vi } from 'vitest';

import {
  DECISION_OUTLINE,
  GAZETTE_OUTLINE,
  GAZETTE_TOTAL,
  LONG_TOTAL,
  NORM_MARKDOWN,
  SHORT_CHUNK,
} from '../__fixtures__/document-chunks.js';
import type { ToolPayload } from '../shared/bridge.js';

import { COPY } from './copy.js';
import {
  focusAfterJump,
  interpretPayload,
  renderDocument,
  renderNotice,
  viewportHeight,
  type ViewerHandlers,
} from './view.js';
import { buildDocumentView, sectionId, type ViewerState } from './viewmodel.js';

function handlers(): ViewerHandlers {
  return {
    onJump: vi.fn(),
    onLoadGap: vi.fn(),
    onOpenLink: vi.fn(),
    onToggleFullscreen: vi.fn(),
  };
}

function state(overrides: Partial<ViewerState> = {}): ViewerState {
  return {
    key: { dokumentnummer: 'NOR12019037' },
    chunks: [{ offset: 0, text: NORM_MARKDOWN, nextOffset: null }],
    totalLength: NORM_MARKDOWN.length,
    outline: SHORT_CHUNK.outline ?? [],
    sourceUrl: SHORT_CHUNK.source_url ?? null,
    title: '',
    provisional: false,
    failedOffset: null,
    expired: false,
    connected: true,
    ...overrides,
  };
}

function render(
  overrides: Partial<ViewerState> = {},
  actions = handlers(),
): [HTMLElement, ViewerHandlers] {
  const container = document.createElement('div');
  renderDocument(container, buildDocumentView(state(overrides)), actions, 640);
  return [container, actions];
}

function payload(overrides: Partial<ToolPayload> = {}): ToolPayload {
  return {
    structuredContent: SHORT_CHUNK,
    source: 'toolresult',
    text: NORM_MARKDOWN,
    isError: false,
    ...overrides,
  };
}

function maybeButtonLabelled(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((node) =>
    node.textContent?.startsWith(label),
  );
}

function buttonLabelled(container: HTMLElement, label: string): HTMLButtonElement {
  const match = maybeButtonLabelled(container, label);
  if (!match) throw new Error(`no button labelled "${label}"`);
  return match;
}

// =============================================================================
// Container height
// =============================================================================

describe('viewportHeight', () => {
  it.each([
    ['a fixed height', { containerDimensions: { height: 520, width: 700 } }, 520],
    ['a host that sends only a width', { containerDimensions: { width: 700 } }, 640],
    ['a host that sends no dimensions', { theme: 'dark' }, 640],
    ['no host context at all', undefined, 640],
    ['a nonsensical height', { containerDimensions: { height: 0 } }, 640],
    // A ceiling below the preferred height is the one case where maxHeight
    // decides the number.
    ['a maximum height that binds', { containerDimensions: { maxHeight: 480 } }, 480],
  ])('takes %s', (_label, context, expected) => {
    expect(viewportHeight(context)).toBe(expected);
  });

  it('reads maxHeight as a ceiling rather than as a height', () => {
    // The reference host reports exactly this, and reading it as a height is
    // what made the widget 4 000 pixels tall: a wall of text instead of a
    // reading pane, with every lazy-loading sentinel in view at once.
    expect(viewportHeight({ containerDimensions: { maxHeight: 4000 } })).toBe(640);
  });

  it.each([
    ['a container collapsed to two lines', { height: 90 }, 320],
    ['a ceiling too low to read under', { maxHeight: 120 }, 320],
  ])('floors %s', (_label, containerDimensions, expected) => {
    // ChatGPT was measured collapsing the widget to about two lines. A pane that
    // overflows its container slightly beats one that shows nothing.
    expect(viewportHeight({ containerDimensions })).toBe(expected);
  });

  it('caps a container reported as a whole page', () => {
    // Also the guard against a host that echoes back the size the widget last
    // reported, which would otherwise grow on every measurement.
    expect(viewportHeight({ containerDimensions: { height: 9000 } })).toBe(1200);
  });
});

// =============================================================================
// interpretPayload
// =============================================================================

describe('interpretPayload', () => {
  it('takes the text block of the mounting result as the first render', () => {
    // The reference host's channel: content blocks, nothing structured. A text
    // block says nothing about the document it was cut from, so nothing around
    // it is invented.
    expect(interpretPayload(payload({ structuredContent: null }), 'mount')).toEqual({
      kind: 'document',
      document: {
        text: NORM_MARKDOWN,
        totalLength: null,
        outline: null,
        key: {},
        sourceUrl: null,
      },
    });
  });

  it('takes the structured payload of the mounting result, text and all', () => {
    // claude.ai's only measured channel to a widget. Everything the text block
    // alone cannot say arrives here: the real length, the outline, and the
    // identifier the viewer fetches further sections with.
    const outcome = interpretPayload(
      payload({
        text: '',
        structuredContent: {
          dokumentnummer: 'NOR12019037',
          text: NORM_MARKDOWN,
          total_length: 259_284,
          outline: SHORT_CHUNK.outline,
          source_url: 'https://ris.bka.gv.at/Dokumente/Bundesnormen/NOR12019037/NOR12019037.html',
        },
      }),
      'mount',
    );

    expect(outcome).toEqual({
      kind: 'document',
      document: {
        text: NORM_MARKDOWN,
        totalLength: 259_284,
        outline: SHORT_CHUNK.outline,
        key: { dokumentnummer: 'NOR12019037' },
        sourceUrl: 'https://ris.bka.gv.at/Dokumente/Bundesnormen/NOR12019037/NOR12019037.html',
      },
    });
  });

  it('addresses a document that has no Dokumentnummer by its source URL', () => {
    const url = 'https://ris.bka.gv.at/Dokumente/Bundesnormen/NOR12019037/NOR12019037.html';
    const outcome = interpretPayload(
      payload({
        structuredContent: { text: NORM_MARKDOWN, total_length: 1000, source_url: url },
      }),
      'mount',
    );

    if (outcome.kind !== 'document') throw new Error('expected a document');
    // Never both: `ris_dokument_abschnitt` given a url resolves through the URL
    // branch of the loader even when a Dokumentnummer is present, which builds a
    // different metadata header and shifts every offset the viewer holds.
    expect(outcome.document.key).toEqual({ url });
  });

  it('falls back to the text block when the structured payload is unusable', () => {
    const outcome = interpretPayload(
      payload({ structuredContent: { text: '', total_length: 12 } }),
      'mount',
    );

    if (outcome.kind !== 'document') throw new Error('expected a document');
    expect(outcome.document.text).toBe(NORM_MARKDOWN);
  });

  it('reports an empty mount so the caller can try the next rung', () => {
    expect(interpretPayload(payload({ text: '', structuredContent: null }), 'mount')).toEqual({
      kind: 'empty',
    });
  });

  it('parses a section the widget requested itself', () => {
    const outcome = interpretPayload(payload(), 'section');

    expect(outcome).toMatchObject({ kind: 'chunk' });
  });

  it('keeps the German prose of a failed tool call', () => {
    const outcome = interpretPayload(
      payload({ isError: true, text: 'Zeitüberschreitung bei der RIS-Anfrage.' }),
      'mount',
    );

    expect(outcome.kind).toBe('notice');
    if (outcome.kind !== 'notice') return;
    expect(outcome.node.querySelector('.ris-notice-title')?.textContent).toBe(
      COPY.documentErrorTitle,
    );
    expect(outcome.node.querySelector('.ris-notice-detail')?.textContent).toBe(
      'Zeitüberschreitung bei der RIS-Anfrage.',
    );
  });

  it('says the section is unchanged when a payload is not a section at all', () => {
    const outcome = interpretPayload(
      payload({ structuredContent: { nichts: 'brauchbar' } }),
      'section',
    );

    expect(outcome.kind).toBe('notice');
    if (outcome.kind !== 'notice') return;
    expect(outcome.node.querySelector('.ris-notice-title')?.textContent).toBe(
      COPY.invalidPayloadTitle,
    );
    expect(outcome.node.querySelector('.ris-notice-detail')?.textContent).toBe(
      COPY.sectionUnchanged,
    );
  });
});

// =============================================================================
// Document rendering
// =============================================================================

describe('renderDocument', () => {
  it('puts the citation in the header and the text in the reading pane', () => {
    const [container] = render();

    expect(container.querySelector('.ris-doc-title')?.textContent).toBe(
      '§ 1295 Allgemeines bürgerliches Gesetzbuch (JGS Nr. 946/1811)',
    );
    expect(container.querySelector('.ris-doc-text')?.textContent).toContain('§ 1295.');
  });

  it('shows the Dokumentnummer and offers the RIS link', () => {
    const [container, actions] = render();

    expect(container.querySelector('.ris-doc-number')?.textContent).toBe('NOR12019037');
    buttonLabelled(container, COPY.openInRis).click();

    expect(actions.onOpenLink).toHaveBeenCalledWith(SHORT_CHUNK.source_url);
  });

  it('bounds its height and scrolls inside instead of growing the iframe', () => {
    const [container] = render();

    expect(container.style.height).toBe('640px');
    expect(container.classList.contains('ris-doc-root')).toBe(true);
    expect(container.querySelector('.ris-doc-text')).not.toBeNull();
  });

  it('renders metadata as label and value pairs', () => {
    const [container] = render();
    const terms = [...container.querySelectorAll('.ris-doc-metadata dt')].map(
      (node) => node.textContent,
    );

    expect(terms).toEqual(['Titel', 'Paragraph', 'Dokumentnummer', 'Quelle']);
  });

  it('routes a metadata link through the host instead of navigating', () => {
    const [container, actions] = render();
    const link = container.querySelector<HTMLButtonElement>('.ris-doc-metadata .ris-link');

    expect(container.querySelector('.ris-doc-metadata a')).toBeNull();
    link?.click();

    expect(actions.onOpenLink).toHaveBeenCalledWith(
      'https://www.ris.bka.gv.at/eli/jgs/1811/946/P1295',
    );
  });

  it('marks the sections the outline points at', () => {
    const [container] = render();

    expect(
      container.querySelector(`#${sectionId(SHORT_CHUNK.outline?.[2].offset ?? 0)}`),
    ).not.toBeNull();
  });
});

describe('renderDocument — the two layouts', () => {
  it('renders a rail for an outline that divides the document', () => {
    const [container] = render({ totalLength: GAZETTE_TOTAL, outline: GAZETTE_OUTLINE });

    expect(container.querySelector('.ris-outline')).not.toBeNull();
    expect(container.querySelectorAll('.ris-outline-jump')).toHaveLength(GAZETTE_OUTLINE.length);
    expect(container.querySelector('.ris-outline-nav')?.getAttribute('aria-label')).toBe(
      COPY.outlineLabel,
    );
  });

  it('renders single-pane when one section covers the whole document', () => {
    const [container] = render({ totalLength: LONG_TOTAL, outline: DECISION_OUTLINE });

    expect(container.querySelector('.ris-outline')).toBeNull();
  });

  it('renders single-pane for a document without an outline', () => {
    const [container] = render({ outline: [] });

    expect(container.querySelector('.ris-outline')).toBeNull();
  });

  it('reports the jump the user asked for', () => {
    const [container, actions] = render({ totalLength: GAZETTE_TOTAL, outline: GAZETTE_OUTLINE });

    container.querySelectorAll<HTMLButtonElement>('.ris-outline-jump')[1].click();

    expect(actions.onJump).toHaveBeenCalledWith(GAZETTE_OUTLINE[1].offset);
  });

  it('shows how much of the document each section covers', () => {
    const [container] = render({ totalLength: GAZETTE_TOTAL, outline: GAZETTE_OUTLINE });
    const shares = [...container.querySelectorAll('.ris-outline-share')].map(
      (node) => node.textContent,
    );

    expect(shares[2]).toBe('14,8 %');
  });
});

describe('renderDocument — loading affordances', () => {
  const chunked: Partial<ViewerState> = {
    totalLength: LONG_TOTAL,
    outline: [],
    chunks: [
      { offset: 0, text: 'Anfang des Dokuments.', nextOffset: 21 },
      { offset: 50_000, text: 'Weit hinten im Dokument.', nextOffset: 50_024 },
    ],
  };

  it('offers a gap marker between two runs and reports what it should fill', () => {
    const [container, actions] = render(chunked);

    buttonLabelled(container, COPY.gapMarker).click();

    expect(actions.onLoadGap).toHaveBeenCalledWith(21);
  });

  it('carries the next offset on the sentinel at the end of the text', () => {
    const [container] = render(chunked);

    expect(container.querySelector<HTMLElement>('.ris-doc-sentinel')?.dataset.offset).toBe('50024');
  });

  it('drops the sentinel once the document ends', () => {
    const [container] = render();

    expect(container.querySelector('.ris-doc-sentinel')).toBeNull();
  });
});

// =============================================================================
// Injection surface
// =============================================================================

describe('the widget never interprets document text as markup', () => {
  const hostile = [
    '# <script>alert(1)</script>',
    '',
    '## Inhalt',
    '',
    '<img src=x onerror="alert(1)">',
    '',
    '**Quelle:** <b>fett</b>',
  ].join('\n');

  it('renders RIS content as text, not as elements', () => {
    const [container] = render({
      chunks: [{ offset: 0, text: hostile, nextOffset: null }],
      outline: [],
    });

    expect(container.querySelector('script, img, b')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(container.querySelector('.ris-doc-title')?.textContent).toBe(
      '<script>alert(1)</script>',
    );
  });
});

// =============================================================================
// Jumping, notices and the expired session
// =============================================================================

describe('focusAfterJump', () => {
  it('moves focus and aria-current to the section', () => {
    const [container] = render({
      totalLength: GAZETTE_TOTAL,
      outline: GAZETTE_OUTLINE,
      chunks: [{ offset: 0, text: 'Anfang.', nextOffset: 7 }],
    });
    document.body.append(container);

    // Only the sections inside the loaded text can be jumped to; the fixture's
    // outline points past it, so a section id is planted the way a loaded run
    // would carry one.
    const target = container.querySelector<HTMLElement>('.ris-doc-p');
    if (target) {
      target.id = sectionId(GAZETTE_OUTLINE[1].offset);
      target.tabIndex = -1;
    }

    expect(focusAfterJump(container, GAZETTE_OUTLINE[1].offset)).toBe(true);
    expect(document.activeElement).toBe(target);
    expect(container.querySelectorAll('.ris-outline-jump')[1].getAttribute('aria-current')).toBe(
      'true',
    );

    container.remove();
  });

  it('reports a section that is not on screen', () => {
    const [container] = render();

    expect(focusAfterJump(container, 999_999)).toBe(false);
  });
});

describe('renderNotice', () => {
  it('gives the bounded height back, so a notice is not a 640px box', () => {
    const [container] = render();

    renderNotice(container, document.createElement('p'));

    expect(container.style.height).toBe('');
    expect(container.classList.contains('ris-doc-root')).toBe(false);
  });
});

describe('an expired session', () => {
  it('takes every control out of service that would call the tool again', () => {
    const [container] = render({
      expired: true,
      totalLength: LONG_TOTAL,
      outline: GAZETTE_OUTLINE,
      chunks: [
        { offset: 0, text: 'Anfang.', nextOffset: 7 },
        { offset: 50_000, text: 'Später.', nextOffset: 50_007 },
      ],
    });

    expect(container.querySelector('.ris-doc-sentinel')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('.ris-doc-gap button')?.disabled).toBe(true);
    // The text already read stays exactly as it was.
    expect(container.querySelector('.ris-doc-text')?.textContent).toContain('Anfang.');
  });

  it('leaves a jump to a loaded section usable', () => {
    // A jump inside the text on screen is pure scrolling; one that would have
    // to fetch cannot work any more.
    const [container] = render({
      expired: true,
      totalLength: GAZETTE_TOTAL,
      outline: GAZETTE_OUTLINE,
      chunks: [{ offset: GAZETTE_OUTLINE[0].offset, text: 'Anfang.', nextOffset: 307 }],
    });

    const jumps = container.querySelectorAll<HTMLButtonElement>('.ris-outline-jump');
    expect(jumps[0].disabled).toBe(false);
    expect(jumps[1].disabled).toBe(true);
  });

  it('keeps every jump usable while the session is alive', () => {
    const [container] = render({ totalLength: GAZETTE_TOTAL, outline: GAZETTE_OUTLINE });
    const jumps = [...container.querySelectorAll<HTMLButtonElement>('.ris-outline-jump')];

    expect(jumps.every((jump) => !jump.disabled)).toBe(true);
  });
});

describe('links when there is no host on the other end', () => {
  it('keeps them working after the session expired', () => {
    // An evicted session costs tool calls, not `openLink` — that goes through
    // the host, which is still there.
    const [container, actions] = render({ expired: true });

    const open = buttonLabelled(container, COPY.openInRis);
    expect(open.disabled).toBe(false);
    open.click();

    expect(actions.onOpenLink).toHaveBeenCalledWith(SHORT_CHUNK.source_url);
    expect(container.querySelector<HTMLButtonElement>('.ris-link')?.disabled).toBe(false);
  });

  it('disables them when the handshake never completed', () => {
    const [container] = render({ connected: false });

    expect(buttonLabelled(container, COPY.openInRis).disabled).toBe(true);
    // The links inside the metadata block route through the same host.
    expect(container.querySelector<HTMLButtonElement>('.ris-link')?.disabled).toBe(true);
  });
});

// =============================================================================
// The fullscreen toggle
// =============================================================================

describe('the fullscreen toggle', () => {
  it('offers it once the host has a fullscreen mode to give', () => {
    const [container, actions] = render({ canFullscreen: true });

    buttonLabelled(container, COPY.openFullscreen).click();

    expect(actions.onToggleFullscreen).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while the host never offered the mode', () => {
    const [container] = render();

    expect(maybeButtonLabelled(container, COPY.openFullscreen)).toBeUndefined();
  });

  it('takes it away once the widget is already in fullscreen', () => {
    // The host renders the way back out itself, so a control of our own would
    // be a second, competing answer to the same question.
    const [container] = render({ canFullscreen: true, displayMode: 'fullscreen' });

    expect(maybeButtonLabelled(container, COPY.openFullscreen)).toBeUndefined();
  });

  it('disables it while there is no host to ask', () => {
    const [container] = render({ canFullscreen: true, connected: false });

    expect(buttonLabelled(container, COPY.openFullscreen).disabled).toBe(true);
    // The RIS action beside it keeps its own gate — two buttons, one header.
    expect(buttonLabelled(container, COPY.openInRis).disabled).toBe(true);
  });

  it('stays usable after the session expired, unlike the tool calls', () => {
    // Switching display mode goes through the host, not through the server.
    const [container] = render({ canFullscreen: true, expired: true });

    expect(buttonLabelled(container, COPY.openFullscreen).disabled).toBe(false);
  });
});

describe('safe-area insets', () => {
  const safeAreaInsets = { top: 44, right: 8, bottom: 34, left: 8 };

  it('pads the reading surface by them in fullscreen', () => {
    const [container] = render({ displayMode: 'fullscreen', safeAreaInsets });

    expect(container.style.getPropertyValue('--ris-inset-top')).toBe('44px');
    expect(container.style.getPropertyValue('--ris-inset-left')).toBe('8px');
  });

  it('ignores them inline, where the host owns everything around the widget', () => {
    const [container] = render({ safeAreaInsets });

    expect(container.style.getPropertyValue('--ris-inset-top')).toBe('0px');
  });

  it('is zero when the host reports no insets at all', () => {
    const [container] = render({ displayMode: 'fullscreen' });

    expect(container.style.getPropertyValue('--ris-inset-bottom')).toBe('0px');
  });
});

describe('a section that failed to load', () => {
  it('offers the gap marker as the retry, with no sentinel to loop on', () => {
    const [container, actions] = render({
      totalLength: LONG_TOTAL,
      outline: [],
      chunks: [{ offset: 0, text: 'Anfang.', nextOffset: 7 }],
      failedOffset: 7,
    });

    expect(container.querySelector('.ris-doc-sentinel')).toBeNull();
    buttonLabelled(container, COPY.gapMarker).click();

    expect(actions.onLoadGap).toHaveBeenCalledWith(7);
  });
});
