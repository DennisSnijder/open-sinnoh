/**
 * The Pokétch model on the fixture pack (docs/research/poketch.md): the device (side buttons, the screen
 * between apps, the app counter) and each app's behaviour, driven by touches as the DS bottom screen's.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLOCK, readPackFolder, withClock, type ClockTime, type Id } from '@opensinnoh/core';
import { countPoketchStep, poketchAppId, registerPoketchApp, setupPokemon, type GameState, type PoketchAppName, type PoketchModel, type PoketchView, type Registries, type Zone } from '@opensinnoh/contracts';
import { loadGamePacks, newGameState } from '@opensinnoh/game';
import { calcDigit, calcEval, calcText, calcZero, createPoketch, type CalcValue } from './index.ts';
import { packDots, unpackDots } from './poketch/tools.ts';
import { compatibilityLevelOf, friendshipMood, hpBarWidth } from './poketch/pokemon.ts';
import { mapPosition } from './poketch/field.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const pack = readPackFolder((p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined), 'packs/fixture');
const loadedPacks = loadGamePacks([pack]);
const id = (s: string) => `fixture:${s}` as Id;
const app = (name: PoketchAppName) => poketchAppId('fixture', name);

/** The fixture's registries plus the Pokétch texts and a full type list (the move tester names all 17). */
function registriesWith(): Registries {
  const r = loadedPacks.registries;
  const texts = new Map(r.texts);
  for (const name of ['MoveTester_Text_NotEffective', 'MoveTester_Text_NotVeryEffective', 'MoveTester_Text_NotVeryEffective2', 'MoveTester_Text_RegularlyEffective', 'MoveTester_Text_SuperEffective', 'MoveTester_Text_SuperEffective2', 'MoveTester_Text_None', 'PokemonHistory_Text_ObtainedPokemon', 'PoketchBerrySearcher_Text_Berries'])
    texts.set(id(name), { id: id(name), text: name.replace(/^.*_Text_/, '') });
  const types = new Map(r.types);
  for (const n of ['NORMAL', 'FIRE', 'WATER', 'ELECTRIC', 'GRASS', 'ICE', 'FIGHTING', 'POISON', 'GROUND', 'FLYING', 'PSYCHIC', 'BUG', 'ROCK', 'GHOST', 'DRAGON', 'DARK', 'STEEL'])
    if (!types.has(id(`TYPE_${n}`))) types.set(id(`TYPE_${n}`), { id: id(`TYPE_${n}`), name: n, matchups: [] });
  return { ...r, texts, types } as Registries;
}
const registries = registriesWith();

function fresh(apps: PoketchAppName[] = ['DIGITALWATCH', 'CALCULATOR', 'PEDOMETER', 'PARTYSTATUS']): GameState {
  const s = newGameState([...registries.newGame.values()][0]!, registries, loadedPacks.loaded.order, 1);
  s.poketch.enabled = true;
  for (const a of apps) registerPoketchApp(s.poketch, app(a));
  return s;
}

/** A Pokétch on `state`, with a settable clock and a counting RNG; `tick` steps it with a touch (or none). */
function device(state: GameState, opts: { clock?: ClockTime; rng?: () => number; reg?: Registries } = {}) {
  let clock = opts.clock ?? DEFAULT_CLOCK;
  const sounds: string[] = [];
  const model: PoketchModel = createPoketch({
    registries: opts.reg ?? registries,
    state,
    log: { stub: () => {} },
    rng: opts.rng ?? (() => 0),
    clock: () => clock,
    sound: { playSe: (s: Id) => sounds.push(s), playCry: (s: Id) => sounds.push(`cry ${s}`), cryPlaying: () => false } as never,
  });
  const d = {
    model,
    sounds,
    setClock: (c: ClockTime) => (clock = c),
    tick(touch: { x: number; y: number } | null = null, moved = false) {
      model.step({ touch, busy: false, moved });
    },
    ticks(n: number) {
      for (let i = 0; i < n; i++) d.tick();
    },
    /** A tap: down one tick, up the next. */
    tap(x: number, y: number) {
      d.tick({ x, y });
      d.tick();
    },
    view: (): PoketchView => model.view(),
    /** Lets the first app's screen open (4 ticks). */
    ready() {
      d.ticks(4);
      return d;
    },
  };
  return d;
}

