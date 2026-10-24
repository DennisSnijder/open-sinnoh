import { fixtureAudio } from '../../../tests/fixtures/audio.ts';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLOCK, eggCycleLength, RECORD_EGGS_HATCHED, RECORD_STEPS, type Button, type Id } from '@opensinnoh/core';
import type { BillboardSprite, Prop, Registries } from '@opensinnoh/contracts';
import { FakeRunner, f, mon, newState, pos, registries, setup } from './testing.ts';
import { HGSS_PLAYER_SPRITES, LOCALID_FOLLOWER, LOCALID_PLAYER } from '@opensinnoh/contracts';
import { bgFacingMatches, createWorld, MOVEMENT_TYPE_FOLLOW_PLAYER, WARP_FADE_TICKS } from './world.ts';
import { terrainHeight } from './terrain.ts';

describe('movement', () => {
  it('walks one tile in 8 ticks and keeps walking without a gap', () => {
    const g = setup();
    g.hold(['up'], 8);
    expect(pos(g.state)).toEqual([f('ROOM'), 14, 15, 'up']);
    g.hold(['up'], 8);
    expect(pos(g.state)).toEqual([f('ROOM'), 14, 14, 'up']);
    g.tick();
    expect(g.world.idle()).toBe(true);
  });

  it('turns in place on a tap (2 ticks), then walks when held', () => {
    const g = setup();
    g.tick(['left']);
    g.tick();
    expect(pos(g.state)).toEqual([f('ROOM'), 14, 16, 'left']);
    expect(g.world.idle()).toBe(true);
    g.hold(['down'], 2);
    expect(pos(g.state)).toEqual([f('ROOM'), 14, 16, 'down']);
    g.hold(['down'], 8);
    expect(pos(g.state)).toEqual([f('ROOM'), 14, 17, 'down']);
  });

  it('changes direction while moving without a turn', () => {
    const g = setup();
    g.hold(['up'], 8);
    g.hold(['right'], 8);
    expect(pos(g.state)).toEqual([f('ROOM'), 15, 15, 'right']);
  });

  it('collides with blocked tiles and objects', () => {
    const g = setup();
    // The table covers x 12..13, z 14..15.
    g.hold(['left'], 2 + 8);
    expect(pos(g.state)).toEqual([f('ROOM'), 13, 16, 'left']);
    g.hold(['up'], 40);
    expect(pos(g.state)).toEqual([f('ROOM'), 13, 16, 'up']);
    // The helper stands at (18, 14). Releasing the pad ends the DS "moving" state.
    g.tick();
    g.hold(['right'], 2 + 5 * 8);
    g.hold(['up'], 2 + 8 + 40);
    expect(pos(g.state)).toEqual([f('ROOM'), 18, 15, 'up']);
  });

  it('each step the player starts counts RECORD_STEPS; a bump into a wall does not (PlayerAvatar_IncrementStepsRecord)', () => {
    const g = setup();
    const steps = () => g.state.records.counts[RECORD_STEPS] ?? 0;
    g.hold(['up'], 16);
    expect(steps()).toBe(2);
    g.tick();
    // The table covers x 12..13, z 14..15: left from (14, 14) only bumps.
    g.hold(['left'], 2 + 40);
    expect(pos(g.state)).toEqual([f('ROOM'), 14, 14, 'left']);
    expect(steps()).toBe(2);
    g.hold(['down'], 8);
    expect(steps()).toBe(3);
  });

  it('an egg that starts hatching counts RECORD_EGGS_HATCHED and the trainer score (Field_UpdateDaycare)', () => {
    const g = setup();
    const egg = { ...mon('SPECIES_MOSSLET', 1), isEgg: true, friendship: 0 };
    g.state.party.push(egg);
    g.state.daycare.stepCounter = eggCycleLength(g.state.gameTime.now.date, false) - 1;
    const score = g.state.records.score;
    g.hold(['up'], 8);
    g.tick();
    expect(g.scripts.starts.at(-1)?.label).toBe(f('Common_HatchEgg'));
    expect(g.state.records.counts[RECORD_EGGS_HATCHED]).toBe(1);
    expect(g.state.records.score).toBe(score + registries.newGame.get(f('NEW_GAME'))!.gameRecords.scoreIncrements[15]!);
  });

  it('runs (4 ticks per tile) with B only once the running shoes are obtained', () => {
    const g = setup();
    const ticksPerTile = () => {
      let n = 0;
      do {
        g.tick(['down', 'b']);
        n++;
      } while (!g.world.idle());
      return n;
    };
    g.hold(['down'], 2);
    expect(ticksPerTile()).toBe(8);
    g.state.runningShoes = true;
    g.tick(['down', 'b']);
    expect(g.world.view().actors[0]!.anim).toBe('run');
    g.hold(['down', 'b'], 3);
    expect(ticksPerTile()).toBe(4);
    expect(g.state.player.z).toBe(19);
  });

  it('auto-run (OpenSinnoh option): with the shoes the player runs without B, and B held walks', () => {
    let on = true;
    const g = setup(undefined, { autoRun: () => on });
    const ticksPerTile = (held: Button[]) => {
      let n = 0;
      do {
        g.tick(held);
        n++;
      } while (!g.world.idle());
      return n;
    };
    g.hold(['down'], 2);
    // No shoes yet: walking either way.
    expect(ticksPerTile(['down'])).toBe(8);
    g.state.runningShoes = true;
    expect(ticksPerTile(['down'])).toBe(4);
    expect(ticksPerTile(['down', 'b'])).toBe(8);
    on = false;
    g.tick();
    g.hold(['up'], 2);
    expect(ticksPerTile(['up'])).toBe(8);
  });

  it('the HGSS look (OpenSinnoh option): the add-on\'s sprite on foot when the packs have it; Platinum\'s otherwise', () => {
    const hero = (g: ReturnType<typeof setup>) => g.world.view().actors[0]!.sprite;
    const plain = setup(undefined, { hgssCharacter: () => true });
    const platinum = hero(plain);
    expect(platinum).not.toBe(HGSS_PLAYER_SPRITES.walk.male);
    const sprites = new Map(registries.sprites);
    sprites.set(HGSS_PLAYER_SPRITES.walk.male as Id, { ...sprites.get(platinum)!, id: HGSS_PLAYER_SPRITES.walk.male as Id });
    const regs = { ...registries, sprites } as Registries;
    let on = true;
    const g = setup(undefined, { regs, hgssCharacter: () => on });
    expect(hero(g)).toBe(HGSS_PLAYER_SPRITES.walk.male);
    on = false;
    expect(hero(setup(undefined, { regs, hgssCharacter: () => on }))).toBe(platinum);
  });

  it('keeps the run frames going over consecutive steps (sprite-anim.ts; no stand frame between steps)', () => {
    const g = setup();
    g.state.runningShoes = true;
    const frames = (held: Button[], ticks: number) =>
      Array.from({ length: ticks }, () => {
        g.tick(held);
        const a = g.world.view().actors[0]!;
        return `${a.anim}:${a.animTick}`;
      });
    // The tap turn (WALK_ON_SPOT_FASTER, 4 frames a tick from frame 0), then three runs from frame 8 on.
    expect(frames(['down', 'b'], 2 + 3 * 4)).toEqual(['walk:4', 'walk:8', 'run:9', 'run:10', 'run:11', 'run:12', 'run:13', 'run:14', 'run:15', 'run:0', 'run:1', 'run:2', 'run:3', 'run:4']);
    expect(g.state.player.z).toBe(19);
    expect(frames([], 2)).toEqual(['stand:0', 'stand:0']);
    // Walking back: the steps alternate feet (frames 1–8, then 9–15 and 0).
    expect(frames(['up'], 2 + 2 * 8)).toEqual(['walk:4', 'walk:8', 'walk:9', 'walk:10', 'walk:11', 'walk:12', 'walk:13', 'walk:14', 'walk:15', 'stand:0', 'walk:1', 'walk:2', 'walk:3', 'walk:4', 'walk:5', 'walk:6', 'walk:7', 'stand:8']);
  });

  it('a held run shows only run pictures, each for exactly 4 ticks (the DS shows no stand picture between steps)', () => {
    // The player's sheet as the ROM's walk_and_run frame sequence binds it facing east: 4 anim frames
    // per picture, walk pictures 12–15 (12 = stand), run pictures 28–31. Picture = the renderer's
    // lookup (spriteFrame: the `<anim>-right` list at animTick % 16; `stand` is walk frame 0).
    const picture = (anim: string, animTick: number) => (anim === 'stand' ? 12 : (anim === 'run' ? 28 : 12) + Math.floor((animTick % 16) / 4));
    const g = setup(newState('TOWN', 5, 5, 'right'));
    g.state.runningShoes = true;
    const shown: number[] = [];
    for (let t = 0; t < 6 * 4; t++) {
      g.tick(['right', 'b']);
      const a = g.world.view().actors[0]!;
      shown.push(picture(a.anim, a.animTick));
    }
    expect(g.state.player.x).toBe(11);
    expect(shown.every((p) => p >= 28)).toBe(true);
    // From a stop at frame 0: frames 1–3 on the first picture, then 4 ticks per picture, in order.
    expect(shown).toEqual([28, 28, 28, ...[29, 30, 31, 28, 29].flatMap((p) => [p, p, p, p]), 30]);
  });

  it('takes terrain height from BDHC plates', () => {
    const t = {
      points: [
        [-256, -256],
        [256, 256],
      ] as [number, number][],
      normals: [[0.5, 1, 0]] as [number, number, number][],
      constants: [-10],
      plates: [{ p1: 0, p2: 1, normal: 0, constant: 0 }],
      strips: [{ z: -256, count: 1, start: 0 }],
      accessList: [0],
    };
    expect(terrainHeight(t, 20, 0, 0)).toBe(0);
    expect(terrainHeight(t, 0, 0, 0)).toBe(10);
    expect(terrainHeight(t, 300, 0, 0)).toBe(null);
  });
});

