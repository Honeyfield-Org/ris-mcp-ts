import { describe, expect, it, vi } from 'vitest';

import { LAW_RESULT } from '../__fixtures__/search-results.js';

import { createSnapshotStore } from './widget-state.js';

/** The store under test, keyed the way the Trefferliste keys its own. */
const store = createSnapshotStore('risTrefferliste', 1);

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

describe('persist', () => {
  it('stores a payload the next mount can read back', () => {
    const { globals } = hostWithMemory();

    expect(store.persist(LAW_RESULT, globals)).toBe(true);
    expect(store.restore(globals)).toEqual(LAW_RESULT);
  });

  it('keeps the payload away from the model', () => {
    const { globals } = hostWithMemory();

    store.persist(LAW_RESULT, globals);

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
    expect(store.persist(LAW_RESULT, globals)).toBe(false);
  });

  it('reports a host that refuses the write instead of failing the render', () => {
    const globals = {
      openai: {
        setWidgetState: vi.fn(() => {
          throw new Error('state too large');
        }),
      },
    };

    expect(store.persist(LAW_RESULT, globals)).toBe(false);
  });

  it('clears the previous page instead of storing an oversized one', () => {
    const { globals } = hostWithMemory();
    const huge = {
      ...LAW_RESULT,
      documents: Array.from({ length: 400 }, () => LAW_RESULT.documents[0]),
    };

    store.persist(LAW_RESULT, globals);
    expect(store.persist(huge, globals)).toBe(false);

    // Neither the oversized page nor the smaller one the user has left: a
    // reopen shows the honest notice rather than the wrong page.
    expect(globals.openai.setWidgetState).toHaveBeenLastCalledWith({ privateContent: {} });
    expect(store.restore(globals)).toBeNull();
  });
});

describe('restore', () => {
  it.each([
    ['no globals at all', undefined],
    ['a host without the extension', {}],
    ['a host that never stored anything', { openai: { widgetState: null } }],
    ['state written by something else', { openai: { widgetState: { selectedId: 3 } } }],
    ['a non-object state', { openai: { widgetState: 'irgendwas' } }],
  ])('finds nothing to restore in %s', (_label, globals) => {
    expect(store.restore(globals)).toBeNull();
  });

  it('ignores a snapshot written by an older version of the widget', () => {
    const globals = {
      openai: {
        widgetState: { privateContent: { risTrefferliste: { version: 0, payload: LAW_RESULT } } },
      },
    };

    expect(store.restore(globals)).toBeNull();
  });

  it('also reads state the host handed back without the envelope', () => {
    // Whether the structured shape survives round-tripping is not documented,
    // so the read accepts the snapshot at either level.
    const globals = {
      openai: {
        widgetState: { risTrefferliste: { version: 1, payload: LAW_RESULT } },
      },
    };

    expect(store.restore(globals)).toEqual(LAW_RESULT);
  });

  it('survives a snapshot whose payload is missing', () => {
    const globals = {
      openai: { widgetState: { privateContent: { risTrefferliste: { version: 1 } } } },
    };

    expect(store.restore(globals)).toBeNull();
  });
});

describe('two widgets on one host', () => {
  it('does not let one store overwrite the other', () => {
    const { globals } = hostWithMemory();
    const viewer = createSnapshotStore('risViewer', 1);

    store.persist(LAW_RESULT, globals);
    viewer.persist({ dokumentnummer: 'NOR12019037' }, globals);

    // A shared key would have made the second write destroy the first, and a
    // reopened Trefferliste would restore a document instead of its list.
    expect(viewer.restore(globals)).toEqual({ dokumentnummer: 'NOR12019037' });
    expect(store.restore(globals)).toEqual(LAW_RESULT);
  });

  it('leaves state that is not a snapshot where the host put it', () => {
    const openai: Record<string, unknown> = {
      widgetState: { selectedId: 3 },
      setWidgetState: vi.fn((next: unknown) => {
        openai.widgetState = next;
      }),
    };

    store.persist(LAW_RESULT, { openai });

    // The host's own state is not this store's to carry around; relocating it
    // under `privateContent` would move data nothing here understands.
    expect(openai.widgetState).toEqual({
      privateContent: { risTrefferliste: { version: 1, payload: LAW_RESULT } },
    });
  });

  it('leaves a foreign snapshot in place when its own is dropped', () => {
    const { globals } = hostWithMemory();
    const viewer = createSnapshotStore('risViewer', 1);

    store.persist(LAW_RESULT, globals);
    expect(viewer.persist({ note: 'x'.repeat(70_000) }, globals)).toBe(false);

    expect(store.restore(globals)).toEqual(LAW_RESULT);
    expect(viewer.restore(globals)).toBeNull();
  });
});