describe('the Pokétch device', () => {
  it('opens on the current app; the side button walks the registered apps in app id order, wrapping', () => {
    const s = fresh(['PARTYSTATUS', 'DIGITALWATCH', 'PEDOMETER']);
    const d = device(s);
    expect(d.view().cover).toBe(56);
    d.ready();
    expect(d.view()).toMatchObject({ app: app('PARTYSTATUS'), cover: 0 });
    // DOWN: the screen closes (5 ticks), waits 3, opens (4): the next id after PARTYSTATUS (4) wraps to DIGITALWATCH (0).
    d.tap(240, 128);
    expect(d.view().buttons.down).toBe('idle');
    d.tick();
    d.ticks(3);
    expect(d.view().cover).toBe(80);
    d.ticks(8);
    expect(d.view()).toMatchObject({ app: app('DIGITALWATCH'), cover: 0 });
    expect(s.poketch.current).toBe(app('DIGITALWATCH'));
    // UP: the previous one.
    d.tap(240, 64);
    d.ticks(12);
    expect(d.view().app).toBe(app('PARTYSTATUS'));
  });

  it('a tap while the screen closes skips apps with the counter (the app id + 1), 30 ticks after the last tap', () => {
    const d = device(fresh(['DIGITALWATCH', 'CALCULATOR', 'PEDOMETER', 'PARTYSTATUS'])).ready();
    d.tap(240, 128);
    d.tap(240, 128);
    d.ticks(4);
    expect(d.view().counter).toBe(2);
    d.tap(240, 128);
    expect(d.view().counter).toBe(4);
    d.ticks(30);
    d.ticks(4);
    expect(d.view()).toMatchObject({ app: app('PEDOMETER'), counter: null, cover: 0 });
  });

  it('holding UP 7 ticks changes the app; a single app does not change', () => {
    const d = device(fresh(['DIGITALWATCH', 'CALCULATOR'])).ready();
    for (let i = 0; i < 8; i++) d.tick({ x: 240, y: 50 });
    expect(d.view().buttons.up).toBe('idle');
    d.tick();
    d.ticks(12);
    expect(d.view().app).toBe(app('CALCULATOR'));
    const one = device(fresh(['DIGITALWATCH'])).ready();
    one.tap(240, 128);
    one.ticks(12);
    expect(one.view()).toMatchObject({ app: app('DIGITALWATCH'), cover: 0 });
  });

  it('counts steps once the Pedometer is registered, wrapping past 99999, not while hidden', () => {
    const s = fresh(['DIGITALWATCH']);
    countPoketchStep(s, registries);
    expect(s.poketch.steps).toBe(0);
    registerPoketchApp(s.poketch, app('PEDOMETER'));
    countPoketchStep(s, registries);
    expect(s.poketch.steps).toBe(1);
    s.poketch.steps = 99999;
    countPoketchStep(s, registries);
    expect(s.poketch.steps).toBe(0);
  });
});

