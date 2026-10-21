/**
 * A breadth-first search over the engine's own movement steps, for routing the Distortion World (where the map
 * grid of path.ts sees only walls: the rooms walk supports, walls and ceilings). Needs the ROM (OPENSINNOH_NDS_ROM).
 *
 *   OPENSINNOH_NDS_ROM=… pnpm tsx tools/replays/dw-search.ts <file.replay> [--seed 1] [--anchor] --to <x> <z> [--zone B4F] [--y <tile>]
 *   OPENSINNOH_NDS_ROM=… pnpm tsx tools/replays/dw-search.ts <file.replay> [--anchor] --list [--zone B4F]
 *
 * It plays the replay to its end, then searches from there. A node is the game saved at rest; an edge is one
 * step the game takes for an input, played by the game itself: a direction held until the player's tile,
 * height or zone changes, then released and the field left to rest (walks, turns onto walls, jumps, double
 * jumps, elevator rides, cascades, ghost triggers and boulder pushes all happen as the game plays them), or
 * Surf (A, the text advanced, YES, the text advanced) where the player faces water, from the land, a wall or the ceiling. Nodes are
 * told apart by the zone, tile, height, facing, avatar state, the Distortion World slot (support, elevator and
 * puzzle flags, platforms) and the live objects' tiles.
 *
 * `--to` prints the replay lines of a fewest-steps route to the tile (the zone and height tile, if given, must
 * match); `--list` prints every tile reached, by zone. A load re-enters the map, which turns the player's height
 * calculation on; the search puts back what the save point had (a jump leaves it off until the next map load),
 * so the steps it plays are the steps an unbroken run plays. Still a guide: play the lines (the search's nodes
 * are saves, and a load can differ from a played-through state in what a save does not hold).
 */
import { basename } from 'node:path';
import { parseReplay } from '@opensinnoh/core';
import { gameDriver, runReplay, type Game, type ReplayDriver } from '@opensinnoh/game';
import { prepareRomCache } from '../../tests/rom.ts';
import { anchoredDriver, anchoredText, chainAnchor, readReplay, storyGame } from '../../tests/integration/checkpoints-anchors.ts';

type Dir = 'up' | 'down' | 'left' | 'right';
const DIRS: Dir[] = ['up', 'down', 'left', 'right'];
/** The waits written to the lines, and the shorter ones the search gives a held direction and the rest after it. */
const HOLD = 400;
const REST = 6000;
let searchHold = 16;
let searchRest = 1500;
let longestHold = 0;

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && /\.replay$/.test(a));
const opt = (name: string, at = 1) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + at];
};
if (!file || !process.env.OPENSINNOH_NDS_ROM || (!opt('to') && !args.includes('--list'))) {
  console.error('usage: OPENSINNOH_NDS_ROM=<rom> tsx tools/replays/dw-search.ts <file.replay> [--seed N] [--anchor] (--to <x> <z> [--zone NAME] [--y TILE] | --list [--zone NAME]) [--avoid NAME]… [--keep-puzzle] [--max NODES] [--hold TICKS] [--rest TICKS]');
  process.exit(2);
}
const seed = Number(opt('seed') ?? 1);
searchHold = Number(opt('hold') ?? searchHold);
searchRest = Number(opt('rest') ?? searchRest);
const maxNodes = Number(opt('max') ?? 20000);
const zoneName = opt('zone');
/** `--avoid <zone>` (repeatable): never enter that room. `--keep-puzzle`: no step that changes the boulder puzzle's bits (a guardian's tutorial). */
const avoid = new Set(args.flatMap((a, i) => (a === '--avoid' ? [args[i + 1]!] : [])));
const keepPuzzle = args.includes('--keep-puzzle');
const puzzle = () => (game.state.mapFeatures as { puzzleFlags?: number } | null)?.puzzleFlags;
const goal = opt('to') ? { x: Number(opt('to')), z: Number(opt('to', 2)), y: opt('y') === undefined ? undefined : Number(opt('y')) } : null;

