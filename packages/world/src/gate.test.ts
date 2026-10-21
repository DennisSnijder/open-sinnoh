/**
 * Field fixes of contracts 0.12.0: Cycling Road, height calculation, bg event moves, the previous
 * zone, onResume, the avatar sprites per state, sinking into mud and snow, and the platform lift ride.
 */
import { describe, expect, it } from 'vitest';
import type { Id } from '@opensinnoh/core';
import { LOCALID_PLAYER, type GameState, type Registries } from '@opensinnoh/contracts';
import { f, newState, pos, registries, setup } from './testing.ts';
import { LIFTS, PlatformLift, initLift, liftOf } from './platform-lift.ts';

const terrain = (x: number, z: number, facing: 'up' | 'down' | 'left' | 'right', edit: (s: GameState) => void = () => {}) => {
  const s = newState('TERRAIN', x, z, facing);
  edit(s);
  return setup(s);
};
const hero = (g: ReturnType<typeof setup>) => g.world.view().actors.find((a) => a.localId === LOCALID_PLAYER)!;

describe('Cycling Road (forceBicycling, PlayerAvatar_IsOnCyclingRoadBridge)', () => {
  it('on the elevated bridge with no input the bike rolls south at WALK_FASTER until the bridge ends; without it the bike stays', () => {
    const ride = (force: boolean) => {
      const g = terrain(29, 25, 'up', (s) => (s.playerState = 'cycle'));
      for (let i = 0; i < 40 && !(g.state.player.z === 21 && g.world.idle()); i++) g.tick(['up']);
      expect(g.state.player.z).toBe(21);
      g.world.forceBicycling(force);
      g.hold([], 20);
      return g;
    };
    expect(ride(false).state.player).toMatchObject({ x: 29, z: 21 });
    const g = ride(true);
    // 2 ticks a tile down the bridge (z 20–23), onto its BRIDGE_START end at z 24 (not a bridge tile: the roll ends there).
    expect(pos(g.state)).toEqual([f('TERRAIN'), 29, 24, 'down']);
  });

  it('is an avatar flag: a map load clears it', () => {
    const g = terrain(29, 25, 'up', (s) => (s.playerState = 'cycle'));
    g.world.forceBicycling(true);
    g.world.enter('load');
    g.settle();
    for (let i = 0; i < 40 && !(g.state.player.z === 21 && g.world.idle()); i++) g.tick(['up']);
    g.hold([], 20);
    expect(g.state.player).toMatchObject({ x: 29, z: 21 });
  });
});

describe('field host members of 0.12.0', () => {
  it('releaseObject unpauses one locked object', () => {
    const g = setup();
    g.world.lockAll();
    g.world.releaseObject(0);
    const actors = (g.world as unknown as { actors: Map<number, { paused: boolean }> }).actors;
    expect(actors.get(0)!.paused).toBe(false);
  });

  it('setBgEventPosition moves a bg event for this visit (A on its new tile starts it)', () => {
    const g = setup(newState('ROOM', 14, 16, 'up'));
    g.world.setBgEventPosition(0, 14, 15);
    g.tick(['a']);
    expect(g.scripts.starts.at(-1)).toMatchObject({ label: f('Room_TV'), source: 'bg' });
    expect(() => g.world.setBgEventPosition(5, 0, 0)).toThrow(/no bg event 5/);
  });

  it('a warp records the zone it left (previousZone); onResume runs after onLoad on every map load', () => {
    const zones = new Map(registries.zones);
    const town = zones.get(f('TOWN'))!;
    zones.set(town.id, { ...town, mapScripts: { ...town.mapScripts, onResume: f('Town_OnResume') } });
    const regs = { ...registries, zones } as Registries;
    const g = setup(newState('ROOM', 14, 16, 'up'), { regs });
    expect(g.state.previousZone).toBeNull();
    const w = town.events.warps[0]!;
    g.world.warp(town.id, w.x, w.z, 'down');
    for (let i = 0; i < 60 && !g.world.warpDone(); i++) g.tick();
    expect(g.state.previousZone).toBe(f('ROOM'));
    expect(g.scripts.immediates.at(-1)).toMatchObject({ label: f('Town_OnResume'), source: 'resume' });
    // A loaded save runs onResume too (not onTransition).
    const before = g.scripts.immediates.length;
    g.world.enter('load');
    expect(g.scripts.immediates.slice(before).map((s) => s.source)).toEqual(['resume']);
  });
});