/** From the spawn in the room, walk onto the exit mat (15,19) and push south into the door warp. */
function leaveRoom(g: ReturnType<typeof setup>) {
  g.hold(['right'], 2 + 8);
  g.hold(['down'], 3 * 8);
  expect(pos(g.state)).toEqual([f('ROOM'), 15, 19, 'down']);
  g.tick(['down']);
  g.settle();
}

describe('warps', () => {
  it('pushing into the blocked warp leaves the room; the player comes out of the town door and goes back in', () => {
    const g = setup();
    leaveRoom(g);
    // The town door (10,13) is blocked: the player walks out of it, south.
    expect(pos(g.state)).toEqual([f('TOWN'), 10, 14, 'down']);
    expect(g.world.view().doors).toBeUndefined();
    // Arriving through a door does not fire the warp under it.
    g.hold([], 5);
    expect(g.state.player.zone).toBe(f('TOWN'));
    // Turn north (2 ticks), then push into the door.
    g.hold(['up'], 3);
    expect(g.world.warpDone()).toBe(false);
    g.settle();
    // ROOM warp 0 is the blocked tile (15,20), not a door: the player walks one step in, onto the mat.
    expect(pos(g.state)).toEqual([f('ROOM'), 15, 19, 'up']);
    expect(g.world.fadeState()).toBe(null);
  });

  it('fades out, loads, and fades in over the warp', () => {
    const g = setup();
    g.hold(['right'], 2 + 8);
    g.hold(['down'], 3 * 8);
    g.tick(['down']);
    // The fade out ends on its last tick, which also loads the map: the screen is fully black once.
    for (let i = 0; i < WARP_FADE_TICKS - 1; i++) g.tick();
    expect(g.state.player.zone).toBe(f('TOWN'));
    expect(g.world.fadeState()?.alpha).toBe(1);
    g.hold([], WARP_FADE_TICKS);
    expect(g.world.fadeState()).toBe(null);
  });
});

/** The fixture door prop at (10,13): 8-tick open and close clips (Prop.animations ticks). */
const { open: OPEN, close: CLOSE } = registries.props.get(f('PROP_DOOR'))!.animations!;
const DOOR = { open: OPEN!, close: CLOSE! };

