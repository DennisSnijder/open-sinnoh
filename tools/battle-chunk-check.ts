/**
 * Builds the battle chunk as the app does (vite.config.ts trims @pkmn/sim) and plays a fixture wild battle
 * with the built bundle in Node, so the trimmed sim is proven to battle, not only to build:
 *
 *   pnpm tsx tools/battle-chunk-check.ts
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { createPokemon, readPackFolder, type Id } from '@opensinnoh/core';
import { dexOf, type CreateBattle } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import config from '../vite.config.ts';

// Inside packages/battle, so the bundle's external @opensinnoh/* imports resolve as the package's own do.
const cache = resolve(import.meta.dirname, '../packages/battle/node_modules');
const out = mkdtempSync(join(cache, '.opensinnoh-battle-chunk-'));
process.on('exit', () => rmSync(out, { recursive: true, force: true }));
await build({
  configFile: false,
  plugins: (config as { plugins: never[] }).plugins,
  logLevel: 'warn',
  build: { outDir: out, minify: true, lib: { entry: 'packages/battle/src/index.ts', formats: ['es'], fileName: 'battle' }, rolldownOptions: { external: [/^@opensinnoh\//] } },
});
const file = readdirSync(out).find((f) => f.endsWith('.js'))!;
console.log(`built ${file}: ${(readFileSync(join(out, file)).length / 1024).toFixed(0)} KB`);
const { createBattle } = (await import(pathToFileURL(join(out, file)).href)) as { createBattle: CreateBattle };

const read = (p: string) => {
  try {
    return readFileSync(join('packs/fixture', p), 'utf8');
  } catch {
    return undefined;
  }
};
const registries = loadGamePacks([readPackFolder(read, 'packs/fixture')]).registries;
const dex = dexOf(registries);
const f = (n: string) => `fixture:${n}` as Id;
const lead = createPokemon(dex, { species: f('SPECIES_MOSSLET'), level: 8, pid: 1, ivs: 15, otId: 1, otName: 'A', otGender: 'male', ball: f('ITEM_POKE_BALL') });
const battle = createBattle(
  { kind: 'wild', trainers: [], wild: [{ species: f('SPECIES_SKYLET'), level: 3 }], background: null, terrain: null, time: 'day' },
  { registries, party: [lead], bag: {}, pc: { current: { box: 0, name: 'A' }, free: null, metBebe: false }, met: { zone: null, date: null }, player: { name: 'A', gender: 'male', trainerId: 1, rival: 'B' }, money: 0, badges: 0, caught: [], seed: 5, textSpeed: 4, log: new CountingStubLog(() => {}) },
);
for (let t = 0; t < 20000 && !battle.done(); t++) {
  if (battle.view().prompt) battle.choose({ kind: 'move', slot: 0 });
  battle.step({ held: [], pressed: [], touch: null });
}
const result = battle.done();
if (!result || result.outcome !== 'won') throw new Error(`the trimmed bundle's battle did not end in a win: ${JSON.stringify(result?.outcome)}`);
console.log(`trimmed bundle: won in ${result.turns} turns`);
