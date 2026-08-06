# CLAUDE.md

MCP Server for the Austrian Legal Information System (RIS - Rechtsinformationssystem).

## Quick Start

```bash
pnpm install
pnpm run build
```

## Development Commands

```bash
pnpm run dev             # Start with tsx (hot reload, stdio)
pnpm run dev:http        # Start HTTP server with tsx (hot reload)
pnpm run build           # Compile TypeScript (runs typecheck first)
pnpm run gen:ui          # Build the widget bundles → src/generated/<widget>-html.ts
pnpm start               # Run compiled version (stdio)
pnpm run start:http      # Run HTTP server (Streamable HTTP transport)
pnpm run check           # typecheck + lint + format:check + test + test:ui
```

**Node floor: ≥ 20.19** (`engines` in package.json) — required by vite 7, which
builds the widget bundles. `gen:ui` runs automatically as a `pre*` hook of
`dev`, `dev:http`, `typecheck`, `test`, `test:coverage` and `test:watch`, so the
generated sources are never stale; you rarely call it by hand.

## Testing

```bash
pnpm test                # Server unit tests (1060 tests, 21 files) — node env
pnpm run test:ui         # Widget tests under ui/ (435 tests, 10 files) — jsdom env
pnpm run test:watch      # Run tests in watch mode
pnpm run test:coverage   # Tests with V8 coverage report
pnpm run test:integration # Integration tests (separate config, requires network)
pnpm run test:host       # Host-sim harness (Playwright, real Chromium iframes) — needs `pnpm exec playwright install chromium` once; not part of `check`/CI
```

Two separate vitest projects, because the widget needs a DOM and the server must
not have one: `vitest.config.ts` (node, excludes `ui/**`) and
`vitest.ui.config.ts` (jsdom, only `ui/**/*.test.ts`). `pnpm run check` runs
both.