describe('doors', () => {
  const hero = (g: ReturnType<typeof setup>) => g.world.view().actors[0]!;

  it('arriving through a door: hidden while it opens under the fade in, walks out south, then it closes', () => {
    expect(DOOR.open.ticks).toBe(8);
    const g = setup();
    g.hold(['right'], 2 + 8);
    g.hold(['down'], 3 * 8);
    g.tick(['down']);
    for (let i = 0; i < WARP_FADE_TICKS - 1; i++) g.tick();
    // The load tick: the door's open clip starts (first frame) and the player is hidden on the door tile.
    expect(pos(g.state)).toEqual([f('TOWN'), 10, 13, 'down']);
    expect(g.world.view().doors).toEqual([{ x: 10, z: 13, anim: 'open', tick: 1 }]);
    expect(hero(g).visible).toBe(false);
    g.hold([], DOOR.open.ticks - 1);
    expect(g.world.view().doors).toEqual([{ x: 10, z: 13, anim: 'open', tick: DOOR.open.ticks }]);
    expect(g.world.doorDone()).toBe(true);
    expect(hero(g).visible).toBe(false);
    // Open and faded in (both 8 ticks): the player appears and walks out (8 ticks).
    g.tick();
    expect(hero(g)).toMatchObject({ visible: true, anim: 'walk' });
    g.hold([], 7);
    expect(pos(g.state)).toEqual([f('TOWN'), 10, 14, 'down']);
    expect(g.world.view().doors).toEqual([{ x: 10, z: 13, anim: 'open', tick: DOOR.open.ticks }]);
    // Then the door closes; input is ignored until it has.
    g.tick(['left']);
    expect(g.world.view().doors).toEqual([{ x: 10, z: 13, anim: 'close', tick: 1 }]);
    expect(g.world.idle()).toBe(false);
    g.hold([], DOOR.close.ticks - 1);
    expect(g.world.view().doors).toBeUndefined();
    expect(g.world.idle()).toBe(false);
    g.tick();
    expect(g.world.idle()).toBe(true);
    expect(pos(g.state)).toEqual([f('TOWN'), 10, 14, 'down']);
  });

  it('entering a door: it opens, the player walks in and disappears, it closes, then the fade out', () => {
    const g = setup(newState('TOWN', 10, 14, 'up'));
    g.tick(['up']);
    expect(g.world.view().doors).toEqual([{ x: 10, z: 13, anim: 'open', tick: 1 }]);
    expect(g.world.fadeState()).toBe(null);
    g.hold(['up'], DOOR.open.ticks - 1);
    expect(pos(g.state)).toEqual([f('TOWN'), 10, 14, 'up']);
    // Open: the player walks north onto the (blocked) door tile.
    g.hold(['up'], 8);
    expect(pos(g.state)).toEqual([f('TOWN'), 10, 13, 'up']);
    expect(hero(g).visible).toBe(true);
    g.tick();
    expect(hero(g).visible).toBe(false);
    expect(g.world.view().doors).toEqual([{ x: 10, z: 13, anim: 'close', tick: 1 }]);
    g.hold([], DOOR.close.ticks - 1);
    expect(g.world.fadeState()).toBe(null);
    // Closed: the fade out starts on the next tick, then the map loads.
    g.tick();
    g.hold([], WARP_FADE_TICKS - 1);
    expect(g.world.fadeState()?.alpha).toBe((WARP_FADE_TICKS - 1) / WARP_FADE_TICKS);
    expect(g.state.player.zone).toBe(f('TOWN'));
    g.tick();
    expect(g.state.player.zone).toBe(f('ROOM'));
    g.settle();
    expect(pos(g.state)).toEqual([f('ROOM'), 15, 19, 'up']);
  });

  it('script doors: playDoor finds the door in x-1..x+1 of the row, doorDone waits its ticks, an open is held until closed', () => {
    const g = setup(newState('TOWN', 20, 16));
    expect(g.world.doorDone()).toBe(true);
    g.world.playDoor(11, 13, 'open');
    expect(g.world.doorDone()).toBe(false);
    g.hold([], DOOR.open.ticks - 1);
    expect(g.world.doorDone()).toBe(false);
    g.tick();
    expect(g.world.doorDone()).toBe(true);
    g.hold([], 30);
    expect(g.world.view().doors).toEqual([{ x: 10, z: 13, anim: 'open', tick: DOOR.open.ticks }]);
    g.world.playDoor(9, 13, 'close');
    expect(g.world.view().doors).toEqual([{ x: 10, z: 13, anim: 'close', tick: 0 }]);
    g.hold([], DOOR.close.ticks);
    expect(g.world.doorDone()).toBe(true);
    expect(g.world.view().doors).toBeUndefined();
    expect(() => g.world.playDoor(12, 13, 'open')).toThrow(/no door prop/);
    expect(() => g.world.playDoor(10, 14, 'open')).toThrow(/no door prop/);
  });

  it('the PC (playPcAnimation): the loaded PC prop boots up and holds, then shuts down to rest; none loaded throws', () => {
    const regs = structuredClone(registries);
    const pc = { id: f('PROP_PC'), model: regs.props.get(f('PROP_DOOR'))!.model, animations: { 'pc-on': DOOR.open, 'pc-off': DOOR.close } };
    (regs.props as Map<Id, Prop>).set(pc.id, pc);
    const room = regs.zones.get(f('ROOM'))!;
    // Tile (5, 3) of the room's one chunk: chunk-local units from its centre (16 per tile).
    regs.chunks.get(regs.matrices.get(room.matrix)!.chunks[0]!)!.props.push({ prop: pc.id, position: [5 * 16 + 8 - 256, 0, 3 * 16 + 8 - 256], rotation: [0, 0, 0], scale: [1, 1, 1] });
    const g = setup(newState('ROOM', 14, 16), { regs });
    g.world.playPcAnimation('pc-on');
    expect(g.world.doorDone()).toBe(false);
    g.hold([], DOOR.open.ticks + 10);
    expect(g.world.doorDone()).toBe(true);
    expect(g.world.view().doors).toEqual([{ x: 5, z: 3, anim: 'pc-on', tick: DOOR.open.ticks }]);
    g.world.playPcAnimation('pc-off');
    g.hold([], DOOR.close.ticks);
    expect(g.world.doorDone()).toBe(true);
    expect(g.world.view().doors).toBeUndefined();
    expect(() => setup(newState('ROOM', 14, 16)).world.playPcAnimation('pc-on')).toThrow(/no PC prop loaded/);
  });

  it('a script warp onto the door tile does not play the door', () => {
    const g = setup();
    g.world.warp(f('TOWN'), 10, 13, 'down');
    g.settle();
    expect(g.world.view().doors).toBeUndefined();
    // Blocked arrival tile: one step out, as before.
    expect(pos(g.state)).toEqual([f('TOWN'), 10, 14, 'down']);
  });
});

