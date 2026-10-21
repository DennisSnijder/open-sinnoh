/**
 * Plays a replay headless once and prints where it ended: for writing a story replay line by line.
 * Needs the ROM (OPENSINNOH_NDS_ROM); uses the test cache (tests/rom.ts) and, with `--anchor`, the chain
 * anchor of the replay's `from` prefix (tests/integration/checkpoints-anchors.ts), so the story before it
 * is not played again. Prints the game's state, never ROM text beyond the open message.
 *
 *   OPENSINNOH_NDS_ROM=… pnpm tsx tools/replays/explore.ts tests/rom-replays/cp5.replay [--seed 2] [--anchor] [--map 9] [--trace] [--watch <movementType> <ticks>]
 *
 * The end (or the failing line): tick, player, script, message, battle prompt, party, the battle log of
 * this run, and the tiles around the player (`map.ts` legend; `P` the player, `o` a live object, its local
 * id last digit). `--trace` prints the position before every timed line; `--watch` ticks on after the end and
 * prints each move of the object with that movement type (a walker's pattern, to time a crossing).
 * `--to <x> <z>` prints replay lines for a shortest walk from the end to that tile (collision, directional
 * walls, ledges, water, live objects and coord triggers on the way avoided; height steps and trainer sight
 * are not checked: play it to see).
 */
import { basename } from 'node:path';
import type { Matrix } from '@opensinnoh/contracts';
import { gameDriver, runReplay } from '@opensinnoh/game';
import { MapGrid } from '../../packages/world/src/tiles.ts';
import { walkLines } from './path.ts';
import { prepareRomCache } from '../../tests/rom.ts';
import { anchoredDriver, anchoredText, chainAnchor, readReplay, storyGame } from '../../tests/integration/checkpoints-anchors.ts';
import { parseReplay } from '@opensinnoh/core';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && /\.replay$/.test(a));
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
};
const seed = Number(opt('seed') ?? 1);
const radius = Number(opt('map') ?? 8);
if (!file || !process.env.OPENSINNOH_NDS_ROM) {
  console.error('usage: OPENSINNOH_NDS_ROM=<rom> tsx tools/replays/explore.ts <file.replay> [--seed N] [--anchor] [--map R] [--trace]');
  process.exit(2);
}
await prepareRomCache();
const name = basename(file);
const game = storyGame(seed);
let driver = gameDriver(game);
let text = readReplay(name);
if (args.includes('--anchor')) {
  const prefix = parseReplay(text).from!.file;
  const t0 = Date.now();
  driver = anchoredDriver(driver, await chainAnchor(prefix, seed));
  text = anchoredText(name, prefix);
  console.log(`anchor ${prefix} seed ${seed}: ${Date.now() - t0} ms`);
}
const t0 = Date.now();
const result = await runReplay(driver, text, {
  registries: game.registries,
  seed,
  name,
  repeat: false,
  resolve: (f) => ({ name: f, text: readReplay(f) }),
  beforeLine: args.includes('--trace')
    ? (line, tick) => {
        const p = game.state.player;
        console.log(`${String(line.line).padStart(4)} t${tick} ${p.zone.replace('platinum:MAP_HEADER_', '')} ${p.x},${p.z} ${p.facing}`);
      }
    : undefined,
});
console.log(`${result.ok ? 'OK' : 'FAILED'} in ${Date.now() - t0} ms: ${result.ticks} ticks, ${result.assertions} asserts`);
if (result.error) console.log(result.error);

// `--watch <movementType>|id:<localId> <ticks>`: tick on idle and print where that object goes (a wanderer's pattern).
const watch = opt('watch');
if (watch) {
  let last = '';
  for (let t = 0; t < Number(args[args.indexOf('--watch') + 2]); t++) {
    game.tick();
    const o = game.state.objects.find((x) => (watch.startsWith('id:') ? x.localId === Number(watch.slice(3)) : x.movementType === Number(watch)));
    const now = o ? `${o.x},${o.z} ${o.facing}` : 'gone';
    if (now !== last) console.log(`+${t} ${now}`);
    last = now;
  }
}
// The running script and where each context stands (the VM's own fields, for debugging a stuck wait).
const thread = (game.scripts as unknown as { thread?: { label: string; contexts: ({ label: string; pc: number } | null)[] } }).thread;
if (thread) console.log(`thread ${thread.label}: ${thread.contexts.map((c) => c && `${c.label}@${c.pc}`).join(', ')}`);
const s = game.state;
const v = game.scripts.view();
console.log(`app ${game.app()?.app ?? 'none'}; inBattle ${game.inBattle()}; popup ${JSON.stringify(game.mapPopup())}; blackout ${JSON.stringify(game.blackOutScreen())}`);
console.log(`player ${s.player.zone} ${s.player.x},${s.player.z} facing ${s.player.facing}; script ${game.scripts.running() ? 'running' : 'idle'}; canSave ${game.canSave()}`);
if (v.message) console.log(`message ${JSON.stringify(v.message)}`);
if (v.yesNo) console.log('yes/no');
if (v.menu) console.log(`menu: ${JSON.stringify(v.menu)}`);
const battle = game.battle?.view();
if (battle) console.log(`battle ${battle.kind} ${battle.topology}: prompt ${battle.prompt?.kind ?? 'none'}; ${JSON.stringify(battle.message?.text ?? '')}`);
for (const p of s.party) console.log(`party ${p.species} L${p.level} ${p.hp}/${p.stats.hp} exp ${p.exp} ${p.moves.join(' ')}`);
console.log(`money ${s.money}; balls ${JSON.stringify(s.bag['Balls'] ?? s.bag['balls'] ?? Object.keys(s.bag))}`);
for (const b of game.battles) console.log(`battle t${b.tick} ${b.kind} ${b.trainers.join('+')}${b.species.join('+')} ${b.result} ${b.topology}`);

