/**
 * The Pokédex (decomp applications/pokedex; docs/research/pokedex.md): the list, the entry pages (info,
 * area, cry, size, forms) and the search, driven by `pokedex.seen`/`caught`. Sinnoh order until the
 * national dex is unlocked, then either (SELECT). Everything a page shows comes from the species' `dex`
 * record and the base pack's `pl_msg_pokedex_*` texts.
 */
import { dayPeriod, type Button, type DayPeriod, type Id } from '@opensinnoh/core';
import { dexNameOrder, gameLanguage, nameInitial } from '@opensinnoh/services';
import { newGameRecord, type PokedexEntryView, type PokedexListView, type PokedexPageId, type PokedexRow, type PokedexSearchView, type Registries, type Species, type SpeciesDex, type GameState, type SeenForm } from '@opensinnoh/contracts';
import type { MenuContext } from './context.ts';
import { DexScroll } from './pokedex-scroll.ts';
import { namingScreen } from './naming.ts';
import { areaLayers } from './pokedex-area.ts';
import { tapIndex, type Screen, type Step } from './stack.ts';

type Input = { button: Button } | { tap: string };

/** The texts the Pokédex reads (bank 697, `pl_msg_pokedex_*`), checked when it opens. */
const DEX_TEXT = [
  'seen', 'obtained', 'switch', 'search', 'ht', 'wt', 'male', 'female', 'westsea', 'eastsea', 'plantcloak', 'sandycloak', 'trashcloak', 'oneform', 'blank',
  'areaunknown', 'morning', 'day', 'night', 'heightcheck_topscreen', 'name', 'type', 'form', 'order', 'ok', 'abc', 'def', 'ghi', 'jkl', 'mno', 'pqr', 'stu', 'vwx', 'yz',
  'numerical', 'alphabetical', 'heaviest', 'lightest', 'tallest', 'smallest', 'alphabetical_description', 'type_description', 'body_description', 'listing_description',
  'nonefound', 'lucasheight', 'dawnheight', 'noname', 'none', 'anotherform', 'info', 'area', 'cry', 'size', 'forms', 'quit', 'cancel', 'results',
  'normalforme', 'attackforme', 'defenseforme', 'speedforme', 'landforme', 'skyforme', 'alteredforme', 'originforme', 'rotom', 'rotomheat', 'rotomwash', 'rotomfrost',
  'rotomfan', 'rotommow', 'nonealphabetical', 'nonetype',
] as const;
type DexKey = (typeof DEX_TEXT)[number];

/** Name groups of the search (decomp pokedex_search.c): the first letter of the name. */
const NAME_GROUPS: [DexKey, string][] = [['abc', 'ABC'], ['def', 'DEF'], ['ghi', 'GHI'], ['jkl', 'JKL'], ['mno', 'MNO'], ['pqr', 'PQR'], ['stu', 'STU'], ['vwx', 'VWX'], ['yz', 'YZ']];
const ORDERS: DexKey[] = ['numerical', 'alphabetical', 'heaviest', 'lightest', 'tallest', 'smallest'];
/** Body shapes, decomp enum PokemonBodyShape. */
export const BODY_SHAPES = 14;
const PAGES: PokedexPageId[] = ['info', 'area', 'cry', 'size', 'forms'];
/** Retained shoulder-button page shortcut. */
const PAGE = 10;
/**
 * Form labels by the sprite form's name, for the species the DS Pokédex records forms of (decomp
 * formmain.c FormMessageID); other species show their genders.
 */
const FORM_LABELS: Record<string, DexKey> = {
  west: 'westsea', east: 'eastsea', plant: 'plantcloak', sand: 'sandycloak', trash: 'trashcloak',
  attack: 'attackforme', defense: 'defenseforme', speed: 'speedforme', land: 'landforme', sky: 'skyforme', altered: 'alteredforme', origin: 'originforme',
  heat: 'rotomheat', wash: 'rotomwash', frost: 'rotomfrost', fan: 'rotomfan', mow: 'rotommow',
};
/** The form-0 names of Deoxys and Rotom; Unown's letters all read "One form". */
const FORM_ZERO: Record<string, DexKey> = { normal: 'normalforme', base: 'rotom' };

