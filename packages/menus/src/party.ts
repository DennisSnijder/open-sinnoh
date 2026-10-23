/**
 * The party (decomp applications/party_menu): six panels and the CANCEL button, in one of its modes.
 * - `field` (start menu): the context window SUMMARY, the Pokémon's field moves, SWITCH, ITEM, CANCEL
 *   (an egg: SUMMARY, SWITCH, CANCEL; GetContextMenuEntriesForPartyMon); ITEM opens GIVE / TAKE.
 * - `give` (the bag's GIVE), `use` (a bag item on a member, a PP item picks a move), `teach` (a TM/HM,
 *   with ABLE! / UNABLE! / LEARNED and the forget-a-move flow through the summary): each returns to the bag.
 * - `daycare` (`daycare-select`, decomp PARTY_MENU_MODE_DAYCARE): STORE, SUMMARY, CANCEL (an egg: SUMMARY,
 *   CANCEL; sub_020801B8); STORE closes with the slot, B or CANCEL with none.
 * - `select` (a script's `select_move_tutor_pokemon`): A on a panel returns its slot at once.
 * - `order` (`party-order`, decomp PARTY_MENU_MODE_BATTLE_TOWER): ENTER / NO ENTRY and SUMMARY per panel, the
 *   panels say FIRST… / NOT ENTERED / BANNED, CONFIRM returns the slots in the order entered, CANCEL or B none.
 * - `contest` (`contest-select`, decomp PARTY_MENU_MODE_CONTEST): the panels say ELIGIBLE / INELIGIBLE (CheckContestEligibility);
 *   ENTER (eligible only, sub_020801F0), SUMMARY, CANCEL; ENTER closes with the slot, B or CANCEL with none.
 * The battle's party (`party-select`) and the battle bag's target are battle.ts.
 */
import { evolutionTarget, maxPp, monGender, movesAtLevel, setMoveSlot, type Button, type Id, type Pokemon, type Stats } from '@opensinnoh/core';
import { dexOf, itemCount, levelEvolutionTrigger, markCaught, takeItem as takeBagItem, type AppMenu, type AppResult, type PartyView } from '@opensinnoh/contracts';
import { bySource, canShayminSky, contestEligible, frontierBanned, HALL, canUseItemOn, giveHeldItem, ITEM_GRACIDEA, itemPicksMove, itemRecord, setShayminForm, SHAYMIN_SKY, takeHeldItem, teachTm, tmCompatibility, useItemOnMon, type ItemUsedMessage } from '@opensinnoh/services';
import { menuSe, type MenuContext } from './context.ts';
import { Dialog } from './dialog.ts';
import { moveCursor, tapIndex, type Screen, type Step } from './stack.ts';
import type { MenuKey } from './strings.ts';
import { bagScreen } from './bag.ts';
import { evolutionScreen } from './evolution.ts';
import { summaryScreen } from './summary.ts';
import { townMapScreen } from './town-map.ts';

type Input = { button: Button } | { tap: string };

/** Decomp sFieldMoves (party_menu/main.c), by move name: the moves the context window lists. */
const FIELD_MOVES = new Set([
  'MOVE_CUT', 'MOVE_FLY', 'MOVE_SURF', 'MOVE_STRENGTH', 'MOVE_DEFOG', 'MOVE_ROCK_SMASH', 'MOVE_WATERFALL', 'MOVE_ROCK_CLIMB',
  'MOVE_FLASH', 'MOVE_TELEPORT', 'MOVE_DIG', 'MOVE_SWEET_SCENT', 'MOVE_CHATTER', 'MOVE_SOFTBOILED', 'MOVE_MILK_DRINK',
]);
const localName = (id: Id) => id.slice(id.indexOf(':') + 1);
/** The party-menu field moves that give HP to another member (decomp ACTION_SOFTBOILED, ACTION_MILK_DRINK). */
const HP_TRANSFER = new Set(['MOVE_SOFTBOILED', 'MOVE_MILK_DRINK']);
/** SEQ_SE_DP_KAIFUKU (the healing sound), by SDAT index. */
const SE_HEAL = 1516;
/** Decomp SEQ_SE_DP_CUSTOM06: the party's refusal buzz. */
const SE_CUSTOM06 = 1522;