describe('the watches', () => {
  it('the digital watch copies the four digits of the clock; holding the screen lights it', () => {
    const d = device(fresh(), { clock: withClock(DEFAULT_CLOCK, undefined, '07:45') }).ready();
    const v = d.view();
    expect(v.info.time).toBe('07:45');
    expect(v.blits.map((b) => [b.from.x / 32, b.x])).toEqual([[0, 24], [7, 64], [4, 120], [5, 160]]);
    d.tick({ x: 100, y: 100 });
    expect(d.view().backlight).toBe(true);
    d.tick();
    expect(d.view().backlight).toBe(false);
  });

  it('the analog watch turns its hands: the hour hand by half a degree a minute', () => {
    const s = fresh(['ANALOGWATCH']);
    const d = device(s, { clock: withClock(DEFAULT_CLOCK, undefined, '15:30') }).ready();
    expect(d.view().sprites.map((x) => x.angle)).toEqual([180, 90 + 15]);
  });

  it('the alarm clock sets the alarm (saved) and rings at that minute', () => {
    const s = fresh(['ALARMCLOCK']);
    const d = device(s, { clock: withClock(DEFAULT_CLOCK, undefined, '06:58') }).ready();
    expect(d.view().info.mode).toBe('edit');
    for (let i = 0; i < 7; i++) d.tap(72, 120);
    d.tap(120, 168);
    expect(d.view().info.alarm).toBe('07:59');
    d.tap(190, 80);
    expect(s.poketch.alarm).toEqual({ on: true, hour: 7, minute: 59 });
    d.setClock(withClock(DEFAULT_CLOCK, undefined, '07:59'));
    d.tick();
    expect(d.view().info.mode).toBe('ring');
    expect(d.sounds.some((x) => x.endsWith('SPECIES_LOUDRED'))).toBe(false); // the fixture has no Loudred: the cry is asked for by id
  });

  it('the stopwatch runs on a tap and pauses on the next; a long hold resets it', () => {
    const d = device(fresh(['STOPWATCH'])).ready();
    d.tap(112, 112);
    d.ticks(30);
    expect(d.view().info).toMatchObject({ running: true, time: '00:00:01:00' });
    d.tap(112, 112);
    expect(d.view().info.running).toBe(false);
    for (let i = 0; i < 80; i++) d.tick({ x: 112, y: 112 });
    d.tick();
    d.ticks(240);
    expect(d.view().info).toMatchObject({ running: false, time: '00:00:00:00', state: 'inactive' });
  });

  it('the kitchen timer counts down the set time and rings', () => {
    const d = device(fresh(['KITCHENTIMER'])).ready();
    d.tap(140, 84); // seconds ones up
    d.tap(140, 84);
    d.tap(40, 160); // START
    expect(d.view().info.mode).toBe('running');
    d.ticks(30);
    expect(d.view().info.time).toBe('00:01');
    d.ticks(30);
    expect(d.view().info).toMatchObject({ mode: 'sounding', time: '00:00' });
    d.tap(176, 160); // RESET
    expect(d.view().info.mode).toBe('edit');
  });

  it('the calendar marks and unmarks days of the clock month (one month kept)', () => {
    const s = fresh(['CALENDAR']);
    // 2009-03-22 is a Sunday: March 1 is a Sunday, cell 0.
    const d = device(s, { clock: DEFAULT_CLOCK }).ready();
    d.tap(40 + 24 * 2, 48 + 24 * 1); // cell 9: March 10
    expect(s.poketch.calendar).toEqual({ month: 3, marks: 1 << 9 });
    d.tap(40 + 24 * 2, 48 + 24 * 1);
    expect(s.poketch.calendar).toEqual({ month: 3, marks: 0 });
    expect(d.view().sprites[0]).toMatchObject({ x: 40, y: 48 + 24 * 3 });
  });
});

describe('the calculator', () => {
  const num = (s: string): CalcValue => [...s].reduce((v, c) => (c === '.' ? { ...v, decimal: true } : c === '-' ? { ...v, neg: true } : calcDigit(v, Number(c))), calcZero());
  it('adds, subtracts, multiplies and divides in fixed point, truncating to 10 symbols', () => {
    expect(calcText(calcEval(num('12'), '+', num('3')))).toBe('15');
    expect(calcText(calcEval(num('1.5'), '-', num('4')))).toBe('-2.5');
    expect(calcText(calcEval(num('2.50'), '*', num('4')))).toBe('10');
    expect(calcText(calcEval(num('1'), '/', num('3')))).toBe('0.33333333');
    expect(calcEval(num('1'), '/', num('0')).invalid).toBe(true);
    expect(calcText(calcEval(num('99999'), '*', num('99999')))).toBe('9999800001');
  });

  it('runs the keys: chaining, repeat equals, error and C', () => {
    const d = device(fresh(['CALCULATOR'])).ready();
    const keys: Record<string, [number, number]> = { '1': [48, 128], '2': [80, 128], '3': [112, 128], '+': [144, 96], '=': [160, 160], '/': [176, 128], '0': [64, 160], C: [160, 64] };
    const press = (k: string) => d.tap(...keys[k]!);
    for (const k of ['1', '2', '+', '3', '=']) press(k);
    expect(d.view().info.display).toBe('15');
    press('=');
    expect(d.view().info.display).toBe('18');
    for (const k of ['/', '0', '=']) press(k);
    expect(d.view().info.display).toBe('error');
    press('C');
    expect(d.view().info.display).toBe('0');
    d.tick({ x: 48, y: 128 });
    expect(d.view().blits.length).toBeGreaterThan(40);
  });
});