export interface DexEntry {
  species: Species;
  dex: SpeciesDex;
  national: number;
}

interface DexLists {
  national: DexEntry[];
  regional: DexEntry[];
  /** Types that some species has, in type order (the search's type options). */
  types: Id[];
}

const listsCache = new WeakMap<Registries, DexLists>();

/** The national (species with an entry, by number) and regional lists. */
export function dexLists(registries: Registries): DexLists {
  let l = listsCache.get(registries);
  if (l) return l;
  const national = [...registries.species.values()]
    .filter((s) => s.dex && s.sourceIndex !== undefined && s.sourceIndex > 0)
    .map((s) => ({ species: s, dex: s.dex!, national: s.sourceIndex! }))
    .sort((a, b) => a.national - b.national);
  const regional = national.filter((e) => e.species.regionalDex !== undefined).sort((a, b) => a.species.regionalDex! - b.species.regionalDex!);
  const used = new Set(national.flatMap((e) => e.species.types));
  const types = [...registries.types.values()].filter((t) => used.has(t.id)).sort((a, b) => (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0)).map((t) => t.id);
  listsCache.set(registries, (l = { national, regional, types }));
  return l;
}

/**
 * A search (decomp pokedex_search.c): order 0–5; name, type and shape 0 = none, else the option index + 1. With the
 * name search (OpenSinnoh option `dexNameSearch`), name `TYPED_NAME` looks for `text` (a typed name) in the names.
 */
export interface DexQuery {
  order: number;
  name: number;
  type1: number;
  type2: number;
  shape: number;
  text: string;
}
export const NO_QUERY: Readonly<DexQuery> = { order: 0, name: 0, type1: 0, type2: 0, shape: 0, text: '' };
/** The NAME row's typed-name option (after the nine letter groups). */
export const TYPED_NAME = 10;
/** Decomp MON_NAME_LEN: the longest name the search keyboard takes. */
const NAME_LENGTH = 10;

type DexSort = (a: DexEntry, b: DexEntry) => number;
/** The A–Z order: the names in the game language's order (services `dexNameOrder`), ties by number. */
const byName = (order: (a: string, b: string) => number): DexSort => (a, b) => order(a.species.name, b.species.name) || a.national - b.national;
const SORTS: (DexSort | 'name' | null)[] = [
  null,
  'name',
  (a, b) => b.dex.weight - a.dex.weight || a.national - b.national,
  (a, b) => a.dex.weight - b.dex.weight || a.national - b.national,
  (a, b) => b.dex.height - a.dex.height || a.national - b.national,
  (a, b) => a.dex.height - b.dex.height || a.national - b.national,
];

/**
 * The search over a mode's list (decomp PokedexSort_Sort with filters): seen species only; the weight
 * and height orders and the type filters keep caught ones only (decomp keepUncaught FALSE). `language`: the game's
 * (services `gameLanguage`), for the A–Z order and the name groups.
 */
export function searchDex(base: DexEntry[], q: DexQuery, state: GameState, types: Id[], language: number): DexEntry[] {
  const seen = new Set(state.pokedex.seen);
  const caught = new Set(state.pokedex.caught);
  let out = base.filter((e) => seen.has(e.species.id));
  const sort = SORTS[q.order];
  if (sort === undefined) throw new Error(`pokedex: order ${q.order}`);
  if (q.order >= 2) out = out.filter((e) => caught.has(e.species.id));
  if (sort) out = [...out].sort(sort === 'name' ? byName(dexNameOrder(language)) : sort);
  if (q.name === TYPED_NAME) {
    const text = q.text.toLowerCase();
    out = out.filter((e) => e.species.name.toLowerCase().includes(text));
  } else if (q.name) {
    const letters = NAME_GROUPS[q.name - 1]![1];
    out = out.filter((e) => letters.includes(nameInitial(e.species.name)));
  }
  for (const t of [q.type1, q.type2]) {
    if (!t) continue;
    const type = types[t - 1]!;
    out = out.filter((e) => caught.has(e.species.id) && e.species.types.includes(type));
  }
  if (q.shape) out = out.filter((e) => e.dex.shape === q.shape - 1);
  return out;
}

