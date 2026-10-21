import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { sourceKey } from '../tests/source-key.ts';
import { headlessSourceKey } from '../tests/integration/anchor-key.ts';

const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'opensinnoh-source-key-'));
  temporary.push(repo);
  const write = (file: string, content: string) => {
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    writeFileSync(join(repo, file), content);
  };
  write('packages/game/package.json', JSON.stringify({ dependencies: { '@opensinnoh/core': 'workspace:*', sim: '1' } }));
  write('packages/core/package.json', '{}');
  write('packages/game/src/index.ts', 'original game');
  write('packages/core/src/index.ts', 'original core');
  write('packages/core/data/table.json', '[1,2]');
  write('tests/harness.ts', 'original harness');
  write('pnpm-lock.yaml', 'original dependencies');
  for (const pkg of ['battle', 'menus', 'vm', 'world']) {
    write(`packages/${pkg}/package.json`, '{}');
    write(`packages/${pkg}/src/index.ts`, `original ${pkg}`);
  }
  for (const file of ['checkpoints-anchors', 'anchor-key']) write(`tests/integration/${file}.ts`, `original ${file}`);
  write('tests/source-key.ts', 'original source key');
  const key = () => sourceKey(repo, ['game'], ['tests/harness.ts']);
  return { repo, write, key };
}

it('reuses a headless key after UI, renderer and test-only edits', () => {
  const f = fixture();
  const before = f.key();
  for (const path of ['packages/app/src/index.ts', 'packages/render/src/index.ts', 'packages/game/src/game.test.ts']) f.write(path, 'changed');
  expect(f.key()).toBe(before);
  f.write('packages/core/src/index.ts', 'modified core');
  expect(f.key()).not.toBe(before);
});

it.each(['packages/game/src/index.ts', 'packages/core/data/table.json', 'tests/harness.ts', 'pnpm-lock.yaml'])('invalidates on changes to %s, even with the same byte length', (path) => {
  const f = fixture();
  const before = f.key();
  f.write(path, path.endsWith('.json') ? '[3,4]' : path.includes('lock') ? 'modified dependencies' : path.includes('harness') ? 'modified harness' : 'modified game');
  expect(f.key()).not.toBe(before);
});

it('follows newly declared workspace dependencies and hashes their manifests and sources', () => {
  const f = fixture();
  const before = f.key();
  f.write('packages/core/package.json', JSON.stringify({ dependencies: { '@opensinnoh/audio': 'workspace:*' } }));
  f.write('packages/audio/package.json', '{}');
  f.write('packages/audio/src/index.ts', 'original audio');
  const added = f.key();
  expect(added).not.toBe(before);
  f.write('packages/audio/src/index.ts', 'modified audio');
  expect(f.key()).not.toBe(added);
});

it('the actual anchor key includes the harness and each headless package, while UI edits keep it warm', () => {
  const f = fixture();
  let before = headlessSourceKey(f.repo);
  f.write('packages/app/src/main.ts', 'changed UI');
  f.write('packages/render/src/index.ts', 'changed renderer');
  expect(headlessSourceKey(f.repo)).toBe(before);
  for (const path of ['packages/battle/src/index.ts', 'packages/menus/src/index.ts', 'packages/vm/src/index.ts', 'packages/world/src/index.ts', 'tests/integration/checkpoints-anchors.ts']) {
    f.write(path, 'changed');
    const after = headlessSourceKey(f.repo);
    expect(after, path).not.toBe(before);
    before = after;
  }
});
