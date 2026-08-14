#!/usr/bin/env node
/**
 * Fail if the browser entry graphs pull Node-only deps (Phase 7 / BACKLOG 6.2).
 *
 *   yarn test:browser-bundle
 */
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const FORBIDDEN = [
  { id: 'level', pattern: /(?:^|\/)(?:level|classic-level|abstract-level)(?:\/|$)/u },
  { id: '@libp2p/tcp', pattern: /@libp2p\/tcp(?:\/|$)/u },
  { id: '@libp2p/mdns', pattern: /@libp2p\/mdns(?:\/|$)/u },
  { id: 'LevelDbReplicaStore', pattern: /LevelDbReplicaStore/u },
  { id: 'createNodePlatformStack', pattern: /createNodePlatformStack/u },
  { id: 'node:fs', pattern: /(?:^|\/)node:fs(?:\/|$)|(?:^|\/)fs\/promises(?:\.js)?$/u },
  { id: 'node:crypto', pattern: /(?:^|\/)node:crypto(?:\/|$)|(?:^|\/)crypto\/(?:createHash|webcrypto)/u },
];

const entries = [
  { name: '@dechat/core/browser', path: join(repoRoot, 'packages/core/browser.ts') },
  { name: '@dechat/chat/browser', path: join(repoRoot, 'packages/chat/browser.ts') },
];

const matchesForbidden = (inputPath) => {
  const normalized = inputPath.replaceAll('\\', '/');
  for (const rule of FORBIDDEN) {
    if (rule.pattern.test(normalized)) return rule.id;
  }
  return undefined;
};

const checkEntry = async (name, entryPath) => {
  const result = await build({
    absWorkingDir: repoRoot,
    entryPoints: [entryPath],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    conditions: ['browser', 'development', 'import'],
    mainFields: ['browser', 'module', 'main'],
    metafile: true,
    logLevel: 'silent',
    // Keep Node builtins external so a leak shows up as an import instead of a failed build.
    external: ['node:fs', 'node:crypto', 'fs', 'crypto', 'path', 'os', 'stream', 'net', 'tls', 'dgram'],
  });

  const inputs = Object.keys(result.metafile?.inputs ?? {});
  const leaks = [];
  for (const input of inputs) {
    const id = matchesForbidden(input);
    if (id) leaks.push(`${id} ← ${input}`);
  }

  const outputs = Object.values(result.metafile?.outputs ?? {});
  for (const output of outputs) {
    for (const item of output.imports ?? []) {
      const id = matchesForbidden(item.path);
      if (id) leaks.push(`${id} ← import ${item.path}`);
    }
  }

  if (leaks.length > 0) {
    throw new Error(`Browser bundle guard failed for ${name}:\n${leaks.map((row) => `  - ${row}`).join('\n')}`);
  }

  console.log(`ok  ${name} (${inputs.length} inputs)`);
};

const main = async () => {
  for (const entry of entries) {
    await checkEntry(entry.name, entry.path);
  }
};

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