/** The numerical list: the mode's order up to the highest seen species, unseen gaps as null. */
export function numericalRows(base: DexEntry[], state: GameState): (DexEntry | null)[] {
  const seen = new Set(state.pokedex.seen);
  let last = -1;
  base.forEach((e, i) => {
    if (seen.has(e.species.id)) last = i;
  });
  return base.slice(0, last + 1).map((e) => (seen.has(e.species.id) ? e : null));
}

/** What the DS keeps between openings (PokedexMemory): the mode and the species under the cursor. */
interface DexMemory {
  national: boolean | null;
  species: Id | null;
}
const memories = new WeakMap<GameState, DexMemory>();

class DexText {
  constructor(private readonly ctx: MenuContext) {
    const missing = DEX_TEXT.filter((k) => !ctx.registries.texts.has(ctx.text.id(`pl_msg_pokedex_${k}`)));
    if (missing.length) throw new Error(`pokedex: the ${ctx.text.ns} pack has no text for ${missing.map((k) => `pl_msg_pokedex_${k}`).join(', ')}`);
  }
  t(key: DexKey): string {
    return this.ctx.text.message(`pl_msg_pokedex_${key}`);
  }
  record(id: Id): string {
    return this.ctx.text.text(id).trim();
  }
}

/** The forms and genders seen of a species, in the order seen (GameState v9; empty when none was recorded). */
function seenForms(state: GameState, species: Id): SeenForm[] {
  return state.pokedex.forms[species] ?? [];
}

/** The Pokédex app, pushed by the start menu's POKéDEX. */
export function pokedexScreen(ctx: MenuContext): Screen {
  const text = new DexText(ctx);
  const lists = dexLists(ctx.registries);
  const state = ctx.state;
  let memory = memories.get(state);
  if (!memory) memories.set(state, (memory = { national: null, species: null }));
  let national = state.pokedex.national && (memory.national ?? true);
  let results: DexEntry[] | null = null;
  let query: DexQuery = { ...NO_QUERY };
  const base = () => (national ? lists.national : lists.regional);
  const rows = (): (DexEntry | null)[] => results ?? numericalRows(base(), state);
  const indexOf = (species: Id | null) => Math.max(0, rows().findIndex((e) => e?.species.id === species));
  const scroll = new DexScroll(() => rows().length);
  scroll.reset(indexOf(memory.species));
  const remember = () => {
    memory.national = national;
    memory.species = rows()[scroll.cursor]?.species.id ?? memory.species;
  };
  const number = (e: DexEntry) => String(national ? e.national : (e.species.regionalDex ?? 0)).padStart(3, '0');
  const move = (to: number) => {
    scroll.reset(to);
    remember();
  };
  const open = (i: number): Step => {
    const e = rows()[i];
    if (!e) return;
    scroll.reset(i);
    remember();
    return { push: entryScreen(ctx, text, () => rows().filter((r): r is DexEntry => r !== null), e, number, (species) => move(indexOf(species))) };
  };
  const canSwitch = () => state.pokedex.national && !results;
  const switchMode = () => {
    if (!canSwitch()) return;
    national = !national;
    scroll.reset(0);
    remember();
  };
  const search = (): Step => {
    if (results) return;
    query = { ...NO_QUERY };
    return {
      push: searchScreen(ctx, text, lists.types, query, (q) => {
        const found = searchDex(base(), q, state, lists.types, gameLanguage(ctx.registries));
        if (!found.length) return false;
        results = found;
        scroll.reset(0);
        remember();
        return true;
      }),
    };
  };
  const quit = (): Step => {
    if (!results) return 'pop';
    const species = rows()[scroll.cursor]?.species.id ?? null;
    results = null;
    move(indexOf(species));
    return;
  };
  return {
    tick(frame) {
      scroll.tick(frame);
      remember();
    },
    view(): PokedexListView {
      const list = rows();
      const seen = new Set(state.pokedex.seen);
      const caught = new Set(state.pokedex.caught);
      const counts = results
        ? [{ label: text.t('results'), value: String(results.length) }]
        : [
            { label: text.t('seen'), value: String(base().filter((e) => seen.has(e.species.id)).length) },
            { label: text.t('obtained'), value: String(base().filter((e) => caught.has(e.species.id)).length) },
          ];
      return {
        app: 'pokedex',
        screen: 'list',
        title: ctx.text.t('startPokedex'),
        national,
        counts,
        rows: list.map((e, i): PokedexRow => {
          // An unseen gap only occurs in the numerical list, whose row i is the mode's entry i.
          if (!e) return { species: null, form: 0, number: number(base()[i]!), name: text.t('noname'), caught: false };
          return { species: e.species.id, form: picture(ctx.registries, state, e).form, number: number(e), name: e.species.name, caught: caught.has(e.species.id) };
        }),
        cursor: scroll.cursor,
        scrollPosition: scroll.position,
        switchLabel: canSwitch() ? text.t('switch') : null,
        searchLabel: results ? null : text.t('search'),
        quitLabel: text.t(results ? 'cancel' : 'quit'),
      };
    },
    input(i: Input): Step {
      if ('tap' in i) {
        if (i.tap === 'back' || i.tap === 'quit') return quit();
        if (i.tap === 'search') return search();
        if (i.tap === 'switch') return void switchMode();
        if (i.tap === 'open') return open(scroll.cursor);
        if (i.tap === 'wheel-end') return void scroll.touch(null);
        const speed = tapIndex(i.tap, 'wheel');
        if (speed !== null) return void scroll.touch(speed);
        const n = tapIndex(i.tap, 'row');
        if (n === null || n < 0 || n >= rows().length) return;
        if (n === scroll.cursor && !scroll.moving) return open(n);
        scroll.seek(n);
        return;
      }
      const b = i.button;
      // Directional keys are read once per simulation tick, independent of AppStack's repeat.
      if (b === 'l' || b === 'r') move(scroll.cursor + (b === 'l' ? -PAGE : PAGE));
      else if (b === 'a') return open(scroll.cursor);
      else if (b === 'b') return quit();
      else if (b === 'x') return search();
      else if (b === 'select') switchMode();
      return;
    },
  };
}

