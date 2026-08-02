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
pnpm test                # Server unit tests (886 tests, 18 files) — node env
pnpm run test:ui         # Widget tests under ui/ (287 tests, 9 files) — jsdom env
pnpm run test:watch      # Run tests in watch mode
pnpm run test:coverage   # Tests with V8 coverage report
pnpm run test:integration # Integration tests (separate config, requires network)
```

Two separate vitest projects, because the widget needs a DOM and the server must
not have one: `vitest.config.ts` (node, excludes `ui/**`) and
`vitest.ui.config.ts` (jsdom, only `ui/**/*.test.ts`). `pnpm run check` runs
both.

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

vite.ui.config.ts      # Widget build: one widget per pass, named by RIS_UI_WIDGET
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

1. The 11 search tools and `ris_dokument` register with `registerAppTool(server, name, { title, description, inputSchema, outputSchema, annotations, _meta }, handler)` from `@modelcontextprotocol/ext-apps/server` — same config object as `server.registerTool()` plus a `_meta` from `src/widgets.ts` that points the tool at its widget: `SEARCH_WIDGET_META` → Trefferliste, `VIEWER_WIDGET_META` → document viewer. `ris_dokument` still declares no `outputSchema` (see below); the wrapper only touches the descriptor. `ris_dokument_abschnitt` uses plain `server.registerTool()` because it sets no `resourceUri` — it feeds the viewer that is already open. The deprecated `server.tool(...)` overload is no longer used.
2. `title` is a German display name, `description`/`inputSchema` are English. `annotations` is `{ readOnlyHint: true, openWorldHint: true, destructiveHint: false }` on **all 12** tools — `destructiveHint` is spec-redundant once `readOnlyHint` is true, but OpenAI lists it as a required annotation for app submissions; do not drop it as noise.
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
document viewer. The mechanism, in the order it happens:

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

`ris_dokument` declares no `structuredContent` by design, so the viewer takes
the first of four rungs that yields content: **(1)** the text block of the
mounting result (up to 25 000 characters of markdown — the normal path, and it
costs no tool call); **(2)** the `dokumentnummer`/`url` from the `toolinput`
notification or `window.openai.toolInput`, followed by one
`ris_dokument_abschnitt` call at offset 0; **(3)** this widget's own snapshot,
which stores structure and a reading position but never text; **(4)** a German
notice. There is no host-global stale-data path — the chat keeps the complete
text and the `resource_link` in every rung.

Further sections load through `ris_dokument_abschnitt` as the reader scrolls:
one call in flight at a time, an `IntersectionObserver` rooted on the text pane
with a 600px prefetch margin, paused while the tab is hidden. The viewer is the
one widget that sets a height (from `hostContext.containerDimensions`, 640px
fallback) and scrolls internally — without a real scroll container every
sentinel intersects at once and lazy loading fetches the whole document.

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

The viewer's behaviour in both hosts is **not yet measured** — see the open
questions in `.superpowers/sdd/v150-plan/v150-design-widget.md` §9, above all
whether `toolinput` fires at all and what `containerDimensions` each host sends.

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
`ris_dokument` deliberately declares no `outputSchema`: clients may treat the
text block as a mere serialization of `structuredContent` and render only the
latter, which once made the document text disappear (v1.3.0 live finding, see
DECISIONS.md). `ris_dokument_abschnitt` *does* declare one, because there the
chunk text is itself part of `structuredContent` — a client that renders only
the structured payload loses nothing.

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
