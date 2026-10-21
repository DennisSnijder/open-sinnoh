/**
 * The Distortion World in the world, on the original jump room (testing.ts): the room's shared space and land,
 * jump points and their frames, walking floors, both walls and the ceiling with the decomp's axes and drawn
 * facings, the floors' support change, double jumps on the land, and saves at rest on every surface.
 */
import { describe, expect, it } from 'vitest';
import type { DistortionWorldFeature, Facing, GameState, MapEntry } from '@opensinnoh/contracts';
import type { Button } from '@opensinnoh/core';
import { newState, setup, type Harness } from '../testing.ts';
import { DW_BELOW, DW_ON_TRANSITION, DW_ROOM, distortionRegistries } from './testing.ts';
import { angleDelta } from './feature.ts';

function enter(x: number, z: number, facing: Facing, state = newState(), entry: MapEntry = 'arrival'): Harness {
  const g = setup(state, { regs: distortionRegistries(), entry });
  const run = g.scripts.runImmediate.bind(g.scripts);
  // The rooms' onTransition runs init_persisted_map_features_for_distortion_world.
  g.scripts.runImmediate = (s) => {
    run(s);
    if (s.label === DW_ON_TRANSITION) g.world.initMapFeatures('distortion-world');
  };
  if (state.player.zone !== DW_ROOM) {
    g.world.warp(DW_ROOM, x, z, facing);
    g.settle();
  }
  return g;
}

/** A save loaded into a fresh world (GameState only, as the game's save round trip keeps it). */
const reload = (g: Harness) => enter(0, 0, 'up', structuredClone(g.state) as GameState, 'load');
const slot = (g: Harness) => g.state.mapFeatures as DistortionWorldFeature;
const tile = (g: Harness) => [g.state.player.x, g.state.player.y / 16, g.state.player.z];
const press = (g: Harness, b: Button, ticks = 1) => g.hold([b], ticks);