/**
 * The entry the battle shows after a new catch (decomp ov21_021E8D48, `pokedex-entry`): the caught species'
 * info page, as caught (the state marks it when the battle ends), with the dex's numbering; A, B or a tap
 * closes it (the DS waits for A or a tap).
 */
export function caughtEntryScreen(ctx: MenuContext, species: Id, form: number): Screen {
  const text = new DexText(ctx);
  const lists = dexLists(ctx.registries);
  const national = ctx.state.pokedex.national;
  const entry = lists.national.find((e) => e.species.id === species);
  if (!entry) throw new Error(`pokedex: ${species} has no Pokédex entry`);
  const number = (e: DexEntry) => String(national ? e.national : (e.species.regionalDex ?? 0)).padStart(3, '0');
  const screen = entryScreen(ctx, text, () => [entry], entry, number, () => {}, { caught: true, form });
  return {
    view: () => screen.view(),
    input(i: Input): Step {
      if ('tap' in i || i.button === 'a' || i.button === 'b') return { close: { app: 'pokedex-entry' } };
      return;
    },
  };
}

/** The form and gender the entry pictures: the first seen (decomp: the dex's default form and gender), else form 0. */
function picture(registries: Registries, state: GameState, e: DexEntry): { form: number; female: boolean } {
  const first = seenForms(state, e.species.id)[0];
  if (!first) return { form: 0, female: false };
  return { form: first.form, female: first.gender === 'female' && !!registries.pokemonSprites.get(e.species.id)?.forms[first.form]?.frontFemale };
}

/** The area page's time (0 morning, 1 day, 2 night) by period. */
const AREA_TIME: Record<DayPeriod, number> = { morning: 0, day: 1, twilight: 1, night: 2, lateNight: 2 };

