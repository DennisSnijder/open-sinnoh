/**
 * The summary screen (decomp applications/pokemon_summary_screen): pages INFO, TRAINER MEMO, SKILLS,
 * BATTLE MOVES and RIBBONS (the contest pages come with contests). Left/right change the page, up/down
 * the Pokémon. On BATTLE MOVES, A selects a move (its category, power, accuracy and description) and A
 * on another swaps them (decomp SUMMARY_MODE_NORMAL). Teach mode (SUMMARY_MODE_SELECT_MOVE, the forget-a-
 * move flow) opens on the moves with the new move fifth: A on an old move forgets it (HMs refused), A on
 * the new move or B gives up. On RIBBONS, A (or a tap on a ribbon) selects one: its name and description,
 * the cursor moving and scrolling by the DS's rules (ChangeSelectedRibbon); A or B lets go.
 */
import { CONDITIONS, eggWatchMessage, isShiny, maxPp, MAX_CONDITION, MAX_LEVEL, monGender, natureIndex, type Button, type Id, type Pokemon, type StatName } from '@opensinnoh/core';
import { dexOf, newGameRecord, type Poffin, type SummaryPageId, type SummaryView } from '@opensinnoh/contracts';
import { feedPoffin, flavorPreference, isHmMove, wontEat } from '@opensinnoh/services';
import { menuSe, type MenuContext } from './context.ts';
import { Dialog } from './dialog.ts';
import { monName } from './party.ts';
import { namingScreen } from './naming.ts';
import { tapIndex, type Screen, type Step } from './stack.ts';
import type { MenuKey } from './strings.ts';

type Input = { button: Button } | { tap: string };

/**
 * `teach.move` null: a move pick with no new move (decomp FieldSystem_OpenSummaryScreenSelectMove, the move deleter).
 * 0.31.0 `feed` (SUMMARY_MODE_FEED_POFFIN): A gives the Poffin to the Pokémon shown (`done` its slot; null for B, or
 * when it won't eat any more). `condition-change` (SUMMARY_MODE_SHOW_CONDITION_CHANGE): A feeds `poffin` to it and
 * shows what changed.
 */
export type SummaryMode =
  | { kind: 'view' }
  | { kind: 'teach'; move: Id | null; done: (forget: number | null) => Step }
  | { kind: 'feed'; done: (slot: number | null) => Step }
  | { kind: 'condition-change'; poffin: Poffin; done: () => Step };

const PAGES: { id: SummaryPageId; label: MenuKey }[] = [
  { id: 'info', label: 'sumInfo' },
  { id: 'memo', label: 'sumMemo' },
  { id: 'skills', label: 'sumSkills' },
  { id: 'condition', label: 'sumCondition' },
  { id: 'moves', label: 'sumMoves' },
  { id: 'ribbons', label: 'sumRibbons' },
];
/** The five stats in the skills page order, with their labels. */
const SKILL_STATS: { stat: StatName; label: MenuKey }[] = [
  { stat: 'attack', label: 'sumAttack' },
  { stat: 'defense', label: 'sumDefense' },
  { stat: 'spAttack', label: 'sumSpAttack' },
  { stat: 'spDefense', label: 'sumSpDefense' },
  { stat: 'speed', label: 'sumSpeed' },
];
/** The SKILLS page's numbers with the EV/IV view on (OpenSinnoh): A steps through them. */
const VALUE_MODES = [
  { mode: 'stats', label: 'sumStatsView' },
  { mode: 'evs', label: 'sumEvsView' },
  { mode: 'ivs', label: 'sumIvsView' },
] as const satisfies readonly { mode: string; label: MenuKey }[];
/** Decomp MON_NAME_LEN (the naming screen's length for a nickname). */
const MON_NAME_LEN = 10;
/** Decomp RIBBONS_PER_ROW; RIBBONS_PER_PAGE / RIBBONS_PER_ROW rows show while browsing, two while selecting. */
const RIBBONS_PER_ROW = 4;
const BROWSE_ROWS = 3;
const SELECT_ROWS = 2;
/** Decomp Unk_020F5578: the characteristic is message 71 + 5 · stat + (its IV % 5), stats in HP, Atk, Def, Speed, SpAtk, SpDef order. */
const CHARACTERISTIC_STATS: StatName[] = ['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'];
/** The CONDITION page's FAVORITE FOOD line by the liked flavour (decomp PokemonSummary_Text_LikesItSpicy + flavour). */
const LIKES: MenuKey[] = ['sumLikesSpicy', 'sumLikesDry', 'sumLikesSweet', 'sumLikesBitter', 'sumLikesSour'];
/** Decomp PrintPoffinFeedMsg: the raised conditions' messages, cool … tough. */
const ENHANCED: MenuKey[] = ['sumCoolEnhanced', 'sumBeautyEnhanced', 'sumCuteEnhanced', 'sumSmartEnhanced', 'sumToughEnhanced'];
/** Decomp MAX_SHEEN_SPRITES (SUMMARY_SPRITE_SHEEN_1 … 12) and the spider graph's growth in frames (a quarter per frame). */
const SHEEN_SPRITES = 12;
const GRAPH_STEPS = 4;
/** Favourite flavour by the raised stat (messages 65 spicy, 66 dry, 67 sweet, 68 bitter, 69 sour; 70 eats anything). */
const FLAVOR: Partial<Record<StatName, number>> = { attack: 65, spAttack: 66, speed: 67, spDefense: 68, defense: 69 };

