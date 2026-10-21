import { describe, expect, it } from 'vitest';
import { createGame, saveToJson } from '@opensinnoh/game';
import { createWorld } from '@opensinnoh/world';
import { createScriptRunner } from '@opensinnoh/vm';
import { itemCount } from '@opensinnoh/contracts';
import { readPack } from '../../../game/test/packs.ts';
import type { Session } from '../boot.ts';
import { debugActions, integer } from './actions.ts';

function setup() {
  const game = createGame({ packs: [readPack('fixture')], createWorld, createScriptRunner, seed: 1 });
  for (let i = 0; i < 600 && !(game.canSave() && game.state.vars['fixture:VAR_ROOM_INTRO'] === 1); i++) {
    if (game.scripts.view().message?.waitingForInput) { game.press('a'); game.tick(); game.release('a'); }
    game.tick();
  }
  expect(game.canSave()).toBe(true);
  const session = { game, load: async (json: string) => game.load(JSON.parse(json)) } as Session;
  return { game, session, actions: debugActions(() => session) };
}

describe('developer state edits over the fixture', () => {
  it('sets, clears and resets flags and vars, rejecting invalid input without edits', () => {
    const { game, actions } = setup();
    const flag = 'fixture:FLAG_TALKED_TO_HELPER';
    actions.flag(flag, true); expect(game.state.flags[flag]).toBe(true);
    actions.flag(flag, false); expect(game.state.flags[flag]).toBeUndefined();
    const variable = 'fixture:VAR_SCENE';
    actions.variable(variable, '42'); expect(game.state.vars[variable]).toBe(42);
    actions.variable(variable, null); expect(game.state.vars[variable]).toBeUndefined();
    expect(() => actions.variable(variable, '65536')).toThrow();
    expect(() => actions.flag('fixture:missing', true)).toThrow(/Unknown/);
    for (const value of ['', '-1', '1.5', 'NaN', 'Infinity', '1e2']) expect(() => integer(value, 0, 999)).toThrow();
  });
  it('gives items and Pokémon, records the dex and sends a full party gift to a PC box', () => {
    const { game, actions } = setup();
    actions.item('fixture:ITEM_TONIC', '2');
    expect(itemCount(game.state, 'fixture:ITEM_TONIC')).toBe(2);
    for (let i = 0; i < 7; i++) actions.pokemon('fixture:SPECIES_MOSSLET', '7');
    expect(game.state.party).toHaveLength(6);
    expect(game.state.boxes[0]!.slots[0]).toMatchObject({ species: 'fixture:SPECIES_MOSSLET', level: 7 });
    expect(game.state.pokedex.caught).toContain('fixture:SPECIES_MOSSLET');
    expect(() => actions.pokemon('fixture:SPECIES_MOSSLET', '101')).toThrow();
    // The dev-only events need the ROM's records (the fixture has none: a loud error, no edit).
    expect(() => actions.event('mew')).toThrow(/Unknown event/);
    expect(() => actions.event('darkrai')).toThrow(/no (var|item)/);
  });
  it('uses a real warp and freezes the clock, refusing edits during the warp', () => {
    const { game, actions } = setup();
    actions.clock('2024-02-29', '21:30');
    expect(game.clock()).toMatchObject({ date: '2024-02-29', hour: 21, minute: 30 });
    expect(() => actions.warp('fixture:TOWN', '-1', '14')).toThrow();
    actions.warp('fixture:TOWN', '10', '14');
    expect(() => actions.item('fixture:ITEM_TONIC', '1')).toThrow(/idle/);
    for (let i = 0; i < 120; i++) game.tick();
    expect(game.state.player).toMatchObject({ zone: 'fixture:TOWN', x: 10, z: 14 });
  });
  it('loads a cached state and its clock, validates before changing the clock, and follows a replaced session', async () => {
    const first = setup();
    const second = setup();
    let live = first.session;
    const actions = debugActions(() => live);
    live = second.session;
    actions.variable('fixture:VAR_SCENE', '17');
    expect(first.game.state.vars['fixture:VAR_SCENE']).toBeUndefined();
    second.game.setClock('2024-02-29', '21:30');
    second.game.tick();
    const save = saveToJson(second.game.save());
    actions.variable('fixture:VAR_SCENE', '23');
    actions.clock('2025-03-01', '10:00');
    await expect(actions.checkpoint('{}')).rejects.toThrow();
    expect(second.game.clock().date).toBe('2025-03-01');
    await actions.checkpoint(save);
    expect(second.game.state.vars['fixture:VAR_SCENE']).toBe(17);
    expect(second.game.clock()).toMatchObject({ date: '2024-02-29', hour: 21, minute: 30 });
  });
});