describe('the avatar sprite follows the player state (NewGame.playerCycleSprite, playerSurfSprite)', () => {
  it('cycling and surfing draw their own sprites, also after a surf mount task and on load', () => {
    const g = terrain(11, 7, 'right');
    expect(hero(g).sprite).toBe(f('SPRITE_HERO'));
    g.world.setPlayerState('cycle');
    expect(hero(g).sprite).toBe(f('SPRITE_HERO_CYCLE'));
    g.world.setPlayerState('walk');
    expect(hero(g).sprite).toBe(f('SPRITE_HERO'));
    const surfer = terrain(5, 9, 'up', (s) => (s.playerState = 'surf'));
    expect(hero(surfer).sprite).toBe(f('SPRITE_HERO_SURF'));
  });
});

describe('sinking into mud and snow (MapObject_SinkIntoTerrain)', () => {
  it('a step that ends in deep mud sinks the sprite 14 units; jumping out does not, until the next step', () => {
    const g = terrain(13, 10, 'up');
    expect(hero(g).sink).toBeUndefined();
    g.hold(['up'], 8);
    expect(pos(g.state)).toEqual([f('TERRAIN'), 13, 9, 'up']);
    expect(hero(g).sink).toBe(14);
    for (const d of ['left', 'right', 'left', 'right'] as const) g.hold([d], 3);
    g.hold(['left'], 9);
    expect(hero(g).sink).toBeUndefined();
  });

  it('deep snow sinks by its depth', () => {
    const g = terrain(11, 7, 'right');
    const sinks: (number | undefined)[] = [];
    for (let x = 12; x <= 17; x++) {
      for (let i = 0; i < 60 && !(g.state.player.x === x && g.world.idle()); i++) g.tick(['right']);
      sinks.push(hero(g).sink);
    }
    // Arriving on SNOW_DEEP (14), SNOW_DEEPER (15), SNOW_DEEPEST (16), then plain ground (17).
    expect(sinks).toEqual([undefined, undefined, 12, 14, 16, undefined]);
  });
});

describe('platform lifts (platform_lift.c)', () => {
  it('the table follows the decomp PlatformLiftID order', () => {
    expect(LIFTS.map((l) => l.zone)).toEqual([
      'IRON_ISLAND_B1F_RIGHT_ROOM',
      'IRON_ISLAND_B2F_LEFT_ROOM',
      'IRON_ISLAND_B3F',
      'POKEMON_LEAGUE_ELEVATOR_TO_AARON_ROOM',
      'POKEMON_LEAGUE_ELEVATOR_TO_BERTHA_ROOM',
      'POKEMON_LEAGUE_ELEVATOR_TO_FLINT_ROOM',
      'POKEMON_LEAGUE_ELEVATOR_TO_LUCIAN_ROOM',
      'POKEMON_LEAGUE_ELEVATOR_TO_CHAMPION_ROOM',
      'POKEMON_LEAGUE_CHAMPION_ROOM',
    ]);
    expect(liftOf('platinum:MAP_HEADER_IRON_ISLAND_B3F' as Id)).toBe(2);
    expect(liftOf('platinum:MAP_HEADER_IRON_ISLAND_B3' as Id)).toBe(-1);
  });

  it('init: the floor from the arrival z; a League lift entered on top was used', () => {
    expect(initLift(2, 15)).toEqual({ lift: 2, floor: 'bottom', notUsedWhenEntered: true });
    expect(initLift(2, 9)).toEqual({ lift: 2, floor: 'top', notUsedWhenEntered: true });
    expect(initLift(3, 15)).toEqual({ lift: 3, floor: 'bottom', notUsedWhenEntered: true });
    expect(initLift(3, 9)).toEqual({ lift: 3, floor: 'top', notUsedWhenEntered: false });
  });

  it('rides: height calc off, 1 unit a tick up Iron Island (2 in the League), the plate moves at the end; a League lift never goes down', () => {
    const data = initLift(2, 15);
    const lift = new PlatformLift(2, data, [0, 0]);
    expect(lift.plateAt(8, 11)).toBe(16);
    expect(lift.plateAt(11, 11)).toBeNull();
    lift.trigger();
    expect(data.floor).toBe('top');
    const steps = [];
    while (!lift.done()) steps.push(lift.step());
    expect(steps[0]).toEqual({ calc: false, play: 1553 });
    expect(steps.slice(1, -2).map((s) => s.height)).toEqual(Array.from({ length: 128 }, (_, i) => 17 + i));
    expect(steps.at(-3)).toEqual({ height: 144, stop: 1553 });
    expect(steps.at(-2)).toEqual({ calc: true, play: 1562 });
    expect(lift.plateAt(10, 12)).toBe(144);
    const league = new PlatformLift(3, initLift(3, 15), [0, 0]);
    league.trigger();
    let n = 0;
    while (!league.done()) n += league.step().height !== undefined ? 1 : 0;
    expect(n).toBe(80);
    league.trigger();
    expect(league.done()).toBe(true);
  });
});
