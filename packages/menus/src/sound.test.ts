import { describe, expect, it } from 'vitest';
import { DEFAULT_CLOCK, type Button } from '@opensinnoh/core';
import { DEFAULT_DEVICE_OPTIONS, type AppRequest, type AppHost, type PartyView } from '@opensinnoh/contracts';
import { audioTrace, fixtureAudio, withFieldSounds } from '../../../tests/fixtures/audio.ts';
import { f, mon, newState, registries } from '../../world/src/testing.ts';
import { createApp } from './index.ts';

function open(request: AppRequest = { app: 'start-menu' }) {
  const regs = withFieldSounds(registries);
  const state = newState();
  state.party = [mon('SPECIES_MOSSLET', 10), mon('SPECIES_DRIPLING', 10)];
  state.bag.items = [{ item: f('ITEM_LAMP_OIL'), count: 20 }];
  state.bag.medicine = [{ item: f('ITEM_TONIC'), count: 2 }];
  const audio = fixtureAudio(regs, state);
  const sounds = audioTrace(audio, regs, () => state.tick);
  const host: AppHost = { sound: audio, options: () => ({ ...DEFAULT_DEVICE_OPTIONS }), setOption: () => {}, save: () => {}, fieldMoveCheck: () => null, useFieldMove: () => {}, fieldItemCheck: () => null, useFieldItem: () => {}, clock: () => DEFAULT_CLOCK };
  const app = createApp(request, { registries: regs, state, host, log: { stub: () => {} } });
  const step = (button?: Button, tap?: string, pressed = true) => {
    const result = app.step({ held: button ? [button] : [], pressed: button && pressed ? [button] : [], touch: null, ...(tap ? { tap } : {}) });
    audio.tick();
    state.tick++;
    return result;
  };
  const trace = () => sounds.map(({ tick, source, op }) => [tick, op, source]);
  return { app, state, step, trace, sounds };
}

describe('accepted menu sound transitions', () => {
  it('start cursor uses 1504, confirmation/cancel use 1500, ignored input stays silent', () => {
    const g = open();
    g.step('left');
    g.step('down');
    g.step('up');
    g.step(undefined, 'entry:99');
    g.step('b');
    expect(g.trace()).toEqual([[1, 'start', 1504], [2, 'start', 1504], [4, 'start', 1500]]);
  });

  it('held start-menu movement sounds only at accepted repeat callbacks, at 8 then every 4 ticks', () => {
    const g = open();
    g.step('down');
    for (let i = 1; i <= 12; i++) g.step('down', undefined, false);
    expect(g.trace()).toEqual([[0, 'start', 1504], [8, 'start', 1504], [12, 'start', 1504]]);
  });

  it('bag rows cycle rustles and pockets use 1738; opening and rendering never rustle', () => {
    const g = open();
    g.step(undefined, 'entry:1'); // Pokémon and bag precede the card; no Pokédex yet.
    g.sounds.length = 0;
    g.app.view(); g.app.view();
    g.step('down'); g.step(); g.step('up'); g.step(); g.step('down'); g.step(); g.step('up');
    g.step('right');
    expect(g.trace()).toEqual([[1, 'start', 1740], [3, 'start', 1741], [5, 'start', 1742], [7, 'start', 1740], [8, 'start', 1738]]);
  });

  it('a medicine with no effect: the pick confirms, the message is silent and A goes back to the bag; an Egg buzzes and stays', () => {
    const g = open();
    g.step(undefined, 'entry:1');
    g.step(undefined, 'pocket:1');
    g.step(undefined, 'row:0');
    g.step(undefined, 'menu:0'); // USE: "Use it on whom?"
    expect(g.app.view().app).toBe('party');
    g.sounds.length = 0;
    // Both are at full HP (decomp ApplyItemEffectOnPokemon: "It won't have any effect.", PartyMenuCB_PrintThenWaitABPress).
    g.step(undefined, 'slot:1');
    expect((g.app.view() as PartyView).message?.text).toBe('That would do nothing.');
    g.step('a');
    expect(g.app.view().app).toBe('bag');
    expect(g.sounds.map((s) => s.source)).toEqual([1500]);
    expect(g.state.bag.medicine).toEqual([{ item: f('ITEM_TONIC'), count: 2 }]);
    // HandleSpecialInput: an Egg cannot be picked (SEQ_SE_DP_CUSTOM06), the party stays without a message.
    g.state.party[1] = { ...g.state.party[1]!, isEgg: true };
    g.step(undefined, 'row:0');
    g.step(undefined, 'menu:0');
    g.sounds.length = 0;
    g.step(undefined, 'slot:1');
    expect(g.app.view()).toMatchObject({ app: 'party', message: null });
    expect(g.sounds.map((s) => s.source)).toEqual([1522]);
  });

  it('party swap swaps at once and cues on the swap and 17 ticks later, without holding input', () => {
    const g = open();
    g.step(undefined, 'entry:0');
    g.step(undefined, 'slot:0');
    g.step(undefined, 'menu:1'); // SWITCH (no field moves on this fixture mon).
    g.sounds.length = 0;
    const at = g.state.tick;
    g.step(undefined, 'slot:1');
    expect(g.state.party[0]!.species).toBe(f('SPECIES_DRIPLING'));
    for (let i = 0; i < 20; i++) g.step();
    const [first, second] = g.sounds.filter((s) => s.source === 1696).map((s) => [s.tick - at, s.source]);
    expect(first![1]).toBe(1696);
    expect(second).toEqual([first![0]! + 17, 1696]);
  });

  it('summary page changes sound only when a different page is allowed', () => {
    const g = open();
    g.step(undefined, 'entry:0');
    g.step(undefined, 'slot:0');
    g.step(undefined, 'menu:0');
    g.sounds.length = 0;
    g.step('right');
    const v = g.app.view();
    if (v.app !== 'summary') throw new Error('expected summary');
    g.step(undefined, `page:${v.page}`);
    g.step('b');
    expect(g.sounds.map((s) => s.source)).toEqual([1505, 1501]);
  });
});

it('a mart purchase confirms before the register cue, in the same tick, once', () => {
  const g = open({ app: 'mart', mart: f('MART_COMMON'), countVar: null, greeting: null });
  g.state.money = 3000;
  g.step('a'); g.step(); // BUY
  g.step('a'); g.step(); // item
  g.step('a'); g.step(); // quantity
  g.sounds.length = 0;
  const at = g.state.tick;
  g.step('a'); // YES
  expect(g.sounds.map((s) => [s.tick - at, s.source])).toEqual([[0, 1500], [0, 1604]]);
});

describe('naming keyboard sounds (naming_screen.c)', () => {
  it('moves and Start confirm, a key BOX02, BACK confirms only when a character goes, a page SYU03, OK PIRORIRO', () => {
    const g = open({ app: 'naming', kind: 'box', initial: '', maxLength: 8, gender: 'male', pokemon: null });
    g.step('down'); // onto the first key row
    g.step('a'); // a character
    g.step('b'); // it goes
    g.step('b'); // nothing to delete: silent
    g.step('select'); // the next page
    g.step(undefined, 'page:1'); // already there: silent
    g.step(undefined, 'type:k'); // a typed character
    g.step('start'); // to OK
    g.step('a'); // OK
    expect(g.trace().map(([tick, , source]) => [tick, source])).toEqual([[0, 1500], [1, 1515], [2, 1500], [4, 1694], [6, 1515], [7, 1500], [8, 1506]]);
  });
});