/** `caught`: the battle's entry of a new catch (shown as caught, the info page only, the caught form). */
function entryScreen(
  ctx: MenuContext,
  text: DexText,
  seenList: () => DexEntry[],
  first: DexEntry,
  number: (e: DexEntry) => string,
  onLeave: (species: Id) => void,
  caughtEntry?: { caught: true; form: number },
): Screen {
  const state = ctx.state;
  const map = newGameRecord(ctx.registries).pokedexMap ?? null;
  let entry = first;
  let page: PokedexPageId = 'info';
  /**
   * The area page's time: it opens on the saved clock's (decomp start_menu.c FieldSystem_GetTimeOfDay;
   * ov21_021DC9BC.c: morning 0, day and twilight 1, night and late night 2).
   */
  let time = AREA_TIME[dayPeriod(state.gameTime.now.hour)];
  let formCursor = 0;
  const isCaught = () => !!caughtEntry || state.pokedex.caught.includes(entry.species.id);
  const enabled = (p: PokedexPageId) => (caughtEntry ? p === 'info' : p === 'size' || p === 'forms' ? isCaught() : p === 'area' ? !!map : true);
  /** The forms and genders seen, as the forms page lists them (decomp formmain.c). */
  const formList = () => {
    const sprites = ctx.registries.pokemonSprites.get(entry.species.id);
    const names = sprites?.forms.map((f) => f.name ?? '') ?? [''];
    const recorded = names.some((n) => n in FORM_LABELS) || names[0] === 'a';
    const looks = seenForms(state, entry.species.id);
    const out: { form: number; female: boolean; label: string }[] = [];
    const add = (form: number, female: boolean, label: string) => {
      if (!out.some((o) => o.form === form && o.female === female)) out.push({ form, female, label });
    };
    if (recorded) {
      const forms = looks.length ? looks.map((m) => m.form) : [0];
      for (const f of forms) {
        const n = names[f] ?? '';
        add(f, false, text.t(FORM_LABELS[n] ?? FORM_ZERO[n] ?? 'oneform'));
      }
      return out;
    }
    const genders = looks.map((m) => m.gender);
    if (!genders.length || genders.every((g) => g === 'none')) add(0, false, genders.length ? text.t('blank') : text.t('oneform'));
    for (const g of genders) if (g !== 'none') add(0, g === 'female' && !!sprites?.forms[0]?.frontFemale, text.t(g));
    return out;
  };
  const dexFor = (form: number) => {
    const f = entry.dex.forms?.find((x) => x.form === form);
    return f ? { ...entry.dex, ...f } : entry.dex;
  };
  const unknownTexts = () => {
    const u = newGameRecord(ctx.registries).pokedexUnknown;
    if (!u) throw new Error('pokedex: the base pack has no NewGame.pokedexUnknown texts for seen-only entries');
    return u;
  };
  let cryLogged = false;
  const step = (delta: number) => {
    const list = seenList();
    const i = list.findIndex((e) => e.species.id === entry.species.id);
    const next = list[Math.max(0, Math.min(list.length - 1, i + delta))]!;
    if (next === entry) return;
    entry = next;
    formCursor = 0;
    if (!enabled(page)) page = 'info';
  };
  const setPage = (p: PokedexPageId) => {
    if (!enabled(p)) return;
    page = p;
    if (p !== 'cry') return;
    // The cry page plays the species' cry (POKECRY_POKEDEX) in the pictured form.
    if (ctx.host.sound) ctx.host.sound.playCry(entry.species.id, picture(ctx.registries, state, entry).form, 'pokedex');
    else if (!cryLogged) {
      cryLogged = true;
      ctx.log.stub('menus:pokedex-cry', 'no sound in this host: the cry page plays no cry');
    }
  };
  const cyclePage = (delta: number) => {
    const open = PAGES.filter(enabled);
    setPage(open[(open.indexOf(page) + delta + open.length) % open.length]!);
  };
  const leave = (): Step => {
    onLeave(entry.species.id);
    return 'pop';
  };
  return {
    view(): PokedexEntryView {
      const caught = isCaught();
      const forms = caught ? formList() : [];
      formCursor = Math.min(formCursor, Math.max(0, forms.length - 1));
      const pic = caughtEntry ? { form: caughtEntry.form, female: false } : page === 'forms' && forms[formCursor] ? forms[formCursor]! : picture(ctx.registries, state, entry);
      const dex = dexFor(pic.form);
      const unknown = caught ? null : unknownTexts();
      const gender = state.gender;
      let area: PokedexEntryView['area'] = null;
      if (page === 'area' && map) {
        const layers = areaLayers(map, entry.dex, time, state);
        area = {
          map: map.image,
          overlays: layers.overlays,
          origin: map.origin,
          cell: map.cell,
          columns: map.columns,
          cells: layers.cells,
          specialCells: layers.specialCells,
          dungeons: layers.dungeons.map((d) => ({ ...d, x: map.dungeonOrigin[0] + d.x * map.cell, y: map.dungeonOrigin[1] + d.y * map.cell })),
          times: [text.t('morning'), text.t('day'), text.t('night')],
          time,
          unknown: layers.empty ? text.t('areaunknown') : null,
        };
      }
      const size = page === 'size' && caught ? dex.size[gender] : null;
      return {
        app: 'pokedex',
        screen: 'entry',
        pages: PAGES.map((id) => ({ id, label: text.t(id), enabled: enabled(id) })),
        page,
        species: entry.species.id,
        form: pic.form,
        female: pic.female,
        number: number(entry),
        name: entry.species.name,
        caught,
        category: text.record(unknown ? unknown.category : dex.category),
        types: caught ? [...new Set(entry.species.types)] : [],
        height: { label: text.t('ht'), value: text.record(unknown ? unknown.height : dex.heightText) },
        weight: { label: text.t('wt'), value: text.record(unknown ? unknown.weight : dex.weightText) },
        description: caught ? text.record(dex.description) : '',
        footprint: caught ? dex.footprint : null,
        area,
        size: size && {
          title: text.t('heightcheck_topscreen'),
          pokemon: { name: entry.species.name, height: text.record(dex.heightText), scale: size.pokemonScale, y: size.pokemonY },
          trainer: { name: state.names.player, height: text.t(gender === 'male' ? 'lucasheight' : 'dawnheight'), gender, scale: size.trainerScale, y: size.trainerY },
        },
        forms: page === 'forms' ? { prompt: text.t('anotherform'), list: forms, cursor: formCursor } : null,
        cry: page === 'cry' ? text.t('cry') : null,
      };
    },
    input(i: Input): Step {
      if ('tap' in i) {
        if (i.tap === 'back') return leave();
        if (i.tap === 'prev' || i.tap === 'next') return void step(i.tap === 'prev' ? -1 : 1);
        const p = tapIndex(i.tap, 'page');
        if (p !== null && PAGES[p]) return void setPage(PAGES[p]);
        const t = tapIndex(i.tap, 'time');
        if (t !== null && t >= 0 && t <= 2 && page === 'area') time = t;
        const f = tapIndex(i.tap, 'form');
        if (f !== null && f >= 0 && page === 'forms' && f < formList().length) formCursor = f;
        return;
      }
      const b = i.button;
      if (b === 'up' || b === 'down') step(b === 'up' ? -1 : 1);
      else if (b === 'l' || b === 'r') cyclePage(b === 'l' ? -1 : 1);
      else if (b === 'left' || b === 'right') {
        const d = b === 'left' ? -1 : 1;
        // The area page's left/right pick the time of day (decomp ov21_021DDD2C.c), the forms page's the form.
        if (page === 'area') time = Math.max(0, Math.min(2, time + d));
        else if (page === 'forms') formCursor = Math.max(0, Math.min(formList().length - 1, formCursor + d));
        else cyclePage(d);
      } else if (b === 'b') return leave();
      return;
    },
  };
}

