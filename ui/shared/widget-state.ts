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
 * Feature-detected, never sniffed. claude.ai exposes no such global and both
 * functions are no-ops there.
 */

/** How the host's own extension surface looks from here. */
interface WidgetStateHost {
  widgetState?: unknown;
  setWidgetState?: (state: unknown) => unknown;
}

/** Distinguishes our snapshot from any other state under the same key. */
const SNAPSHOT_KEY = 'risTrefferliste';

/** Bumped whenever a stored payload stops being readable by this code. */
const SNAPSHOT_VERSION = 1;

/**
 * Largest snapshot worth handing to the host, in characters of JSON.
 *
 * The host stores it alongside the conversation and documents no limit of its
 * own. RIS documents run around 1.2k characters each, so the default page of 20
 * and the 50-document page both fit; only the opt-in 100 does not, and that one
 * reopens to the same notice as before rather than to a truncated list.
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
 * Hand the host the payload currently rendered, so a reopen can show it again.
 *
 * Returns whether it was stored — every reason not to (no such host, a payload
 * too large for one, a host that refuses) is a reason to carry on rendering,
 * never to fail the render. A page that cannot be stored clears the previous
 * one, so a reopen never restores a page the user has moved on from.
 */
export function persistSnapshot(payload: unknown, globals: unknown = globalThis): boolean {
  const host = widgetStateHost(globals);
  if (typeof host?.setWidgetState !== 'function') return false;

  const snapshot = { [SNAPSHOT_KEY]: { version: SNAPSHOT_VERSION, payload } };

  try {
    const storable = JSON.stringify(snapshot).length <= SNAPSHOT_LIMIT;

    // `privateContent` is the documented slot for state the model must not
    // read: the result reaches it once as the tool result, and a search page
    // has no business being replayed into its context on every later turn.
    // A page too large to store also invalidates whatever smaller page was
    // stored before it — leaving that behind would reopen on a page the user
    // has since left, so it is cleared rather than kept.
    host.setWidgetState(storable ? { privateContent: snapshot } : {});
    return storable;
  } catch {
    return false;
  }
}

/**
 * Read back what this widget stored, or `null` when there is nothing usable.
 *
 * The payload is returned unvalidated — the caller decides whether it is still
 * the shape it renders, exactly as it does for host-delivered data.
 */
export function restoreSnapshot(globals: unknown = globalThis): unknown {
  const state = widgetStateHost(globals)?.widgetState;
  if (!isRecord(state)) return null;

  // Written under `privateContent`, read from either level: a host may hand
  // back the envelope it was given or only the state inside it.
  const container = isRecord(state.privateContent) ? state.privateContent : state;
  const entry = container[SNAPSHOT_KEY];

  if (!isRecord(entry) || entry.version !== SNAPSHOT_VERSION) return null;

  return entry.payload ?? null;
}