/** The fixture with stairs in ROOM: east stairs at (20,16) and west stairs at (11,16), linked to each other. */
function stairsRegistries(): Registries {
  const regs = structuredClone(registries);
  const room = regs.zones.get(f('ROOM'))!;
  room.events.warps.push({ x: 20, z: 16, toZone: f('ROOM'), toWarp: 2 }, { x: 11, z: 16, toZone: f('ROOM'), toWarp: 1 });
  const matrix = regs.matrices.get(room.matrix)!;
  const chunk = regs.chunks.get(matrix.chunks[0]!)!;
  chunk.tiles[20 + 16 * 32] = 0x5e;
  chunk.tiles[11 + 16 * 32] = 0x5f;
  return regs;
}

describe('stairs', () => {
  it('fire when pushed, not when stepped on; walk in, then arrive one tile out of the far stairs facing away', () => {
    const g = setup(newState('ROOM', 19, 16), { regs: stairsRegistries() });
    g.hold(['right'], 2 + 8);
    g.hold([], 4);
    expect(pos(g.state)).toEqual([f('ROOM'), 20, 16, 'right']);
    expect(g.world.idle()).toBe(true);
    // Push: walk slowly into the stairs (16 ticks), then the fade.
    g.tick(['right']);
    g.hold([], 15);
    expect(g.state.player.x).toBe(21);
    expect(g.world.fadeState()).toBe(null);
    g.settle();
    // Arrival (decomp sub_02057368): from inside the west stairs, one slow step east onto the warp tile.
    expect(pos(g.state)).toEqual([f('ROOM'), 11, 16, 'right']);
  });
});

describe('escalators', () => {
  it.each([
    ['left', 0x6a, 'right', 12], ['right', 0x6a, 'left', 10],
    ['left', 0x6b, 'left', 10], ['right', 0x6b, 'right', 12],
  ] as const)('entering %s on behaviour %s arrives facing %s off the landing', (enter, behaviour, exit, x) => {
    const regs = { ...structuredClone(registries), tileBehaviors: new Map(registries.tileBehaviors) };
    regs.tileBehaviors.set(f('ESCALATOR'), { id: f('ESCALATOR'), sourceIndex: behaviour, name: behaviour === 0x6a ? 'ESCALATOR_FLIP_FACE' : 'ESCALATOR' });
    const room = regs.zones.get(f('ROOM'))!;
    room.events.warps.push({ x: 20, z: 16, toZone: f('ROOM'), toWarp: 2 }, { x: 11, z: 16, toZone: f('ROOM'), toWarp: 1 });
    const chunk = regs.chunks.get(regs.matrices.get(room.matrix)!.chunks[0]!)!;
    chunk.tiles[10 + 16 * 32] = 0;
    chunk.tiles[20 + 16 * 32] = behaviour;
    chunk.tiles[11 + 16 * 32] = behaviour;
    const g = setup(newState('ROOM', enter === 'left' ? 21 : 19, 16, enter), { regs });
    g.hold([enter], 8);
    g.tick(); // Stepping onto the escalator, unlike pushing into stairs, starts the transition.
    expect(g.world.warpDone()).toBe(false);
    // One WALK_SLOW step in (ov5_021D4A24), two out (sub_02057300 then ov5_021D4858): 16 ticks per tile.
    let between = g.world.view().actors[0]!.cur[0] % 16 !== 8 ? 1 : 0;
    for (let i = 0; i < 200 && !g.world.idle(); i++) {
      g.tick();
      if (g.world.view().actors[0]!.cur[0] % 16 !== 8) between++;
    }
    expect(between).toBe(3 * 15);
    g.settle();
    expect(pos(g.state)).toEqual([f('ROOM'), x, 16, exit]);
    g.hold([], 40);
    expect(pos(g.state)).toEqual([f('ROOM'), x, 16, exit]);
  });
});

