# Contributing to ris-mcp-ts

Thank you for your interest in contributing to the RIS MCP Server! This guide will help you get started.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20.19.0
- [pnpm](https://pnpm.io/)

## Getting Started

1. Fork the repository and clone your fork:

   ```bash
   git clone https://github.com/<your-username>/ris-mcp-ts.git
   cd ris-mcp-ts
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Build the project:

   ```bash
   pnpm run build
   ```

4. Verify everything works:

   ```bash
   pnpm run check
   ```

## Architecture Overview

The server is built on the [Model Context Protocol SDK](https://modelcontextprotocol.io/) and communicates via **stdio transport** — it reads JSON-RPC messages from stdin and writes responses to stdout.

```
src/
├── index.ts        # Entry point — creates stdio transport, starts server
├── server.ts       # MCP server init, registers all tools
├── client.ts       # HTTP client for the RIS API (fetch, error classes, SSRF protection)
├── types.ts        # Zod schemas + TypeScript types for API params/responses
├── parser.ts       # JSON parsing and response normalization
├── formatting.ts   # Output formatting (markdown/json) + character truncation
├── helpers.ts      # Shared helpers for tool handlers (param building, error formatting)
├── constants.ts    # Static mappings, enum values, config
└── tools/          # One file per tool — each exports a register function
    ├── index.ts    # registerAllTools() barrel
    ├── bundesrecht.ts
    ├── judikatur.ts
    └── ...
```

**Data flow:** MCP Client → `index.ts` (stdio) → `server.ts` (routing) → `tools/*.ts` (handler) → `client.ts` (HTTP) → RIS API

## Development Workflow

| Command | Description |
|---------|-------------|
| `pnpm run dev` | Start with hot reload (tsx) |
| `pnpm run build` | Compile TypeScript |
| `pnpm start` | Run compiled version |
| `pnpm run check` | Run typecheck + lint + format check + tests |
| `pnpm run inspect` | Test with MCP Inspector (see below) |

### Useful shortcuts

- **`pnpm run dev`** — Fastest way to test changes during development
- **`pnpm run check`** — Run this before committing to catch all issues at once

### MCP Inspector

The [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) is a web-based UI for testing MCP servers interactively:

```bash
pnpm run inspect
```

This opens a browser where you can:
- See all registered tools and their schemas
- Call tools with custom parameters and inspect responses
- Debug issues without needing a full MCP client

### Testing with MCP Clients

To test your local changes in a real client (Claude Desktop, VS Code, etc.), point the config to your local build instead of the published package:

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ris-dev": {
      "command": "node",
      "args": ["/absolute/path/to/ris-mcp-ts/dist/index.js"]
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add ris-dev -- node /absolute/path/to/ris-mcp-ts/dist/index.js
```

Run `pnpm run build` after each change (or use `pnpm run dev` in a separate terminal for hot reload during development).

## Code Conventions

### Language

- **Tool descriptions and error messages** are written in **German** (the target audience is Austrian legal professionals)
- Code, comments, and documentation are in **English**

### TypeScript / ESM

- The project uses **ES modules** (`"type": "module"` in package.json) — use `.js` extensions in imports (e.g., `import { ... } from './client.js'`)
- Use **`type` imports** for type-only imports (`import type { ... }`)
- No explicit `any` — use `unknown` and narrow types instead
- Prefix intentionally unused variables with `_` (e.g., `_unusedParam`)

### Formatting & Linting

This project uses **Prettier** for formatting and **ESLint** for linting. Pre-commit hooks via **Husky** and **lint-staged** run both automatically on staged files.

| Command | Description |
|---------|-------------|
| `pnpm run format` | Format all source files with Prettier |
| `pnpm run lint` | Run ESLint on source files |
| `pnpm run lint:fix` | Run ESLint with auto-fix |
| `pnpm run format:check` | Check formatting without modifying files |

You don't need to run these manually before committing — the pre-commit hook handles it. But they're useful if you want to fix issues across the codebase.

## Writing Tests

Tests use [Vitest](https://vitest.dev/) and are located in `src/__tests__/`.

| Command | Description |
|---------|-------------|
| `pnpm test` | Run all tests |
| `pnpm run test:watch` | Run tests in watch mode |
| `pnpm run test:coverage` | Run tests with coverage report |
| `pnpm run test:integration` | Run integration tests (requires network) |

### Guidelines

- Place test files in `src/__tests__/` with the naming pattern `*.test.ts`
- Co-locate tests with the module they cover (e.g., `client.test.ts` tests `client.ts`)
- Use descriptive test names that explain the expected behavior
- Mock external HTTP calls — avoid hitting the real RIS API in unit tests

## Adding a New Tool

The most common contribution is adding a new RIS tool. Each tool lives in its own file under `src/tools/` and follows a consistent pattern:

### 1. Create the tool file

Create `src/tools/<name>.ts` with this structure:

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { searchRIS } from '../client.js';
import {
  buildBaseParams,
  addOptionalParams,
  executeSearchTool,
  hasAnyParam,
  createValidationErrorResponse,
} from '../helpers.js';

export function register<Name>Tool(server: McpServer): void {
  server.tool(
    'ris_<name>',
    'German description of the tool',
    {
      // Zod schema for parameters
      suchworte: z.string().optional().describe('Volltextsuche'),
      titel: z.string().optional().describe('Suche im Titel'),
      // ... more params
    },
    async (params) => {
      // 1. Validate that at least one search param is provided
      if (!hasAnyParam(params, ['suchworte', 'titel'])) {
        return createValidationErrorResponse(['suchworte', 'titel']);
      }

      // 2. Build API request params
      const apiParams = buildBaseParams('ApplikationName', params);
      addOptionalParams(apiParams, params, ['suchworte', 'titel']);

      // 3. Execute search with standard error handling
      return executeSearchTool(apiParams, params.response_format);
    },
  );
}
```

### 2. Register in the barrel file

Add your tool to `src/tools/index.ts`:

```typescript
import { register<Name>Tool } from './<name>.js';

export function registerAllTools(server: McpServer): void {
  // ... existing tools
  register<Name>Tool(server);
}
```

### 3. Write tests

Create `src/__tests__/<name>.test.ts` — mock HTTP calls, don't hit the real API. See existing test files for examples.

### 4. Run checks

```bash
pnpm run check
```

## Submitting Changes

1. Create a feature branch from `main`:

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes and ensure all checks pass:

   ```bash
   pnpm run check
   ```

3. Commit your changes following [Conventional Commits](https://www.conventionalcommits.org/):

   ```bash
   git commit -m "feat: add new search parameter"
   git commit -m "fix: handle empty API response"
   ```

   Common prefixes: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `ci:`

4. Push to your fork and open a Pull Request against `main`.

### Pull Request guidelines

- Keep PRs focused on a single change
- Include a description of what changed and why
- Ensure all CI checks pass
- Add or update tests for new functionality

## Reporting Issues

Found a bug or have a feature request? Please [open an issue](../../issues) using one of the available templates:

- **Bug Report** — For reporting bugs with reproduction steps
- **Feature Request** — For suggesting new features or improvements

## Releasing (Maintainers)

Releases are automated via GitHub Actions with [OIDC trusted publishing](https://docs.npmjs.com/trusted-publishers/) — no npm tokens required. Direct pushes to `main` are blocked, so the version bump goes through a pull request like any other change, and the tag is set on the merged commit:

1. On a branch, bump `version` in `package.json` and both `version` fields in `server.json` (`.version` and `.packages[0].version`) to the new number. Do not use `pnpm version` — it would also create a local tag on the unmerged commit.
2. Commit as `chore(release): x.y.z (#<PRs since the last release>)`, open a PR, wait for CI, merge.
3. Tag the merged commit on `main` and push the tag:

   ```bash
   git fetch origin main
   git tag vx.y.z origin/main
   git push origin vx.y.z
   ```

The tag triggers the release workflow: `pnpm run check` and build, a GitHub Release with notes grouped by commit type, npm publish with provenance, the MCP Registry publish (below), the Docker image to ECR and the gateway deploy — which fails the run if the live `initialize` version does not match the tag. Roll back a deploy by running the "Deploy Gateway" workflow by hand with an existing image tag.

### MCP Registry

The `publish-registry` job in `release.yml` runs after `publish-npm` on every
`v*` tag: it writes the tag version into `server.json`, installs
`mcp-publisher`, runs `mcp-publisher login github-oidc` (`id-token: write`, no
secret) and publishes — with a short retry, because the registry validates the
package against npm, which can lag right behind a fresh publish. The
[MCP Registry](https://registry.modelcontextprotocol.io) entry is
`io.github.Honeyfield-Org/ris`, described by `server.json`. Nothing here is a
manual step per release; the version comes from the tag, so a forgotten
`server.json` bump is harmless.

What still has to match by hand: `name` in `server.json` must equal `mcpName`
in `package.json`, in that **exact spelling** — the registry grants the OIDC
namespace as GitHub spells the `repository_owner` claim
(`io.github.Honeyfield-Org/*`) and matches it with a case-sensitive prefix
check, so any other casing fails to publish.

The registry previously listed this server as `io.github.philrox/ris`
(personal namespace, last published by hand for 1.0.2 on 2026-02-09 — OIDC
from a workflow run only grants `io.github.<repository owner>/*`, so CI could
never have published that name). Server names are immutable, so that entry
isn't migrated — it stays and is deprecated once, by hand, from the `philrox`
account, after the first successful automated publish of the new name:

```bash
mcp-publisher login github   # device flow, as philrox
mcp-publisher status --status deprecated --all-versions --message "Moved to io.github.Honeyfield-Org/ris" io.github.philrox/ris
```

## Questions?

If you have questions about the codebase or need guidance on a contribution, feel free to open a discussion or reach out via an issue.
