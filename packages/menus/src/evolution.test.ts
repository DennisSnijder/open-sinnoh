/**
 * The evolution scene (decomp evolution.c) and its triggers in the menus on the fixture pack: after a
 * battle (with B to cancel), the moves of the new level with the forget flow, the Rare Candy-style level
 * item and an evolution stone from the bag.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLOCK, readPackFolder, type Button, type Id } from '@opensinnoh/core';
import { DEFAULT_DEVICE_OPTIONS, giveItem, itemCount, setupPokemon, type AppHost, type AppModel, type AppRequest, type AppResult, type EvolutionView, type GameState, type PartyView } from '@opensinnoh/contracts';
import { loadGamePacks, newGameState } from '@opensinnoh/game';
import { createApp } from './index.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const pack = readPackFolder((p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined), 'packs/fixture');
const { registries, loaded } = loadGamePacks([pack]);
const record = [...registries.newGame.values()][0]!;
const id = (s: string) => `fixture:${s}` as Id;

function fresh(level: number, moves: string[] = []): GameState {
  const s = newGameState(record, registries, loaded.order, 1);
  s.party.push(setupPokemon(s, registries, 0, id('SPECIES_MOSSLET'), level, moves.map((m) => id(`MOVE_${m}`))));
  return s;
}

function open(s: GameState, request: AppRequest): AppModel {
  const options = { ...DEFAULT_DEVICE_OPTIONS };
  const host: AppHost = { options: () => options, setOption: () => {}, save: () => {}, fieldMoveCheck: () => 'location', useFieldMove: () => {}, fieldItemCheck: () => null, useFieldItem: () => {}, clock: () => DEFAULT_CLOCK };
  return createApp(request, { registries, state: s, log: { stub: () => {} }, host });
}

const idle = { held: [] as Button[], pressed: [] as Button[], touch: null };
/**
 * Runs the app: A on every waiting message (down one tick, up the next), `answer` for the YES/NO windows,
 * B once when `cancel` and the scene allows it. Returns the result and the views seen.
 */
function run(app: AppModel, o: { cancel?: boolean; answer?: (v: EvolutionView | PartyView) => string | null; max?: number } = {}): { result: AppResult | null; ticks: number; views: string[]; cancellable: number } {
  let down = false;
  let cancelled = false;
  let cancellable = 0;
  const views: string[] = [];
  for (let n = 1; n <= (o.max ?? 3000); n++) {
    const v = app.view();
    views.push(v.app);
    let frame = idle;
    if (v.app === 'evolution' && v.cancellable) cancellable++;
    if (down) down = false;
    else if (o.cancel && !cancelled && v.app === 'evolution' && v.cancellable) {
      cancelled = true;
      frame = { ...idle, pressed: ['b'], held: ['b'] };
    } else if ((v.app === 'evolution' || v.app === 'party') && v.yesNo) {
      const tap = o.answer?.(v) ?? 'no';
      const r = app.step({ ...idle, tap });
      if (r) return { result: r, ticks: n, views, cancellable };
      continue;
    } else if (v.app === 'summary' && o.answer) {
      const tap = o.answer(v as never);
      if (tap) {
        const r = app.step({ ...idle, tap });
        if (r) return { result: r, ticks: n, views, cancellable };
        continue;
      }
    } else if ((v.app === 'evolution' || v.app === 'party') && v.message?.waiting) {
      down = true;
      frame = { ...idle, pressed: ['a'], held: ['a'] };
    } else if (v.app === 'party' && (v as PartyView).menu?.cursor === -1) {
      // The level-up stats window.
      down = true;
      frame = { ...idle, pressed: ['a'], held: ['a'] };
    }
    const r = app.step(frame);
    if (r) return { result: r, ticks: n, views, cancellable };
  }
  return { result: null, ticks: o.max ?? 3000, views, cancellable };
}