describe('map load', () => {
  it('clears map-local vars, runs onTransition before spawning and resolves sprite vars', () => {
    const g = setup();
    leaveRoom(g);
    expect(g.scripts.immediates.map((s) => [s.label, s.source])).toEqual([[f('Town_OnTransition'), 'transition']]);
    expect(g.state.vars[f('VAR_MAP_LOCAL_0')]).toBe(1);
    expect(g.world.view().actors.find((a) => a.localId === 0)?.sprite).toBe(f('SPRITE_GUIDE'));
    g.world.warp(f('ROOM'), 15, 19, 'up');
    g.settle();
    expect(g.state.vars[f('VAR_MAP_LOCAL_0')]).toBe(undefined);
    g.world.warp(f('TOWN'), 10, 14, 'down');
    g.settle();
    expect(g.state.vars[f('VAR_MAP_LOCAL_0')]).toBe(1);
  });

  it('does not spawn objects whose hide flag is set', () => {
    const state = newState('TOWN', 20, 16);
    state.flags[f('FLAG_HIDE_GUIDE')] = true;
    const g = setup(state);
    expect(g.state.objects).toEqual([]);
    g.world.addObject(0);
    expect(g.state.objects.map((o) => [o.localId, o.x, o.z])).toEqual([[0, 44, 16]]);
  });

  it('spawns both objects of a duplicated local id; the id names the first', () => {
    const room = registries.zones.get(f('ROOM'))!;
    const helper = room.events.objects[0]!;
    const zones = new Map(registries.zones).set(room.id, { ...room, events: { ...room.events, objects: [helper, { ...helper, x: 16, z: 12 }] } });
    const state = newState();
    state.vars[f('VAR_ROOM_INTRO')] = 1;
    const world = createWorld({ audio: fixtureAudio(registries, state), registries: { ...registries, zones }, state, scripts: new FakeRunner(state), log: { stub: () => {} }, battleLog: () => {}, battles: { start: () => {}, done: () => null, blackOut: () => {} }, clock: () => DEFAULT_CLOCK });
    world.enter('arrival');
    expect(state.objects.map((o) => [o.localId, o.x, o.z])).toEqual([
      [0, 18, 14],
      [0, 16, 12],
    ]);
    world.removeObject(0);
    expect(state.objects.map((o) => [o.localId, o.x, o.z])).toEqual([[0, 16, 12]]);
    // add_object of the (hidden) first event: the added object takes the local id.
    world.setObjectPosition(0, 17, 12);
    world.addObject(0);
    expect(state.objects.map((o) => [o.localId, o.x, o.z])).toEqual([
      [0, 16, 12],
      [0, 17, 12],
    ]);
  });

  it('enter("load") restores a saved state’s live objects instead of respawning the events', () => {
    const g = setup(newState('TOWN', 20, 16));
    g.world.setObjectPosition(0, 40, 10);
    g.world.removeObject(0);
    g.world.addObject(0);
    g.world.switchMovementType(0, 17);
    g.tick();
    const saved = structuredClone(g.state);
    const world = createWorld({ audio: fixtureAudio(registries, saved), registries, state: saved, scripts: new FakeRunner(saved), log: { stub: () => {} }, battleLog: () => {}, battles: { start: () => {}, done: () => null, blackOut: () => {} }, clock: () => DEFAULT_CLOCK });
    world.enter('load');
    expect(saved.objects).toEqual(g.state.objects);
    expect(world.view().actors.find((a) => a.localId === 0)).toMatchObject({ sprite: f('SPRITE_GUIDE'), facing: 'right' });
    // An empty list (new game) spawns from the events (remove_object set the guide's hide flag).
    saved.objects = [];
    delete saved.flags[f('FLAG_HIDE_GUIDE')];
    world.enter('arrival');
    expect(saved.objects.map((o) => [o.localId, o.x, o.z])).toEqual([[0, 44, 16]]);
  });

  it('a loaded save in a zone with no objects keeps its map-local flags, vars and weather and runs no onTransition or fly unlock; an arrival resets them and unlocks', () => {
    const zones = new Map(registries.zones);
    const route = zones.get(f('ROUTE_W'))!;
    expect(route.events.objects).toEqual([]);
    const arrival = f('FLAG_ON_CYCLING_ROAD'); // stands in for a FLAG_FIRST_ARRIVAL_*
    zones.set(route.id, { ...route, firstArrival: arrival, mapScripts: { ...route.mapScripts, onTransition: f('Town_OnTransition') } });
    const regs = { ...registries, zones } as Registries;
    // The fake runner's Town_OnTransition counts arrivals in VAR_MAP_LOCAL_0 (as Turnback Cave counts rooms).
    const g = setup(newState('ROUTE_W', 40, 16), { regs });
    expect(g.state.vars[f('VAR_MAP_LOCAL_0')]).toBe(1);
    g.state.flags[f('FLAG_MAP_LOCAL_0')] = true;
    g.state.vars[f('VAR_MAP_LOCAL_0')] = 3;
    g.world.setWeather(f('OVERWORLD_WEATHER_DARK_FLASH'));
    expect(g.state.flags[arrival]).toBe(true);
    delete g.state.flags[arrival];
    const saved = structuredClone(g.state);
    expect(saved.objects).toEqual([]);
    const loaded = setup(structuredClone(saved), { regs, entry: 'load' });
    expect(loaded.scripts.immediates.map((s) => s.source)).not.toContain('transition');
    expect(loaded.state.flags[f('FLAG_MAP_LOCAL_0')]).toBe(true);
    expect(loaded.state.vars[f('VAR_MAP_LOCAL_0')]).toBe(3);
    expect(loaded.state.weather).toBe(f('OVERWORLD_WEATHER_DARK_FLASH'));
    expect(loaded.state.flags[arrival]).toBeUndefined();
    const arrived = setup(structuredClone(saved), { regs, entry: 'arrival' });
    expect(arrived.scripts.immediates.map((s) => s.source)).toContain('transition');
    expect(arrived.state.flags[f('FLAG_MAP_LOCAL_0')]).toBeUndefined();
    expect(arrived.state.vars[f('VAR_MAP_LOCAL_0')]).toBe(1); // cleared, then counted by the onTransition
    expect(arrived.state.weather).toBe(f('OVERWORLD_WEATHER_CLEAR'));
    expect(arrived.state.flags[arrival]).toBe(true);
  });

  it('setObject* edit the event for this visit; a live object changes only on its next spawn', () => {
    const g = setup(newState('TOWN', 20, 16));
    const live = { ...g.state.objects[0]! };
    g.world.setObjectPosition(0, 40, 10);
    g.world.setObjectFacing(0, 'up');
    g.world.setObjectMovementType(0, 17);
    g.tick();
    expect(g.state.objects[0]).toEqual(live);
    g.world.removeObject(0);
    g.world.addObject(0);
    expect(g.state.objects[0]).toMatchObject({ x: 40, z: 10, facing: 'up', movementType: 17 });
    // A LOOK_* type turns on its first update (the next tick), not at once.
    g.tick();
    expect(g.state.objects[0]!.facing).toBe('right');
    // switchMovementType changes the live object.
    g.world.switchMovementType(0, 14);
    expect(g.state.objects[0]!.facing).toBe('right');
    g.tick();
    expect(g.state.objects[0]).toMatchObject({ movementType: 14, facing: 'up' });
  });
});

