/**
 * Prints a zone's tiles as text, for routing replays around wanderers by hand. Needs the ROM
 * (OPENSINNOH_NDS_ROM; the test cache's slice import, tests/rom.ts); prints nothing from the ROM but
 * collision and event positions.
 *
 *   OPENSINNOH_NDS_ROM=… pnpm tsx tools/replays/map.ts JUBILIFE_CITY 140 745 190 780
 *   OPENSINNOH_NDS_ROM=… pnpm tsx tools/replays/map.ts ROUTE_204_SOUTH FLOAROMA_TOWN   (each zone's cells)
 *
 * `#` blocked, `.` free, `w` warp, `c` coord trigger, `,` tall grass (wild encounters), `~` a tile an NPC
 * with a movement type may walk or look from (its range around its origin); an object's origin shows the
 * last digit of its local id. The legend lists the objects in view with their movement type, range and
 * script, and the warps with their targets.
 */
import type { Matrix, Zone } from '@opensinnoh/contracts';
import { CountingStubLog, createGame } from '@opensinnoh/game';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { MapGrid } from '../../packages/world/src/tiles.ts';
import { prepareRomCache, romSlice } from '../../tests/rom.ts';

const [name, ...nums] = process.argv.slice(2);
if (!name || !process.env.OPENSINNOH_NDS_ROM) {
  console.error('usage: OPENSINNOH_NDS_ROM=<rom> tsx tools/replays/map.ts <ZONE> <x0> <z0> <x1> <z1> | <ZONE>...');
  process.exit(2);
}
await prepareRomCache();
const { pack } = romSlice();
const { registries } = createGame({ packs: [pack], createWorld, createScriptRunner, seed: 1, log: new CountingStubLog(() => {}) });
const zoneOf = (n: string) => {
  const z = registries.zones.get(`platinum:MAP_HEADER_${n}`) as Zone | undefined;
  if (!z) throw new Error(`no zone platinum:MAP_HEADER_${n}`);
  return z;
};
if (nums.length < 4 || nums.some((n) => Number.isNaN(Number(n)))) {
  // Zone names only: each zone's cells (32×32 tiles each) in its matrix.
  for (const n of [name, ...nums]) {
    const z = zoneOf(n);
    const m = registries.matrices.get(z.matrix) as Matrix;
    const cells = m.chunks.map((_, i) => i).filter((i) => (m.zones?.[i] ?? z.id) === z.id && m.chunks[i]);
    console.log(`${n} (${z.matrix}): ${cells.map((i) => `x ${(i % m.width) * 32}–${(i % m.width) * 32 + 31} z ${Math.floor(i / m.width) * 32}–${Math.floor(i / m.width) * 32 + 31}`).join('; ')}`);
  }
  process.exit(0);
}
const zone = zoneOf(name);
const matrix = registries.matrices.get(zone.matrix) as Matrix;
const [x0, z0, x1, z1] = nums.map(Number) as [number, number, number, number];
const grid = new MapGrid(registries, matrix);
// Every zone of the matrix shares its tiles: show the events of the zones in view.
const zones = [...registries.zones.values()].filter((z) => z.matrix === zone.matrix);
const objects = zones.flatMap((z) => z.events.objects);
const mark = new Map<string, string>();
const key = (x: number, z: number) => `${x},${z}`;
const inView = (x: number, z: number) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
for (const z of zones) {
  for (const w of z.events.warps) mark.set(key(w.x, w.z), 'w');
  for (const c of z.events.coords) for (let dx = 0; dx < c.width; dx++) for (let dz = 0; dz < c.length; dz++) mark.set(key(c.x + dx, c.z + dz), 'c');
}
const shown = objects.filter((o) => inView(o.x, o.z));
for (const o of shown) {
  if (o.movementType > 1) for (let dx = -o.range.x; dx <= o.range.x; dx++) for (let dz = -o.range.z; dz <= o.range.z; dz++) mark.set(key(o.x + dx, o.z + dz), '~');
}
for (const o of shown) mark.set(key(o.x, o.z), String(o.localId % 10));
const grass = (x: number, z: number) => /TALL_GRASS/.test(grid.behaviour(x, z));
const pad = String(x1).length;
for (let d = pad - 1; d >= 0; d--) {
  let row = ' '.repeat(pad + 1);
  for (let x = x0; x <= x1; x++) row += String(x).padStart(pad)[pad - 1 - d];
  console.log(row);
}
for (let z = z0; z <= z1; z++) {
  let row = `${String(z).padStart(pad)} `;
  for (let x = x0; x <= x1; x++) row += mark.get(key(x, z)) ?? (grid.blocked(x, z) ? '#' : grass(x, z) ? ',' : '.');
  console.log(row);
}
for (const o of shown) console.log(`${o.localId} @${o.x},${o.z} type ${o.movementType} range ${o.range.x},${o.range.z} ${o.label ?? ''}${o.trainer ? ` trainer ${o.trainer.id} sight ${o.data[0]}` : ''}`);
for (const z of zones) for (const w of z.events.warps) if (inView(w.x, w.z)) console.log(`warp @${w.x},${w.z} → ${w.toZone} ${w.toWarp}`);
for (const z of zones) for (const c of z.events.coords) if (inView(c.x, c.z)) console.log(`coord @${c.x},${c.z} ${c.width}x${c.length} ${c.label} when ${c.var} = ${c.value}`);