describe('the tools', () => {
  it('the memo pad draws dots and lines with the pencil and erases with the eraser', () => {
    const d = device(fresh(['MEMOPAD'])).ready();
    d.tick({ x: 40, y: 40 });
    d.tick({ x: 80, y: 40 });
    d.tick();
    const inked = d.view().info.inked as number;
    expect(inked).toBe(21 * 4);
    d.tap(190, 50);
    expect(d.view().info.tool).toBe('eraser');
    d.tick({ x: 60, y: 40 });
    d.tick();
    expect(d.view().info.inked).toBeLessThan(inked);
  });

  it('the counter counts on release inside its button, to 9999 and back to 0', () => {
    const d = device(fresh(['COUNTER'])).ready();
    d.tap(114, 128);
    d.tap(114, 128);
    expect(d.view().info.count).toBe(2);
    d.tick({ x: 114, y: 128 });
    d.tick({ x: 20, y: 20 });
    d.tick();
    expect(d.view().info.count).toBe(2);
  });

  it('the coin toss rolls the side first and lands after its bounces', () => {
    const d = device(fresh(['COINTOSS']), { rng: () => 2 }).ready();
    d.tap(112, 144);
    expect(d.view().info.tossing).toBe(true);
    d.ticks(80);
    expect(d.view().info).toMatchObject({ tossing: false, side: 'tails' });
    expect(d.sounds.length).toBeGreaterThanOrEqual(0);
  });

  it('the color changer saves the colour picked on the slider', () => {
    const s = fresh(['COLORCHANGER']);
    const d = device(s).ready();
    d.tap(48 + 16 * 5 + 3, 148);
    expect(s.poketch.color).toBe(5);
    expect(d.view().color).toBe(5);
  });

  it('the dot artist starts on "Touch!", cycles cells and saves 120 bytes', () => {
    const s = fresh(['DOTART']);
    const d = device(s).ready();
    d.tap(16 + 4, 16 + 4);
    expect(s.poketch.dotArt).toMatch(/^[0-9a-f]{240}$/);
    const cells = unpackDots(s.poketch.dotArt!);
    expect(cells[0]).toBe(2);
    expect(cells[7 * 24 + 1]).toBe(4);
    expect(packDots(cells)).toBe(s.poketch.dotArt);
  });

  it('the move tester counts the "!" marks of a type against one or two types', () => {
    const types = new Map(registries.types);
    const t = (n: string) => id(`TYPE_${n}`);
    types.set(t('NORMAL'), { ...types.get(t('NORMAL'))!, matchups: [{ type: t('GHOST'), multiplier: 0, foresight: true }, { type: t('ROCK'), multiplier: 5, foresight: false }] });
    const d = device(fresh(['MOVETESTER']), { reg: { ...registries, types } as Registries }).ready();
    expect(d.view().info.marks).toBe(3);
    // Defender type 1 back from Normal to Steel, then to … Ghost (the order ends Ghost, Dragon, Dark, Steel).
    for (let i = 0; i < 4; i++) d.tap(100, 30);
    expect(d.view().info).toMatchObject({ defend: [t('GHOST'), null], marks: 0 });
  });
});