describe('triggers', () => {
  it('onFrame fires first, once its var matches, and only when idle', () => {
    const g = setup(newState(), { introDone: false });
    expect(g.scripts.starts).toEqual([]);
    g.tick();
    expect(g.scripts.starts.map((s) => [s.label, s.source])).toEqual([[f('Room_OnFrame_Intro'), 'frame']]);
    // Not during a step.
    g.hold(['up'], 4);
    g.state.vars[f('VAR_ROOM_INTRO')] = 0;
    g.hold(['up'], 4);
    expect(g.scripts.starts).toHaveLength(1);
    g.tick();
    expect(g.scripts.starts).toHaveLength(2);
  });

  it('frame beats talk; talk to an object passes lastTalked; bg needs the facing', () => {
    const g = setup(newState('ROOM', 17, 14), { introDone: false });
    g.tick();
    g.scripts.starts = [];
    g.hold(['right'], 2);
    g.state.vars[f('VAR_ROOM_INTRO')] = 0;
    g.tick(['a']);
    expect(g.scripts.starts.map((s) => s.source)).toEqual(['frame']);
    g.tick();
    g.tick(['a']);
    expect(g.scripts.starts[1]).toMatchObject({ label: f('Room_Helper'), lastTalked: 0, source: 'object' });
    // TV at (12,12), facing up only.
    g.world.setObjectPosition(0, 18, 18);
    g.world.warp(f('ROOM'), 12, 13, 'left');
    g.settle();
    g.tick(['a']);
    expect(g.scripts.starts).toHaveLength(2);
    g.hold(['up'], 2);
    g.tick();
    g.tick(['a']);
    expect(g.scripts.starts[2]).toMatchObject({ label: f('Room_TV'), source: 'bg' });
  });

  it('a coord trigger fires once, on step completion, while var == value', () => {
    const g = setup(newState('TOWN', 36, 14));
    g.hold(['right'], 2 + 8);
    expect(g.scripts.starts).toHaveLength(0);
    g.hold(['right'], 8);
    expect(g.state.player.x).toBe(38);
    expect(g.scripts.starts).toHaveLength(0);
    g.tick();
    expect(g.scripts.starts.map((s) => [s.label, s.source])).toEqual([[f('Town_GuideScene'), 'coord']]);
    g.hold([], 20);
    expect(g.scripts.starts).toHaveLength(1);
    // Var no longer matches: walking across does nothing.
    g.state.vars[f('VAR_SCENE')] = 1;
    g.hold(['down'], 2 + 8 + 1);
    expect(g.scripts.starts).toHaveLength(1);
  });

  it('ignores movement input while a script runs', () => {
    const g = setup(newState('TOWN', 37, 14));
    g.scripts.hold = true;
    g.hold(['right'], 2 + 8 + 1);
    expect(g.scripts.running()).toBe(true);
    g.hold(['right'], 20);
    expect(g.state.player.x).toBe(38);
    g.scripts.finish();
    g.hold(['right'], 8);
    expect(g.state.player.x).toBe(39);
  });
});

describe('script movements', () => {
  it('runs movement lists with DS durations and reports done', () => {
    const g = setup(newState('TOWN', 38, 16));
    g.world.lockAll();
    g.world.applyMovement(0, f('MV_GUIDE_APPROACH'));
    g.world.applyMovement(LOCALID_PLAYER, f('MV_PLAYER_FACE_EAST'));
    expect(g.world.idle()).toBe(false);
    let ticks = 0;
    while (!g.world.movementDone('all')) {
      g.tick();
      ticks++;
    }
    // Emote (30) + 3 walks (8 each).
    expect(ticks).toBe(30 + 24);
    expect(g.state.objects[0]).toMatchObject({ x: 41, z: 16, facing: 'left' });
    expect(g.state.player.facing).toBe('right');
    g.world.releaseAll();
  });

  it('a LOOK_* object added after lock_all turns to its direction once its movement ends', () => {
    const run = (addAfterLock: boolean) => {
      const g = setup(newState('TOWN', 38, 16));
      g.world.setObjectMovementType(0, 15); // MOVEMENT_TYPE_LOOK_SOUTH
      g.world.switchMovementType(0, 15);
      g.tick();
      if (addAfterLock) g.world.removeObject(0);
      g.world.lockAll();
      if (addAfterLock) g.world.addObject(0);
      g.world.applyMovement(0, f('MV_GUIDE_APPROACH'));
      while (!g.world.movementDone(0)) g.tick();
      g.tick();
      return g.state.objects[0]!.facing;
    };
    // Not paused, first update still pending: decomp MapObject_Move runs the movement type (LOOK_SOUTH).
    expect(run(true)).toBe('down');
    // Present at lock_all: paused, and its one-time turn already ran. MV_GUIDE_APPROACH ends facing left.
    expect(run(false)).toBe('left');
  });

  it('face_player turns the object opposite to the player’s facing (decomp ScrCmd_FacePlayer)', () => {
    const g = setup(newState('TOWN', 38, 16));
    expect(g.state.player.facing).toBe('up');
    g.world.facePlayer(0);
    g.tick();
    expect(g.state.objects[0]!.facing).toBe('down');
  });

  it('logs unknown movement ops and skips them', () => {
    const g = setup(newState('TOWN', 38, 16));
    const mv = { id: f('MV_TEST'), steps: [{ op: '133', count: 2 }, { op: 'walk_fast_north', count: 1 }] };
    (registries.movements as Map<Id, typeof mv>).set(mv.id, mv);
    g.world.applyMovement(0, mv.id);
    for (let i = 0; i < 6; i++) g.tick();
    expect(g.world.movementDone(0)).toBe(true);
    expect(g.stubs.filter((s) => s === 'movement:133')).toHaveLength(2);
    expect(g.state.objects[0]).toMatchObject({ x: 44, z: 15 });
  });

  it('pose actions: the nurse bow ends facing south; give/receive hold on the heal avatar until the state is set', () => {
    const sprites = new Map(registries.sprites);
    const hero = sprites.get(f('SPRITE_HERO'))! as BillboardSprite;
    const guide = sprites.get(f('SPRITE_GUIDE'))! as BillboardSprite;
    sprites.set(f('SPRITE_GUIDE'), { ...guide, animations: { ...guide.animations, 'pose-bow': [{ frame: 0, ticks: 5 }] } });
    sprites.set(f('SPRITE_HEAL'), { ...hero, id: f('SPRITE_HEAL'), animations: { ...hero.animations, 'pose-give': [{ frame: 0, ticks: 21 }], 'pose-receive': [{ frame: 1, ticks: 21 }] } });
    const ng = [...registries.newGame.values()][0]!;
    const regs = { ...registries, sprites, newGame: new Map([[ng.id, { ...ng, playerHealSprite: { male: f('SPRITE_HEAL'), female: f('SPRITE_HEAL') } }]]) } as Registries;
    const moves = registries.movements as Map<Id, { id: Id; steps: { op: string; count: number }[] }>;
    for (const op of ['pokecenter_nurse_bow', 'player_give', 'player_receive']) moves.set(f(`MV_${op}`), { id: f(`MV_${op}`), steps: [{ op, count: 1 }] });

    const g = setup(newState('TOWN', 38, 16), { regs });
    const actor = (id: number) => g.world.view().actors.find((a) => a.localId === id)!;
    g.world.setObjectFacing(0, 'left');
    g.world.applyMovement(0, f('MV_pokecenter_nurse_bow'));
    g.tick();
    expect(actor(0)).toMatchObject({ pose: 'bow', animTick: 1 });
    for (let i = 0; i < 7; i++) g.tick();
    expect(actor(0).pose).toBeUndefined();
    expect(actor(0).facing).toBe('down');
    expect(g.world.movementDone(0)).toBe(true);

    // The plain player sprite has no give pose: logged, drawn standing, same timing.
    g.world.applyMovement(LOCALID_PLAYER, f('MV_player_give'));
    g.tick();
    expect(actor(LOCALID_PLAYER).pose).toBeUndefined();
    expect(g.stubs).toContain('pose:give');
    for (let i = 0; i < 20; i++) g.tick();
    expect(g.world.movementDone(LOCALID_PLAYER)).toBe(true);

    g.world.setPlayerAvatar('heal');
    g.world.applyMovement(LOCALID_PLAYER, f('MV_player_give'));
    for (let i = 0; i < 21; i++) g.tick();
    expect(g.world.movementDone(LOCALID_PLAYER)).toBe(true);
    expect(actor(LOCALID_PLAYER)).toMatchObject({ sprite: f('SPRITE_HEAL'), pose: 'give', animTick: 21 });
    g.world.applyMovement(LOCALID_PLAYER, f('MV_player_receive'));
    g.tick();
    expect(actor(LOCALID_PLAYER)).toMatchObject({ pose: 'receive', animTick: 1 });
    g.world.setPlayerState('walk');
    expect(actor(LOCALID_PLAYER)).toMatchObject({ sprite: f('SPRITE_HERO') });
    expect(actor(LOCALID_PLAYER).pose).toBeUndefined();
  });

  it('free camera moves with LOCALID_CAMERA and restores to the player', () => {
    const g = setup(newState('TOWN', 38, 16));
    g.world.addFreeCamera(38, 10);
    g.tick();
    expect(g.world.view().camera.cur[2]).toBe(10 * 16 + 8);
    g.world.applyMovement(0xf1, f('MV_GUIDE_LEAVE'));
    g.settle();
    expect(g.world.view().camera.cur[0]).toBe(41 * 16 + 8);
    g.world.restoreCamera();
    g.tick();
    expect(g.world.view().camera.cur[0]).toBe(38 * 16 + 8);
  });

  it('an untracked camera object (AddCameraOverrideObject) moves while the view stays on the player', () => {
    const g = setup(newState('TOWN', 38, 16));
    g.world.addFreeCamera(38, 10, false);
    g.world.applyMovement(0xf1, f('MV_GUIDE_LEAVE'));
    g.settle();
    expect(g.world.movementDone(0xf1)).toBe(true);
    expect(g.world.view().camera.cur).toEqual(g.world.view().actors[0]!.cur);
    g.world.restoreCamera();
    g.world.addFreeCamera(38, 10);
    g.tick();
    expect(g.world.view().camera.cur[2]).toBe(10 * 16 + 8);
  });

  it('remove_object sets the object\'s hide flag (decomp MapObject_SetFlagAndDeleteObject)', () => {
    const g = setup(newState('TOWN', 38, 16));
    expect(g.state.objects.map((o) => o.localId)).toContain(0);
    g.world.removeObject(0);
    expect(g.state.objects.map((o) => o.localId)).not.toContain(0);
    expect(g.state.flags[f('FLAG_HIDE_GUIDE')]).toBe(true);
  });

  it('setPositionLive snaps a live object and the player to a tile and facing (decomp SetPosition)', () => {
    const g = setup(newState('TOWN', 38, 16));
    g.world.setPositionLive(0, 40, 18, 'up');
    g.tick();
    expect(g.state.objects[0]).toMatchObject({ localId: 0, x: 40, z: 18, facing: 'up' });
    const view = g.world.view().actors.find((a) => a.localId === 0)!;
    expect([view.cur[0], view.cur[2]]).toEqual([40 * 16 + 8, 18 * 16 + 8]);
    expect(view.prev).toEqual(view.cur);
    g.world.setPositionLive(LOCALID_PLAYER, 36, 16, 'left');
    expect(pos(g.state)).toEqual([f('TOWN'), 36, 16, 'left']);
  });
});

