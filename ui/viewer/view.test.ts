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
  disableLoading,
  focusAfterJump,
  interpretPayload,
  renderDocument,
  renderNotice,
  viewportHeight,
  type ViewerHandlers,
} from './view.js';
import { buildDocumentView, sectionId, type ViewerState } from './viewmodel.js';

function handlers(): ViewerHandlers {
  return { onJump: vi.fn(), onLoadGap: vi.fn(), onOpenLink: vi.fn() };
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

function buttonLabelled(container: HTMLElement, label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find((node) =>
    node.textContent?.startsWith(label),
  );
  if (!match) throw new Error(`no button labelled "${label}"`);
  return match;
}

// =============================================================================
// Container height
// =============================================================================

describe('viewportHeight', () => {
  it.each([
    ['a fixed height', { containerDimensions: { height: 520, width: 700 } }, 520],
    ['a maximum height', { containerDimensions: { maxHeight: 480 } }, 480],
    ['a host that sends only a width', { containerDimensions: { width: 700 } }, 640],
    ['a host that sends no dimensions', { theme: 'dark' }, 640],
    ['no host context at all', undefined, 640],
    ['a nonsensical height', { containerDimensions: { height: 0 } }, 640],
  ])('takes %s', (_label, context, expected) => {
    expect(viewportHeight(context)).toBe(expected);
  });
});

// =============================================================================
// interpretPayload
// =============================================================================

describe('interpretPayload', () => {
  it('takes the text block of the mounting result as the first render', () => {
    // The whole first-render thesis: `ris_dokument` declares no structured
    // content, and its text block is the payload.
    expect(interpretPayload(payload({ structuredContent: null }), 'mount')).toEqual({
      kind: 'text',
      text: NORM_MARKDOWN,
    });
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

describe('disableLoading', () => {
  it('takes every control out of service that would call the tool again', () => {
    const [container] = render({
      totalLength: LONG_TOTAL,
      outline: GAZETTE_OUTLINE,
      chunks: [
        { offset: 0, text: 'Anfang.', nextOffset: 7 },
        { offset: 50_000, text: 'Später.', nextOffset: 50_007 },
      ],
    });

    disableLoading(container);

    expect(container.querySelector('.ris-doc-sentinel')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('.ris-doc-gap button')?.disabled).toBe(true);
    // The text already read stays exactly as it was.
    expect(container.querySelector('.ris-doc-text')?.textContent).toContain('Anfang.');
  });

  it('leaves a jump to a loaded section usable', () => {
    // Every outline entry sits past the one short run on screen, so only the
    // section planted here counts as loaded.
    const [container] = render({
      totalLength: GAZETTE_TOTAL,
      outline: GAZETTE_OUTLINE,
      chunks: [{ offset: 0, text: 'Anfang.', nextOffset: 7 }],
    });
    const target = container.querySelector<HTMLElement>('.ris-doc-p');
    if (target) target.id = sectionId(GAZETTE_OUTLINE[0].offset);

    disableLoading(container);

    const jumps = container.querySelectorAll<HTMLButtonElement>('.ris-outline-jump');
    expect(jumps[0].disabled).toBe(false);
    expect(jumps[1].disabled).toBe(true);
  });
});
