/**
 * sys-turnback-routing, the seeded walk (decomp ScrCmd_InitTurnbackCave): from Sendoff
 * Spring into Turnback Cave, then door after door until the routing ends the walk: three pillars seen → the Giratina
 * room, or 30 rooms → back at the entrance, then out to Sendoff Spring. Each room's counters and target are checked
 * against the decomp's rule. The walk is built as a replay, segment by segment from where the last one ended (a
 * shortest path round the room's rocks to the nearest door other than the one the player came by); the finished
 * replay must run twice identically with a save round trip on each seed. Constructed starts:
 * tests/rom-replays/sys-turnback-*.replay.
 */
import { describe, expect, it } from 'vitest';
import type { Id } from '@opensinnoh/core';
import { createBattle } from '@opensinnoh/battle';
import { CountingStubLog, createGame, gameDriver, runReplay, type Game } from '@opensinnoh/game';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld, gridOffset, MapGrid } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';

const ZONE = 'platinum:MAP_HEADER_';
type Dir = 'up' | 'down' | 'left' | 'right';
const STEP: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
/**
 * A room's doors (warps 0–3): the tile and direction that walk into it, and where the next room is entered (its
 * destination warp: north ↔ south, east ↔ west). The south door's arrival (the north door, in the wall) is not
 * used: the player never leaves by the south door, so never comes in by the north one.
 */
const DOORS = [
  { name: 'north', warp: 0, from: [11, 2], dir: 'up', arrive: [11, 20] },
  { name: 'east', warp: 1, from: [19, 11], dir: 'right', arrive: [2, 11] },
  { name: 'west', warp: 3, from: [3, 11], dir: 'left', arrive: [20, 11] },
] as const;
const ENTRY: Record<string, number> = { '11,20': 2, '20,11': 1, '2,11': 3, '11,16': 5 };

/** Replay legs from the player's tile to `to` round blocked tiles, objects and other warps (BFS), as press/until lines. */
function path(game: Game, to: readonly [number, number]): string {
  const zone = game.registries.zones.get(game.state.player.zone)!;
  const grid = new MapGrid(game.registries, game.registries.matrices.get(zone.matrix)!, gridOffset(game.registries, zone.id));
  const busy = new Set([...game.state.objects.map((o) => `${o.x},${o.z}`), ...zone.events.warps.map((w) => `${w.x},${w.z}`)]);
  const start = `${game.state.player.x},${game.state.player.z}`;
  const prev = new Map<string, [string, Dir] | null>([[start, null]]);
  const queue = [[game.state.player.x, game.state.player.z] as [number, number]];
  while (queue.length) {
    const [x, z] = queue.shift()!;
    if (x === to[0] && z === to[1]) break;
    for (const [d, [dx, dz]] of Object.entries(STEP) as [Dir, [number, number]][]) {
      const k = `${x + dx},${z + dz}`;
      if (prev.has(k) || grid.blocked(x + dx, z + dz) || busy.has(k)) continue;
      prev.set(k, [`${x},${z}`, d]);
      queue.push([x + dx, z + dz]);
    }
  }
  const steps: [Dir, string][] = [];
  for (let k = `${to[0]},${to[1]}`; k !== start; ) {
    const p = prev.get(k);
    if (!p) throw new Error(`no path in ${zone.id} from ${start} to ${to}`);
    steps.unshift([p[1], k]);
    k = p[0];
  }
  let out = '';
  steps.forEach(([d, k], i) => {
    if (steps[i - 1]?.[0] !== d) out += `+0 press ${d}\n`;
    if (steps[i + 1]?.[0] !== d) out += `until position ${k.replace(',', ' ')} 300\n+0 release ${d}\n`;
  });
  return out;
}

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Turnback Cave routing (OPENSINNOH_NDS_ROM)', () => {
  for (const seed of [1, 2, 3])
    it(`seed ${seed}: the walk ends in the Giratina room or, after 30 rooms, back at the entrance; twice, save round trip`, async () => {
      const game = createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, createBattle, seed, log: new CountingStubLog(() => {}), now: () => '2026-01-01T00:00:00.000Z' });
      const counts = () => ({ pillars: game.state.vars['platinum:VAR_TURNBACK_CAVE_PILLARS_SEEN' as Id] ?? 0, rooms: game.state.vars['platinum:VAR_TURNBACK_CAVE_ROOMS_VISITED' as Id] ?? 0 });
      const play = (text: string, repeat: boolean) => runReplay(gameDriver(game), text, { registries: game.registries, seed, name: `turnback-${seed}`, repeat });
      let text = `warp ${ZONE}SENDOFF_SPRING 31 17 up\nuntil idle\n+0 press up\n+1 release up\nuntil idle 600\n`;
      /** Appends a segment and replays the walk once, with a save round trip in the room it ends in (a load runs no onTransition). */
      const extend = async (segment: string) => {
        text += segment;
        const r = await play(text, false);
        if (!r.ok) throw new Error(r.error);
        expect(r.roundTrip).toBe('identical');
        text += `+0 assert map ${game.state.player.zone}\n`;
      };
      await extend('');
      const rooms: string[] = [];
      let before = { pillars: 0, rooms: 0 };
      for (;;) {
        const zone = game.state.player.zone;
        const now = counts();
        rooms.push(`${zone.slice(ZONE.length + 'TURNBACK_CAVE_'.length)} ${now.pillars}/${now.rooms}`);
        if (zone === `${ZONE}TURNBACK_CAVE_GIRATINA_ROOM`) {
          expect(before.pillars).toBe(3);
          text += '+0 assert var platinum:VAR_TURNBACK_CAVE_PILLARS_SEEN 3\n';
          break;
        }
        if (zone === `${ZONE}TURNBACK_CAVE_ENTRANCE` && rooms.length > 1) {
          // 30 rooms: back at the entrance, whose onTransition clears both counters. Out to Sendoff Spring.
          expect(before.rooms).toBeGreaterThanOrEqual(30);
          expect(now).toEqual({ pillars: 0, rooms: 0 });
          await extend(`${path(game, [11, 15])}+0 press down\nuntil position 31 16 300\n+0 release down\nuntil idle 300\n`);
          expect(game.state.player.zone).toBe(`${ZONE}SENDOFF_SPRING`);
          break;
        }
        if (rooms.length > 1) {
          // Each room adds a room, the pillar room a pillar too; the target followed from the counts before.
          expect(now.rooms).toBe(before.rooms + 1);
          if (zone === `${ZONE}TURNBACK_CAVE_PILLAR_ROOM`) expect(now.pillars).toBe(before.pillars + 1);
          else expect([1, 2, 3, 4, 5, 6].map((r) => `${ZONE}TURNBACK_CAVE_PILLAR_${before.pillars + 1}_ROOM_${r}`)).toContain(zone);
        }
        before = now;
        const entry = ENTRY[`${game.state.player.x},${game.state.player.z}`];
        expect(entry, `arrival tile ${game.state.player.x},${game.state.player.z}`).toBeDefined();
        const door = DOORS.filter((d) => d.warp !== entry)
          .map((d) => ({ d, legs: path(game, d.from) }))
          .sort((a, b) => a.legs.split('\n').length - b.legs.split('\n').length)[0]!;
        await extend(`${door.legs}+0 press ${door.d.dir}\nuntil position ${door.d.arrive.join(' ')} 300\n+0 release ${door.d.dir}\nuntil idle 300\n`);
      }
      const result = await play(text, true);
      expect(result.error, rooms.join(', ')).toBeUndefined();
      expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
      expect(rooms.length).toBeGreaterThan(3);
    }, 600_000);
});
