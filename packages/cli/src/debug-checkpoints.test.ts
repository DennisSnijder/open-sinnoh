import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import * as key from '../../../tests/integration/anchor-key.ts';
import { checkpointEntries, readCheckpoint } from '../../../tools/dev-checkpoints.ts';

it('serves the chain anchor the ROM tests cache under its key, and fails loudly on a missing one', () => {
  const root = mkdtempSync(join(tmpdir(), 'opensinnoh-debug-'));
  try {
    expect(checkpointEntries(root, key).every((e) => !e.cached)).toBe(true);
    expect(() => readCheckpoint(root, key, 'cp4.replay:1')).toThrow(/no ROM test cache/);
    const dir = join(root, '.opensinnoh-cache/tests/rom-key');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'key.json'), '{}');
    // A stale anchor (another engine hash) is not the current one.
    mkdirSync(join(dir, 'anchors'));
    writeFileSync(join(dir, 'anchors', 'cp4-s1-0000000000000000.json'), '{"stale":true}');
    expect(() => readCheckpoint(root, key, 'cp4.replay:1')).toThrow(/no cached anchor for cp4.replay seed 1/);
    const file = key.anchorFile(dir, 'cp4.replay', 1);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '{"fixture":true}');
    expect(checkpointEntries(root, key).filter((e) => e.cached).map((e) => e.id)).toEqual(['cp4.replay:1']);
    expect(readCheckpoint(root, key, 'cp4.replay:1')).toBe('{"fixture":true}');
    expect(() => readCheckpoint(root, key, 'cp4.replay:2')).toThrow(/no cached anchor/);
    for (const id of ['../../package.json', 'cp4.replay:9', 'cp1.replay:1']) expect(() => readCheckpoint(root, key, id)).toThrow(/unknown checkpoint/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
