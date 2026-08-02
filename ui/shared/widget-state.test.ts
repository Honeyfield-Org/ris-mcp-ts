import { describe, expect, it, vi } from 'vitest';

import { LAW_RESULT } from '../__fixtures__/search-results.js';

import { persistSnapshot, restoreSnapshot } from './widget-state.js';

/**
 * A host that keeps what the widget stores, the way ChatGPT does between the
 * two mounts of one widget instance.
 */
function hostWithMemory(): { globals: { openai: Record<string, unknown> } } {
  const openai: Record<string, unknown> = {
    widgetState: null,
    setWidgetState: vi.fn((state: unknown) => {
      openai.widgetState = state;
    }),
  };

  return { globals: { openai } };
}

describe('persistSnapshot', () => {
  it('stores a payload the next mount can read back', () => {
    const { globals } = hostWithMemory();

    expect(persistSnapshot(LAW_RESULT, globals)).toBe(true);
    expect(restoreSnapshot(globals)).toEqual(LAW_RESULT);
  });

  it('keeps the payload away from the model', () => {
    const { globals } = hostWithMemory();

    persistSnapshot(LAW_RESULT, globals);

    // Everything the widget stores sits under `privateContent`; a snapshot in
    // `modelContent` would replay a whole result page into the model's context
    // on every later turn.
    expect(globals.openai.widgetState).toHaveProperty('privateContent');
    expect(globals.openai.widgetState).not.toHaveProperty('modelContent');
  });

  it.each([
    ['a host without the extension', {}],
    ['a host that only reads state', { openai: { widgetState: null } }],
    ['no globals at all', undefined],
  ])('reports %s as not stored, without throwing', (_label, globals) => {
    expect(persistSnapshot(LAW_RESULT, globals)).toBe(false);
  });

  it('reports a host that refuses the write instead of failing the render', () => {
    const globals = {
      openai: {
        setWidgetState: vi.fn(() => {
          throw new Error('state too large');
        }),
      },
    };

    expect(persistSnapshot(LAW_RESULT, globals)).toBe(false);
  });

  it('leaves an oversized page unstored rather than pushing it at the host', () => {
    const { globals } = hostWithMemory();
    const huge = {
      ...LAW_RESULT,
      documents: Array.from({ length: 400 }, () => LAW_RESULT.documents[0]),
    };

    expect(persistSnapshot(huge, globals)).toBe(false);
    expect(globals.openai.setWidgetState).not.toHaveBeenCalled();
    // And the reopen then shows the honest notice rather than a truncated list.
    expect(restoreSnapshot(globals)).toBeNull();
  });
});

describe('restoreSnapshot', () => {
  it.each([
    ['no globals at all', undefined],
    ['a host without the extension', {}],
    ['a host that never stored anything', { openai: { widgetState: null } }],
    ['state written by something else', { openai: { widgetState: { selectedId: 3 } } }],
    ['a non-object state', { openai: { widgetState: 'irgendwas' } }],
  ])('finds nothing to restore in %s', (_label, globals) => {
    expect(restoreSnapshot(globals)).toBeNull();
  });

  it('ignores a snapshot written by an older version of the widget', () => {
    const globals = {
      openai: {
        widgetState: { privateContent: { risTrefferliste: { version: 0, payload: LAW_RESULT } } },
      },
    };

    expect(restoreSnapshot(globals)).toBeNull();
  });

  it('also reads state the host handed back without the envelope', () => {
    // Whether the structured shape survives round-tripping is not documented,
    // so the read accepts the snapshot at either level.
    const globals = {
      openai: {
        widgetState: { risTrefferliste: { version: 1, payload: LAW_RESULT } },
      },
    };

    expect(restoreSnapshot(globals)).toEqual(LAW_RESULT);
  });

  it('survives a snapshot whose payload is missing', () => {
    const globals = {
      openai: { widgetState: { privateContent: { risTrefferliste: { version: 1 } } } },
    };

    expect(restoreSnapshot(globals)).toBeNull();
  });
});