describe('the evolution scene (decomp evolution.c)', () => {
  it('after a battle: "What?", the swap until the emitters end, the new species, the Pokédex and the move of the level', () => {
    const s = fresh(16, ['BOP', 'STARE']);
    const before = s.party[0]!.stats.hp;
    const app = open(s, { app: 'evolution', slot: 0, target: id('SPECIES_MOSSGROVE'), method: 'LEVEL', source: 'battle' });
    const first = app.view() as EvolutionView;
    expect(first.sprites.map((p) => [p.species, p.scale])).toEqual([[id('SPECIES_MOSSLET'), 256], [id('SPECIES_MOSSGROVE'), 0]]);
    expect(first.fade).toEqual({ level: 16, color: 'black', box: true });
    const { result, cancellable } = run(app);
    expect(result).toEqual({ app: 'evolution', evolved: true });
    // The fixture's longest emitter emits for 60 frames and its last particle lives 30: 90 ticks of swapping.
    expect(cancellable).toBe(90);
    const mon = s.party[0]!;
    expect([mon.species, mon.nickname, mon.ability]).toEqual([id('SPECIES_MOSSGROVE'), null, id('ABILITY_SPROUT')]);
    expect(mon.stats.hp).toBeGreaterThan(before);
    expect(s.pokedex.caught).toContain(id('SPECIES_MOSSGROVE'));
    // Decomp Poketch_PokemonHistoryEnqueue: the evolved Pokémon joins the Pokétch's history.
    expect(s.poketch.history.at(-1)).toEqual({ species: id('SPECIES_MOSSGROVE'), form: 0 });
    // Mossgrove learns Quick Dash at 16 (Mosslet's moves were set by hand without it).
    expect(mon.moves).toEqual([id('MOVE_BOP'), id('MOVE_STARE'), id('MOVE_QUICK_DASH')]);
  });

  it('runs one decomp frame per 30 Hz tick: "What?" to "Congratulations!" takes 275 ticks', () => {
    // SysTask_Evolution is a main-loop task and NitroMain waits two vblanks per loop, so Evolution_Main,
    // the palette fade task, the sprite fades (VBlank callback), the particles (sub_0207C770) and the
    // sprite animations all step once per tick; the print task runs twice per loop. On the fixture, with
    // the default text speed (4: a character every 4 render calls, so every 2 ticks), no sound host (no
    // cry to wait for), A pressed the tick a message waits:
    //   10  "Oh?{clear}": 3 characters (6), A (1), the printer ends (1), WAIT_PRINT_WHAT sees it (1), the fade check (1)
    //   41  "Mosslet is changing!": 20 characters (40), WAIT_PRINT_POKEMON_IS_EVOLVING sees it (1); Mosslet's 24-tick animation ends first
    //   20  START_FADE's delay
    //   40  CLAMP_IN's delay (the window clamps 2 rows a tick)
    //   90  ANIMATION_ALTERNATE_POKEMON until the emitters end: the longest emits for 60 frames and its last particle lives 30
    //   32  CLAMP_OUT_AND_FADE: the white fade (0 → 16 by 2, wait 2: 8 steps of 3 ticks = 24), then delay 8
    //   41  the fade back (16 → 0 by 2, wait 4: 8 steps of 5 ticks = 40), PLAY_EVOLVED_POKEMON_ANIMATION_AND_CRY sees it (1)
    //    1  Mossgrove has no animation: SET_POKEMON_VALUES_AND_PRINT_CONGRATULATIONS the next tick
    // At 60 Hz (two decomp frames a tick) it would take about half.
    const s = fresh(16, ['BOP', 'STARE']);
    const app = open(s, { app: 'evolution', slot: 0, target: id('SPECIES_MOSSGROVE'), method: 'LEVEL', source: 'battle' });
    let what = 0;
    let down = false;
    for (let n = 1; n < 1000; n++) {
      const v = app.view() as EvolutionView;
      const press: boolean = !down && !!v.message?.waiting;
      down = press;
      app.step(press ? { ...idle, pressed: ['a'], held: ['a'] } : idle);
      const after = app.view() as EvolutionView;
      if (!what && after.message?.text === 'O') what = n;
      // The step that ran SET_POKEMON_VALUES_AND_PRINT_CONGRATULATIONS evolves the Pokémon.
      if (s.party[0]!.species === id('SPECIES_MOSSGROVE')) {
        expect([what, n - what]).toEqual([18, 10 + 41 + 20 + 40 + 90 + 32 + 41 + 1]);
        return;
      }
    }
    throw new Error('the Pokémon did not evolve');
  });

  it('B while the silhouettes swap stops it: "Huh?", nothing changes', () => {
    const s = fresh(16);
    const species = s.party[0]!.species;
    const app = open(s, { app: 'evolution', slot: 0, target: id('SPECIES_MOSSGROVE'), method: 'LEVEL', source: 'battle' });
    const { result } = run(app, { cancel: true });
    expect(result).toEqual({ app: 'evolution', evolved: false });
    expect(s.party[0]!.species).toBe(species);
    expect(s.pokedex.caught).not.toContain(id('SPECIES_MOSSGROVE'));
  });

  it('an evolution stone cannot be stopped (no cancellable phase)', () => {
    const s = fresh(16);
    const app = open(s, { app: 'evolution', slot: 0, target: id('SPECIES_MOSSGROVE'), method: 'USE_ITEM', source: 'item' });
    const { result, cancellable } = run(app, { cancel: true });
    expect([result, cancellable]).toEqual([{ app: 'evolution', evolved: true }, 0]);
  });

  it('a fifth move: "Should a move be deleted?" YES, the summary forgets one; NO then YES gives up', () => {
    const s = fresh(20, ['BOP', 'STARE', 'LEAF_TAP', 'BARK_SHIELD']);
    let app = open(s, { app: 'evolution', slot: 0, target: id('SPECIES_MOSSGROVE'), method: 'LEVEL', source: 'battle' });
    const seen: string[] = [];
    run(app, {
      answer: (v) => {
        if (v.app === 'evolution') return 'yes';
        seen.push(v.app);
        return 'move:1';
      },
    });
    expect(seen[0]).toBe('summary');
    expect(s.party[0]!.moves).toEqual(['BOP', 'DIG_PAW', 'LEAF_TAP', 'BARK_SHIELD'].map((m) => id(`MOVE_${m}`)));

    const t = fresh(20, ['BOP', 'STARE', 'LEAF_TAP', 'BARK_SHIELD']);
    app = open(t, { app: 'evolution', slot: 0, target: id('SPECIES_MOSSGROVE'), method: 'LEVEL', source: 'battle' });
    let asked = 0;
    // "Should a move be deleted?" NO → "Stop trying to teach?" YES.
    expect(run(app, { answer: () => (asked++ === 0 ? 'no' : 'yes') }).result).toEqual({ app: 'evolution', evolved: true });
    expect([asked, t.party[0]!.moves.length, t.party[0]!.moves.includes(id('MOVE_DIG_PAW'))]).toEqual([2, 4, false]);
  });
});