describe('Distortion World rooms', () => {
  it('address the shared space: the grid is offset, the land raised by the altitude', () => {
    const g = enter(16, 22, 'left');
    expect(tile(g)).toEqual([16, 18, 22]);
    expect(slot(g)).toMatchObject({ valid: true, support: null, platformFlags: (1 << 3) | (1 << 7), puzzleFlags: 0b111 });
    const v = g.world.view().distortion!;
    expect(v.orientation).toBe('land');
    expect(v.floors).toEqual([
      { zone: DW_ROOM, matrix: 'fixture:MATRIX_DW', area: 'fixture:AREA_INDOOR', offset: [128, 288, 128] },
      { zone: DW_BELOW, matrix: 'fixture:MATRIX_DW', area: 'fixture:AREA_INDOOR', offset: [128, 160, 128] },
    ]);
    // The Grotto's walls are its matrix tiles 0–3: shared x 8–11.
    press(g, 'left', 40);
    expect(tile(g)).toEqual([12, 18, 22]);
  });

  it('a jump point takes the press and lands on the west wall the frame after its last move', () => {
    const g = enter(16, 21, 'left');
    press(g, 'left');
    // JumpOnFloatingPlatform: the next frame turns and moves; 16 moves; the frame after lands and ends.
    g.hold([], 8);
    const mid = g.world.view().actors[0]!.cur;
    expect(mid[1]).toBeGreaterThan(288 + 8);
    expect(g.world.idle()).toBe(false);
    g.hold([], 8);
    expect(g.world.idle()).toBe(false);
    g.tick();
    expect(g.world.idle()).toBe(true);
    expect(tile(g)).toEqual([15, 19, 21]);
    expect(slot(g).support).toBe(0);
    expect(g.state.player.facing).toBe('left');
    const v = g.world.view().distortion!;
    expect(v.orientation).toBe('west-wall');
    expect(v.roll.cur).toBe(90);
    expect(g.world.view().actors[0]!.cur).toEqual([15 * 16 + 8, 19 * 16, 21 * 16 + 8]);
  });

  it('walks the west wall in y and z, faces the drawn way, and bumps off its edge and its blocked cell', () => {
    const g = enter(16, 21, 'left');
    press(g, 'left');
    g.settle();
    // Up is +y; the first press turns (the moving direction was left).
    press(g, 'up', 60);
    expect(tile(g)).toEqual([15, 22, 21]);
    expect(g.state.player.facing).toBe('left');
    expect(slot(g).movingDir).toBe('up');
    // Released (a held direction would walk on without turning), then a turn (2 frames) and 8 frames a tile.
    g.settle();
    g.tick();
    press(g, 'down', 2 + 8 + 8);
    g.settle();
    expect(tile(g)).toEqual([15, 20, 21]);
    // Left is +z: (y 20, z 22) is blocked.
    press(g, 'left', 30);
    g.settle();
    expect(tile(g)).toEqual([15, 20, 21]);
    expect(g.state.player.facing).toBe('down');
    // Right is −z.
    press(g, 'right', 12);
    g.settle();
    expect(tile(g)).toEqual([15, 20, 20]);
    expect(g.state.player.facing).toBe('up');
  });

  it('jumps back to the land; the height then stays fixed until the next map load', () => {
    const g = enter(16, 21, 'left');
    press(g, 'left');
    g.settle();
    press(g, 'down');
    g.settle();
    expect(tile(g)).toEqual([16, 18, 21]);
    expect(slot(g).support).toBeNull();
    expect(g.state.player.facing).toBe('right');
    expect(g.world.view().distortion!.orientation).toBe('land');
    expect(g.world.view().distortion!.roll.cur).toBe(0);
  });

  it('changes floors at a support edge and stops where no support continues', () => {
    const g = enter(20, 18, 'up');
    press(g, 'up');
    g.settle();
    expect(tile(g)).toEqual([20, 20, 17]);
    expect(slot(g).support).toBe(1);
    press(g, 'right', 60);
    g.settle();
    expect(tile(g)).toEqual([27, 20, 17]);
    expect(slot(g).support).toBe(2);
    expect(g.state.player.facing).toBe('right');
  });

  it('walks the ceiling with up as +z and left as −x', () => {
    const g = enter(29, 19, 'down');
    press(g, 'down');
    g.settle();
    expect(tile(g)).toEqual([29, 24, 20]);
    expect(g.world.view().distortion!.orientation).toBe('ceiling');
    press(g, 'up', 10);
    g.settle();
    expect(tile(g)).toEqual([29, 24, 21]);
    expect(g.state.player.facing).toBe('down');
    press(g, 'left', 10);
    g.settle();
    expect(tile(g)).toEqual([28, 24, 21]);
    expect(g.state.player.facing).toBe('right');
  });

  it('walks the east wall with up as +y and left as −z', () => {
    const g = enter(32, 27, 'right');
    press(g, 'right');
    g.settle();
    expect(tile(g)).toEqual([33, 19, 27]);
    expect(g.world.view().distortion!.roll.cur).toBe(270);
    press(g, 'up', 10);
    g.settle();
    expect(tile(g)).toEqual([33, 20, 27]);
    expect(g.state.player.facing).toBe('right');
    press(g, 'left', 10);
    g.settle();
    expect(tile(g)).toEqual([33, 20, 26]);
    expect(g.state.player.facing).toBe('up');
    expect(slot(g).movingDir).toBe('left');
    // Right is +z; its action (112) turns the moving direction west too, as the decomp's table has it.
    g.tick();
    press(g, 'right', 10);
    g.settle();
    expect(tile(g)).toEqual([33, 20, 27]);
    expect(g.state.player.facing).toBe('down');
    expect(slot(g).movingDir).toBe('left');
  });

  it('double-jumps a JUMP_EAST_TWICE tile: three tiles in 24 frames', () => {
    const g = enter(17, 32, 'right');
    press(g, 'right');
    expect(tile(g)).toEqual([20, 18, 32]);
    g.hold([], 22);
    expect(g.world.idle()).toBe(false);
    g.tick();
    expect(g.world.idle()).toBe(true);
  });

  it('an elevator platform carries the player down to the next floor and back up', () => {
    const g = enter(14, 15, 'up');
    expect(slot(g).platforms).toEqual([{ zone: DW_ROOM, index: 0, x: 14, y: 18, z: 14, path: 0 }]);
    press(g, 'up', 8);
    g.tick();
    expect(g.world.idle()).toBe(false);
    // BEGIN, a 22-frame shake, then 4 units a frame: 16 frames to the floor change, 16 more to the end.
    g.hold([], 1 + 22 + 16);
    expect(g.state.player.zone).toBe(DW_BELOW);
    expect(g.world.idle()).toBe(false);
    g.hold([], 16);
    expect(g.world.idle()).toBe(true);
    expect(g.state.player).toMatchObject({ zone: DW_BELOW, x: 14, z: 14, y: 160 });
    expect(slot(g)).toMatchObject({ platformFlags: (1 << 0) | (1 << 3) | (1 << 7), platforms: [{ zone: DW_BELOW, index: 0, x: 14, y: 10, z: 14, path: 1 }] });
    expect(g.world.view().distortion!.floors.map((f) => f.zone)).toEqual([DW_BELOW]);
    // The platform's prop: the tile's centre, its height + 8, the kind's offset.
    expect(g.world.view().distortion!.props).toEqual([{ key: `platform:${DW_BELOW}:0`, prop: 'medium-elevator-platform-1', cur: [232, 143, 226], prev: [232, 143, 226], opacity: 31 }]);
    // Off and back on: the ride up clears the flag and returns the platform to the floor above.
    press(g, 'down', 10);
    g.settle();
    g.tick();
    press(g, 'up', 10);
    g.tick();
    g.settle();
    expect(g.state.player).toMatchObject({ zone: DW_ROOM, x: 14, z: 14, y: 288 });
    expect(slot(g)).toMatchObject({ platformFlags: (1 << 3) | (1 << 7), platforms: [{ zone: DW_ROOM, index: 0, x: 14, y: 18, z: 14, path: 0 }] });
  });

  it('a camera row turns the camera to its angles in its frames, and a save keeps them', () => {
    const g = enter(16, 23, 'up');
    expect(g.world.view().distortion!.camera.cur).toEqual([0, 0, 0]);
    press(g, 'down');
    expect(slot(g).cameraAngle).toEqual([0, 0, 64]);
    // CameraTransitionTask from the next frame: 7 steps of 0x4000 / 8, then the target on the eighth.
    g.hold([], 3);
    expect(g.world.view().distortion!.camera.cur).toEqual([0, 0, 3 * 0x800]);
    g.hold([], 4);
    expect(g.world.view().distortion!.camera.cur).toEqual([0, 0, 7 * 0x800]);
    g.tick();
    expect(g.world.view().distortion!.camera.cur).toEqual([0, 0, 0x4000]);
    g.settle();
    expect(reload(g).world.view().distortion!.camera.cur).toEqual([0, 0, 0x4000]);
  });

  it('turns by the decomp\'s angle deltas, the long way past half a turn', () => {
    expect(angleDelta(0x1000, 0xf000)).toBe(-0x2000);
    expect(angleDelta(0xf000, 0x1000)).toBe(0x2000);
    expect(angleDelta(0x7000, 0x9000)).toBe(-0x6000);
  });

  it('a save at rest on each surface reloads to the same place and moves on the same way', () => {
    const cases: [number, number, Facing, Button, Button][] = [
      [16, 21, 'left', 'left', 'down'], // west wall
      [20, 18, 'up', 'up', 'right'], // floor
      [29, 19, 'down', 'down', 'left'], // ceiling
      [32, 27, 'right', 'right', 'up'], // east wall
    ];
    for (const [x, z, facing, jump, then] of cases) {
      const g = enter(x, z, facing);
      press(g, jump);
      g.settle();
      press(g, then, 3);
      g.settle();
      const h = reload(g);
      expect(h.state.player, `${x},${z}`).toEqual(g.state.player);
      expect(h.state.mapFeatures).toEqual(g.state.mapFeatures);
      expect(h.world.view().distortion!.orientation).toBe(g.world.view().distortion!.orientation);
      for (const run of [g, h]) {
        press(run, then, 10);
        run.settle();
      }
      expect(h.state.player, `${x},${z} after`).toEqual(g.state.player);
      expect(h.state.mapFeatures).toEqual(g.state.mapFeatures);
    }
  });
});
