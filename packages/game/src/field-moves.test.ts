import { describe, expect, it } from 'vitest';
import type { Id, PackData } from '@opensinnoh/core';
import { setupPokemon, type CreateScriptRunner, type ScriptStart } from '@opensinnoh/contracts';
import { createGame } from './game.ts';
import { CountingStubLog } from './stub-log.ts';
import { createFakeScriptRunner, createFakeWorld } from '../test/fakes.ts';
import { readPack } from '../test/packs.ts';

/**
 * The fixture town with a river on row 0 (Surf), a Rock Smash rock at (10, 20) and the FIELD_MOVES menu
 * labels. The fake VM records each script start.
 */
function setup() {
  const pack = structuredClone(readPack('fixture')) as PackData;
  const reg = pack.registries;
  const river = reg.tileBehaviors!.find((b) => b.id === 'fixture:TILE_BEHAVIOR_WATER_RIVER')!;
  Object.assign(river, { fieldMove: { move: 'fixture:MOVE_SURF', label: 'fixture:Town_OnTransition' } });
  reg.sprites!.push({ id: 'fixture:OBJ_EVENT_GFX_ROCK_SMASH', sourceIndex: 85, model: null });
  const town = reg.zones!.find((z) => z.id === 'fixture:TOWN') as unknown as { events: { objects: unknown[] } };
  town.events.objects.push({ localId: 9, sprite: 'fixture:OBJ_EVENT_GFX_ROCK_SMASH', movementType: 0, trainerType: 0, facing: 'down', data: [0, 0, 0], range: { x: 0, z: 0 }, x: 10, z: 20, y: 0 });
  for (const name of ['Cut', 'RockSmash', 'Strength', 'RockClimb', 'Surf', 'Waterfall', 'Defog', 'Flash']) pack.scripts.labels[`fixture:FieldMoves_Use${name}FromMenu`] = [{ op: 'end', args: [] }];
  const surf = reg.moves!.find((m) => m.id === 'fixture:MOVE_SURF')!;
  for (const name of ['TACKLE', 'CUT', 'ROCK_SMASH', 'DEFOG', 'FLASH', 'FLY']) reg.moves!.push({ ...structuredClone(surf), id: `fixture:MOVE_${name}` } as never);
  const starts: ScriptStart[] = [];
  const createScriptRunner: CreateScriptRunner = (deps) => {
    const r = createFakeScriptRunner(deps);
    return { ...r, start: (s) => (starts.push(s), r.start(s)), running: () => r.running(), step: (i) => r.step(i), view: () => r.view(), runImmediate: (s) => r.runImmediate(s), takeStartMenuRequest: () => r.takeStartMenuRequest() };
  };
  const game = createGame({ packs: [pack], createWorld: createFakeWorld, createScriptRunner, seed: 1, log: new CountingStubLog(() => {}) });
  const place = (x: number, z: number, facing: 'up' | 'down' | 'left' | 'right') => {
    const state = structuredClone(game.state);
    state.player = { zone: 'fixture:TOWN', x, z, y: 0, facing };
    state.objects = [];
    game.load({ format: 'lantern-nds-save', version: 1, savedAt: 'x', state }, 'arrival');
    while (!game.canSave()) game.tick();
  };
  const mon = (slot: number, moves: string[]) => setupPokemon(game.state, game.registries, slot, 'fixture:SPECIES_MOSSLET' as Id, 9, moves as Id[]);
  return { game, starts, place, mon };
}

