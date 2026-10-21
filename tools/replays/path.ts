/**
 * A cheapest walk from the player to a tile, as replay lines (explore.ts `--to`): one press per straight run.
 * Avoided: collision, directional walls, water, live objects (and the event origins of zones not loaded), the
 * Veilstone Gym's bags and stacks, coord triggers that would fire (the target excepted), and on the bike very
 * tall grass and mud; ledges are jumped the way they go. A height step of 20 units or more is a wall (bridges
 * are walked at the walker's height, over or under; leaving one is checked; a tile is searched once per height,
 * so reaching a bridge tile on the deck does not hide the way under it). A tile an undefeated trainer
 * could see (any facing, from any tile of its wander range, terrain blocking its view) costs 100, a turn 2, a
 * step 1. A guide: play the lines to see.
 */
import type { Zone } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import type { Game } from '@opensinnoh/game';
import type { MapGrid } from '../../packages/world/src/tiles.ts';
import { blocksMovement, isMud, isMudWithGrass, isVeryTallGrass, onWater } from '../../packages/world/src/behaviours.ts';

type Dir = 'up' | 'down' | 'left' | 'right';
const DIRS: Record<Dir, readonly [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const BACK: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };
const LEDGE: Record<Dir, string> = { up: 'JUMP_NORTH', down: 'JUMP_SOUTH', left: 'JUMP_WEST', right: 'JUMP_EAST' };
/** Decomp TRAINER_DEFEATED_FLAGS_START. */
const TRAINER_FLAGS_START = 0x550;
/** World units per tile. */
const TILE = 16;

export function walkLines(game: Game, grid: MapGrid, zones: Zone[], tx: number, tz: number): string[] {
  const s = game.state;
  const reg = game.registries;
  const key = (x: number, z: number) => `${x},${z}`;
  const centre = (t: number) => t * TILE + TILE / 2;
  const live = new Set(s.objects.map((o) => o.zone));
  const occupied = new Set([...s.objects.map((o) => key(o.x, o.z)), ...zones.filter((z) => !live.has(z.id)).flatMap((z) => z.events.objects.map((o) => key(o.x, o.z)))]);
  const f = s.mapFeatures;
  if (f?.kind === 'veilstone-gym') for (const t of [...f.bags, ...f.stacks]) if (t) occupied.add(key(t.x, t.z));
  const varOf = (v: Id) => s.vars[v] ?? reg.vars.get(v)?.initial ?? 0;
  const triggers = new Set<string>();
  for (const z of zones) for (const c of z.events.coords) if (varOf(c.var) === c.value) for (let i = 0; i < c.width * c.length; i++) triggers.add(key(c.x + (i % c.width), c.z + Math.floor(i / c.width)));
  const defeated = (trainer: Id) => {
    const index = TRAINER_FLAGS_START + (reg.trainers.get(trainer)?.sourceIndex ?? NaN);
    for (const fl of reg.flags.values()) if (fl.sourceIndex === index) return s.flags[fl.id] ?? fl.initial;
    return false;
  };
  const seen = new Set<string>();
  for (const z of zones) {
    for (const ev of z.events.objects) {
      if (!ev.trainer || defeated(ev.trainer.id)) continue;
      if (live.has(z.id) && !s.objects.some((o) => o.zone === z.id && o.localId === ev.localId)) continue;
      const rx = Math.max(0, ev.range.x);
      const rz = Math.max(0, ev.range.z);
      for (let ox = ev.x - rx; ox <= ev.x + rx; ox++) {
        for (let oz = ev.z - rz; oz <= ev.z + rz; oz++) {
          for (const [dx, dz] of Object.values(DIRS)) {
            for (let d = 1; d <= ev.data[0]; d++) {
              if (grid.blocked(ox + dx * d, oz + dz * d)) break;
              seen.add(key(ox + dx * d, oz + dz * d));
            }
          }
        }
      }
    }
  }
  const sk = (x: number, z: number, d: Dir, y: number) => `${x},${z},${d},${Math.round(y)}`;
  const best = new Map<string, number>();
  const prev = new Map<string, { from: string; dir: Dir; x: number; z: number }>();
  // A bucket queue by cost, searched within 64 tiles of the box around the player and the target.
  const start = { x: s.player.x, z: s.player.z, d: s.player.facing as Dir, y: grid.heightAt(centre(s.player.x), centre(s.player.z), s.player.y) };
  const buckets: (typeof start)[][] = [[start]];
  const inBox = (x: number, z: number) => x >= Math.min(start.x, tx) - 64 && x <= Math.max(start.x, tx) + 64 && z >= Math.min(start.z, tz) - 64 && z <= Math.max(start.z, tz) + 64;
  const cycling = s.playerState === 'cycle';
  best.set(sk(start.x, start.z, start.d, start.y), 0);
  let goal: string | undefined;
  for (let c = 0; c < buckets.length && !goal; c++) {
    for (const { x, z, d, y } of buckets[c] ?? []) {
      const here = sk(x, z, d, y);
      if ((best.get(here) ?? Infinity) < c) continue;
      if (x === tx && z === tz) {
        goal = here;
        break;
      }
      for (const dir of Object.keys(DIRS) as Dir[]) {
        const [dx, dz] = DIRS[dir];
        let [nx, nz] = [x + dx, z + dz];
        const next = grid.behaviour(nx, nz);
        if (next === LEDGE[dir]) [nx, nz] = [nx + dx, nz + dz];
        else if (grid.blocked(nx, nz) || blocksMovement(grid.behaviour(x, z), dir) || blocksMovement(next, BACK[dir]) || onWater(next, false) || next.startsWith('JUMP')) continue;
        if (cycling && (isVeryTallGrass(next) || isMud(next) || isMudWithGrass(next))) continue;
        let ny = grid.heightAt(centre(nx), centre(nz), y);
        if (next.startsWith('BRIDGE') && Math.abs(ny - y) >= 20) ny = y;
        else if (next !== LEDGE[dir] && !next.startsWith('BIKE_SLOPE') && Math.abs(ny - y) >= 20) continue;
        const k = key(nx, nz);
        if (!inBox(nx, nz) || occupied.has(k) || (triggers.has(k) && k !== key(tx, tz))) continue;
        const nc = c + 1 + (dir === d ? 0 : 2) + (seen.has(k) ? 100 : 0);
        const to = sk(nx, nz, dir, ny);
        if ((best.get(to) ?? Infinity) <= nc) continue;
        best.set(to, nc);
        prev.set(to, { from: here, dir, x: nx, z: nz });
        (buckets[nc] ??= []).push({ x: nx, z: nz, d: dir, y: ny });
      }
    }
  }
  if (!goal) return [`# --to ${tx} ${tz}: no walk found`];
  const steps: { dir: Dir; x: number; z: number }[] = [];
  for (let k = goal; prev.has(k); k = prev.get(k)!.from) steps.unshift(prev.get(k)!);
  const runs: { dir: Dir; x: number; z: number }[] = [];
  for (const st of steps) {
    if (runs.at(-1)?.dir === st.dir) Object.assign(runs.at(-1)!, st);
    else runs.push({ ...st });
  }
  const risky = steps.filter((st) => seen.has(key(st.x, st.z))).map((st) => key(st.x, st.z));
  return [
    `# --to ${tx} ${tz}: ${steps.length} steps, ${risky.length} in possible trainer sight${risky.length ? ` (${risky.join(' ')})` : ''}`,
    ...runs.flatMap((r) => [`+0 press ${r.dir}`, `until position ${r.x} ${r.z} 6000`, `+0 release ${r.dir}`]),
  ];
}
