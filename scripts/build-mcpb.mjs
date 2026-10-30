#!/usr/bin/env node
/**
 * Builds the Claude Desktop extension: `ris-mcp-<version>.mcpb` in the repo root.
 *
 * An .mcpb is a zip of the compiled server, its production dependencies and a
 * manifest, which Claude Desktop installs with a double click. Run
 * `pnpm run build` first — this script packages `dist/`, it does not compile.
 *
 * Staging happens in `.mcpb-build/`: a flat (`hoisted`) production install, so
 * the archive holds real files instead of pnpm's symlinks, which would not
 * survive zipping. The manifest is `mcpb/manifest.json` with the version taken
 * from package.json, so the two cannot drift apart.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pinned: the packer defines what "valid" means, so a new release must not
// change the result of an unchanged commit.
const MCPB_CLI = '@anthropic-ai/mcpb@2.1.2';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const stage = join(root, '.mcpb-build');
const output = join(root, `ris-mcp-${pkg.version}.mcpb`);

function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

if (!existsSync(join(root, 'dist', 'index.js'))) {
  console.error('dist/index.js fehlt — zuerst `pnpm run build` ausführen.');
  process.exit(1);
}

rmSync(stage, { recursive: true, force: true });
rmSync(output, { force: true });
mkdirSync(stage);

// Only what runs: no tests, type declarations or source maps.
cpSync(join(root, 'dist'), join(stage, 'dist'), {
  recursive: true,
  filter: (source) =>
    !source.includes(`${join('dist', '__tests__')}`) &&
    !source.endsWith('.d.ts') &&
    !source.endsWith('.map'),
});

for (const file of ['package.json', 'pnpm-lock.yaml', 'LICENSE']) {
  cpSync(join(root, file), join(stage, file));
}
run(
  'pnpm',
  ['install', '--prod', '--frozen-lockfile', '--ignore-scripts', '--config.node-linker=hoisted'],
  stage,
);

const manifest = JSON.parse(readFileSync(join(root, 'mcpb', 'manifest.json'), 'utf8'));
manifest.version = pkg.version;
writeFileSync(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
cpSync(join(root, 'mcpb', 'icon.png'), join(stage, 'icon.png'));

run('pnpm', ['dlx', MCPB_CLI, 'validate', join(stage, 'manifest.json')]);
run('pnpm', ['dlx', MCPB_CLI, 'pack', stage, output]);

console.log(`\nFertig: ${output}`);