export type PartyMode =
  | { kind: 'field' }
  | { kind: 'give'; item: Id }
  | { kind: 'use'; item: Id }
  | { kind: 'teach'; item: Id }
  | { kind: 'daycare' }
  /** A script's pick (decomp PARTY_MENU_MODE_SELECT_NO_PROMPT): A returns the slot, an Egg included. */
  | { kind: 'select' }
  /** 0.31.0. The Poffin Case's GIVE (decomp PARTY_MENU_MODE_FEED_POFFIN): A picks a Pokémon (an Egg buzzes), B gives up. */
  | { kind: 'feed'; pick: (slot: number | null) => Step }
  /**
   * 0.34.0. The Battle Tower's pick of `count` in order (decomp PARTY_MENU_MODE_BATTLE_TOWER, reqLevel 100). 0.37.0:
   * `hall`, the Battle Hall's (PARTY_MENU_MODE_BATTLE_HALL: level 30 or more, all of one species).
   */
  | { kind: 'order'; count: number; hall?: true }
  /** 0.35.0. A contest's entry (decomp PARTY_MENU_MODE_CONTEST): ENTER (when eligible), SUMMARY, CANCEL. */
  | { kind: 'contest'; rank: number; type: number };

/** A context or submenu entry: its label and what A does. */
interface Entry {
  label: string;
  right?: string;
  run: () => Step;
}

/** The party panel view of one Pokémon (shared with the PC's party column). */
export function slotView(ctx: MenuContext, m: Pokemon): NonNullable<PartyView['slots'][number]> {
  return {
    species: m.species,
    form: m.form,
    name: monName(ctx, m),
    levelLabel: ctx.text.t('level'),
    level: String(m.level),
    hp: m.hp,
    maxHp: m.stats.hp,
    egg: m.isEgg,
    gender: m.isEgg ? 'none' : monGender(dexOf(ctx.registries), m),
    status: m.hp === 0 ? 'fainted' : m.status,
    heldItem: m.heldItem,
  };
}

/** The nickname, or the species name; an egg is named by the egg species (decomp Egg_CreateEgg: SPECIES_EGG's name). */
export function monName(ctx: Pick<MenuContext, 'registries' | 'text'>, m: Pokemon): string {
  if (m.isEgg) return ctx.registries.species.get(ctx.text.id('SPECIES_EGG'))!.name;
  return m.nickname ?? ctx.registries.species.get(m.species)?.name ?? m.species;
}

const ITEM_MESSAGES: Record<ItemUsedMessage['key'], MenuKey> = {
  hpRestored: 'partyHpRestored',
  regainedHealth: 'partyRegainedHealth',
  becameHealthy: 'partyBecameHealthy',
  curedPoison: 'partyCuredPoison',
  wokeUp: 'partyWokeUp',
  burnHealed: 'partyBurnHealed',
  thawedOut: 'partyThawedOut',
  curedParalysis: 'partyCuredParalysis',
  ppRestored: 'partyPpRestored',
  ppIncreased: 'partyPpIncreased',
  statRose: 'partyStatRose',
  noEffect: 'partyNoEffect',
};
const STAT_INDEX = { hp: 0, attack: 1, defense: 2, speed: 3, spAttack: 4, spDefense: 5 } as const;
/** The level-up stats window's rows (decomp PartyMenu_DrawLevelUpStatIncreases): MAX HP, ATTACK, DEFENSE, SP. ATK, SP. DEF, SPEED. */
const LEVEL_UP_STATS: [keyof Stats, MenuKey][] = [
  ['hp', 'partyStatHp'],
  ['attack', 'partyStatAttack'],
  ['defense', 'partyStatDefense'],
  ['spAttack', 'partyStatSpAttack'],
  ['spDefense', 'partyStatSpDefense'],
  ['speed', 'partyStatSpeed'],
];

