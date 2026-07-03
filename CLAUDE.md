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
pnpm start               # Run compiled version (stdio)
pnpm run start:http      # Run HTTP server (Streamable HTTP transport)
pnpm run check           # Run typecheck + lint + format:check + tests
```

## Testing

```bash
pnpm test                # Run all unit tests (744 tests, 10 files)
pnpm run test:watch      # Run tests in watch mode
pnpm run test:coverage   # Tests with V8 coverage report
pnpm run test:integration # Integration tests (separate config, requires network)
```

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
├── formatting.ts      # Output formatting (markdown/json), character truncation
├── helpers.ts         # Shared helper functions for tool handlers
├── constants.ts       # Static mappings, enum values, configuration
├── version.ts         # Shared VERSION constant (read from package.json)
├── tools/
│   ├── index.ts       # registerAllTools() barrel file
│   ├── bundesrecht.ts
│   ├── landesrecht.ts
│   ├── judikatur.ts
│   ├── bundesgesetzblatt.ts
│   ├── landesgesetzblatt.ts
│   ├── regierungsvorlagen.ts
│   ├── dokument.ts    # Full document retrieval (largest handler)
│   ├── bezirke.ts
│   ├── gemeinden.ts
│   ├── sonstige.ts    # 8 sub-applications (second largest)
│   ├── history.ts
│   └── verordnungen.ts
└── __tests__/
    ├── client.test.ts
    ├── document-matching.test.ts
    ├── http.test.ts
    ├── edge-cases.test.ts
    ├── formatting.test.ts
    ├── history.test.ts
    ├── parser.test.ts
    ├── security.e2e.test.ts
    ├── server.test.ts
    ├── types.test.ts
    └── integration/
        └── smoke.test.ts
```

## Key Patterns

### Adding/Modifying a Tool Handler

Each tool lives in `src/tools/<name>.ts` and exports a `register<Name>Tool(server)` function. Pattern:

1. Register with `server.registerTool(name, { title, description, inputSchema, annotations }, handler)` — `title` is a German display name, `description`/`inputSchema` are English, `annotations` is `{ readOnlyHint: true, openWorldHint: true }` for these read-only tools. (The deprecated `server.tool(...)` overload is no longer used.)
2. For `limit`/`seite`, reuse `LimitSchema`/`SeiteSchema` from `types.ts` instead of raw `z.number()`
3. Use `helpers.ts` functions: `hasAnyParam()`, `buildBaseParams()`, `addOptionalParams()`, `executeSearchTool()`
4. Call client search functions from `client.ts`
5. Register in `src/tools/index.ts` if adding a new tool

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
- **Character limit**: 25,000 characters (formatting.ts `CHARACTER_LIMIT`)
- **Pagination**: 10/20/50/100 documents per page (mapped via `limitToDokumenteProSeite()` in types.ts)
- **Allowed document hosts**: `data.bka.gv.at`, `www.ris.bka.gv.at`, `ris.bka.gv.at` (SSRF protection in client.ts)

### Conventions

- **Language**: User-facing error messages are in **German**; tool descriptions and parameter `.describe()` text are in **English** (existing convention). Tool `title` (display name via `registerTool`) is German.
- **Imports**: Enforced order — builtin > external > internal > parent > sibling > index (alphabetized)
- **Types**: Use `type` imports (`import type { ... }`), no explicit `any`
- **Unused vars**: Must be prefixed with `_`
- **ESM**: Project uses ES modules (`"type": "module"` in package.json, `.js` extensions in imports)

## CI/CD

GitHub Actions runs on push/PR to main:
- **CI**: Matrix test (Node 20, 22) → `pnpm run check` + coverage
- **Release**: Tag push (`v*`) → check + build + GitHub Release + pnpm publish + **Lightsail deploy**
- **CodeQL**: Weekly security scanning

### Deployment Flow

```
feature branch → PR → merge to main → git tag v1.x.x → push tag → CI auto-deploys
```

No manual deployment needed. The release workflow handles: pnpm publish → Docker build → Lightsail push → deployment creation.

## Hosting (AWS Lightsail)

The service runs on AWS Lightsail but is reached through the public
`mcp.honeyfield.at` gateway (the direct `*.amazonlightsail.com` URL is retired).

| Property | Value |
|----------|-------|
| **Platform** | AWS Lightsail Container Service |
| **Transport** | Streamable HTTP (MCP Spec v2025-03-26) |
| **Region** | eu-central-1 |
| **Power** | Nano (0.25 vCPU, 512 MB RAM) |
| **Port** | 3000 |
| **Public MCP Endpoint** | `POST https://mcp.honeyfield.at/ris/mcp` (container route: `POST /mcp`) |
| **Public Health Check** | `GET https://mcp.honeyfield.at/ris/health` (container route: `GET /health`) |

### Architecture: Two Transports

- **stdio** (`src/index.ts`): Singleton McpServer, used by local MCP clients (Claude Desktop local, Claude Code)
- **HTTP** (`src/http.ts`): Per-session McpServer instances, Express + StreamableHTTPServerTransport. Session map stores active transports, cleanup via `transport.onclose`.

### Key Decisions

- `express.json()` parses body → must pass `req.body` as 3rd arg to `transport.handleRequest()`
- `sessionIdGenerator: () => crypto.randomUUID()` for stateful sessions
- `sessions.set()` called AFTER `handleRequest()` (SDK generates sessionId during initialize)
- Dockerfile uses `HUSKY=0` env + `--frozen-lockfile` for production pnpm install

## MCP Tools (12)

Each tool is registered via `server.registerTool()` with a German `title`, an
English `description`/schema, and `annotations: { readOnlyHint, openWorldHint }`
(all 12 are read-only against an external API). Numeric `limit`/`seite` params
are validated by the shared `LimitSchema` (10/20/50/100) and `SeiteSchema` (≥1).

| Tool | Description | API Endpoint |
|------|-------------|--------------|
| `ris_bundesrecht` | Federal laws (ABGB, StGB, etc.); filters: `paragraph` + `abschnitt_typ`, `fassung_vom`. `applikation="Erv"` = English translations (uses `SearchTerms`/`Title`, no Abschnitt/Fassung) | /Bundesrecht |
| `ris_landesrecht` | State/provincial laws; filters: `paragraph`/`abschnitt_typ`, `fassung_vom`, `gesetzesnummer` | /Landesrecht |
| `ris_judikatur` | Court decisions (16 court types, chosen via `gerichtsbarkeit`); filters: `dokumenttyp`, `gericht`, `rechtsgebiet`, `fachgebiet`, `entscheidungsart`, `sammlungsnummer`, `sortierung` | /Judikatur |
| `ris_bundesgesetzblatt` | Federal Law Gazettes | /Bundesrecht |
| `ris_landesgesetzblatt` | State Law Gazettes | /Landesrecht |
| `ris_regierungsvorlagen` | Government Bills | /Sonstige |
| `ris_dokument` | Full document text | Direct URL + fallback |
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
| `src/__tests__/http.test.ts` | HTTP transport tests (9 tests) |
| `Dockerfile` | Multi-stage build (node:22-alpine) |
| `.dockerignore` | Docker build excludes |
| `.github/workflows/release.yml` | CI/CD: release + Lightsail deploy |

## Documentation

- API Docs: `docs/Dokumentation_OGD-RIS_API.md` (Markdown) / `docs/Dokumentation_OGD-RIS_API.pdf`
- Deployment Spec: `specs/AWS_LIGHTSAIL_DEPLOYMENT.md`
- RIS API v2.6: https://data.bka.gv.at/ris/api/v2.6/