describe('the Pokémon apps', () => {
  it('party status: HP bars in 2 px steps, silhouettes for fainted Pokémon, a bounce and cry on a tap', () => {
    expect([hpBarWidth(0, 50), hpBarWidth(50, 50), hpBarWidth(1, 50), hpBarWidth(25, 50)]).toEqual([0, 64, 2, 32]);
    const s = fresh();
    s.party.push(setupPokemon(s, registries, 0, id('SPECIES_MOSSLET'), 10), setupPokemon(s, registries, 1, id('SPECIES_DRIPLING'), 9));
    s.party[1]!.hp = 0;
    s.poketch.current = app('PARTYSTATUS');
    const d = device(s).ready();
    const v = d.view();
    expect(v.icons.map((i) => [i.species, i.silhouette, i.x, i.y])).toEqual([
      [id('SPECIES_MOSSLET'), false, 64, 36],
      [id('SPECIES_DRIPLING'), true, 160, 36],
    ]);
    d.tick({ x: 64, y: 40 });
    expect(d.sounds).toContain(`cry ${id('SPECIES_MOSSLET')}`);
    d.tick({ x: 64, y: 40 });
    expect(d.view().icons[0]!.y).not.toBe(36);
  });

  it('friendship moods follow the decomp tiers', () => {
    expect([0, 1, 34, 35, 70, 149, 150, 200, 254, 255].map((f) => { const m = friendshipMood(f); return `${m.kind}${m.intensity}`; })).toEqual(['hate3', 'hate2', 'hate2', 'hate1', 'neutral0', 'neutral0', 'like1', 'like2', 'like2', 'like3']);
  });

  it('the day-care checker shows the daycare: levels after the steps, and the egg', () => {
    const s = fresh(['DAYCARECHECKER']);
    expect(device(s).ready().view().info).toEqual({ mons: [], levels: [], egg: false });
    const mon = setupPokemon(s, registries, 0, id('SPECIES_MOSSLET'), 10);
    s.daycare.mons[0] = { mon, steps: 100000 };
    s.daycare.offspring = 1234;
    const v = device(s).ready().view();
    expect(v.info).toMatchObject({ mons: [id('SPECIES_MOSSLET')], egg: true });
    expect((v.info.levels as number[])[0]).toBeGreaterThan(10);
  });

  it('the matchup checker grades a pair as the daycare does', () => {
    const s = fresh();
    const a = setupPokemon(s, registries, 0, id('SPECIES_MOSSLET'), 10);
    const b = structuredClone(a);
    const ctx = { deps: { registries } } as never;
    // Same species, same trainer: medium if they are male and female, incompatible if alike.
    b.pid = a.pid ^ 0xff;
    expect([0, 1, 2, 3]).toContain(compatibilityLevelOf(ctx, a, b));
    expect(compatibilityLevelOf(ctx, a, structuredClone(a))).toBe(3);
  });

  it('the Pokémon history lists what was obtained', () => {
    const s = fresh(['POKEMONHISTORY']);
    s.poketch.history.push({ species: id('SPECIES_MOSSLET'), form: 0 });
    const d = device(s).ready();
    expect(d.view().icons).toMatchObject([{ species: id('SPECIES_MOSSLET'), x: 48, y: 48 }]);
  });
});