describe('field moves from the party menu (FieldMoves_SetUsableMoves)', () => {
  it('Surf: facing a behaviour with a fieldMove, with the badge; the menu script gets the slot', () => {
    const { game, starts, place, mon } = setup();
    place(5, 1, 'up');
    game.state.party = [mon(0, ['fixture:MOVE_TACKLE']), mon(1, ['fixture:MOVE_CUT', 'fixture:MOVE_SURF'])];
    expect(game.usableFieldMoves()).toEqual([]);
    expect(() => game.useFieldMove(1, 'fixture:MOVE_SURF')).toThrow('fixture:MOVE_SURF cannot be used here (badge)');
    game.state.badges.push('fixture:BADGE_ID_FEN');
    expect(game.usableFieldMoves()).toEqual([{ slot: 1, move: 'fixture:MOVE_SURF' }]);
    game.state.hasPartner = true;
    expect(() => game.useFieldMove(1, 'fixture:MOVE_SURF')).toThrow('(partner)');
    game.state.hasPartner = false;
    game.state.playerState = 'surf';
    expect(() => game.useFieldMove(1, 'fixture:MOVE_SURF')).toThrow('(state)');
    game.state.playerState = 'walk';
    game.useFieldMove(1, 'fixture:MOVE_SURF');
    expect(starts.at(-1)).toEqual({ label: 'fixture:FieldMoves_UseSurfFromMenu', zone: 'fixture:TOWN', source: 'field-move', params: [1] });
    // Facing away from the water: not usable.
    place(5, 1, 'down');
    expect(() => game.useFieldMove(1, 'fixture:MOVE_SURF')).toThrow('(location)');
    expect(() => game.useFieldMove(0, 'fixture:MOVE_SURF')).toThrow('does not know fixture:MOVE_SURF');
    expect(() => game.useFieldMove(2, 'fixture:MOVE_SURF')).toThrow('no Pokémon in party slot 2');
  });

  it('Rock Smash: the facing object by sprite; the script gets the object as lastTalked; not while surfing', () => {
    const { game, starts, place, mon } = setup();
    game.state.party = [mon(0, ['fixture:MOVE_ROCK_SMASH'])];
    game.state.badges.push('fixture:BADGE_ID_COAL');
    place(10, 19, 'down');
    expect(game.state.objects.some((o) => o.localId === 9)).toBe(true);
    expect(game.usableFieldMoves()).toEqual([{ slot: 0, move: 'fixture:MOVE_ROCK_SMASH' }]);
    game.useFieldMove(0, 'fixture:MOVE_ROCK_SMASH');
    expect(starts.at(-1)).toEqual({ label: 'fixture:FieldMoves_UseRockSmashFromMenu', zone: 'fixture:TOWN', source: 'field-move', params: [0], lastTalked: 9 });
    // The started script runs: the menu needs the idle field.
    expect(() => game.useFieldMove(0, 'fixture:MOVE_ROCK_SMASH')).toThrow(/idle field/);
  });

  it('Defog in FOG and Flash in DARK_FLASH (by weather name); Flash needs no badge; Fly without the Town Map is refused', () => {
    const { game, starts, place, mon } = setup();
    place(20, 20, 'down');
    game.state.party = [mon(0, ['fixture:MOVE_DEFOG', 'fixture:MOVE_FLASH', 'fixture:MOVE_FLY'])];
    game.state.badges.push('fixture:BADGE_ID_RELIC');
    expect(game.usableFieldMoves()).toEqual([]);
    game.state.weather = 'fixture:OVERWORLD_WEATHER_FOG';
    expect(game.usableFieldMoves()).toEqual([{ slot: 0, move: 'fixture:MOVE_DEFOG' }]);
    game.state.weather = 'fixture:OVERWORLD_WEATHER_DARK_FLASH';
    expect(game.usableFieldMoves()).toEqual([{ slot: 0, move: 'fixture:MOVE_FLASH' }]);
    game.useFieldMove(0, 'fixture:MOVE_FLASH');
    expect(starts.at(-1)?.label).toBe('fixture:FieldMoves_UseFlashFromMenu');
    expect(() => setup().game.useFieldMove(0, 'fixture:MOVE_FLY')).toThrow(/party slot 0 does not know/);
    const g = setup();
    g.place(20, 20, 'down');
    g.game.state.party = [g.mon(0, ['fixture:MOVE_FLY'])];
    // The fixture has no NewGame.townMap: Fly is not available (the party menu logs it).
    expect(() => g.game.useFieldMove(0, 'fixture:MOVE_FLY', 0)).toThrow('fixture:MOVE_FLY cannot be used here (unsupported)');
  });
});