describe('follower', () => {
  it('follows the partner into the tile the player left; a warp deletes it', () => {
    const g = setup(newState('TOWN', 43, 16));
    g.world.switchMovementType(0, MOVEMENT_TYPE_FOLLOW_PLAYER);
    g.world.setObjectPersistent(0, true);
    g.state.hasPartner = true;
    g.hold(['left'], 2 + 8);
    expect(g.state.player.x).toBe(42);
    expect(g.state.follower).toMatchObject({ localId: 0, x: 43, z: 16 });
    g.hold(['up'], 8);
    expect(g.state.follower).toMatchObject({ x: 42, z: 16, facing: 'left' });
    g.hold([], 1);
    expect(g.state.follower).toMatchObject({ x: 42, z: 16 });
    // The player may walk into the partner (they swap).
    g.hold(['down'], 2 + 8);
    expect([g.state.player.x, g.state.player.z]).toEqual([42, 16]);
    expect(g.state.follower).toMatchObject({ x: 42, z: 15 });
    // Not while hasPartner is cleared.
    g.state.hasPartner = false;
    g.hold(['left'], 2 + 8);
    expect(g.state.follower).toMatchObject({ x: 42, z: 15 });
    g.state.hasPartner = true;
    g.settle();
    expect(() => g.world.applyMovement(LOCALID_FOLLOWER, f('MV_PLAYER_FACE_EAST'))).not.toThrow();
    g.settle();
    // Decomp FieldMapChange_DeleteObjects: a warp deletes every object, persistent ones too.
    g.world.warp(f('ROOM'), 15, 18, 'up');
    g.settle();
    expect(g.state.follower).toBeNull();
  });

  it('a follower restored from a save keeps its talk script', () => {
    const g = setup(newState('TOWN', 43, 16));
    g.world.switchMovementType(0, MOVEMENT_TYPE_FOLLOW_PLAYER);
    g.world.setObjectPersistent(0, true);
    g.state.hasPartner = true;
    g.tick();
    expect(g.state.follower).toMatchObject({ localId: 0, label: f('Town_Guide') });
    // Load: a fresh world from a saved state in a zone whose events do not list the follower's script
    // (a partner taken across a zone connection keeps its own zone).
    const saved = structuredClone(g.state);
    saved.player = { ...saved.player, zone: f('ROOM'), x: 15, z: 18 };
    saved.objects = saved.objects.filter((o) => o.localId === 0).map((o) => ({ ...o, x: 15, z: 18 }));
    saved.follower = { ...saved.follower!, x: 15, z: 18 };
    const h = setup(saved, { entry: 'load' });
    expect(h.stubs).not.toContain('follower-label');
    expect(h.state.follower).toMatchObject({ localId: 0, x: 15, z: 18, label: f('Town_Guide') });
    // Step away (the follower takes the tile left), face it and talk.
    h.hold(['up'], 8);
    h.tick();
    h.tick(['down']);
    h.tick();
    h.tick();
    h.tick(['a']);
    expect(h.scripts.starts.at(-1)).toMatchObject({ label: f('Town_Guide'), lastTalked: 0, source: 'object' });
  });

  it('the follow type makes an object pass-through and a switch away keeps it; setObjectPassThrough clears it; saved (MAP_OBJ_STATUS_18)', () => {
    const g = setup(newState('TOWN', 43, 16, 'right'));
    g.hold(['right'], 2 + 8);
    expect(g.state.player.x).toBe(43); // the guide at 44,16 blocks
    g.world.switchMovementType(0, MOVEMENT_TYPE_FOLLOW_PLAYER);
    g.world.switchMovementType(0, 0);
    expect(g.state.objects.find((o) => o.localId === 0)).toMatchObject({ movementType: 0, passThrough: true });
    // A fresh world from that save keeps it.
    const h = setup(structuredClone(g.state), { entry: 'load' });
    expect(h.state.objects.find((o) => o.localId === 0)).toMatchObject({ passThrough: true });
    h.hold(['right'], 2 + 8);
    expect(h.state.player.x).toBeGreaterThanOrEqual(44); // through the guide (no partner: only the status lets the player pass)
    // Cleared (scr_cmd_2b6 <id>, 1): the guide blocks again, and the save no longer marks it.
    g.world.setObjectPassThrough(0, false);
    expect(g.state.objects.find((o) => o.localId === 0)).not.toHaveProperty('passThrough');
    g.hold(['right'], 2 + 8);
    expect(g.state.player.x).toBe(43);
  });

  it('throws when a movement targets a missing object', () => {
    const g = setup();
    expect(() => g.world.applyMovement(7, f('MV_PLAYER_FACE_EAST'))).toThrow(/not present/);
    expect(() => g.world.applyMovement(0xf1, f('MV_PLAYER_FACE_EAST'))).toThrow(/addFreeCamera/);
  });
});