const SEARCH_ROWS = ['order', 'name', 'type1', 'type2', 'shape'] as const;

function searchScreen(ctx: MenuContext, text: DexText, types: Id[], query: DexQuery, run: (q: DexQuery) => boolean): Screen {
  let cursor = 0;
  let message: string | null = null;
  const byName = ctx.host.options().dexNameSearch === 0;
  const counts = { order: ORDERS.length, name: NAME_GROUPS.length + (byName ? 2 : 1), type1: types.length + 1, type2: types.length + 1, shape: BODY_SHAPES + 1 };
  /** The typed name (OpenSinnoh): the naming screen; an empty name leaves the row at none. */
  const typeName = (): Step => ({
    push: namingScreen(
      ctx,
      { app: 'naming', kind: 'dex-search', initial: query.text, maxLength: NAME_LENGTH, gender: ctx.state.gender, pokemon: null },
      (name) => {
        if (name !== null) query.text = name;
        if (!query.text) query.name = 0;
        return 'pop';
      },
      () => ctx.host.options().autoLowercase === 0,
    ),
  });
  /** A type cannot be picked for both slots (decomp ov21_021DC67C). */
  const allowed = (row: (typeof SEARCH_ROWS)[number], v: number) => !((row === 'type1' && v && v === query.type2) || (row === 'type2' && v && v === query.type1));
  const set = (row: (typeof SEARCH_ROWS)[number], v: number) => {
    if (v < 0 || v >= counts[row] || !allowed(row, v)) return;
    query[row] = v;
  };
  const cycle = (row: (typeof SEARCH_ROWS)[number], d: number) => {
    let v = query[row];
    do v = (v + d + counts[row]) % counts[row];
    while (!allowed(row, v));
    query[row] = v;
  };
  const ok = (): Step => {
    if (query.name === TYPED_NAME && !query.text) query.name = 0;
    if (run(query)) return 'pop';
    message = text.t('nonefound');
    return;
  };
  const nameOfType = (t: Id) => ctx.registries.types.get(t)!.name;
  return {
    view(): PokedexSearchView {
      const descriptions = [text.t('listing_description'), text.t('alphabetical_description'), text.t('type_description'), text.t('type_description'), text.t('body_description')];
      return {
        app: 'pokedex',
        screen: 'search',
        title: text.t('search').replace('\n', ' '),
        rows: [
          { id: 'order', label: text.t('order'), options: ORDERS.map((k) => text.t(k)), value: query.order },
          { id: 'name', label: text.t('name'), options: [text.t('nonealphabetical'), ...NAME_GROUPS.map(([k]) => text.t(k)), ...(byName ? [query.text || ctx.text.t('dexByName')] : [])], value: query.name },
          { id: 'type1', label: text.t('type'), options: [text.t('nonetype'), ...types.map(nameOfType)], value: query.type1 },
          { id: 'type2', label: text.t('type'), options: [text.t('nonetype'), ...types.map(nameOfType)], value: query.type2 },
          { id: 'shape', label: text.t('form'), options: [text.t('nonetype'), ...Array.from({ length: BODY_SHAPES }, () => '')], value: query.shape },
        ],
        shapes: [-1, ...Array.from({ length: BODY_SHAPES }, (_, s) => s)],
        types: [null, ...types],
        cursor,
        ok: text.t('ok'),
        description: descriptions[cursor] ?? '',
        message,
      };
    },
    input(i: Input): Step {
      message = null;
      if ('tap' in i) {
        if (i.tap === 'back') return 'pop';
        if (i.tap === 'ok') return ok();
        const m = /^(order|name|type1|type2|shape):(\d+)$/.exec(i.tap);
        if (m) {
          const row = m[1] as (typeof SEARCH_ROWS)[number];
          cursor = SEARCH_ROWS.indexOf(row);
          set(row, Number(m[2]));
          if (row === 'name' && query.name === TYPED_NAME) return typeName();
        }
        return;
      }
      const b = i.button;
      if (b === 'up' || b === 'down') cursor = Math.max(0, Math.min(SEARCH_ROWS.length, cursor + (b === 'up' ? -1 : 1)));
      else if ((b === 'left' || b === 'right') && cursor < SEARCH_ROWS.length) cycle(SEARCH_ROWS[cursor]!, b === 'left' ? -1 : 1);
      else if (b === 'a' && cursor === SEARCH_ROWS.length) return ok();
      else if (b === 'a' && SEARCH_ROWS[cursor] === 'name' && query.name === TYPED_NAME) return typeName();
      else if (b === 'a') cursor++;
      else if (b === 'b') return 'pop';
      return;
    },
  };
}