const zone = game.registries.zones.get(s.player.zone)!;
const grid = new MapGrid(game.registries, game.registries.matrices.get(zone.matrix) as Matrix);
console.log(`tile ${grid.behaviour(s.player.x, s.player.z)}; ahead ${grid.behaviour(s.player.x + (s.player.facing === 'right' ? 1 : s.player.facing === 'left' ? -1 : 0), s.player.z + (s.player.facing === 'down' ? 1 : s.player.facing === 'up' ? -1 : 0))}`);
const zones = [...game.registries.zones.values()].filter((z) => z.matrix === zone.matrix);
const mark = new Map<string, string>();
const key = (x: number, z: number) => `${x},${z}`;
for (const z of zones) {
  for (const w of z.events.warps) mark.set(key(w.x, w.z), 'w');
  for (const c of z.events.coords) for (let dx = 0; dx < c.width; dx++) for (let dz = 0; dz < c.length; dz++) mark.set(key(c.x + dx, c.z + dz), 'c');
}
for (const o of s.objects) mark.set(key(o.x, o.z), String(o.localId % 10));
mark.set(key(s.player.x, s.player.z), 'P');
const [x0, x1, z0, z1] = [s.player.x - radius * 2, s.player.x + radius * 2, s.player.z - radius, s.player.z + radius];
for (let d = 2; d >= 0; d--) {
  let row = '     ';
  for (let x = x0; x <= x1; x++) row += String(x).padStart(3)[2 - d];
  console.log(row);
}
for (let z = z0; z <= z1; z++) {
  let row = `${String(z).padStart(4)} `;
  for (let x = x0; x <= x1; x++) row += mark.get(key(x, z)) ?? (grid.blocked(x, z) ? '#' : '.');
  console.log(row);
}
const events = zones.flatMap((z) => z.events.objects);
for (const o of s.objects) {
  const e = events.find((ev) => ev.localId === o.localId && o.zone === zones.find((z) => z.events.objects.includes(ev))?.id);
  console.log(`obj ${o.zone.replace("platinum:MAP_HEADER_", "")}#${o.localId} @${o.x},${o.z} ${o.facing} type ${o.movementType} ${e?.label ?? ''}${e?.trainer ? ` trainer ${e.trainer.id} sight ${e.data[0]}` : ''}`);
}


// `--to <x> <z>`: replay lines for a cheapest walk from the end to that tile (path.ts).
const to = opt('to');
if (to) for (const l of walkLines(game, grid, zones, Number(to), Number(args[args.indexOf('--to') + 2]))) console.log(l);

// `--probe <x> <z> [--probe-r R]`: the tiles within R (default 2) of (x, z) as a grid of heights (rounded
// tens: 3 = 32, 6 = 64), `#` blocked, `b` bridge, `/` a ledge or slope, `*` an object (why a step fails).
const probe = opt('probe');
if (probe) {
  const [px, pz] = [Number(probe), Number(args[args.indexOf('--probe') + 2])];
  const r = Number(opt('probe-r') ?? 2);
  console.log(`probe ${px},${pz} (heights from y ${s.player.y})`);
  for (let z = pz - r; z <= pz + r; z++) {
    let row = `probe ${String(z).padStart(4)} `;
    for (let x = px - r; x <= px + r; x++) {
      const b = grid.behaviour(x, z);
      row += grid.blocked(x, z) ? '#' : s.objects.some((o) => o.x === x && o.z === z) ? '*' : b.startsWith('BRIDGE') ? 'b' : /^(JUMP|BIKE_SLOPE)/.test(b) ? '/' : String(Math.round(grid.heightAt(x * 16 + 8, z * 16 + 8, s.player.y) / 10) % 10);
    }
    console.log(row);
  }
}
