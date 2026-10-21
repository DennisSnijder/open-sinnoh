/**
 * Prints trainers' parties (species, level, moves, item) from the ROM import: for planning a story replay's
 * level targets. Needs the ROM (OPENSINNOH_NDS_ROM; the test cache's slice import).
 *
 *   OPENSINNOH_NDS_ROM=… pnpm tsx tools/replays/trainer.ts TRAINER_LEADER_GARDENIA TRAINER_COMMANDER_JUPITER_TEAM_GALACTIC_ETERNA_BUILDING
 */
import { CountingStubLog, createGame } from '@opensinnoh/game';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { prepareRomCache, romSlice } from '../../tests/rom.ts';

await prepareRomCache();
const { registries } = createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, seed: 1, log: new CountingStubLog(() => {}) });
const short = (id: string) => id.slice(id.indexOf(':') + 1).replace(/^(SPECIES|MOVE|ITEM)_/, '');
for (const name of process.argv.slice(2)) {
  const t = registries.trainers.get(`platinum:${name}`);
  if (!t) {
    console.log(`${name}: no such trainer`);
    continue;
  }
  console.log(`${name} (${t.items.map(short).join(', ') || 'no items'}):`);
  for (const m of t.party) console.log(`  ${short(m.species)} L${m.level}${m.item ? ` @${short(m.item)}` : ''}${m.moves ? ` ${m.moves.map(short).join(' ')}` : ''}`);
}