describe('bg facing', () => {
  it('honours one direction, the two axes and any (decomp BG_EVENT_DIR_*)', () => {
    const dirs = ['up', 'down', 'left', 'right'] as const;
    const ok = (req: Parameters<typeof bgFacingMatches>[0]) => dirs.filter((d) => bgFacingMatches(req, d));
    expect(ok('any')).toEqual(dirs);
    expect(ok('horizontal')).toEqual(['left', 'right']);
    expect(ok('vertical')).toEqual(['up', 'down']);
    expect(ok('left')).toEqual(['left']);
  });
});

describe('determinism', () => {
  it('the same inputs give the same state', () => {
    const run = () => {
      const g = setup();
      const script: Button[][] = [['right'], ['right'], ['down'], ['down', 'b'], [], ['left'], ['up'], ['a']];
      for (let i = 0; i < 200; i++) g.tick(script[Math.floor(i / 7) % script.length]);
      return JSON.stringify(g.state);
    };
    expect(run()).toBe(run());
  });
});

describe('contracts 0.8 field members', () => {
  it('setWeather stores the weather and the view follows it (with its darkness); moveCamera offsets until a map load', () => {
    const g = setup();
    expect(g.world.view()).toMatchObject({ weather: f('OVERWORLD_WEATHER_CLEAR'), darkness: null, effects: [], cameraOffset: [0, 0, 0] });
    g.world.setWeather(f('OVERWORLD_WEATHER_DARK_FLASH'));
    expect(g.state.weather).toBe(f('OVERWORLD_WEATHER_DARK_FLASH'));
    expect(g.world.view()).toMatchObject({ weather: f('OVERWORLD_WEATHER_DARK_FLASH'), darkness: { radius: 32 } });
    expect(() => g.world.setWeather(f('OVERWORLD_WEATHER_NOPE'))).toThrow(/missing weathers record/);
    g.world.moveCamera(16, 0, -32);
    expect(g.world.view().cameraOffset).toEqual([16, 0, -32]);
    g.world.enter('load');
    expect(g.world.view().cameraOffset).toEqual([0, 0, 0]);
    expect(() => g.world.surf(0)).toThrow(/no party Pokémon in slot 0/);
  });
});

describe('the registered Bicycle (decomp CanUseBicycle)', () => {
  it('refuses with a partner, in the forced-biking gate, where the zone has no bikes and while surfing', () => {
    const g = setup(newState('TOWN', 38, 16));
    expect(g.world.bicycleCheck()).toBeNull();
    g.state.flags[f('FLAG_FORCE_BIKING_IN_GATE')] = true;
    expect(g.world.bicycleCheck()).toBe('dismount');
    g.state.hasPartner = true;
    expect(g.world.bicycleCheck()).toBe('partner');
    g.state.hasPartner = false;
    g.state.flags[f('FLAG_FORCE_BIKING_IN_GATE')] = false;
    g.state.playerState = 'surf';
    expect(g.world.bicycleCheck()).toBe('generic');
    expect(setup(newState('ROOM')).world.bicycleCheck()).toBe('generic');
  });
});

describe('screen fades', () => {
  it('a fade in of another colour starts fully in that colour (black, then a white fade-in: Contests)', () => {
    const { world } = setup();
    world.fade('out', 4, 'black');
    for (let i = 0; i < 8; i++) world.step({ held: [], pressed: [] } as never);
    expect(world.fadeState()).toEqual({ color: 'black', alpha: 1 });
    world.fade('in', 4, 'white');
    expect(world.fadeState()).toMatchObject({ color: 'white', alpha: 1 });
    for (let i = 0; i < 8; i++) world.step({ held: [], pressed: [] } as never);
    expect(world.fadeDone()).toBe(true);
  });
});