describe('triggers from the bag (decomp party menu: PARTY_MENU_EXIT_CODE_EVOLVE_BY_LEVEL / _BY_ITEM)', () => {
  const useFromBag = (s: GameState, item: string) => {
    const app = open(s, { app: 'start-menu' });
    const v = app.view();
    if (v.app !== 'start-menu') throw new Error(v.app);
    app.step({ ...idle, tap: `entry:${v.entries.findIndex((e) => e.id === 'bag')}` });
    const bagView = () => app.view() as { app: string; pockets: string[]; pocket: number; rows: { item: Id }[] };
    for (let p = 0; p < 8 && !bagView().rows.some((r) => r.item === id(item)); p++) app.step({ ...idle, tap: `pocket:${p}` });
    app.step({ ...idle, tap: `row:${bagView().rows.findIndex((r) => r.item === id(item))}` });
    app.step({ ...idle, tap: 'menu:0' });
    return app;
  };

  it('a level item: "elevated to Lv. 16", the stats window, then the evolution (B allowed), then back to the bag', () => {
    const s = fresh(15, ['BOP', 'STARE', 'LEAF_TAP']);
    giveItem(s, registries, id('ITEM_GROW_CANDY'), 1);
    const app = useFromBag(s, 'ITEM_GROW_CANDY');
    expect(app.view().app).toBe('party');
    app.step({ ...idle, tap: 'slot:0' });
    const party = app.view() as PartyView;
    expect(party.message?.text).toMatch(/level 16/);
    const { views, cancellable } = run(app, { max: 1500 });
    expect(views).toContain('evolution');
    expect(cancellable).toBeGreaterThan(0);
    expect(app.view().app).toBe('bag');
    expect([s.party[0]!.level, s.party[0]!.species, itemCount(s, id('ITEM_GROW_CANDY'))]).toEqual([16, id('SPECIES_MOSSGROVE'), 0]);
    // Quick Dash came with the level (party menu) and is not offered twice by the evolution.
    expect(s.party[0]!.moves).toEqual(['BOP', 'STARE', 'LEAF_TAP', 'QUICK_DASH'].map((m) => id(`MOVE_${m}`)));
  });

  it('a stone: ABLE / UNABLE notes, the evolution (B does nothing), then the bag', () => {
    const s = fresh(10);
    s.party.push(setupPokemon(s, registries, 1, id('SPECIES_BURROWBIT'), 8));
    giveItem(s, registries, id('ITEM_GROVE_STONE'), 1);
    const app = useFromBag(s, 'ITEM_GROVE_STONE');
    const party = app.view() as PartyView;
    expect(party.notes.slice(0, 2)).toEqual(['NOT YET', 'READY!']);
    app.step({ ...idle, tap: 'slot:1' });
    expect(app.view().app).toBe('evolution');
    run(app, { cancel: true, max: 1500 });
    expect(app.view().app).toBe('bag');
    expect([s.party[1]!.species, itemCount(s, id('ITEM_GROVE_STONE'))]).toEqual([id('SPECIES_MOSSGROVE'), 0]);
  });
});