await prepareRomCache();
const game: Game = storyGame(seed);
const base = gameDriver(game);
let driver: ReplayDriver = base;
const name = basename(file);
let text = readReplay(name);
if (args.includes('--anchor')) {
  const prefix = parseReplay(text).from!.file;
  driver = anchoredDriver(base, await chainAnchor(prefix, seed));
  text = anchoredText(name, prefix);
}
// No round trip at the end (its load would re-enter the map): the search starts from the unbroken run's end.
// The runner resets once to play and again for the round trip: the second reset stops it there.
const STOP = 'dw-search: the run is kept';
let resets = 0;
const keepEnd: ReplayDriver = {
  ...driver,
  reset: async (s) => {
    if (resets++) throw new Error(STOP);
    await driver.reset(s);
  },
};
const result = await runReplay(keepEnd, text, { registries: game.registries, seed, name, repeat: false, resolve: (f) => ({ name: f, text: readReplay(f) }) });
if (result.error !== STOP) throw new Error(`${name}: ${result.error ?? 'the round trip did not run'}`);

const world = game.world as unknown as { heightCalc: boolean };
const short = (zone: string) => zone.replace(/.*DISTORTION_WORLD_/, '').replace('platinum:MAP_HEADER_', '');

interface Node {
  save: string;
  calc: boolean;
  key: string;
  prev: Node | null;
  lines: string[];
  depth: number;
}

function key(): string {
  const s = game.state;
  const p = s.player;
  const f = s.mapFeatures as unknown as Record<string, unknown> | null;
  // On the land a facing only costs a turn (a held direction turns, then walks); on a wall or the ceiling the
  // moving direction is the avatar's state.
  const dw = f && f.kind === 'distortion-world' ? JSON.stringify([f.support, f.platformFlags, f.puzzleFlags, f.platforms, f.support === null ? null : f.movingDir]) : '';
  const objects = s.objects.map((o) => `${o.zone}#${o.localId}@${o.x},${o.z},${o.y}`).join(';');
  const v = (n: string) => s.vars[`platinum:${n}`] ?? 0;
  return `${p.zone}|${p.x},${p.y},${p.z}|${f?.kind === 'distortion-world' && f.support !== null ? p.facing : ''}|${s.playerState}|${dw}|${objects}|${v('VAR_DISTORTION_WORLD_PROGRESS')},${v('VAR_DISTORTION_WORLD_CYRUS_APPEARANCE')}`;
}

function restore(n: Node): void {
  game.load(JSON.parse(n.save));
  if (!n.calc) world.heightCalc = false;
  // The load's fade-in takes no input (an unbroken run has none): wait it out.
  for (let t = 0; t < 600 && !game.canSave(); t++) game.tick();
  if (!game.canSave()) throw new Error('dw-search: the game does not come to rest after a load');
}

function at(): { zone: string; x: number; y: number; z: number } {
  const p = game.state.player;
  return { zone: p.zone, x: p.x, y: p.y, z: p.z };
}

/** A direction held until the tile, height or zone changes, then released, then rest. The lines played, or null. */
async function walk(dir: Dir): Promise<string[] | null> {
  const start = at();
  game.press(dir);
  let changed: string | null = null;
  for (let n = 0; n < searchHold && !changed; n++) {
    game.tick();
    const now = at();
    if (now.zone !== start.zone) changed = `zone ${JSON.stringify(now.zone)}`;
    else if (now.x !== start.x) changed = `x ${now.x}`;
    else if (now.z !== start.z) changed = `z ${now.z}`;
    else if (now.y !== start.y) changed = `y ${now.y}`;
    if (changed) longestHold = Math.max(longestHold, n + 1);
  }
  game.release(dir);
  if (!changed) return null;
  if ((await base.until({ kind: 'idle' } as never, searchRest)) === null) return null;
  return [`+0 press ${dir}`, `until state player.${changed} ${HOLD}`, `+0 release ${dir}`, `until idle ${REST}`];
}