const summaryMessage = (n: number) => `pl_msg_00000455_${String(n).padStart(5, '0')}`;
/**
 * The summary bank's messages this screen reads by number: natures (24–48), the met line (49, 50), the hatched
 * line (52, 53), flavours and characteristics (65–100), an egg's memo (101, 102) and "The Egg Watch" (105–108).
 */
export const SUMMARY_MESSAGES = [...Array.from({ length: 27 }, (_, i) => 24 + i), 52, 53, ...Array.from({ length: 38 }, (_, i) => 65 + i), 105, 106, 107, 108].map(summaryMessage);

export function summaryScreen(ctx: MenuContext, o: { party: () => Pokemon[]; slot: number; mode: SummaryMode }): Screen {
  const t = ctx.text;
  const dex = dexOf(ctx.registries);
  const dialog = new Dialog(t.t('yes'), t.t('no'), (n) => menuSe(ctx, n));
  const teach = o.mode.kind === 'teach' ? o.mode : null;
  const feed = o.mode.kind === 'feed' ? o.mode : null;
  const change = o.mode.kind === 'condition-change' ? o.mode : null;
  const conditionOnly = !!(feed || change);
  let slot = o.slot;
  let page: SummaryPageId = teach ? 'moves' : conditionOnly ? 'condition' : 'info';
  // Decomp PokemonSummaryScreen_ShowContestData: CONDITION shows once the Contest Hall was visited (the feed modes always).
  const contestFlag = newGameRecord(ctx.registries).contestHallFlag;
  const showContest = () => conditionOnly || (!!contestFlag && (ctx.state.flags[contestFlag] ?? ctx.registries.flags.get(contestFlag)?.initial ?? false));
  // Decomp SetupInitialPageGfx / PokemonSummaryScreen_PageIsVisble: an egg shows its TRAINER MEMO only.
  const pages = () =>
    conditionOnly ? PAGES.filter((p) => p.id === 'condition')
    : o.party()[slot]!.isEgg ? PAGES.filter((p) => p.id === 'memo')
    : PAGES.filter((p) => p.id !== 'condition' || showContest());
  /** The spider graph's growth (frames since it started, from `graphFrom`), the sheen sparkles' frames, the raised conditions. */
  let graphFrame = 0;
  let graphFrom = [0, 0, 0, 0, 0];
  let sheenFrame = 0;
  let arrows = [false, false, false, false, false];
  /** condition-change: the Poffin is eaten (the first A) and the messages wait for the next A. */
  let fed = false;
  const restartGraph = (from = [0, 0, 0, 0, 0]) => {
    graphFrom = from;
    graphFrame = 0;
    sheenFrame = 0;
  };
  const showPage = () => (pages().some((p) => p.id === page) ? page : pages()[0]!.id);
  /** The selected move (moves page), null while browsing pages. */
  let moveCursor: number | null = teach ? 0 : null;
  let swapping: number | null = null;
  /** Decomp ribbonRow (the first shown row) and ribbonCol (the cursor within the two shown rows; null while browsing). */
  let ribbonRow = 0;
  let ribbonCol: number | null = null;
  const mon = () => o.party()[slot]!;
  /** The EV/IV view (OpenSinnoh option `statView`): which numbers SKILLS shows; it stays as the Pokémon change. */
  let valueMode = 0;
  const statView = () => ctx.host.options().statView === 0 && !teach;
  /** RENAME (OpenSinnoh option `summaryRename`): the player's own Pokémon (not an Egg, not traded), outside teach mode. */
  const canRename = () => {
    const m = mon();
    return ctx.host.options().summaryRename === 0 && !teach && !m.isEgg && m.otId === ctx.state.trainerId && m.otName === ctx.state.names.player;
  };
  /** The naming screen for the shown Pokémon (as the Name Rater's: the species name clears the nickname). */
  const rename = (): Step => {
    const m = mon();
    const species = ctx.registries.species.get(m.species)!.name;
    menuSe(ctx, 1500);
    return {
      push: namingScreen(
        ctx,
        { app: 'naming', kind: 'pokemon', initial: monName(ctx, m), maxLength: MON_NAME_LEN, gender: ctx.state.gender, pokemon: { species: m.species, form: m.form, gender: monGender(dex, m) } },
        (name) => {
          if (name !== null) m.nickname = name === species ? null : name;
          return 'pop';
        },
        () => ctx.host.options().autoLowercase === 0,
      ),
    };
  };
  const ribbonTexts = () => {
    const list = newGameRecord(ctx.registries).ribbons ?? [];
    return mon().ribbons.map((r) => {
      const texts = list[r];
      if (!texts) throw new Error(`summary: the pack has no texts for ribbon ${r}`);
      return { ribbon: r, ...texts };
    });
  };
  /** Decomp ChangeSelectedRibbon (main.c) over the Pokémon's ribbon count. */
  const moveRibbon = (delta: number) => {
    const max = mon().ribbons.length;
    let col = ribbonCol!;
    const w = RIBBONS_PER_ROW;
    if (delta === 1) {
      if (col % w !== w - 1 && ribbonRow * w + col + 1 < max) col++;
    } else if (delta === -1) {
      if (col % w !== 0) col--;
    } else if (delta === w) {
      if (col < w) {
        if (ribbonRow * w + col + w < max) col += w;
        else if (max > w && max % w !== 0) col = (max % w) + w - 1;
      } else if (ribbonRow * w + w * 2 < max) {
        ribbonRow++;
        if (ribbonRow * w + col >= max) col = (max % w) + w - 1;
      }
    } else if (col >= w) col -= w;
    else if (ribbonRow !== 0) ribbonRow--;
    ribbonCol = col;
  };
  /** A tap on shown ribbon `i` (an index into the list): select it, or let go of the selected one. */
  const tapRibbon = (i: number) => {
    const w = RIBBONS_PER_ROW;
    if (ribbonCol !== null) {
      if (i === ribbonRow * w + ribbonCol) return void (ribbonCol = null);
      if (i < ribbonRow * w || i >= (ribbonRow + SELECT_ROWS) * w) return;
      ribbonCol = i - ribbonRow * w;
      return;
    }
    if (i >= BROWSE_ROWS * w) return;
    // Selecting shows two rows: a ribbon in the third row scrolls one row down (as down from the second row would).
    ribbonRow = Math.max(0, Math.floor(i / w) - (SELECT_ROWS - 1));
    ribbonCol = i - ribbonRow * w;
  };
  const moveRows = () => [...mon().moves, ...(teach?.move ? [teach.move] : [])];

  const pickMove = (i: number): Step => {
    moveCursor = i;
    if (teach) {
      if (i === mon().moves.length) return teach.done(null);
      // Decomp: HM moves are refused only when a new move waits (summary data move != MOVE_NONE).
      if (teach.move && isHmMove(ctx.registries, mon().moves[i]!)) return dialog.say(t.pages('sumHmCantForget'));
      return teach.done(i);
    }
    if (swapping === null) {
      swapping = i;
      return;
    }
    const m = mon();
    const a = swapping;
    swapping = null;
    if (a !== i) {
      for (const list of [m.moves, m.pp, m.ppUps] as unknown[][]) [list[a], list[i]] = [list[i], list[a]];
    }
    return;
  };
  const stepValues = (): Step => {
    menuSe(ctx, 1500);
    valueMode = (valueMode + 1) % VALUE_MODES.length;
    return;
  };
  const changePage = (d: number) => {
    if (teach || conditionOnly || moveCursor !== null || ribbonCol !== null) return;
    const list = pages();
    const i = list.findIndex((p) => p.id === showPage());
    const next = list[(i + d + list.length) % list.length]!.id;
    if (next !== page) menuSe(ctx, 1505);
    if (next === 'condition' && next !== page) restartGraph();
    page = next;
  };
  const changeMon = (d: number) => {
    if (teach || change || moveCursor !== null || ribbonCol !== null) return;
    const n = o.party().length;
    // The feed mode passes over Eggs (they have no CONDITION page).
    do slot = (slot + d + n) % n;
    while (feed && o.party()[slot]!.isEgg);
    ribbonRow = 0;
    page = showPage();
    restartGraph();
  };
  /** Decomp TryFeedPoffin: a Pokémon at full sheen refuses ("It won't eat any more..."; the case keeps the Poffin). */
  const tryFeed = (f: NonNullable<typeof feed>): Step => {
    menuSe(ctx, 1501);
    if (wontEat(mon())) return dialog.say(t.pages('sumWontEatMore'), () => f.done(null));
    return f.done(slot);
  };
  /** Decomp SetupPoffinFeedConditionPage, PrintContestStatChangeMsgs: the first A feeds, the next print what was raised. */
  const showChange = (c: NonNullable<typeof change>): Step => {
    if (fed) {
      const raised = ENHANCED.filter((_, i) => arrows[i]);
      return dialog.say(raised.flatMap((k) => t.pages(k)), () => c.done());
    }
    fed = true;
    const m = mon();
    const before = CONDITIONS.slice(0, 5).map((k) => m.condition[k]);
    feedPoffin(dex, m, c.poffin);
    arrows = CONDITIONS.slice(0, 5).map((k, i) => m.condition[k] !== before[i]);
    if (!arrows.some(Boolean)) return dialog.say(t.pages('sumNothingChanged'), () => c.done());
    restartGraph(before);
    return;
  };
  const back = (): Step => {
    menuSe(ctx, 1501);
    if (teach) return teach.done(null);
    if (feed) return feed.done(null);
    if (change) return;
    if (moveCursor !== null) {
      moveCursor = null;
      swapping = null;
      return;
    }
    if (ribbonCol !== null) {
      ribbonCol = null;
      ribbonRow = 0;
      return;
    }
    return 'pop';
  };

  /** A place and date as template slots [year (2 digits), month, day, place]; empty without a date. */
  const when = (zone: Id | null, date: string | null): string[] => {
    const place = zone ? (ctx.registries.zones.get(zone)?.name ?? t.t('sumUnknown')) : t.t('sumUnknown');
    const d = date?.split('-').map(Number);
    return d ? [String(d[0]! % 100).padStart(2, '0'), t.month(d[1]! - 1), String(d[2]), place] : ['', '', '', place];
  };
  const memo = (m: Pokemon): string[] => {
    const lines: string[] = [];
    const own = m.otId === ctx.state.trainerId && m.otName === ctx.state.names.player;
    if (m.isEgg) {
      // Decomp sub_02092494 cases 16/17: "A mysterious Pokémon Egg received from / obtained in", then the Egg Watch (by cycles left).
      const [y, mo, d, place] = when(m.met.zone, m.met.date);
      const got = t.message(summaryMessage(own ? 101 : 102), '', '', '', '', '', y!, mo!, d!, place!).split('\n');
      lines.push(...(m.met.date ? got : got.slice(1)), ...t.message(summaryMessage(eggWatchMessage(m.friendship))).split('\n'));
      return lines;
    }
    lines.push(t.message(summaryMessage(24 + natureIndex(dex, m.pid))));
    if (m.met.egg) {
      // Hatched (cases 3/4): the egg's receipt, then where it hatched.
      const [y, mo, d, place] = when(m.met.zone, m.met.date);
      const [ey, emo, ed, eplace] = when(m.met.egg.zone, m.met.egg.date);
      lines.push(...t.message(summaryMessage(own ? 52 : 53), y!, mo!, d!, '', place!, ey!, emo!, ed!, eplace!).split('\n'));
    } else {
      const [y, mo, d, place] = when(m.met.zone, m.met.date);
      const met = t.message(summaryMessage(own ? 49 : 50), y!, mo!, d!, String(m.met.level), place!).split('\n');
      // Without a met date (set-up and migrated Pokémon) the date line is left out.
      lines.push(...(m.met.date ? met : met.slice(1)));
    }
    lines.push(t.message(summaryMessage(characteristic(m))));
    const up = dex.nature(m.pid).up;
    lines.push(t.message(summaryMessage(up ? FLAVOR[up]! : 70)));
    return lines;
  };
  const characteristic = (m: Pokemon): number => {
    const start = (m.pid >>> 0) % 6;
    let best = start;
    for (let k = 1; k < 6; k++) {
      const s = (start + k) % 6;
      if (m.ivs[CHARACTERISTIC_STATS[s]!] > m.ivs[CHARACTERISTIC_STATS[best]!]) best = s;
    }
    return 71 + best * 5 + (m.ivs[CHARACTERISTIC_STATS[best]!] % 5);
  };

  /** CONDITION's view (decomp 3d_anim.c, sprites.c PokemonSummaryScreen_InitSheenSprites, window.c DrawConditionPageWindows). */
  const conditionView = (m: Pokemon): SummaryView['condition'] => {
    const liked = flavorPreference(dex.nature(m.pid))?.liked;
    const sheen = m.condition.sheen;
    return {
      title: t.t('sumCondition'),
      sheenLabel: t.t('sumSheen'),
      values: CONDITIONS.slice(0, 5).map((k) => m.condition[k]),
      from: graphFrom,
      graph: Math.min(graphFrame, GRAPH_STEPS),
      sheen: sheen >= MAX_CONDITION ? SHEEN_SPRITES : (Math.trunc((SHEEN_SPRITES << 8) / MAX_CONDITION) * sheen) >> 8,
      sheenFrame,
      flavor: conditionOnly ? { label: t.t('sumFavoriteFood'), text: t.t(liked === undefined ? 'sumEatsAnything' : LIKES[liked]!) } : null,
      prompt: feed ? t.t('sumPoffinOk') : null,
      arrows,
    };
  };

  return {
    /** The CONDITION page's frames: the graph's growth and the sheen's sparkles run on their own. */
    tick(): Step {
      if (showPage() !== 'condition') return;
      graphFrame++;
      sheenFrame++;
      return;
    },
    view(): SummaryView {
      const m = mon();
      const sp = ctx.registries.species.get(m.species)!;
      const data = dex.form(m.species, m.form);
      const table = dex.expTable(data.growthRate);
      const nextExp = m.level >= MAX_LEVEL ? m.exp : table[m.level + 1]!;
      const levelExp = table[m.level]!;
      const nature = dex.nature(m.pid);
      const types = [...new Set(data.types)].map((id) => ({ id, name: ctx.registries.types.get(id)!.name }));
      const ability = m.ability ? ctx.registries.abilities.get(m.ability)! : null;
      const rows = moveRows();
      const selected = moveCursor !== null ? rows[moveCursor] : undefined;
      const detail = selected ? ctx.registries.moves.get(selected)! : null;
      const ribbons = ribbonTexts();
      const ribbonCursor = ribbonCol === null ? null : ribbonRow * RIBBONS_PER_ROW + ribbonCol;
      const ribbon = ribbonCursor === null ? null : ribbons[ribbonCursor]!;
      const values = statView() ? VALUE_MODES[valueMode]! : VALUE_MODES[0];
      const number = (stat: StatName) => String(values.mode === 'evs' ? m.evs[stat] : values.mode === 'ivs' ? m.ivs[stat] : m.stats[stat]);
      return {
        app: 'summary',
        mode: o.mode.kind,
        pages: pages().map((p) => ({ id: p.id, label: t.t(p.label) })),
        page: showPage(),
        mon: {
          species: m.species,
          form: m.form,
          shiny: isShiny(m.otId, m.pid),
          egg: m.isEgg,
          name: monName(ctx, m),
          gender: m.isEgg ? 'none' : monGender(dex, m),
          level: String(m.level),
          item: { label: t.t('sumItem'), value: m.heldItem ? ctx.registries.items.get(m.heldItem)!.name : t.t('sumNone') },
          ball: m.ball,
          status: m.hp === 0 ? 'fainted' : m.status,
        },
        info: {
          fields: [
            { label: t.t('sumDexNo'), value: String(sp.sourceIndex ?? 0).padStart(3, '0') },
            { label: t.t('sumName'), value: sp.name },
            { label: t.t('sumType'), value: types.map((x) => x.name).join(' / ') },
            { label: t.t('sumOt'), value: m.otName },
            { label: t.t('sumIdNo'), value: String(m.otId & 0xffff).padStart(5, '0') },
            { label: t.t('sumExp'), value: String(m.exp) },
            { label: t.t('sumToNext'), value: String(nextExp - m.exp) },
          ],
          types,
          exp: nextExp === levelExp ? 0 : (m.exp - levelExp) / (nextExp - levelExp),
          ...(canRename() ? { rename: t.t('sumRename') } : {}),
        },
        memo: memo(m),
        skills: {
          hp: { label: t.t('sumHp'), value: values.mode === 'stats' ? `${m.hp}/${m.stats.hp}` : number('hp') },
          hpNow: m.hp,
          hpMax: m.stats.hp,
          stats: SKILL_STATS.map((s) => ({ label: t.t(s.label), value: number(s.stat), nature: nature.up === s.stat && nature.down !== s.stat ? 'up' : nature.down === s.stat && nature.up !== s.stat ? 'down' : null })),
          ability: { label: t.t('sumAbility'), value: ability?.name ?? t.t('sumNone') },
          abilityDescription: ability ? t.text(ability.description) : '',
          ...(statView() && !m.isEgg ? { values: { mode: values.mode, label: t.t(values.label) } } : {}),
        },
        moves: {
          rows: rows.map((id, i) => {
            const mv = ctx.registries.moves.get(id)!;
            const isNew = i >= m.moves.length;
            const pp = isNew ? `${mv.pp}/${mv.pp}` : `${m.pp[i]}/${maxPp(mv.pp, m.ppUps[i]!)}`;
            return { move: id, name: mv.name, type: mv.type, pp, isNew };
          }),
          cursor: moveCursor,
          swapping,
          detail: detail
            ? {
                category: detail.category,
                categoryName: t.t(detail.category === 'physical' ? 'sumPhysical' : detail.category === 'special' ? 'sumSpecial' : 'sumStatus'),
                power: { label: t.t('sumPower'), value: detail.power > 1 ? String(detail.power) : t.t('sumThreeDashes') },
                accuracy: { label: t.t('sumAccuracy'), value: detail.accuracy > 0 ? String(detail.accuracy) : t.t('sumThreeDashes') },
                description: t.text(detail.description),
              }
            : null,
          hint: t.t(teach ? 'partyWhichForget' : moveCursor !== null ? 'sumSwitch' : 'sumMoveInfo'),
          empty: { name: t.t('sumNoMove'), pp: t.t('sumTwoDashes') },
        },
        ribbons: {
          count: { label: t.t('sumRibbonCount'), value: String(ribbons.length) },
          list: ribbons.map((r) => ({ ribbon: r.ribbon, name: t.text(r.name) })),
          row: ribbonRow,
          rows: ribbonCursor === null ? BROWSE_ROWS : SELECT_ROWS,
          cursor: ribbonCursor,
          detail: ribbon ? { name: t.text(ribbon.name), description: t.text(ribbon.description), index: `${ribbonCursor! + 1}${t.t('sumRibbonSlash')}${ribbons.length}` } : null,
          hint: ribbon ? t.t('sumRibbonCancel') : ribbons.length ? t.t('sumRibbonInfo') : '',
        },
        condition: conditionView(m),
        message: dialog.message(),
      };
    },
    input(i: Input): Step {
      if (dialog.active) return dialog.input(i);
      // The feed modes: A gives the Poffin, or feeds it and shows what changed (taps: `ok`, the A-button prompt; `next`).
      if (feed && (('button' in i && i.button === 'a') || ('tap' in i && i.tap === 'ok'))) return tryFeed(feed);
      if (change && (('button' in i && (i.button === 'a' || i.button === 'b')) || ('tap' in i && (i.tap === 'next' || i.tap === 'back')))) return showChange(change);
      if ('tap' in i) {
        if (i.tap === 'back') return back();
        if (i.tap === 'prev' || i.tap === 'next') return void changeMon(i.tap === 'prev' ? -1 : 1);
        if (i.tap === 'rename' && showPage() === 'info' && canRename()) return rename();
        if (i.tap === 'values' && showPage() === 'skills' && statView()) return stepValues();
        const p = /^page:(\w+)$/.exec(i.tap);
        if (p && !teach && moveCursor === null && ribbonCol === null && pages().some((x) => x.id === p[1])) {
          if (page !== p[1]) menuSe(ctx, 1505);
          if (page !== p[1] && p[1] === 'condition') restartGraph();
          page = p[1] as SummaryPageId;
          return;
        }
        if (i.tap === 'ribbons:up' || i.tap === 'ribbons:down') {
          if (ribbonCol !== null) moveRibbon(i.tap === 'ribbons:up' ? -RIBBONS_PER_ROW : RIBBONS_PER_ROW);
          return;
        }
        const r = tapIndex(i.tap, 'ribbon');
        if (r !== null) {
          if (showPage() === 'ribbons' && r >= 0 && r < mon().ribbons.length) tapRibbon(r);
          return;
        }
        const n = tapIndex(i.tap, 'move');
        if (n === null || showPage() !== 'moves' || n < 0 || n >= moveRows().length) return;
        // The first tap selects a move (its details), a second tap on it picks it.
        if (moveCursor !== n) { menuSe(ctx, moveCursor === null ? 1692 : 1500); moveCursor = n; return; }
        return pickMove(n);
      }
      const b = i.button;
      if (ribbonCol !== null) {
        if (b === 'left') moveRibbon(-1);
        else if (b === 'right') moveRibbon(1);
        else if (b === 'up') moveRibbon(-RIBBONS_PER_ROW);
        else if (b === 'down') moveRibbon(RIBBONS_PER_ROW);
        else if (b === 'a' || b === 'b') return back();
        return;
      }
      if (moveCursor !== null) {
        const n = moveRows().length;
        if (b === 'up') moveCursor = (moveCursor - 1 + n) % n;
        else if (b === 'down') moveCursor = (moveCursor + 1) % n;
        else if (b === 'a') return pickMove(moveCursor);
        else if (b === 'b') return back();
        return;
      }
      if (b === 'left') changePage(-1);
      else if (b === 'right') changePage(1);
      else if (b === 'up') changeMon(-1);
      else if (b === 'down') changeMon(1);
      else if (b === 'a' && showPage() === 'moves' && moveRows().length) { menuSe(ctx, 1692); moveCursor = 0; }
      else if (b === 'a' && showPage() === 'info' && canRename()) return rename();
      else if (b === 'a' && showPage() === 'skills' && statView() && !mon().isEgg) return stepValues();
      else if (b === 'a' && showPage() === 'ribbons' && mon().ribbons.length) {
        ribbonRow = 0;
        ribbonCol = 0;
      }
      else if (b === 'b') return back();
      return;
    },
  };
}