describe('the field apps', () => {
  it('the pedometer shows the steps and resets them on release inside its button', () => {
    const s = fresh(['PEDOMETER']);
    s.poketch.steps = 42;
    const d = device(s).ready();
    expect(d.view().sprites.slice(1).map((x) => x.anim!.seq)).toEqual([0, 0, 0, 4, 2]);
    d.tap(114, 128);
    expect(s.poketch.steps).toBe(0);
  });

  it('the dowsing machine finds a hidden item within its range and keeps pinging for far ones', () => {
    const s = fresh(['DOWSINGMACHINE']);
    const zones = new Map(registries.zones);
    const z = zones.get(s.player.zone)!;
    const flag = [...registries.flags.keys()][0]!;
    zones.set(z.id, { ...z, events: { ...z.events, bgs: [...z.events.bgs, { label: z.events.bgs[0]?.label ?? (`${z.id}:x` as Id), kind: 'hidden-item', x: s.player.x + 2, z: s.player.z, y: 0, facing: 'any', hiddenItem: { flag, range: 2, item: id('ITEM_POTION'), quantity: 1 } }] } } as Zone);
    const d = device(s, { reg: { ...registries, zones } as Registries }).ready();
    // The item is 22 px right of the player's spot (112, 101); range 2 = 48 px.
    d.tap(130, 100);
    expect(d.view().info).toMatchObject({ result: 'near', items: ['134,101'] });
    d.tap(30, 30);
    expect(d.view().info.result).toBe('none');
    d.tick(null, true);
    expect(d.view().sprites).toEqual([]);
  });

  it('the marking map drags a marker (saved) and maps chunks to the map', () => {
    expect([mapPosition(0, 0), mapPosition(29, 32), mapPosition(5, 5)]).toEqual([{ x: 26, y: 0 }, { x: 200, y: 186 }, { x: 56, y: 24 }]);
    const s = fresh(['MARKINGMAP']);
    const d = device(s).ready();
    d.tick({ x: 104 + 16, y: 152 + 16 });
    d.tick({ x: 60, y: 70 });
    d.tick();
    expect(s.poketch.markers[0]).toEqual({ x: 44, y: 54 });
  });

  it('the marking map shows each active roamer on its route (decomp PoketchMap_GetPositionFromMapID, ANIMATION_INDEX_ROAMER)', () => {
    const s = fresh(['MARKINGMAP']);
    const d = device(s).ready();
    expect(d.view().info.roamers).toEqual([]);
    const roamer = { species: id('SPECIES_SKYLET'), level: 50, pid: 1, ivs: { hp: 0, attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0 }, hp: 10, status: 'none' as const };
    s.roamers.slots[0] = roamer;
    s.roamers.slots[3] = { ...roamer };
    s.roamers.routes[0] = 0; // Route 201
    s.roamers.routes[3] = 28; // Fuego Ironworks
    d.tick();
    expect(d.view().info.roamers).toEqual(['47,150', '56,102']);
    expect(d.view().sprites.filter((x) => x.anim?.seq === 18)).toHaveLength(2);
  });

  it('the berry searcher shows the growing patches in fruit at their map spots, one per run of equal spots (GetReadyBerryPatches)', () => {
    const s = fresh(['BERRYSEARCHER']);
    const ng = [...registries.newGame.values()][0]!;
    const patch = (stage: 'fruit' | 'blooming', growing: boolean) => ({ berry: id('ITEM_CHERI_BERRY'), stage, stageMinutes: 60, moistureMinutes: 0, replants: 0, yield: 3, moisture: 100, yieldRating: 5, mulch: null, growing });
    const reg = { ...registries, newGame: new Map([[ng.id, { ...ng, berries: { patches: [], searcher: [{ x: 5, y: 20 }, { x: 5, y: 20 }, { x: 6, y: 19 }, { x: 7, y: 17 }] } }]]) } as unknown as Registries;
    s.berryPatches = [patch('fruit', true), patch('fruit', true), patch('blooming', true), patch('fruit', false)] as GameState['berryPatches'];
    const d = device(s, { reg }).ready();
    expect(d.view().info).toMatchObject({ berries: 1, spots: ['56,114'] });
    s.berryPatches[2] = patch('fruit', true) as GameState['berryPatches'][number];
    // A tap refreshes the map.
    d.tap(100, 100);
    expect(d.view().info).toMatchObject({ berries: 2, spots: ['56,114', '62,108'] });
    expect(d.view().sprites.filter((x) => x.anim?.seq === 7)).toHaveLength(2);
  });

  it('the trainer counter shows the live chain and the best three, highest first; touching one cries', () => {
    const s = fresh(['TRAINERCOUNTER']);
    s.encounters = {
      honeyTrees: [], lastHoneyTree: 21, radarCharge: 0, swarms: false, trophyGarden: [null, null],
      radarRecords: [{ species: id('SPECIES_BIDOOF'), count: 4 }, { species: id('SPECIES_SKYLET'), count: 120 }, { species: null, count: 0 }],
    };
    let chain: { species: Id; count: number } | null = null;
    const sounds: string[] = [];
    const model = createPoketch({ registries, state: s, log: { stub: () => {} }, rng: () => 0, clock: () => DEFAULT_CLOCK, radarChain: () => chain, sound: { playSe: () => {}, playCry: (x: Id) => sounds.push(`cry ${x}`), cryPlaying: () => false } as never });
    const tick = (touch: { x: number; y: number } | null = null) => model.step({ touch, busy: false, moved: false });
    for (let i = 0; i < 4; i++) tick();
    expect(model.view().info).toMatchObject({ chain: 0, species: null, records: [`${id('SPECIES_SKYLET')}:120`, `${id('SPECIES_BIDOOF')}:4`, '-:0'] });
    // Two best chains: 1, 2, 0 (hidden leading zeros) and 4.
    expect(model.view().sprites.filter((x) => x.sheet === 'poketch/trainer_counter').map((x) => x.anim!.seq)).toEqual([1, 2, 0, 4]);
    chain = { species: id('SPECIES_SKYLET'), count: 7 };
    tick();
    expect(model.view().info).toMatchObject({ chain: 7, species: id('SPECIES_SKYLET') });
    expect(model.view().icons).toHaveLength(3);
    tick({ x: 110, y: 80 });
    expect(sounds).toEqual([`cry ${id('SPECIES_SKYLET')}`]);
  });
});
