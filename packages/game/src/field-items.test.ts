import { describe, expect, it } from 'vitest';
import type { Id, PackData } from '@opensinnoh/core';
import type { CreateApp, Item, World, Zone } from '@opensinnoh/contracts';
import { fieldItemCheck, itemUseErrorText } from './field-items.ts';
import { createGame } from './game.ts';
import { CountingStubLog } from './stub-log.ts';
import { createFakeScriptRunner, createFakeWorld } from '../test/fakes.ts';
import { readPack } from '../test/packs.ts';

const BIKE = 'fixture:ITEM_TRAIL_BIKE' as Id;

/**
 * The fixture pack with one key item per field use the check knows (copies of the Trail Bike), a cave
 * that allows the Escape Rope, and a fake app that USEs one item from the bag (the bag's
 * `useFieldItem`, then closing as the bag does).
 */
function setup(bicycle: ReturnType<World['bicycleCheck']> = null) {
  const pack = structuredClone(readPack('fixture')) as PackData;
  const items = pack.registries.items as unknown as Item[];
  const bike = items.find((i) => i.id === BIKE)!;
  const extra: [string, number][] = [
    ['ITEM_POKE_RADAR', 11],
    ['ITEM_SPRAYDUCK', 12],
    ['ITEM_OLD_ROD', 16],
    ['ITEM_ESCAPE_ROPE', 21],
    ['ITEM_VS_SEEKER', 15],
  ];
  for (const [name, fieldUse] of extra) items.push({ ...structuredClone(bike), id: `fixture:${name}`, fieldUse } as Item);
  const town = pack.registries.zones!.find((z) => z.id === 'fixture:TOWN') as unknown as Zone;
  pack.registries.zones!.push({ ...structuredClone(town), id: 'fixture:CAVE', mapType: 'cave', flags: { ...town.flags, escapeRope: true } } as never);
  let use: Id | null = null;
  const createApp: CreateApp = (_request, deps) => {
    return {
      view: () => ({ app: 'start-menu' }) as never,
      step: () => {
        if (!use) return null;
        deps.host.useFieldItem(use);
        use = null;
        return { app: 'start-menu' };
      },
    };
  };
  const log = new CountingStubLog(() => {});
  const createWorld: typeof createFakeWorld = (deps) => ({ ...createFakeWorld(deps), bicycleCheck: () => bicycle });
  const notices: [Id, string[]][] = [];
  const createScriptRunner: typeof createFakeScriptRunner = (deps) => ({ ...createFakeScriptRunner(deps), notice: (text, slots) => void notices.push([text as Id, slots]) });
  const game = createGame({ packs: [pack], createWorld, createScriptRunner, createApp, seed: 1, log, now: () => '2026-10-16T00:00:00.000Z' });
  while (!game.canSave()) game.tick();
  /** Opens the start menu (X), USEs the item and lets the field run it. */
  const bagUse = (item: Id) => {
    game.press('x');
    game.tick();
    game.release('x');
    expect(game.app()).not.toBeNull();
    use = item;
    game.tick();
    expect(game.app()).toBeNull();
  };
  return { game, log, bagUse, notices };
}

describe('field items (decomp sItemUseFuncs): the bag USE and Y share the check and the use', () => {
  it('the Bicycle from the bag: the bag closes, the field mounts, then dismounts with the bike BGM override cleared', () => {
    const { game, bagUse } = setup();
    expect(game.state.playerState).toBe('walk');
    bagUse(BIKE);
    expect(game.state.playerState).toBe('cycle');
    bagUse(BIKE);
    expect(game.state.playerState).toBe('walk');
  });

  it('Y runs the same check and use: refused with the DS message (CanUseBicycle), else mounted', () => {
    const y = (game: ReturnType<typeof setup>['game']) => {
      game.press('y');
      game.tick();
      game.release('y');
      game.tick();
    };
    const refused = setup('dismount');
    refused.game.state.registeredItem = BIKE;
    y(refused.game);
    expect(refused.notices).toEqual([['fixture:Bag_Text_CannotDismount', []]]);
    expect(refused.game.state.playerState).toBe('walk');
    const generic = setup('generic');
    generic.game.state.registeredItem = BIKE;
    y(generic.game);
    expect(generic.notices).toEqual([['fixture:CommonStrings_Text_CantDoThatRightNow', [generic.game.state.names.player]]]);
    const ok = setup();
    ok.game.state.registeredItem = BIKE;
    y(ok.game);
    expect(ok.notices).toEqual([]);
    expect(ok.game.state.playerState).toBe('cycle');
    expect(itemUseErrorText('partner', 'Ari').name).toBe('Bag_Text_CannotUseWithPartner');
    expect(itemUseErrorText('fish', 'Ari').name).toBe('Bag_Text_CannotUseNoFishing');
  });

  it('checks the Poké Radar, Sprayduck, rods and Escape Rope as the decomp does; unimplemented uses are logged', () => {
    const { game, log, bagUse } = setup();
    const d = { registries: game.registries, state: game.state, world: { bicycleCheck: () => null, pokeRadarCheck: () => null, fishingCheck: () => game.state.player.zone === 'fixture:NO_FISHING' ? 'fish' : null } as unknown as World };
    const check = (name: string) => fieldItemCheck(d, `fixture:${name}` as Id);
    for (const name of ['ITEM_POKE_RADAR', 'ITEM_OLD_ROD']) expect(check(name), name).toBeNull();
    // The Sprayduck needs a plant in the berry patch faced (CanUseSprayDuck; the fixture has no berry soil).
    expect(check('ITEM_SPRAYDUCK')).toBe('generic');
    // Escape Rope: only in a cave whose header allows it (CanUseEscapeRope).
    expect(check('ITEM_ESCAPE_ROPE')).toBe('generic');
    game.state.player.zone = 'fixture:CAVE' as Id;
    expect(check('ITEM_ESCAPE_ROPE')).toBeNull();
    // Rods: the Distortion World refuses with "no fishing" (CanUseFishingRod).
    game.state.player.zone = 'fixture:NO_FISHING' as Id;
    expect(check('ITEM_OLD_ROD')).toBe('fish');
    game.state.player.zone = 'fixture:TOWN' as Id;
    // The Poké Radar refuses on the bike.
    game.state.playerState = 'cycle';
    expect(check('ITEM_POKE_RADAR')).toBe('generic');
    game.state.playerState = 'walk';
    // A partner refuses the radar, the Sprayduck, the rods and the Escape Rope first.
    game.state.hasPartner = true;
    for (const name of ['ITEM_POKE_RADAR', 'ITEM_SPRAYDUCK', 'ITEM_OLD_ROD', 'ITEM_ESCAPE_ROPE']) expect(check(name), name).toBe('partner');
    game.state.hasPartner = false;
    // A use whose system the packs lack (the fixture has no Poké Radar tables) is logged and counted, never silent.
    bagUse('fixture:ITEM_POKE_RADAR' as Id);
    expect(log.counts.get('field:item-use:fixture:ITEM_POKE_RADAR')).toBe(1);
  });
});