export function partyScreen(ctx: MenuContext, mode: PartyMode, done: () => Step = () => 'pop'): Screen {
  const t = ctx.text;
  const dialog = new Dialog(t.t('yes'), t.t('no'), (n) => menuSe(ctx, n));
  const party = (): Pokemon[] => ctx.state.party;
  let cursor = 0;
  let moving: number | null = null;
  /** The swap's two cues, 17 ticks apart (cue timing only: the swap itself is immediate and input stays live). */
  let swapCue: number | null = null;
  let menu: { title: string; entries: Entry[]; cursor: number } | null = null;
  /** The level-up stats window (two pages: the increases, then the values); A or B goes on. */
  let stats: { rows: { label: string; right: string }[]; then: () => Step } | null = null;
  /**
   * Softboiled or Milk Drink picking its target (decomp PartyMenu_StartFieldMoveHPTransfer): the donor's slot and the
   * HP it gives (a fifth of its max HP).
   */
  let transfer: { from: number; amount: number } | null = null;
  /**
   * The transfer running (PartyMenu_HPTransferUpdateHP): the donor's bar counts down, then the target's up, a point per
   * DS frame (two per 30 Hz tick); `done` points so far in the phase.
   */
  let flow: { from: number; to: number; amount: number; phase: 'donate' | 'receive'; done: number } | null = null;
  /** An evolution scene was pushed from here: when it pops, the party closes too (decomp: back to the bag). */
  let closeOnResume = false;
  /** Order mode: the slots entered, in order (decomp selectionOrder). */
  const picks: number[] = [];
  const ordering = mode.kind === 'order';
  /** The panels, then CONFIRM (order mode), then CANCEL. */
  const stops = () => party().length + (ordering ? 2 : 1);
  const cancelStop = () => stops() - 1;
  const confirmStop = () => party().length;
  const close = (result: AppResult): Step => ({ close: result });
  const cancel = (): Step => (mode.kind === 'contest' ? close({ app: 'contest-select', slot: null }) : mode.kind === 'select' ? close({ app: 'party', slot: null }) : mode.kind === 'feed' ? mode.pick(null) : ordering ? close({ app: 'party-order', order: null }) : 'pop');
  const name = (slot: number) => monName(ctx, party()[slot]!);
  const itemName = (id: Id) => itemRecord(ctx.registries, id).name;
  const moveName = (id: Id) => ctx.registries.moves.get(id)!.name;
  const openMenu = (title: string, entries: Entry[]): Step => {
    menu = { title, entries: [...entries, { label: t.t('partyContextCancel'), run: () => void (menu = null) }], cursor: 0 };
    return;
  };
  const say = (key: MenuKey, slots: string[], then: () => Step = () => undefined) => dialog.say(t.pages(key, ...slots), then);
  /** An item's message on a member (decomp PartyMenuCB_PrintThenWaitABPress): A or B goes on without a sound. */
  const sayUsed = (pages: string[], then: () => Step) => dialog.say(pages, then, true);

  // --- field: the context window ---
  const context = (slot: number): Step => {
    const mon = party()[slot]!;
    const entries: Entry[] = [{ label: t.t('partySummary'), run: () => openSummary(slot) }];
    if (!mon.isEgg) {
      for (const move of mon.moves) if (FIELD_MOVES.has(localName(move))) entries.push({ label: moveName(move), run: () => fieldMove(slot, move) });
    }
    entries.push({ label: t.t('partySwitch'), run: () => startSwitch(slot) });
    if (!mon.isEgg) entries.push({ label: t.t('partyItem'), run: () => itemMenu(slot) });
    return openMenu(t.t(mon.isEgg ? 'partyPromptEgg' : 'partyPromptMon', name(slot)), entries);
  };
  // --- order: ENTER / NO ENTRY, SUMMARY, CANCEL (decomp sub_0208022C, PartyMenu_CheckEligibility) ---
  const count = mode.kind === 'order' ? mode.count : 0;
  const hall = mode.kind === 'order' && mode.hall === true;
  /** Decomp PartyMenu_CheckEligibility, PartyMenu_CheckBattleHallEligibility (level 30 or more: HALL.minLevel). */
  const eligible = (slot: number) => !party()[slot]!.isEgg && !frontierBanned(ctx.registries, party()[slot]!.species) && (!hall || party()[slot]!.level >= HALL.minLevel);
  const orderMenu = (slot: number): Step => {
    const mon = party()[slot]!;
    const entries: Entry[] = [];
    if (picks.includes(slot)) entries.push({ label: t.t('partyNoEntry'), run: () => ((menu = null), picks.splice(picks.indexOf(slot), 1), undefined) });
    else if (eligible(slot)) entries.push({ label: t.t('partyEnter'), run: () => enter(slot) });
    entries.push({ label: t.t('partySummary'), run: () => openSummary(slot) });
    return openMenu(t.t(mon.isEgg ? 'partyPromptEgg' : 'partyPromptMon', name(slot)), entries);
  };
  /** Decomp PartyMenu_SelectChooseWithLimit: the next free place, the cursor to CONFIRM once all are entered. */
  const enter = (slot: number): Step => {
    menu = null;
    if (picks.length >= count) return say(`partyNoMoreThan${count}` as MenuKey, []);
    picks.push(slot);
    if (picks.length === count) cursor = confirmStop();
    return;
  };
  /**
   * Decomp HandleGameWindowEvent's CONFIRM: all places filled; the tower's no species or held item twice
   * (CheckDuplicateValues), the Hall's all of one species (CheckUniqueValues).
   */
  const confirmOrder = (): Step => {
    if (picks.length < count) return say(count === 1 ? 'partyChoose' : (`partyNeeded${count}` as MenuKey), []);
    const mons = picks.map((s) => party()[s]!);
    if (hall) {
      if (mons.some((m) => m.species !== mons[0]!.species)) return say('partySameKind', []);
      return close({ app: 'party-order', order: [...picks] });
    }
    for (let i = 0; i < mons.length; i++) {
      for (let j = i + 1; j < mons.length; j++) {
        if (mons[i]!.species === mons[j]!.species) return say('partyIdentical', []);
        if (mons[i]!.heldItem !== null && mons[i]!.heldItem === mons[j]!.heldItem) return say('partyIdenticalItems', []);
      }
    }
    return close({ app: 'party-order', order: [...picks] });
  };

  // --- daycare: STORE, SUMMARY, CANCEL ---
  const daycareMenu = (slot: number): Step => {
    const mon = party()[slot]!;
    const entries: Entry[] = mon.isEgg ? [] : [{ label: t.t('partyStore'), run: () => close({ app: 'daycare-select', slot }) }];
    entries.push({ label: t.t('partySummary'), run: () => openSummary(slot) });
    return openMenu(t.t(mon.isEgg ? 'partyPromptEgg' : 'partyPromptMon', name(slot)), entries);
  };
  // --- contest: ENTER, SUMMARY, CANCEL ---
  const contestMenu = (slot: number, rank: number, type: number): Step => {
    const mon = party()[slot]!;
    const entries: Entry[] = contestEligible(mon, rank, type) ? [{ label: t.t('partyEnter'), run: () => close({ app: 'contest-select', slot }) }] : [];
    entries.push({ label: t.t('partySummary'), run: () => openSummary(slot) });
    return openMenu(t.t(mon.isEgg ? 'partyPromptEgg' : 'partyPromptMon', name(slot)), entries);
  };
  const openSummary = (slot: number): Step => {
    menu = null;
    return { push: summaryScreen(ctx, { party, slot, mode: { kind: 'view' } }) };
  };
  const fieldMove = (slot: number, move: Id): Step => {
    menu = null;
    if (HP_TRANSFER.has(localName(move))) return startTransfer(slot);
    const error = ctx.host.fieldMoveCheck(slot, move);
    // Fly opens the Town Map (decomp FieldMoves_SetSelectFlyDestinationTask): a town flies, B comes back here.
    if (error === null && localName(move) === 'MOVE_FLY') {
      const pick = (location: number): Step => {
        ctx.host.useFieldMove(slot, move, location);
        return close({ app: 'start-menu' });
      };
      return { push: townMapScreen(ctx, pick, () => 'pop') };
    }
    if (error === null) {
      ctx.host.useFieldMove(slot, move);
      return close({ app: 'start-menu' });
    }
    const key: MenuKey = error === 'badge' ? 'partyNeedBadge' : error === 'partner' ? 'partyPartner' : error === 'state' ? 'partyAlreadySurfing' : 'partyCantUseHere';
    return say(key, []);
  };
  // --- Softboiled and Milk Drink (decomp PartyMenu_StartFieldMoveHPTransfer, PartyMenu_UseHPTransferFieldMove) ---
  const startTransfer = (slot: number): Step => {
    const mon = party()[slot]!;
    const amount = Math.floor(mon.stats.hp / 5);
    if (mon.hp <= amount) return say('partyNotEnoughHp', []);
    transfer = { from: slot, amount };
    return;
  };
  /**
   * CheckCanUseHPTransferFieldMove, then the transfer: an Egg only buzzes; the donor itself, a fainted Pokémon or one at
   * full HP is refused (the target pick goes on after A or B); otherwise the donor gives min(its fifth, the target's
   * missing HP) and the target gets it (`flow`, the healing sound at each phase's start), then "…'s HP was restored by
   * … point(s)." and the party's prompt again.
   */
  const transferTo = (slot: number): Step => {
    const from = transfer!.from;
    const target = party()[slot]!;
    if (target.isEgg) return void menuSe(ctx, SE_CUSTOM06);
    menuSe(ctx, 1500);
    if (slot === from || target.hp === 0 || target.hp === target.stats.hp) return say('partyCantUseOnThat', []);
    flow = { from, to: slot, amount: Math.min(transfer!.amount, target.stats.hp - target.hp), phase: 'donate', done: 0 };
    menuSe(ctx, SE_HEAL);
    transfer = null;
    return;
  };
  const stepTransfer = () => {
    const f = flow!;
    const n = Math.min(2, f.amount - f.done);
    f.done += n;
    party()[f.phase === 'donate' ? f.from : f.to]!.hp += f.phase === 'donate' ? -n : n;
    if (f.done < f.amount) return;
    if (f.phase === 'donate') {
      menuSe(ctx, SE_HEAL);
      Object.assign(f, { phase: 'receive', done: 0 });
      return;
    }
    flow = null;
    cursor = f.from;
    say('partyHpRestored', [name(f.to), String(f.amount)]);
  };
  const startSwitch = (slot: number): Step => {
    menu = null;
    moving = slot;
    return;
  };
  const finishSwitch = (slot: number): Step => {
    const from = moving!;
    moving = null;
    if (slot === from || slot >= party().length) return;
    const p = party();
    [p[from], p[slot]] = [p[slot]!, p[from]!];
    menuSe(ctx, 1696);
    swapCue = 0;
    return;
  };
  const itemMenu = (slot: number): Step =>
    openMenu(t.t('partyDoWhatItem'), [
      { label: t.t('partyItemGive'), run: () => ((menu = null), { push: giveFromBag(slot) }) },
      { label: t.t('partyItemTake'), run: () => takeItem(slot) },
    ]);
  const giveFromBag = (slot: number): Screen =>
    bagScreen(ctx, {
      kind: 'give',
      pick: (item) => {
        give(slot, item);
        return 'pop';
      },
    });
  /**
   * A form change in the party menu (decomp PartyMenuFormChange_ChangeForm: the Griseous Orb after the give or take message, the Gracidea):
   * its cry, "… changed form!", and the Pokédex records the form (Pokedex_Capture). The particle burst is not drawn.
   */
  const formChange = (slot: number, then: () => Step): Step => {
    const mon = party()[slot]!;
    markCaught(ctx.state, ctx.registries, mon);
    ctx.host.sound?.playCry(mon.species, mon.form);
    return say('partyChangedForm', [name(slot)], then);
  };
  const give = (slot: number, item: Id, after: () => Step = () => undefined): Step => {
    const mon = party()[slot]!;
    if (mon.heldItem) {
      const old = mon.heldItem;
      return dialog.confirm(t.pages('partyAlreadyHolding', name(slot), itemName(old)), (yes) => {
        if (!yes) return;
        const r = giveHeldItem(ctx.state, ctx.registries, slot, item);
        if (r === 'bag-full') return say('partyBagFull', [], after);
        return say('partyItemSwapped', [name(slot), itemName(old), itemName(item)], r.formChanged ? () => formChange(slot, after) : after);
      });
    }
    const r = giveHeldItem(ctx.state, ctx.registries, slot, item);
    if (r === 'bag-full') throw new Error('party: a give into an empty hand cannot fill the bag');
    return say('partyGiven', [name(slot), itemName(item)], r.formChanged ? () => formChange(slot, after) : after);
  };
  const takeItem = (slot: number): Step => {
    menu = null;
    const r = takeHeldItem(ctx.state, ctx.registries, party()[slot]!);
    if (r === null) return say('partyNotHolding', [name(slot)]);
    if (r === 'bag-full') return say('partyBagFull', []);
    return say('partyReceived', [name(slot), itemName(r.item)], r.formChanged ? () => formChange(slot, () => undefined) : undefined);
  };

  // --- use: a bag item on a member ---
  const itemMessage = (slot: number, m: ItemUsedMessage): string[] => {
    const slots = [name(slot)];
    if (m.key === 'hpRestored') slots.push(String(m.amount));
    if (m.key === 'statRose') slots.push(t.statName(STAT_INDEX[m.stat]));
    if (m.key === 'ppIncreased') return t.pages(ITEM_MESSAGES[m.key], moveName(m.move));
    return t.pages(ITEM_MESSAGES[m.key], ...slots);
  };
  /**
   * Decomp ApplyItemEffectOnPokemon: the effect's message or "It won't have any effect.", then A or B goes back to the
   * bag, silently; after a move list (`picked`), the press confirms (PARTY_MENU_STATE_WAIT_AB_PRESS_BEFORE_FADE).
   */
  const useOn = (slot: number, item: Id, moveSlot: number, picked = false): Step => {
    menu = null;
    const r = useItemOnMon(ctx.state, ctx.registries, slot, item, moveSlot);
    const tell = (pages: string[]) => (picked ? dialog.say(pages, done) : sayUsed(pages, done));
    if (!r.ok) return tell(t.pages('partyNoEffect'));
    menuSe(ctx, 1516);
    return tell(itemMessage(slot, r.message));
  };
  const moveMenu = (slot: number, kind: 'restore' | 'boost', pick: (move: number) => Step): Step => {
    const mon = party()[slot]!;
    const dex = dexOf(ctx.registries);
    return openMenu(
      t.t(kind === 'restore' ? 'partyRestoreWhichMove' : 'partyBoostWhichMove'),
      mon.moves.map((m, i) => ({ label: moveName(m), right: `${mon.pp[i]}/${maxPp(dex.move(m).pp, mon.ppUps[i]!)}`, run: () => pick(i) })),
    );
  };

  // --- use: the Rare Candy (decomp PartyMenuCB_LevelUp) and evolution items (PARTY_MENU_EXIT_CODE_EVOLVE_BY_*) ---
  const evolveThen = (slot: number, target: Id, method: string, source: 'level' | 'item'): Step => {
    closeOnResume = true;
    return { push: evolutionScreen(ctx, { slot, target, method, source }, () => 'pop') };
  };
  /**
   * The Gracidea (decomp ApplyItemEffectOnPokemon): a Shaymin that can take the Sky Forme (forms.ts `canShayminSky`, the
   * clock read now) changes, as the Griseous Orb's change shows; anything else: no effect. The flower is kept.
   */
  const useGracidea = (slot: number): Step => {
    const mon = party()[slot]!;
    if (!canShayminSky(ctx.registries, mon, ctx.state.gameTime.now)) return sayUsed(t.pages('partyNoEffect'), done);
    menu = null;
    setShayminForm(ctx.registries, mon, SHAYMIN_SKY);
    return formChange(slot, done);
  };
  const useEvolveItem = (slot: number, item: Id): Step => {
    const found = evolutionTarget(dexOf(ctx.registries), party()[slot]!, { kind: 'item', item });
    if (!found || !canUseItemOn(ctx.registries, party()[slot]!, item)) return sayUsed(t.pages('partyNoEffect'), done);
    // Decomp: the item is taken, the party menu fades out and the evolution starts (no B), then the bag.
    takeBagItem(ctx.state, item, 1);
    return evolveThen(slot, found.target, 'USE_ITEM', 'item');
  };
  const useLevelItem = (slot: number, item: Id): Step => {
    const mon = party()[slot]!;
    if (!canUseItemOn(ctx.registries, mon, item)) return sayUsed(t.pages('partyNoEffect'), done);
    const before = { ...mon.stats };
    useItemOnMon(ctx.state, ctx.registries, slot, item, 0);
    const rows = (right: (s: keyof Stats) => string) => LEVEL_UP_STATS.map(([s, label]) => ({ label: t.t(label), right: right(s) }));
    const values = () => {
      stats = { rows: rows((s) => t.t('partyStatValue', String(mon.stats[s]))), then: () => learnLevelMoves(slot, movesAtLevel(dexOf(ctx.registries), mon)) };
      return undefined;
    };
    return say('partyLevelUp', [name(slot), String(mon.level)], () => {
      stats = { rows: rows((s) => t.t('partyStatIncrease', String(mon.stats[s] - before[s]))), then: values };
      return;
    });
  };
  /** Decomp LEVELUP_STATE_CHECK_LEARNSET: each move of the new level, then the evolution check. */
  const learnLevelMoves = (slot: number, moves: Id[]): Step => {
    const mon = party()[slot]!;
    const next = moves.shift();
    if (next === undefined) return checkEvolution(slot);
    if (mon.moves.includes(next)) return learnLevelMoves(slot, moves);
    if (mon.moves.length < 4) {
      setMoveSlot(dexOf(ctx.registries), mon, mon.moves.length, next);
      return say('partyLearnedMove2', [name(slot), moveName(next)], () => learnLevelMoves(slot, moves));
    }
    return askLearn(slot, next, () => learnLevelMoves(slot, moves));
  };
  const askLearn = (slot: number, move: Id, then: () => Step): Step =>
    dialog.confirm(t.pages('partyWantsToLearn', name(slot), moveName(move)), (yes) => {
      if (!yes) return askStopLearning(slot, move, then);
      return say('partyWhichForget', [], () => ({
        push: summaryScreen(ctx, {
          party,
          slot,
          mode: {
            kind: 'teach',
            move,
            done: (forget) => {
              if (forget === null) {
                askStopLearning(slot, move, then);
                return 'pop';
              }
              const old = moveName(party()[slot]!.moves[forget]!);
              setMoveSlot(dexOf(ctx.registries), party()[slot]!, forget, move);
              dialog.say([...t.pages('partyForgot', name(slot), old), ...t.pages('partyLearned', name(slot), moveName(move))], then);
              return 'pop';
            },
          },
        }),
      }));
    });
  const askStopLearning = (slot: number, move: Id, then: () => Step): Step =>
    dialog.confirm(t.pages('partyStopTeaching', name(slot), moveName(move)), (yes) => (yes ? say('partyDidNotLearn', [name(slot), moveName(move)], then) : askLearn(slot, move, then)));
  /** Decomp LEVELUP_STATE_CHECK_EVOLUTION (the zone's method, B can stop it). */
  const checkEvolution = (slot: number): Step => {
    const trigger = levelEvolutionTrigger(ctx.registries, ctx.state, ctx.host.clock(), ctx.host.options().tradeEvolution === 0);
    const found = evolutionTarget(dexOf(ctx.registries), party()[slot]!, trigger);
    return found ? evolveThen(slot, found.target, found.method, 'level') : done();
  };

  // --- teach: a TM/HM ---
  const teach = (slot: number, item: Id): Step => {
    const mon = party()[slot]!;
    const move = itemRecord(ctx.registries, item).tm!;
    const compat = tmCompatibility(ctx.registries, mon, item);
    if (compat === 'unable') return say('partyNotCompatible', [name(slot), moveName(move)]);
    if (compat === 'learned') return say('partyAlreadyKnows', [name(slot), moveName(move)]);
    if (mon.moves.length < 4) {
      teachTm(ctx.state, ctx.registries, slot, item, null);
      return say('partyLearned', [name(slot), moveName(move)], done);
    }
    return askReplace(slot, item, move);
  };
  const askReplace = (slot: number, item: Id, move: Id): Step =>
    dialog.confirm(t.pages('partyWantsToLearn', name(slot), moveName(move)), (yes) => {
      if (!yes) return askStop(slot, item, move);
      return say('partyWhichForget', [], () => ({
        push: summaryScreen(ctx, {
          party,
          slot,
          mode: {
            kind: 'teach',
            move,
            done: (forget) => {
              if (forget === null) {
                askStop(slot, item, move);
                return 'pop';
              }
              const old = moveName(party()[slot]!.moves[forget]!);
              teachTm(ctx.state, ctx.registries, slot, item, forget);
              dialog.say([...t.pages('partyForgot', name(slot), old), ...t.pages('partyLearned', name(slot), moveName(move))], done);
              return 'pop';
            },
          },
        }),
      }));
    });
  const askStop = (slot: number, item: Id, move: Id): Step =>
    dialog.confirm(t.pages('partyStopTeaching', name(slot), moveName(move)), (yes) => (yes ? say('partyDidNotLearn', [name(slot), moveName(move)], done) : askReplace(slot, item, move)));

  const select = (slot: number): Step => {
    cursor = slot;
    if (transfer && slot !== cancelStop()) return transferTo(slot);
    // Decomp HandleSpecialInput: using an item, an Egg cannot be picked (SEQ_SE_DP_CUSTOM06, the party stays).
    if (mode.kind === 'use' && slot !== cancelStop() && party()[slot]!.isEgg) return void menuSe(ctx, SE_CUSTOM06);
    menuSe(ctx, 1500);
    if (transfer) {
      transfer = null;
      return;
    }
    if (slot === cancelStop()) {
      moving = null;
      return cancel();
    }
    if (ordering && slot === confirmStop()) return confirmOrder();
    if (moving !== null) return finishSwitch(slot);
    switch (mode.kind) {
      case 'field':
        return context(slot);
      case 'give':
        if (party()[slot]!.isEgg) return say('partyEggNoItem', []);
        return give(slot, mode.item, done);
      case 'use': {
        if (itemCount(ctx.state, mode.item) < 1) return done();
        if (mode.item === bySource(ctx.registries, 'items', ITEM_GRACIDEA)) return useGracidea(slot);
        const flags = itemRecord(ctx.registries, mode.item).partyUse?.flags ?? [];
        if (flags.includes('evolve')) return useEvolveItem(slot, mode.item);
        if (flags.includes('levelUp')) return useLevelItem(slot, mode.item);
        const pick = itemPicksMove(ctx.registries, mode.item);
        if (pick) return moveMenu(slot, pick, (move) => useOn(slot, mode.item, move, true));
        return useOn(slot, mode.item, 0);
      }
      case 'teach':
        return teach(slot, mode.item);
      case 'daycare':
        return daycareMenu(slot);
      case 'select':
        return close({ app: 'party', slot });
      case 'feed':
        // Decomp: an Egg plays SEQ_SE_DP_CUSTOM06 and stays.
        if (party()[slot]!.isEgg) return void menuSe(ctx, SE_CUSTOM06);
        return mode.pick(slot);
      case 'order':
        return orderMenu(slot);
      case 'contest':
        return contestMenu(slot, mode.rank, mode.type);
    }
  };

  const prompt = (): string => {
    if (moving !== null) return t.t('partyMoveToWhere');
    if (ordering) return t.t(picks.length ? 'partyChooseAndConfirm' : 'partyChoose');
    if (transfer) return t.t('partyTransferWhich');
    switch (mode.kind) {
      case 'give':
        return t.t('partyGiveToWhich');
      case 'use':
        return t.t('partyUseOnWhich');
      case 'teach':
        return t.t('partyTeachWhich');
      default:
        return t.t('partyChoose');
    }
  };
  const evolveItem = mode.kind === 'use' && (itemRecord(ctx.registries, mode.item).partyUse?.flags.includes('evolve') ?? false);
  const notes = (): (string | null)[] =>
    Array.from({ length: 6 }, (_, i) => {
      const m = party()[i];
      if (!m) return null;
      // Decomp PartyMenu_PrintSelectionEligibility: FIRST… by the place entered, BANNED, NOT ENTERED.
      if (ordering) return picks.includes(i) ? t.t(`partyEntered${picks.indexOf(i) + 1}` as MenuKey) : t.t(eligible(i) ? 'partyNotEntered' : 'partyBanned');
      // Decomp PartyMenu_PrintMemberComment_CanUseEvoItem: ABLE! / UNABLE! (an egg is unable).
      if (mode.kind === 'use' && evolveItem) return t.t(!m.isEgg && evolutionTarget(dexOf(ctx.registries), m, { kind: 'item', item: mode.item }) ? 'partyAbleEvolve' : 'partyUnableEvolve');
      if (mode.kind === 'contest') return t.t(contestEligible(m, mode.rank, mode.type) ? 'partyContestAble' : 'partyContestUnable');
      if (mode.kind !== 'teach') return null;
      const c = tmCompatibility(ctx.registries, m, mode.item);
      return t.t(c === 'able' ? 'partyAble' : c === 'unable' ? 'partyUnable' : 'partyLearnedNote');
    });

  return {
    tick() {
      if (flow) stepTransfer();
      if (swapCue === null) return;
      if (++swapCue === 17) {
        menuSe(ctx, 1696);
        swapCue = null;
      }
    },
    view(): PartyView {
      // The level-up stats window draws as a list window without a cursor.
      const menuView: AppMenu | null = stats
        ? { entries: stats.rows, cursor: -1 }
        : menu
          ? { entries: menu.entries.map((e) => ({ label: e.label, ...(e.right !== undefined ? { right: e.right } : {}) })), cursor: menu.cursor }
          : null;
      return {
        app: 'party',
        mode: mode.kind,
        title: t.t('startPokemon'),
        slots: Array.from({ length: 6 }, (_, i) => (party()[i] ? slotView(ctx, party()[i]!) : null)),
        prompt: menu ? menu.title : prompt(),
        cancel: t.t('partyCancel'),
        cursor: cursor === cancelStop() ? (ordering ? 7 : 6) : ordering && cursor === confirmStop() ? 6 : cursor,
        ...(ordering ? { confirm: t.t('partyConfirm') } : {}),
        // The DS marks the donor with the switch cursor while the target is picked.
        moving: transfer ? transfer.from : moving,
        notes: notes(),
        menu: menuView,
        message: dialog.message(),
        yesNo: dialog.yesNo(),
      };
    },
    resume(): Step {
      if (!closeOnResume) return;
      closeOnResume = false;
      return done();
    },
    input(i: Input): Step {
      if (flow) return;
      if (dialog.active) return dialog.input(i);
      if (stats) {
        const go = 'tap' in i ? i.tap === 'next' || i.tap === 'back' || i.tap.startsWith('menu:') : i.button === 'a' || i.button === 'b';
        if (!go) return;
        const then = stats.then;
        stats = null;
        return then();
      }
      if (menu) {
        const m = menu;
        if ('tap' in i) {
          if (i.tap === 'back') { menuSe(ctx, 1500); menu = null; return; }
          const n = tapIndex(i.tap, 'menu');
          if (n === null || n < 0 || n >= m.entries.length) return;
          m.cursor = n;
          menuSe(ctx, 1500);
          return m.entries[n]!.run();
        }
        if (i.button === 'up' || i.button === 'down') {
          const next = moveCursor(m.cursor, m.entries.length, 1, i.button);
          if (next !== m.cursor) menuSe(ctx, 1500);
          m.cursor = next;
        }
        else if (i.button === 'a') { menuSe(ctx, 1500); return m.entries[m.cursor]!.run(); }
        else if (i.button === 'b') { menuSe(ctx, 1500); menu = null; }
        return;
      }
      if ('tap' in i) {
        if (i.tap === 'cancel') return select(cancelStop());
        if (ordering && i.tap === 'confirm') return select(confirmStop());
        if (i.tap === 'back') {
          if (transfer) {
            menuSe(ctx, 1500);
            return void (transfer = null);
          }
          if (moving !== null) return void (moving = null);
          return cancel();
        }
        const n = tapIndex(i.tap, 'slot');
        return n !== null && n >= 0 && n < party().length ? select(n) : undefined;
      }
      const b = i.button;
      if (b === 'up' || b === 'down' || b === 'left' || b === 'right') {
        const next = moveCursor(cursor, stops(), 2, b);
        if (next !== cursor) menuSe(ctx, 1500);
        cursor = next;
      }
      else if (b === 'a') return select(cursor);
      else if (b === 'b') {
        menuSe(ctx, 1500);
        if (transfer) return void (transfer = null);
        if (moving !== null) return void (moving = null);
        return cancel();
      }
      return;
    },
  };
}