describe('Fly and Teleport (FieldMoves_CheckFly, FieldMoves_CheckTeleport)', () => {
  /** The fixture with a one-location Town Map (Terrain's fly point, spawn 1) and Terrain as the blackout spawn. */
  function flySetup() {
    const pack = structuredClone(readPack('fixture')) as PackData;
    const reg = pack.registries;
    const surf = reg.moves!.find((m) => m.id === 'fixture:MOVE_SURF')!;
    for (const name of ['FLY', 'TELEPORT', 'DIG', 'CHATTER']) reg.moves!.push({ ...structuredClone(surf), id: `fixture:MOVE_${name}` } as never);
    pack.scripts.labels['fixture:RecordChatotCry_Chatter'] = [{ op: 'end', args: [] }];
    const flag = reg.flags![0]!.id;
    // The system flags the checks read (decomp FLAG_SAFARI_GAME_ACTIVE, FLAG_IN_PAL_PARK).
    reg.flags!.push({ id: 'fixture:FLAG_SAFARI_GAME_ACTIVE' as Id, sourceIndex: 2407, initial: false, scope: 'saved' }, { id: 'fixture:FLAG_IN_PAL_PARK' as Id, sourceIndex: 2425, initial: false, scope: 'saved' });
    const sheet = reg.ui2d![0]!.id;
    Object.assign(reg.newGame![0]!, {
      flyDestinations: [{ zone: 'fixture:TERRAIN', x: 3, z: 4 }],
      townMap: { screen: sheet, cursor: sheet, player: { male: sheet, female: sheet }, blocks: [sheet, sheet, sheet, sheet, sheet], matrix: 'fixture:MATRIX_ROUTE', everywhere: 'fixture:TOWN', names: [], cells: [], hidden: [], flyToWhere: reg.texts![0]!.id, locations: [{ zone: 'fixture:TERRAIN', flag, shape: 0, palette: 0, sprite: [0, 0], spawn: 1 }] },
    });
    const terrain = reg.zones!.find((z) => z.id === 'fixture:TERRAIN')! as unknown as { blackOut: unknown };
    terrain.blackOut = { spawn: 1, x: 1, z: 1, label: 'fixture:Town_OnTransition' };
    const game = createGame({ packs: [pack], createWorld: createFakeWorld, createScriptRunner: createFakeScriptRunner, seed: 1, log: new CountingStubLog(() => {}) });
    const place = (zone: string) => {
      const state = structuredClone(game.state);
      state.player = { zone: zone as Id, x: 1, z: 1, y: 0, facing: 'down' };
      state.objects = [];
      game.load({ format: 'lantern-nds-save', version: 1, savedAt: 'x', state }, 'arrival');
      while (!game.canSave()) game.tick();
    };
    return { game, place, mon: (moves = ['fixture:MOVE_FLY', 'fixture:MOVE_TELEPORT']) => setupPokemon(game.state, game.registries, 0, 'fixture:SPECIES_MOSSLET' as Id, 9, moves as Id[]) };
  }

  it('Fly needs the Cobble Badge and a map header that allows it; no partner, Safari Game or Pal Park', () => {
    const { game, place, mon } = flySetup();
    place('fixture:TERRAIN');
    game.state.party = [mon()];
    expect(() => game.useFieldMove(0, 'fixture:MOVE_FLY', 0)).toThrow('(badge)');
    game.state.badges.push('fixture:BADGE_ID_COBBLE');
    expect(game.usableFieldMoves()).toEqual([{ slot: 0, move: 'fixture:MOVE_FLY' }, { slot: 0, move: 'fixture:MOVE_TELEPORT' }]);
    game.state.hasPartner = true;
    expect(() => game.useFieldMove(0, 'fixture:MOVE_FLY', 0)).toThrow('(partner)');
    game.state.hasPartner = false;
    game.state.flags['fixture:FLAG_SAFARI_GAME_ACTIVE' as Id] = true;
    expect(() => game.useFieldMove(0, 'fixture:MOVE_FLY', 0)).toThrow('(location)');
    game.state.flags['fixture:FLAG_SAFARI_GAME_ACTIVE' as Id] = false;
    game.state.flags['fixture:FLAG_IN_PAL_PARK' as Id] = true;
    expect(() => game.useFieldMove(0, 'fixture:MOVE_TELEPORT')).toThrow('(location)');
    game.state.flags['fixture:FLAG_IN_PAL_PARK' as Id] = false;
    expect(() => game.useFieldMove(0, 'fixture:MOVE_FLY')).toThrow("Fly needs the Town Map's location");
    // The flight goes to the location's spawn's fly position.
    expect(() => game.useFieldMove(0, 'fixture:MOVE_FLY', 0)).toThrow('fake world: fly 0 {"zone":"fixture:TERRAIN","x":3,"z":4}');
    place('fixture:ROOM');
    game.state.party = [mon()];
    expect(() => game.useFieldMove(0, 'fixture:MOVE_FLY', 0)).toThrow('(location)');
  });

  it("Teleport needs no badge, refuses towns and cities, and lands at the blackout spawn's fly position", () => {
    const { game, place, mon } = flySetup();
    place('fixture:TERRAIN');
    game.state.party = [mon()];
    expect(() => game.useFieldMove(0, 'fixture:MOVE_TELEPORT')).toThrow('fake world: teleport 0 {"zone":"fixture:TERRAIN","x":3,"z":4}');
    const town = game.registries.zones.get('fixture:TOWN' as Id)!;
    town.flags.fly = true;
    place('fixture:TOWN');
    game.state.party = [mon()];
    expect(() => game.useFieldMove(0, 'fixture:MOVE_TELEPORT')).toThrow('(location)');
    expect(() => game.useFieldMove(0, 'fixture:MOVE_FLY', 0)).toThrow('(badge)');
  });

  it('Dig: a cave that allows an Escape Rope, no partner; it lands at the exit location with its facing', () => {
    const { game, place, mon } = flySetup();
    const terrain = game.registries.zones.get('fixture:TERRAIN' as Id)!;
    place('fixture:TERRAIN');
    game.state.party = [mon(['fixture:MOVE_DIG'])];
    expect(() => game.useFieldMove(0, 'fixture:MOVE_DIG')).toThrow('(location)');
    Object.assign(terrain, { mapType: 'cave', flags: { ...terrain.flags, escapeRope: false } });
    expect(() => game.useFieldMove(0, 'fixture:MOVE_DIG')).toThrow('(location)');
    terrain.flags.escapeRope = true;
    game.state.hasPartner = true;
    expect(() => game.useFieldMove(0, 'fixture:MOVE_DIG')).toThrow('(partner)');
    game.state.hasPartner = false;
    game.state.escapeLocation = { zone: 'fixture:TOWN' as Id, x: 7, z: 8, facing: 'left' };
    expect(game.usableFieldMoves()).toEqual([{ slot: 0, move: 'fixture:MOVE_DIG' }]);
    expect(() => game.useFieldMove(0, 'fixture:MOVE_DIG')).toThrow('fake world: dig 0 {"zone":"fixture:TOWN","x":7,"z":8,"facing":"left"}');
  });

  it('Chatter anywhere outside the Distortion World, as its script (RECORD_CHATOT_CRY 0)', () => {
    const { game, place, mon } = flySetup();
    place('fixture:TOWN');
    game.state.party = [mon(['fixture:MOVE_CHATTER'])];
    expect(game.usableFieldMoves()).toEqual([{ slot: 0, move: 'fixture:MOVE_CHATTER' }]);
    game.useFieldMove(0, 'fixture:MOVE_CHATTER');
    expect(game.scripts.running()).toBe(true);
  });
});
