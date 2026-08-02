/**
 * Widget-scoped persistence of the page the widget last put on screen.
 *
 * On reopening a conversation, ChatGPT replays the mounting tool result without
 * `structuredContent` and `window.openai.toolOutput` is empty by then, so the
 * widget has nothing left to render and says so (live measurement #60). What
 * the host does keep is a snapshot the widget writes itself: `setWidgetState`
 * stores it for that widget instance and `widgetState` hands it back on the
 * next mount ("Keep temporary UI state in the UI",
 * developers.openai.com/plugins/build/chatgpt-ui).
 *
 * This is a snapshot of this instance's own last render, not a cache of
 * whatever the host saw last: it can only restore the page this widget already
 * showed for this message. Fresh data always wins — the caller restores only
 * while it has nothing else to show.
 *
 * Feature-detected, never sniffed. claude.ai exposes no such global and every
 * store is a no-op there.
 */

/** How the host's own extension surface looks from here. */
interface WidgetStateHost {
  widgetState?: unknown;
  setWidgetState?: (state: unknown) => unknown;
}

/**
 * Largest snapshot worth handing to the host, in characters of JSON.
 *
 * The host stores it alongside the conversation and documents no limit of its
 * own. RIS documents run around 1.2k characters each, so the Trefferliste's
 * default page of 20 and its 50-document page both fit; only the opt-in 100
 * does not, and that one reopens to the same notice as before rather than to a
 * truncated list. The viewer stays far below it by storing structure instead of
 * text, and drops its outline when a long one would not fit.
 */
const SNAPSHOT_LIMIT = 64_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function widgetStateHost(globals: unknown): WidgetStateHost | null {
  if (!isRecord(globals)) return null;

  const openai = globals.openai;
  return isRecord(openai) ? (openai as WidgetStateHost) : null;
}

/**
 * Another widget's snapshot, so a write preserves it instead of clearing it.
 *
 * Reads from either level for the same reason the restore does: a host may hand
 * back the envelope it was given or only the state inside it. Only entries
 * shaped like a snapshot are carried over — reading at the outer level means
 * anything else the host keeps there is its own state, and moving that under
 * `privateContent` would relocate data this store has no business touching.
 */
function foreignSnapshots(state: unknown, key: string): Record<string, unknown> {
  if (!isRecord(state)) return {};

  const container = isRecord(state.privateContent) ? state.privateContent : state;
  const rest: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(container)) {
    if (name !== key && isRecord(value) && typeof value.version === 'number') {
      rest[name] = value;
    }
  }

  return rest;
}

/** Reading and writing one widget's snapshot slot. */
export interface SnapshotStore {
  /**
   * Hand the host the payload currently rendered, so a reopen can show it again.
   *
   * Returns whether it was stored — every reason not to (no such host, a payload
   * too large for one, a host that refuses) is a reason to carry on rendering,
   * never to fail the render. A payload that cannot be stored clears the
   * previous one, so a reopen never restores what the user has moved on from.
   */
  persist(payload: unknown, globals?: unknown): boolean;
  /**
   * Read back what this widget stored, or `null` when there is nothing usable.
   *
   * The payload is returned unvalidated — the caller decides whether it is still
   * the shape it renders, exactly as it does for host-delivered data.
   */
  restore(globals?: unknown): unknown;
}

/**
 * A snapshot slot of its own for one widget.
 *
 * `key` names the slot and `version` is bumped whenever a stored payload stops
 * being readable by the code that wrote it. Two widgets in one conversation
 * would otherwise write the same slot and overwrite each other's restore data,
 * so the key is required rather than defaulted: a widget that forgot to pass
 * one would silently inherit another widget's snapshot.
 */
export function createSnapshotStore(key: string, version: number): SnapshotStore {
  return {
    persist(payload: unknown, globals: unknown = globalThis): boolean {
      const host = widgetStateHost(globals);
      if (typeof host?.setWidgetState !== 'function') return false;

      const snapshot = { [key]: { version, payload } };

      try {
        // Measured against this widget's own entry: the budget belongs to the
        // payload being written, not to whatever a second widget stored.
        const storable = JSON.stringify(snapshot).length <= SNAPSHOT_LIMIT;
        const kept = foreignSnapshots(host.widgetState, key);

        // `privateContent` is the documented slot for state the model must not
        // read: the result reaches it once as the tool result, and a rendered
        // page has no business being replayed into its context on every later
        // turn. A payload too large to store also invalidates whatever smaller
        // one was stored before it — leaving that behind would reopen on a page
        // the user has since left, so this widget's key is dropped rather than
        // kept. Another widget's key survives either way.
        host.setWidgetState({ privateContent: storable ? { ...kept, ...snapshot } : kept });
        return storable;
      } catch {
        return false;
      }
    },

    restore(globals: unknown = globalThis): unknown {
      const state = widgetStateHost(globals)?.widgetState;
      if (!isRecord(state)) return null;

      // Written under `privateContent`, read from either level: a host may hand
      // back the envelope it was given or only the state inside it.
      const container = isRecord(state.privateContent) ? state.privateContent : state;
      const entry = container[key];

      if (!isRecord(entry) || entry.version !== version) return null;

      return entry.payload ?? null;
    },
  };
}
