import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPackFolder } from '@opensinnoh/core';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import { warmBattleEngine } from './warm.ts';

const root = join(import.meta.dirname, '../../../../packs/fixture');
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined);

describe('warmBattleEngine', () => {
  it('plays one throwaway turn on the packs’ dex', () => {
    const { registries } = loadGamePacks([readPackFolder(read, 'packs/fixture')]);
    expect(() => warmBattleEngine(registries, new CountingStubLog())).not.toThrow();
  });
});
