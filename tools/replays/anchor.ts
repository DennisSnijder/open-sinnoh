/**
 * Builds (or reads from the cache) the chain anchor at the end of a replay, for each given seed: the save the
 * checkpoint tests and session.ts start the next replay from. Needs the ROM (OPENSINNOH_NDS_ROM).
 *
 *   OPENSINNOH_NDS_ROM=… pnpm tsx tools/replays/anchor.ts cp19.replay [--seed 1] [--seed 2]
 */
import { prepareRomCache } from '../../tests/rom.ts';
import { anchorPath, chainAnchor } from '../../tests/integration/checkpoints-anchors.ts';

const args = process.argv.slice(2);
const file = args.find((a) => /\.replay$/.test(a));
const seeds = args.flatMap((a, i) => (args[i - 1] === '--seed' ? [Number(a)] : []));
if (!file || !process.env.OPENSINNOH_NDS_ROM) throw new Error('usage: OPENSINNOH_NDS_ROM=<rom> tsx tools/replays/anchor.ts <file.replay> [--seed N]…');
await prepareRomCache();
for (const seed of seeds.length ? seeds : [1]) {
  const t0 = Date.now();
  await chainAnchor(file, seed);
  console.log(`${file} seed ${seed}: ${anchorPath(file, seed)} (${Date.now() - t0} ms)`);
}