/** Surf where the player faces water: A, the text advanced to the yes/no, YES, the text advanced to rest. The lines, or null. */
async function surf(): Promise<string[] | null> {
  if (game.state.playerState === 'surf') return null;
  game.press('a');
  game.tick();
  game.release('a');
  if ((await base.advanceText(searchRest)) === null) return null;
  if (!game.scripts.view().yesNo) return null;
  game.press('a');
  game.tick();
  game.release('a');
  if ((await base.advanceText(searchRest)) === null || !game.canSave()) return null;
  if ((game.state.playerState as string) !== 'surf') return null;
  return ['+0 press a', '+1 release a', `advance text ${REST}`, '+0 press a', '+1 release a', `advance text ${REST}`];
}

const t0 = Date.now();
const startPuzzle = puzzle();
const root: Node = { save: JSON.stringify(game.save()), calc: world.heightCalc, key: key(), prev: null, lines: [], depth: 0 };
console.log(`start ${short(game.state.player.zone)} ${game.state.player.x},${game.state.player.y / 16},${game.state.player.z} (${result.ticks} ticks played); height calc ${root.calc}`);
const seen = new Map<string, Node>([[root.key, root]]);
const queue: Node[] = [root];
let found: Node | null = null;
const matches = (zone: string, x: number, y: number, z: number) => (!zoneName || short(zone) === zoneName) && (!goal || (x === goal.x && z === goal.z && (goal.y === undefined || Math.trunc(y / 16) === goal.y)));
for (let i = 0; i < queue.length && seen.size < maxNodes && !found; i++) {
  const node = queue[i]!;
  for (const action of [...DIRS, 'surf' as const]) {
    restore(node);
    const lines = action === 'surf' ? await surf() : await walk(action);
    if (!lines || game.scripts.running() || game.inBattle()) continue;
    if (avoid.has(short(game.state.player.zone)) || (keepPuzzle && puzzle() !== startPuzzle)) continue;
    const k = key();
    if (seen.has(k)) continue;
    const next: Node = { save: JSON.stringify(game.save()), calc: world.heightCalc, key: k, prev: node, lines, depth: node.depth + 1 };
    seen.set(k, next);
    queue.push(next);
    const p = game.state.player;
    if (goal && matches(p.zone, p.x, p.y, p.z)) {
      found = next;
      break;
    }
  }
}
console.log(`${seen.size} nodes in ${Date.now() - t0} ms (longest hold ${longestHold} ticks of ${searchHold})`);

if (args.includes('--list')) {
  const tiles = new Map<string, Set<string>>();
  for (const n of seen.values()) {
    const [zone, pos, , state] = n.key.split('|') as [string, string, string, string];
    const [x, y, z] = pos.split(',').map(Number) as [number, number, number];
    if (zoneName && short(zone) !== zoneName) continue;
    const support = JSON.parse(n.key.split('|')[4] || '[null]')[0];
    const set = tiles.get(short(zone)) ?? new Set();
    set.add(`${x},${Math.trunc(y / 16)},${z}${state === 'surf' ? 's' : ''}${support === null ? '' : `#${support}`}`);
    tiles.set(short(zone), set);
  }
  for (const [zone, set] of tiles) console.log(`${zone} (${set.size}): ${[...set].sort().join(' ')}`);
}

if (goal) {
  if (!found) {
    console.log(`# no route to ${goal.x},${goal.z}${zoneName ? ` on ${zoneName}` : ''} found`);
    process.exit(1);
  }
  const steps: Node[] = [];
  for (let n: Node | null = found; n?.prev; n = n.prev) steps.unshift(n);
  restore(found);
  const p = game.state.player;
  console.log(`# dw-search: ${steps.length} steps to ${short(p.zone)} ${p.x},${p.z}`);
  for (const s of steps) console.log(s.lines.join('\n'));
  console.log(`+0 assert state player {"zone":"${p.zone}","x":${p.x},"z":${p.z},"y":${p.y},"facing":"${p.facing}"}`);
}