The host-sim suite (`tests/host-sim/`, 25 specs in 4 files) is the third suite
and the only one outside vitest: Playwright mounts the *built* bundles in real
iframes and drives them with real clicks, against a hand-rolled stub of the
host side of the ext-apps postMessage protocol (`host-stub.ts`, injected via
`page.evaluate`). It is not in `check`, so its files reach the static gates by
other means — `tests/tsconfig.json` is a third `tsc` pass in `typecheck`, and
eslint/prettier target `tests/` and the Playwright config. Playwright flags go
through `pnpm exec playwright test --config playwright.host.config.ts <flags>`;
`pnpm run test:host -- <flags>` swallows them silently. Host heights, host-call
latency and iframe click policies remain live-only findings; everything else —
scrolling, lazy loading, rail timing, latency feedback — belongs in this
harness (#95).

Three harness facts a new spec needs. Every scenario that triggers a widget call
needs a `callAnswers` entry — the stub's default answer is an rpcError, which
renders the same „Verbindung abgelaufen“ notice as a real transport failure, so
a forgotten entry lets a sloppy spec pass. And since #92 the viewer's offset-0
`ris_dokument_abschnitt` call is *eager* rather than sentinel-driven: it fires
at mount for every document the viewer can name (`dokumentnummer` or `url`),
whatever the mount text's length, so a viewer scenario scripts that answer first
even when it only means to measure the mount — a mount that names no document
fires nothing, and the chat keeps its text. Everything past that opening section
stays scroll-driven, which is what the big-doc scenario class
(`viewer-big-doc.spec.ts`, `bigChunk`/`BIG_MOUNT_TEXT` in
`ui/__fixtures__/document-chunks.ts`) pins (#92, #93, #95): the eager mount that
puts the outline rail on screen with nothing scrolled, the next section the
scroll earns, and a rail click into a section nobody loaded. `callAnswers` is a
FIFO consumed call-by-call, so a scenario scripts one answer per call it
provokes, in order, and an assertion on the recorded calls describes the moment
it runs rather than promising that nothing follows.

Two of those measurements rest on the fixture rather than on the widget. The
mount run and the canonical first section are told apart by their progress
labels alone — `BIG_MOUNT_PROGRESS` (25,1 %) against the first section's 25,0 %
— and that tenth of a percent is nothing but the 126 characters of truncation
notice the fixture appends to its round 25 000-character slice; a shorter notice
makes the two indistinguishable and the eager adoption unobservable. And where
the scroll spec earns its second call depends on how tall the adopted section
renders against the prefetch margin, so changing `BIG_MOUNT_TEXT` or the section
text can change the recorded call sequence with no viewer change behind it.

The fullscreen class (#80) added one stub config field, one stub method and one
spec helper. `displayModeAnswers` is a second FIFO, one entry per
`ui/request-display-mode`,
and it has the same trap as `callAnswers` in a sharper form: the exhausted-FIFO
default is an rpcError, which the bridge degrades to the mode currently in
effect — so a forgotten entry renders *exactly* what a host that silently
refused renders, down to the same German notice. That is by design in the widget
(a refusal and a dead transport are the same non-event to the reader) and a trap
in a spec, so a scenario that means to measure the refusal scripts
`{ mode: 'inline' }` instead of letting the default stand.
`window.__hostSim.pushHostContext(patch)` sends the patch as the params of
`ui/notifications/host-context-changed`, which is how a real host announces that
it granted a mode or resized the container — and it may only be called *after*
the mount assertions have passed: a push that arrives before the handshake is
delivered to nobody and vanishes without a trace. `recordedMessages(page,
method)` generalises the old recorder (`recordedToolCalls` remains as the
`tools/call` shorthand), which is what lets a spec read the handshake
(`ui/initialize`) and the mode requests. Notices are asserted on their literal
German wording inside `#ris-status`, never against the `COPY` constant: the
wording is the whole user-visible contract of a branch, and an assertion that
reads the same constant the widget renders passes whatever that constant says.

### Manual Testing with MCP Inspector

```bash
pnpm run inspect
```

## Code Quality

```bash
pnpm run typecheck       # TypeScript strict mode check
pnpm run lint            # ESLint (strict + stylistic rules)
pnpm run lint:fix        # ESLint with auto-fix
pnpm run format          # Prettier format
pnpm run format:check    # Prettier check
```

Pre-commit hooks (Husky) auto-run `prettier --write` and `eslint --fix` on staged `.ts` files. Commits must follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, etc.) — enforced by commitlint.

## Code Architecture

```
src/
├── index.ts           # Entry point (stdio transport)
├── http.ts            # Entry point (Streamable HTTP transport, Express)
├── server.ts          # MCP server init, delegates to tools/
├── client.ts          # HTTP client for RIS API, error classes, URL construction
├── types.ts           # Zod schemas + TypeScript types
├── facets.ts          # Zod-free vocabulary shared with the widget (see Key Patterns)
├── parser.ts          # JSON parsing and response normalization
├── formatting.ts      # Output formatting (markdown/json), truncation, chunking, outline
├── document-loader.ts # Shared resolve+fetch+format path for the two document tools
├── document-cache.ts  # Bounded LRU cache backing the viewer's chunk tool
├── helpers.ts         # Shared helper functions for tool handlers
├── constants.ts       # Static mappings, enum values, configuration
├── version.ts         # Shared VERSION constant (read from package.json)
├── widgets.ts         # MCP Apps: widget resource + the tools' _meta.ui
├── generated/         # gitignored, written by gen:ui — widget HTML as TS constants
├── tools/
│   ├── index.ts       # registerAllTools() barrel file
│   ├── bundesrecht.ts
│   ├── landesrecht.ts
│   ├── judikatur.ts
│   ├── bundesgesetzblatt.ts
│   ├── landesgesetzblatt.ts
│   ├── regierungsvorlagen.ts
│   ├── dokument.ts    # Full document retrieval (largest handler)
│   ├── dokument-abschnitt.ts  # Chunk tool for the document viewer (app-only)
│   ├── bezirke.ts
│   ├── gemeinden.ts
│   ├── sonstige.ts    # 8 sub-applications (second largest)
│   ├── history.ts
│   └── verordnungen.ts
└── __tests__/
    ├── cancellation.test.ts / cancellation.e2e.test.ts
    ├── client.test.ts
    ├── document-cache.test.ts
    ├── document-matching.test.ts
    ├── dokument-abschnitt.e2e.test.ts  # chunk tool: _meta, paging, cache hit counting
    ├── dokument-snapshot.e2e.test.ts   # ris_dokument response frozen byte-for-byte
    ├── edge-cases.test.ts
    ├── formatting.test.ts
    ├── helpers.test.ts
    ├── history.test.ts
    ├── http.test.ts / http-transport.e2e.test.ts
    ├── parser.test.ts
    ├── security.e2e.test.ts
    ├── server.test.ts
    ├── structured-content.e2e.test.ts
    ├── tool-errors.e2e.test.ts
    ├── types.test.ts
    ├── ui-resource.e2e.test.ts   # widget resource + tool _meta over a real Client
    ├── ui-template.test.ts       # the generated bundle is self-contained
    └── integration/
        └── smoke.test.ts

ui/                    # Widget sources — browser code, own tsconfig (DOM lib)
├── trefferliste/      # The result-list widget
│   ├── index.html     # Shell with the nojs marker; vite build entry
│   ├── main.ts        # Entry: owns page state, delegates the rest
│   ├── viewmodel.ts   # Pure structuredContent → display model (no DOM)
│   ├── view.ts        # Model → elements, payload interpretation
│   └── style.css
├── viewer/            # The document viewer (same five-file split)
│   ├── index.html     main.ts     viewmodel.ts     view.ts
│   ├── copy.ts        # Viewer-specific German strings
│   └── style.css      # Two-pane layout; the one widget that bounds its height
├── shared/
│   ├── bridge.ts      # Host protocol: ext-apps App class, result acquisition
│   ├── states.ts      # German copy + notice/skeleton elements
│   ├── widget-state.ts # createSnapshotStore(key, version) — one slot per widget
│   └── theme.css
└── __fixtures__/      # Search-result and document-chunk fixtures

tests/host-sim/        # Playwright host simulation: mounts the built bundles in
                       # real iframes, stubs the ext-apps postMessage host side
├── host-stub.ts       # installHostSim(): handshake, tool-result delivery,
│                      # scriptable tool + display-mode answers (delays,
│                      # rpcErrors), pushHostContext(), call recorder
├── helpers.ts         # recordedMessages(page, method) + tools/call shorthand
├── trefferliste.spec.ts # Mount, pagination, Rechtslage am, Judikatur-Facetten,
│                      # failures, latency
├── viewer.spec.ts     # Eager mount section + adoption, slow section call
├── viewer-big-doc.spec.ts # Big-doc scenario class: eager mount with rail,
│                      # scroll lazy-load, prefetch margin + loading label,
│                      # rail click with latency
└── viewer-fullscreen.spec.ts # Handshake declaration, toggle offered/withheld,
                       # grant, silent refusal, mode delta without dimensions,
                       # re-anchor across a geometry change

vite.ui.config.ts      # Widget build: one widget per pass, named by RIS_UI_WIDGET
playwright.host.config.ts # Host-sim suite: testDir tests/host-sim, chromium
scripts/gen-ui.mjs     # Drives the builds, then writes src/generated/<widget>-html.ts
```

### Widget Build Pipeline

`gen:ui` = `node scripts/gen-ui.mjs`, which discovers the widgets from the
sources and runs **one Vite pass per widget**. Each pass inlines that widget
into one self-contained `index.html` (`vite-plugin-singlefile`, all assets
inlined regardless of size), and `gen-ui.mjs` then writes the HTML as a
TypeScript string constant to `src/generated/<widget>-html.ts`. The server
imports the constant, so it never resolves a file path at runtime — one less
thing to break between npm install, Docker and dev.

**One pass per widget is not optional.** Building several entries in one pass
makes Rollup split out everything they share — `ui/shared/` and the whole
ext-apps SDK — into chunks that the single-file plugin does not inline. Both
bundles then ship a bare `import … from "./widget-state-<hash>.js"` for a file
that is never written: they look fine to every `<script src=…>` assertion and
fail to start in every host. `gen-ui.mjs` refuses a bundle that still carries a
relative import, and `ui-template.test.ts` asserts the same thing plus the
presence of the SDK.

Widget discovery still comes from the sources (`ui/<name>/index.html`), so a new
widget means a new directory, not a config edit. `src/generated/` is gitignored
and rebuilt by the `pre*` hooks; a widget that failed to build raises a named
error instead of producing a missing export.

## Key Patterns

### Adding/Modifying a Tool Handler

Each tool lives in `src/tools/<name>.ts` and exports a `register<Name>Tool(server)` function. Pattern:

1. The 11 search tools and `ris_dokument` register with `registerAppTool(server, name, { title, description, inputSchema, outputSchema, annotations, _meta }, handler)` from `@modelcontextprotocol/ext-apps/server` — same config object as `server.registerTool()` plus a `_meta` from `src/widgets.ts` that points the tool at its widget: `SEARCH_WIDGET_META` → Trefferliste, `VIEWER_WIDGET_META` → document viewer. `ris_dokument` declares `DocumentOutputShape` rather than the search shape (see below); the wrapper only touches the descriptor. `ris_dokument_abschnitt` uses plain `server.registerTool()` because it sets no `resourceUri` — it feeds the viewer that is already open. The deprecated `server.tool(...)` overload is no longer used.
2. `title` is a German display name, `description`/`inputSchema` are English. `annotations` is `{ readOnlyHint: true, openWorldHint: true, destructiveHint: false }` on **all 13** tools — `destructiveHint` is spec-redundant once `readOnlyHint` is true, but OpenAI lists it as a required annotation for app submissions; do not drop it as noise.
3. Search tools declare `SearchResultOutputShape` (types.ts) as `outputSchema`; successful results carry the parsed result plus the `query` echo as `structuredContent` (emitted centrally in `executeSearchTool()`), error results (`isError: true`) carry none. `executeSearchTool()` takes the echo from `buildQueryEcho(toolName, args)` as a required argument, so a new search tool cannot silently ship without pagination support.
4. For `limit`/`seite`, reuse `LimitSchema`/`SeiteSchema` from `types.ts` instead of raw `z.number()`
5. Use `helpers.ts` functions: `hasAnyParam()`, `buildBaseParams()`, `addOptionalParams()`, `executeSearchTool()`
6. Call client search functions from `client.ts`
7. Register in `src/tools/index.ts` if adding a new tool

### Helper Functions (helpers.ts)

| Function | Purpose |
|----------|---------|
| `createMcpResponse()` | Standard MCP text response |
| `createValidationErrorResponse()` | Validation error listing required params |
| `hasAnyParam()` | Check if any specified param has a truthy value |
| `buildBaseParams()` | Build base API params (Applikation, DokumenteProSeite, Seitennummer) |
| `addOptionalParams()` | Add truthy optional params to request |
| `executeSearchTool()` | Execute search with parsing, formatting, truncation, error handling |
| `formatErrorResponse()` | Format errors in German for user-facing output |

### Error Classes (client.ts)

- `RISAPIError` — Base error with statusCode
- `RISTimeoutError` — 30s timeout exceeded
- `RISParsingError` — JSON parsing failures, includes originalError

### Constants

- **Timeout**: 30,000ms (30 seconds)
- **Character limit**: 25,000 characters (formatting.ts `CHARACTER_LIMIT`, exported — it is also the chunk size of `ris_dokument_abschnitt`)
- **Document cache**: 10 entries / 1,000,000 characters / 10 min TTL per `registerAllTools()` call (document-cache.ts)
- **Pagination**: 10/20/50/100 documents per page (mapped via `limitToDokumenteProSeite()` in types.ts)
- **Allowed document hosts**: `data.bka.gv.at`, `www.ris.bka.gv.at`, `ris.bka.gv.at` (SSRF protection in client.ts)

### Shared Vocabulary (`src/facets.ts`)

The Judikatur enum values (`JUDIKATUR_GERICHTSBARKEITEN`,
`JUDIKATUR_DOKUMENTTYPEN`, `JUDIKATUR_RECHTSGEBIETE`) and the Fassung rules
(`FASSUNG_TOOLS`, `FASSUNG_EXCLUDED_APPLIKATIONEN`) live here — zod-free and
dependency-free, because the widget bundle imports this file across the tsconfig
boundary. `types.ts` builds its `z.enum()`s from these arrays, `parser.ts` and
`formatting.ts` derive their court-key lookups from them, and
`ui/trefferliste/viewmodel.ts` builds the facet selects from them, so a
jurisdiction is added here rather than in four places in parallel. Adding one
without extending `RawJudikaturMetadata` (types.ts) is a **compile error** in
`parser.ts` — verified, `TS7053` on the typed head-note lookup. German labels
stay in the widget and fall back to the raw code, so a value the widget has no
label for still renders, as itself.

### Conventions

- **Language**: User-facing error messages are in **German**; tool descriptions and parameter `.describe()` text are in **English** (existing convention). Tool `title` (display name via `registerTool`) is German.
- **Imports**: Enforced order — builtin > external > internal > parent > sibling > index (alphabetized)
- **Types**: Use `type` imports (`import type { ... }`), no explicit `any`
- **Unused vars**: Must be prefixed with `_`
- **ESM**: Project uses ES modules (`"type": "module"` in package.json, `.js` extensions in imports)

## MCP Apps (Trefferliste and Viewer Widgets)

Since v1.4.0 the 11 search tools render their results as an interactive result
list in hosts that support the MCP Apps extension
(`@modelcontextprotocol/ext-apps`); since v1.5.0 `ris_dokument` renders a
document viewer. Since v1.6.0 the result list's header carries a native
„Rechtslage am“ date input for `ris_bundesrecht`/`ris_landesrecht` results (not
for `applikation: 'Erv'`, whose English translations have no dated Fassung),
re-issuing the echoed query with a changed `fassung_vom` and a page reset — the
same normal-tool-call path the pagination uses. `ris_judikatur` results carry a
facet row under the header instead: native selects for Gerichtsbarkeit and
Dokumenttyp, a Rechtsgebiet select that exists only inside
`gerichtsbarkeit: 'Justiz'`, and a labelled chip for an echoed `gericht` filter
that can be removed but not set — `gericht` is free text the caller supplied and
RIS has no list of courts to offer. Leaving Justiz drops `gericht`,
`rechtsgebiet` and `fachgebiet` from the re-issue, because RIS honours them in no
other jurisdiction and an argument that keeps riding the echo narrows a search
nobody can see it narrowing. Both rows re-issue the same way — whole echo,
`seite` back to 1 — and neither implies the other: a Bundesrecht list has the
date and no facets, a Judikatur list the facets and no date. The mechanism, in
the order it happens:

1. `registerWidgetResources()` (`src/widgets.ts`) registers two resources,
   `ui://ris-mcp/trefferliste` and `ui://ris-mcp/viewer`, whose content is the
   generated single-file HTML.
2. Each search tool carries `_meta: SEARCH_WIDGET_META` and `ris_dokument`
   carries `_meta: VIEWER_WIDGET_META`, i.e. `_meta.ui.resourceUri` → the
   matching URI. `registerAppTool` additionally mirrors it onto the legacy flat
   key `ui/resourceUri` for older hosts.
3. A supporting host loads that HTML and delivers the tool result to it;
   `ui/shared/bridge.ts` wraps the ext-apps `App` class for the handshake,
   theming, `callServerTool`, `openLink` and `sendMessage`.

### The viewer's first render

The viewer takes the first of four rungs that yields content: **(1)** the
mounting result, from *either* channel — the text block, or
`structuredContent.text`, which is the same string plus the document's real
length, its `dokumentnummer`/`source_url` and (within budget) its outline. This
is the normal path, and since #92 it costs one `ris_dokument_abschnitt` call:
the canonical opening section, fetched at mount for every document the viewer
can name — and none for one it cannot, where the provisional mount text is then
everything the widget will ever hold. **(2)** the `dokumentnummer`/`url`
from the `toolinput` notification or `window.openai.toolInput`, followed by one
`ris_dokument_abschnitt` call at offset 0; **(3)** this widget's own snapshot,
which stores structure and a reading position but never text; **(4)** a German
notice. There is no host-global stale-data path — the chat keeps the complete
text, including its `**Quelle:**` link to the RIS original, in every rung.

**`ris_dokument` emits no `resource_link` block** (#52). claude.ai delivers a
widget *no tool-result event at all* when the result carries one, so the viewer
sat on its degradation notice while the trefferliste rendered in the same
conversation; removing the block made it render fully. The URL survives twice —
in the text block's `**Quelle:**` markdown link and in
`structuredContent.source_url` — and ChatGPT's "Dateibereitstellung erlauben?"
consent prompt, which that block triggered, disappears with it. Host bug,
reported upstream; the block is meant to come back once it is fixed.

**Both mount channels are load-bearing, measured 2026-08-02 (#52):** claude.ai
delivers a widget neither `content[]` nor `toolinput`, only `structuredContent`
— which is why `ris_dokument` declares an `outputSchema` at all. The reference
host (`mcp-app-debug`) delivers the content blocks and the input, and no
structured payload for a tool that used to declare none. A rung that reads only
one of the two is blind in one of the two hosts.

The mount run stays *provisional* however much the payload said about it: that
text is the truncated rendering with a German notice appended, so where it ends
is not where the document continues. The canonical opening section is therefore
fetched **eagerly at mount** (`eagerFirstSection()`), for every document the
viewer can name: a large document's outline travels in that offset-0 answer and
nowhere else, and leaving the call to the sentinel kept the rail invisible until
the reader had scrolled through all 25 000 characters of the mount run (#92). It
is deliberately the one call that is *not* visibility-gated — the sentinel path
stops observing while the tab is hidden, this one fires anyway, because a viewer
mounted in a background tab would otherwise sit outline-less until someone
looked at it.

Further sections load through `ris_dokument_abschnitt` as the reader scrolls:
one call in flight at a time, an `IntersectionObserver` rooted on the text pane
prefetching several screens ahead (`PREFETCH_MARGIN`, 2000px since #93 — the
harness proves the effective margin reaches a sentinel roughly 1 200px below the
fold, and no test pins the literal value), paused while the tab is hidden. While
an appended section is in flight, a `.ris-doc-loading` label („Abschnitt lädt
…“, `COPY.loadingMore`) sits at the foot of the text and is removed when the
call settles: a targeted DOM insert rather than a rendered state, because a
`render()` mid-flight would re-arm the sentinel the call just disarmed. The
price of that is cosmetic and known — a host resize mid-flight rebuilds the pane
and silently drops the label until the answer arrives. The viewer is the one
widget that sets a height and scrolls internally — without a real scroll
container every sentinel intersects at once and lazy loading fetches the whole
document.

**`containerDimensions` carries two different statements** and `viewportHeight()`
must not read them the same way: `height` is a container the host has already
sized, `maxHeight` is a *ceiling*. Answering a ceiling with "then I am that tall"
made the widget 4 000px tall in the reference host, which reports
`{ maxHeight: 4000 }`. Under a ceiling the viewer asks for its own 640px
preference instead, and both numbers are clamped to 320…1200px so a host that
reports a collapsed container (ChatGPT, ~90px) cannot shrink the reading pane to
two lines.

**Fullscreen is declared per widget and offered only where the host offers it**
(#80). The declaration travels in the handshake — `BridgeOptions.displayModes`,
`['inline', 'fullscreen']` for the viewer and unset for the trefferliste, whose
silence a harness assert pins — because the declaration is what makes a host
render its fullscreen affordance at all, so declaring a mode a widget has no
layout for advertises a control that leads nowhere. Neither widget declares
`pip`. The viewer's own „Vollbild“ button sits in the header meta row, rendered
only while
`hostContext.availableDisplayModes` lists `fullscreen` *and* the widget is not
already in it: a host in fullscreen draws its own way back out, and a control of
ours beside it would be a second answer to the same question — which is also why
the viewer has no close chrome of its own. Like „Im RIS öffnen“ the button is a
host request rather than a server call, so an evicted session leaves it working
and only a handshake that never completed disables it.

**A refusal is an answer, not an error.** `requestDisplayMode()` resolves with
the mode the host actually *granted* — which may be the one already in effect —
and never rejects; a throw degrades to the current mode. The viewer therefore
checks the granted mode against what it asked for and turns anything else into
the notice „Vollbild ist hier nicht verfügbar.“ A transport failure renders
identically to a silent refusal, deliberately: both are "the mode did not
happen", nothing was lost either way, and the reader can press again. The
request carries no deadline of its own (the SDK's 60s applies), so the handler is
fire-and-forget behind a `modeRequestPending` guard against a second request
while one is open — the button stays enabled, because a control dead for a minute
is worse than one that ignores a click.

**Host-driven layout changes arrive as `hostcontextchanged` deltas** — the host
sends the fields that changed and nothing else. The pane height is recomputed
only when the delta really carries `containerDimensions`: doing it on every delta
let a `{ displayMode }` or `{ theme }` change answer "no dimensions" with the
640px fallback and collapse a pane the host had sized (latent until #80, now
fixed and pinned). Every render the host forces this way — and every granted mode
switch — returns the reader to their section by *content offset* rather than by
pixel `scrollTop`, which means nothing once the pane has been rebuilt; a jump
still loading wins the shared `pendingAnchor` slot (`pendingAnchor ??=`), because
overwriting it with the position the jump started from would consume the anchor
on the section already on screen. `safeAreaInsets` becomes padding on
`.ris-doc-root`, in fullscreen only — inline the widget sits inside host chrome
that already clears the notch — and only with all four sides present, since a
partial object says nothing about the ones it omits. The display mode is
deliberately not part of the viewer snapshot: it describes the frame rather than
the document, and how a reopened conversation displays its widget is the host's
decision.

Document text is rendered by a line classifier, never a markdown parser, and
always through `textContent`. Section anchors come from the server's
`outline[].offset`; the widget carries no §-regex, because in court decisions
every §-line is a citation of a *foreign* law.

**The `resources` capability is now part of the initialize handshake.** The
first registered resource switches it on for every client, including those that
will never render anything. Accepted deliberately: non-UI clients ignore the
capability and the text path of all 13 tools is unchanged.

**CSP lives on the resource, not on the tool.** `McpUiToolMeta` types `csp` and
`permissions` as `never` because hosts read the policy from the `resources/read`
content item (falling back to the `resources/list` entry) and ignore it on the
tool — so `src/widgets.ts` declares it in both of those places and nowhere else.
All four domain lists (`connectDomains`, `resourceDomains`, `frameDomains`,
`baseUriDomains`) are declared as explicitly empty arrays rather than omitted: a
missing declaration shows up in a host as "CSP off", not as "needs nothing".
That only stays truthful while the bundle really reaches for nothing off-origin,
which `ui-template.test.ts` enforces. `_meta.ui.domain` is deliberately unset.

**Cross-host data acquisition** (`readMountResult` in `ui/shared/bridge.ts`),
in order: (1) `structuredContent` on the `toolresult` notification — what
claude.ai delivers; (2) `window.openai.toolOutput`, ChatGPT's own Apps SDK
global and the *normal* path there, feature-detected rather than host-sniffed;
(3) nothing, which becomes a visible German notice. A result the widget
requested itself (pagination) reads step 1 only — the host global holds the
result of the call that *mounted* the widget, so falling back to it would
silently re-render the page the user just left.

**Never lose data.** The widget is progressive enhancement over a chat answer
that always exists: the text block of every tool stays complete and unchanged,
and every non-result state is a visible German notice (`ui/shared/states.ts`)
instead of an empty box. A failed page request keeps the list on screen and puts
the notice underneath it. Any change here must preserve that.

**Host support** (measured in the rendering gate, #45/#49):

| Host | Status |
|------|--------|
| claude.ai | Fully functional — widget, pagination, `openLink` |
| ChatGPT | Renders via the `window.openai.toolOutput` fallback |
| Claude Code, API clients | Unchanged text output, no regression |

The viewer's live pass (2026-08-02, #52) answered two of the open questions in
`.superpowers/sdd/v150-plan/v150-design-widget.md` §9 and closed both findings:

| Host | Viewer finding | Status |
|------|----------------|--------|
| claude.ai | delivers neither `content[]` nor `toolinput` to the widget | fixed — `ris_dokument` now carries the text in `structuredContent` |
| ChatGPT | widget collapsed to ~2 lines with text rendering behind it | mitigated — host heights are clamped to 320…1200px; **not re-measured in ChatGPT** |
| mcp-app-debug | reported `946×4024`; sends `containerDimensions: { maxHeight: 4000 }` | fixed — `946×664`, 6/6 checks |

The remaining §9 questions are open: the eviction branch (Q6) and the rate limit
under real scrolling (Q7). Fullscreen (Q5) is implemented and covered by the
host-sim harness (#80), but nothing about it has been measured in a real host:
whether claude.ai or ChatGPT list `fullscreen` in `availableDisplayModes` at all,
what `containerDimensions` they report once the mode is granted, and whether a
mobile host sends `safeAreaInsets` are all live-only questions.

Known issues and follow-ups: `claude-ai-mcp#165` (custom-connector rendering
flaky — never reproduced here), `ext-apps#696`, and issue **#60** for
ChatGPT pagination and the CSP badge.

**Dev workflow for host testing:** claude.ai needs a public HTTPS endpoint, so
run `pnpm run dev:http` and expose it with
`cloudflared tunnel --url http://localhost:3000 --protocol http2` — the default
QUIC transport dies in some networks. Connector URLs in claude.ai are **not
editable**: a new tunnel URL means deleting the connector and adding it again.

## CI/CD

GitHub Actions runs on push/PR to main:
- **CI**: Matrix test (Node 20, 22) → `pnpm run check` + coverage
- **Release**: Tag push (`v*`) → check + build + GitHub Release + npm publish (Trusted Publishing/OIDC, no NPM_TOKEN)
- **CodeQL**: Weekly security scanning

### Release Flow

```
feature branch → PR → merge to main → git tag v1.x.x → push tag
  → GitHub Release + npm publish (OIDC) + Docker build → ECR → gateway deploy
```

Direct pushes to main are blocked — version-bump commits go through a PR as well.

### Deployment

- **Automatic**: every `v*` tag builds the Docker image, pushes it to a
  private ECR registry (`:x.y.z` + `:latest`) and switches the production
  container (`.github/workflows/deploy.yml`, called from release.yml). A
  verify step fails the run if the live `initialize` version does not match.
- **Rollback**: run the "Deploy Gateway" workflow manually (workflow_dispatch)
  with any existing ECR tag (e.g. `1.2.3`) — no rebuild, just a switch.
- Deploy targets (registry, host) are configured as GitHub repo **Variables**
  (Settings → Secrets and variables → Actions), not in the YAML — this repo
  is public.

## Hosting

| Property | Value |
|----------|-------|
| **Transport** | Streamable HTTP (MCP Spec v2025-03-26) |
| **Container routes** | `POST /mcp` (MCP), `GET /health` (health check), port 3000 |
| **Public endpoint** | Behind a reverse-proxy gateway; URL intentionally not documented here (public repo) |

### Architecture: Two Transports

- **stdio** (`src/index.ts`): Singleton McpServer, used by local MCP clients (Claude Desktop local, Claude Code)
- **HTTP** (`src/http.ts`): Per-session McpServer instances, Express + StreamableHTTPServerTransport. Session map stores active transports, cleanup via `transport.onclose`.

### Key Decisions

- `express.json()` parses body → must pass `req.body` as 3rd arg to `transport.handleRequest()`
- `sessionIdGenerator: () => crypto.randomUUID()` for stateful sessions
- `sessions.set()` called AFTER `handleRequest()` (SDK generates sessionId during initialize)
- Origin validation middleware on `/mcp`: requests without an Origin header pass (non-browser MCP clients); a present Origin must be in the `ALLOWED_ORIGINS` env var (comma-separated, exact match) or the request gets 403. Unset = no browser origin allowed (server-to-server default). Configured in the compose file on the host, not in this repo.
- Dockerfile uses `HUSKY=0` env + `--frozen-lockfile` for production pnpm install

## MCP Tools (13)

Each tool has a German `title`, an English `description`/schema and
`annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false }`
(all 13 are read-only against an external API). Numeric `limit`/`seite` params
are validated by the shared `LimitSchema` (10/20/50/100) and `SeiteSchema` (≥1).
Every tool except `ris_dokument` and `ris_dokument_abschnitt` is a *search* tool:
those 11 declare
`SearchResultOutputShape` as `outputSchema` and carry the widget `_meta` (see
[MCP Apps](#mcp-apps-trefferliste-and-viewer-widgets)).

Their `structuredContent` holds the pagination fields (`total_hits`, `page`,
`page_size`, `has_more`), the `documents` array and a `query` echo — the tool's
own name plus the validated arguments, so a client (or the widget) can page by
re-issuing the call with an incremented `seite`. Each document carries
`citation_display`, the preformatted citation line as it appears in the text
output, and Judikatur hits additionally carry `gericht`, `geschaeftszahl`,
`entscheidungsdatum` and `rechtssatznummer`. All of these live in
`structuredContent` only — the markdown text is unchanged by them, and
`structuredContent` is not subject to the 25,000-character text limit.
Both document tools declare an `outputSchema` whose payload *carries the
document text itself*. That is what makes it safe: clients may treat the text
block as a mere serialization of `structuredContent` and render only the latter,
which in v1.3.0 made the document text disappear behind metadata — a
text-carrying payload cannot lose it by construction (see DECISIONS.md).
`ris_dokument`'s `structuredContent.text` is byte-identical to its text block,
alongside `total_length`, `dokumentnummer?`, `source_url?` and an optional
`outline`. It carries no `next_offset`: the text block is truncated with a
German notice appended, so its length is not an offset into the document. The
outline rides along only for a truncated document and only while it stays under
`CHARACTER_LIMIT / 4` — measured, a court decision's outline is 361 characters
and a consolidated statute's 38 123, half again the excerpt it would travel with
in every client.

| Tool | Description | API Endpoint |
|------|-------------|--------------|
| `ris_bundesrecht` | Federal laws (ABGB, StGB, etc.); filters: `paragraph` + `abschnitt_typ`, `fassung_vom`. `applikation="Erv"` = English translations (uses `SearchTerms`/`Title`, no Abschnitt/Fassung) | /Bundesrecht |
| `ris_landesrecht` | State/provincial laws; filters: `paragraph`/`abschnitt_typ`, `fassung_vom`, `gesetzesnummer` | /Landesrecht |
| `ris_judikatur` | Court decisions (16 court types, chosen via `gerichtsbarkeit`); filters: `dokumenttyp`, `gericht`, `rechtsgebiet`, `fachgebiet`, `entscheidungsart`, `sammlungsnummer`, `sortierung` | /Judikatur |
| `ris_bundesgesetzblatt` | Federal Law Gazettes | /Bundesrecht |
| `ris_landesgesetzblatt` | State Law Gazettes | /Landesrecht |
| `ris_regierungsvorlagen` | Government Bills | /Sonstige |
| `ris_dokument` | Full document text | Direct URL + fallback |
| `ris_dokument_abschnitt` | One section of an open document, by character offset; app-only (`_meta.ui.visibility: ["app"]`), feeds the document viewer widget | cache, else same path as `ris_dokument` |
| `ris_bezirke` | District authority decisions | /Bezirke |
| `ris_gemeinden` | Municipal law | /Gemeinden |
| `ris_sonstige` | Misc collections (8 apps) | /Sonstige |
| `ris_history` | Document change history | /History |
| `ris_verordnungen` | State ordinances (Tirol only) | /Landesrecht |

## ris_sonstige Applications

| App | Description | Special Parameters |
|-----|-------------|-------------------|
| `Mrp` | Council of Ministers protocols | einbringer, sitzungsnummer, gesetzgebungsperiode |
| `Erlaesse` | Ministerial decrees | bundesministerium, abteilung, fundstelle |
| `Upts` | Party transparency | partei (6 parties) |
| `KmGer` | Court announcements | kmger_typ, gericht |
| `Avsv` | Social insurance | dokumentart, urheber, avsvnummer |
| `Avn` | Veterinary notices | avnnummer, avn_typ |
| `Spg` | Health structure plans | spgnummer, osg_typ, rsg_typ |
| `PruefGewO` | Trade licensing exams | pruefgewo_typ |

## ris_history Applications (36)

Bundesnormen, Landesnormen, Justiz, Vfgh, Vwgh, Bvwg, Lvwg, BgblAuth, BgblAlt, BgblPdf, LgblAuth, Lgbl, LgblNO, Gemeinderecht, GemeinderechtAuth, Bvb, Vbl, RegV, Mrp, Erlaesse, PruefGewO, Avsv, Spg, KmGer, Dsk, Gbk, Dok, Pvak, Normenliste, AsylGH, Verg, Upts, Uvs, Ubas, Umse, Bks

The last six (Verg, Upts, Uvs, Ubas, Umse, Bks) are historical jurisdictions dissolved on 2014-01-01 whose change history is still tracked. Note `Upts` (Party Transparency Senate) is a `ris_sonstige` collection, not a Judikatur court.

## Document Prefixes (ris_dokument routing)

Source of truth: the `DOCUMENT_ROUTES` registry in `src/client.ts` (matched
longest-prefix-first, used for both direct-URL construction and the fallback
search). Judikatur IDs follow `J<court><R|T>` where `R` = Rechtssatz and
`T` = Entscheidungstext (both route to the same court).

| Prefix(es) | Document Type → routed Applikation |
|------------|------------------------------------|
| NOR | Federal law (Bundesnormen → BrKons) |
| BGBLA | Federal Law Gazette authentic (BgblAuth) |
| BGBL | Federal Law Gazette 1945–2003 (BgblAlt) |
| BGBLPDF | Federal Law Gazette PDF (BgblPdf) |
| REGV | Government bills (RegV) |
| LBG, LKT, LNO, LOO, LSB, LST, LTI, LVB, LWI | State laws, 9 states (LrKons) |
| VBL | State ordinance gazettes (Vbl) |
| JWR, JWT | Supreme Administrative Court (VwGH) |
| JFR, JFT | Constitutional Court (VfGH) |
| JJR, JJT | Ordinary courts (Justiz) |
| BVWG | Federal Administrative Court (Bvwg) |
| LVWG | State Administrative Courts (Lvwg) |
| DSB, PDK | Data Protection Authority (Dsk) |
| GBK | Equal Treatment Commission (Gbk) |
| PVAB | Personnel Representation Supervision (Pvak) |
| DKT | Disciplinary Commission (Dok) |
| ASYLGH | Asylum Court, historical (AsylGH) |
| NL | Court norm lists (Normenliste) |
| VERG, JUR, JUT, UBAS, UMSE, BKS | Historical jurisdictions dissolved 2014 (Verg, Uvs, Ubas, Umse, Bks) |
| MRP, ERL | Cabinet protocols (Mrp), ministerial decrees (Erlaesse) |
| PRUEF, AVSV, SPG, KMGER | Trade exams, social insurance, health plans, court announcements |
| BVB | District authorities (Bezirke/Bvb) |

Unknown prefixes fall back to a Justiz search.

## Files Overview (Deployment)

| File | Purpose |
|------|---------|
| `src/http.ts` | Express + Streamable HTTP entry point |
| `src/__tests__/http.test.ts` | HTTP transport tests |
| `Dockerfile` | Multi-stage build (node:22-alpine) |
| `.dockerignore` | Docker build excludes |
| `.github/workflows/release.yml` | CI/CD: release + Lightsail deploy |

## Documentation

- API Docs: `docs/Dokumentation_OGD-RIS_API.md` (Markdown) / `docs/Dokumentation_OGD-RIS_API.pdf`
- Deployment Spec: `specs/done/AWS_LIGHTSAIL_DEPLOYMENT.md` — local only, `specs/` is gitignored
- Decisions log: `DECISIONS.md` (Aktiv / Offen / Verworfen) — read it before changing anything structural
- RIS API v2.6: https://data.bka.gv.at/ris/api/v2.6/
