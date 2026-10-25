/**
 * The Battle Castle's two apps (contracts `CastleView`; decomp battle_castle/self_app.c, opponent_app.c, windows.c):
 * - the player's (self): a Pokémon, then HEAL (restore HP, PP or both for CP, or raise the healing rank), RENTAL
 *   (rent a Berry or an item for CP, or raise the rental rank), SUMMARY and MOVES;
 * - the opponent's: a Poké Ball, then CHECK (identify it for CP), LEVEL (5 up or down for CP; the other way back to 50)
 *   and SUMMARY (its stats or moves for CP, or raise the information rank).
 * Single player: the decomp's link sync states are not here. CP and ranks are spent in the save at once (services
 * `spendCastlePoints`, `raiseCastleRank`); the parties and unlocks come back in the result. The messages are the ROM's
 * (TEXT_BANK_BATTLE_CASTLE_SELF_APP, _OPPONENT_APP); they print at once, as the apps' do.
 */
import type { Button, Id, Pokemon } from '@opensinnoh/core';
import { isShiny, monGender, natureIndex } from '@opensinnoh/core';
import { dexOf, type CastleRequest, type CastleUnlocks, type CastleView, type Ui2dSheet } from '@opensinnoh/contracts';
import { adjustOpponentLevel, CASTLE_COST, CASTLE_RANK, castleHeal, castlePoints, castleRank, castleRentals, frontierTables, maxPps, missingPp, raiseCastleRank, spendCastlePoints } from '@opensinnoh/services';
import { menuSe, type MenuContext } from './context.ts';
import { monName } from './party.ts';
import { tapIndex, type Screen, type Step } from './stack.ts';

const SELF = 'BattleCastleSelfApp_Text_';
const OPP = 'BattleCastleOpponentApp_Text_';
/** The messages the apps print (checked in the base pack at start). */
export const CASTLE_APP_TEXTS = [
  ...['PlayerName', 'CastlePoints', 'CastlePointsItemSelect', 'ChoosePokemon', 'Exit', 'Heal', 'Rental', 'Summary', 'Moves', 'Cancel', 'RestoreHPOrPP', 'RentBerryOrItem', 'CheckStatsAndMore', 'CheckMovesAndPP', 'GoBackToMonSelection', 'RestoreHP', 'RestorePP', 'RestoreAll', 'RankUp', 'Cancel2', 'WhichToUse', 'RankUpToRestorePP', 'RankUpToRestoreHPAndPP', 'RankCannotBeRaised', 'ReturnToPrevious', 'Yes', 'No', 'NotEnoughCP', 'HealRankTooLow', 'HPWillBeRestored', 'PPWillBeRestored', 'HPAndPPWillBeRestored', 'NoBenefit', 'RankUpForCP', 'NotEnoughCP2', 'GainedAbilityToRestorePP', 'GainedAbilityToRestoreHPAndPP', 'Berries', 'Items', 'RankUp2', 'Cancel3', 'MayRentBerry', 'MayRentItem', 'RankUpToRentItem', 'RankUpToExpandChoices', 'RankCannotBeRaised2', 'ReturnToPrevious2', 'RentalRankTooLow', 'WillCostCP', 'ItemGivenToMon', 'AlreadyHoldingItem', 'WantToSwitchItems', 'GainedAbilityToRentItems', 'ExpandedItemRentals'].map((n) => SELF + n),
  ...['CheckWhichPokemon', 'Exit', 'Check', 'Level', 'Summary', 'Cancel', 'CheckIdentity', 'ChangeLevel', 'ExamineStats', 'GoBackToMonSelection', 'IdentifyForCP', 'IdentityRevealed', 'MayChangeLevel', 'LevelUp5', 'LevelDown5', 'Cancel2', 'WillCostCP', 'Yes', 'No', 'NotEnoughCP3', 'LevelCantGoHigher', 'LevelCantGoLower', 'LevelBoostedBy5', 'LevelLoweredBy5', 'Summary2', 'Moves', 'RankUp', 'Cancel3', 'CheckStats', 'CheckMoveList', 'RankUpToCheckMoves', 'CantRankUp', 'ReturnToPreviousMenu', 'TooLowForMoveList', 'CanCheckStats', 'NotEnoughCP', 'MayCheckMoveList', 'NotEnoughCP2', 'RankUpForCP', 'GainedMoveListPurchasePower'].map((n) => OPP + n),
  ...['Item', 'ItemValue', 'Nature', 'NatureValue', 'Ability', 'AbilityValue', 'Attack', 'AttackValue', 'Defense', 'DefenseValue', 'SpAttack', 'SpAttackValue', 'SpDefense', 'SpDefenseValue', 'Speed', 'SpeedValue', 'MoveName1', 'MoveName2', 'MoveName3', 'MoveName4', 'MovePP'].flatMap((n) => [SELF + n, OPP + n]),
];

/** Decomp SE_CONFIRM, SEQ_SE_DP_BOX03 (a refused rank-up), SEQ_SE_DP_KAIFUKU, SEQ_SE_DP_UG_020, SEQ_SE_DP_OPEN7 / CLOSE7. */
const SE = { confirm: 1500, refuse: 1523, heal: 1516, give: 1572, levelUp: 1587, levelDown: 1588 } as const;
/** Decomp sprites.h ANIM_ID_HEAL_SPARKLES, ANIM_ID_RENTAL_SPARKLES (their end waits before the HP is reprinted). */
const SPARKLE_ANIM = { heal: 8, rental: 16 } as const;
/** Decomp UpdateAfterPurchase: the sparkles at 64 + 64 × slot, 62. */
const SPARKLE_AT = { x: 64, step: 64, y: 62 } as const;
/** Decomp sDefaultListTemplate.maxDisplay for the item list (DrawItemSelectMenuAndMonInfo: 6). */
const LIST_ROWS = 6;
/** Decomp PrintPokemonSummary / PrintMoveInfo positions (self app; the opponent's are 8 px further right). */
const SUMMARY_ROWS: { label: string; value: string; stat: keyof Pokemon['stats'] | null; x: number; vx: number; y: number }[] = [
  { label: 'Attack', value: 'AttackValue', stat: 'attack', x: 0, vx: 80, y: 56 },
  { label: 'Defense', value: 'DefenseValue', stat: 'defense', x: 96, vx: 176, y: 56 },
  { label: 'SpAttack', value: 'SpAttackValue', stat: 'spAttack', x: 0, vx: 80, y: 72 },
  { label: 'SpDefense', value: 'SpDefenseValue', stat: 'spDefense', x: 96, vx: 176, y: 72 },
  { label: 'Speed', value: 'SpeedValue', stat: 'speed', x: 0, vx: 80, y: 88 },
];

type Menu = { window: NonNullable<CastleView['menu']>['window']; entries: { label: string; enabled: boolean; run: () => Step }[]; cursor: number; cancel: () => Step; wrap?: true; describe?: (i: number) => void };
type Mode =
  | { k: 'select' }
  | { k: 'menu'; menu: Menu }
  | { k: 'yesno'; cursor: number; yes: () => Step; no: () => Step }
  | { k: 'wait'; then: () => Step }
  | { k: 'sparkle'; anim: number; slot: number; tick: number; ticks: number; then: () => Step }
  | { k: 'items'; kind: 'items' | 'berries'; cursor: number; top: number }
  | { k: 'panel'; which: 'summary' | 'moves' };

/** The Battle Castle's self and opponent apps (decomp BattleCastleSelfApp, BattleCastleOpponentApp), single player. */
export function castleScreen(ctx: MenuContext, request: CastleRequest): Screen {
  const t = ctx.text;
  const dex = dexOf(ctx.registries);
  const se = (n: number) => menuSe(ctx, n);
  const tables = frontierTables(ctx.registries).castle;
  const self = request.mode === 'self';
  const P = self ? SELF : OPP;
  const type = request.challengeType;
  const party = request.party.map((m) => structuredClone(m));
  const opponents = request.opponents.map((m) => structuredClone(m));
  const unlocked: CastleUnlocks = structuredClone(request.unlocked);
  const mons = self ? party : opponents;
  const exit = mons.length;
  const player = ctx.state.names.player;
  let cursor = 0;
  let previous = exit - 1;
  let mode: Mode = { k: 'select' };
  let message: string | null = null;
  let hint: string | null = t.message(self ? `${SELF}ChoosePokemon` : `${OPP}CheckWhichPokemon`);
  /** The rental list a question or message came from: it stays drawn under them (decomp: the list menu is not freed). */
  let under: Extract<Mode, { k: 'items' }> | null = null;
  /** Decomp monMenuListPos / monMenuCursorPos: the options menu opens where it was left. */
  let optionsCursor = 0;

  const cp = () => castlePoints(ctx.state, type);
  const rank = (r: number) => castleRank(ctx.state, type, r);
  const msg = (name: string, ...slots: string[]) => t.message(P + name, ...slots);
  const name = (m: Pokemon) => monName(ctx, m);
  const say = (text: string, then: () => Step): Step => {
    message = text;
    mode = { k: 'wait', then };
    return;
  };
  const ask = (text: string, yes: () => Step, no: () => Step): Step => {
    message = text;
    mode = { k: 'yesno', cursor: 0, yes, no };
    return;
  };
  const toSelect = (): Step => {
    message = null;
    hint = t.message(self ? `${SELF}ChoosePokemon` : `${OPP}CheckWhichPokemon`);
    mode = { k: 'select' };
    return;
  };
  const close = (): Step => ({ close: { app: 'castle', party, opponents, unlocked, slot: cursor } });
  /** Waits for a sprite animation's end (decomp BattleCastleAppSprite_IsAnimated), then goes on. */
  const sparkle = (anim: number, then: () => Step): Step => {
    const art = tables.art;
    const sheet: Ui2dSheet | undefined = art ? ctx.registries.ui2d.get(art.sprites) : undefined;
    const ticks = sheet?.animations?.[anim]?.frames.reduce((n, f) => n + f.ticks, 0) ?? 0;
    mode = { k: 'sparkle', anim, slot: cursor, tick: 0, ticks, then };
    return;
  };

  // ---------------------------------------------------------------- the player's app

  const options = (): Menu => {
    const entries = self
      ? [
          { label: msg('Heal'), enabled: true, run: () => openMenu(healMenu()) },
          { label: msg('Rental'), enabled: true, run: () => openMenu(rentalMenu()) },
          { label: msg('Summary'), enabled: true, run: () => panel('summary') },
          { label: msg('Moves'), enabled: true, run: () => panel('moves') },
          { label: msg('Cancel'), enabled: true, run: toSelect },
        ]
      : [
          { label: msg('Check'), enabled: true, run: check },
          { label: msg('Level'), enabled: true, run: level },
          { label: msg('Summary'), enabled: true, run: () => openMenu(summaryMenu()) },
          { label: msg('Cancel'), enabled: true, run: toSelect },
        ];
    const hints = self ? ['RestoreHPOrPP', 'RentBerryOrItem', 'CheckStatsAndMore', 'CheckMovesAndPP', 'GoBackToMonSelection'] : ['CheckIdentity', 'ChangeLevel', 'ExamineStats', 'GoBackToMonSelection'];
    return {
      window: 'options',
      entries,
      cursor: Math.min(optionsCursor, entries.length - 1),
      cancel: toSelect,
      describe: (i) => {
        optionsCursor = i;
        hint = msg(hints[i]!);
        message = null;
      },
    };
  };
  const openMenu = (menu: Menu): Step => {
    mode = { k: 'menu', menu };
    menu.describe?.(menu.cursor);
    return;
  };

  /** Decomp sHealMenuEntries: RESTORE HP (rank 1), PP (2), ALL (3), RANK UP, CANCEL; up and down wrap. */
  const healMenu = (): Menu => {
    const r = rank(CASTLE_RANK.healing);
    const restore = (what: 'hp' | 'pp' | 'all', need: number, i: number) => ({ label: msg(['RestoreHP', 'RestorePP', 'RestoreAll'][i]!), enabled: r >= need, run: () => heal(what, need, i) });
    return {
      window: 'heal',
      entries: [restore('hp', 1, 0), restore('pp', 2, 1), restore('all', 3, 2), { label: msg('RankUp'), enabled: r !== 3, run: () => rankUp(CASTLE_RANK.healing, () => openMenu(healMenu())) }, { label: msg('Cancel2'), enabled: true, run: () => openMenu(options()) }],
      cursor: 0,
      wrap: true,
      cancel: () => openMenu(options()),
      describe: (i) => (message = msg(i === 3 ? (r === 3 ? 'RankCannotBeRaised' : r === 1 ? 'RankUpToRestorePP' : 'RankUpToRestoreHPAndPP') : i === 4 ? 'ReturnToPrevious' : 'WhichToUse')),
    };
  };
  /** Decomp MAIN_SUBSTATE_HEAL_MENU / _HEAL_YES_NO. */
  const heal = (what: 'hp' | 'pp' | 'all', need: number, i: number): Step => {
    const back = () => openMenu(healMenu());
    if (rank(CASTLE_RANK.healing) < need) return say(msg('HealRankTooLow'), back);
    const cost = tables.healCosts[i]!;
    return ask(
      msg('WillCostCP', String(cost)),
      () => {
        const m = party[cursor]!;
        if (cp() < cost) return say(msg('NotEnoughCP'), back);
        const fullHp = m.hp === m.stats.hp;
        const noBenefit = what === 'hp' ? fullHp : what === 'pp' ? !missingPp(dex, m) : fullHp && !missingPp(dex, m);
        if (noBenefit) return say(msg('NoBenefit'), back);
        spendCastlePoints(ctx.state, type, cost);
        castleHeal(dex, m, what);
        message = msg(['HPWillBeRestored', 'PPWillBeRestored', 'HPAndPPWillBeRestored'][i]!, name(m));
        se(SE.heal);
        return sparkle(SPARKLE_ANIM.heal, () => say(message!, toSelect));
      },
      back,
    );
  };
  /** Decomp IncreaseRank: CP spent, the rank one up, its message. */
  const rankUp = (r: number, back: () => Step): Step => {
    const now = rank(r);
    if (now === 3 || (r === CASTLE_RANK.summary && now === 2)) {
      se(SE.refuse);
      return;
    }
    const cost = r === CASTLE_RANK.summary ? CASTLE_COST.summaryRankUp : tables.rankUpCosts[r]![now]!;
    return ask(
      msg('RankUpForCP', String(cost)),
      () => {
        if (cp() < cost) return say(msg('NotEnoughCP2'), back);
        raiseCastleRank(ctx.state, type, r, cost);
        const text = r === CASTLE_RANK.healing ? ['', 'GainedAbilityToRestorePP', 'GainedAbilityToRestoreHPAndPP'][now]! : r === CASTLE_RANK.rentals ? ['', 'GainedAbilityToRentItems', 'ExpandedItemRentals'][now]! : 'GainedMoveListPurchasePower';
        return say(msg(text, '', '', '', '', '', player), back);
      },
      back,
    );
  };

  /** Decomp sRentalMenuEntries: BERRIES, ITEMS (rank 2), RANK UP, CANCEL. */
  const rentalMenu = (): Menu => {
    const r = rank(CASTLE_RANK.rentals);
    const back = () => openMenu(rentalMenu());
    return {
      window: 'rental',
      entries: [
        { label: msg('Berries'), enabled: true, run: () => openList('berries') },
        { label: msg('Items'), enabled: r >= 2, run: () => (r === 1 ? say(msg('RentalRankTooLow'), back) : openList('items')) },
        { label: msg('RankUp2'), enabled: r !== 3, run: () => rankUp(CASTLE_RANK.rentals, back) },
        { label: msg('Cancel3'), enabled: true, run: () => openMenu(options()) },
      ],
      cursor: 0,
      cancel: () => openMenu(options()),
      describe: (i) => (message = msg(['MayRentBerry', 'MayRentItem', r === 3 ? 'RankCannotBeRaised2' : r === 1 ? 'RankUpToRentItem' : 'RankUpToExpandChoices', 'ReturnToPrevious2'][i]!)),
    };
  };
  const rentals = (kind: 'items' | 'berries') => castleRentals(tables, kind, rank(CASTLE_RANK.rentals));
  const openList = (kind: 'items' | 'berries'): Step => {
    message = null;
    mode = { k: 'items', kind, cursor: 0, top: 0 };
    return;
  };
  /** Decomp MAIN_SUBSTATE_SELECT_ITEM_OR_BERRY_YES_NO and the switch prompt. */
  const rent = (kind: 'items' | 'berries', i: number): Step => {
    const r = rentals(kind)[i]!;
    const list = mode as Extract<Mode, { k: 'items' }>;
    under = list;
    const back = (): Step => {
      message = null;
      under = null;
      mode = list;
      return;
    };
    const give = (): Step => {
      under = null;
      const m = party[cursor]!;
      spendCastlePoints(ctx.state, type, r.cp);
      m.heldItem = r.item;
      se(SE.give);
      message = msg('ItemGivenToMon', name(m), itemName(r.item));
      return sparkle(SPARKLE_ANIM.rental, () => say(message!, toSelect));
    };
    return ask(
      msg('WillCostCP', String(r.cp)),
      () => {
        if (cp() < r.cp) return say(msg('NotEnoughCP'), back);
        const m = party[cursor]!;
        if (m.heldItem === null) return give();
        return say(msg('AlreadyHoldingItem', name(m), itemName(m.heldItem)), () => ask(msg('WantToSwitchItems'), give, back));
      },
      back,
    );
  };
  const itemName = (id: Id) => ctx.registries.items.get(id)?.name ?? id;

  // ---------------------------------------------------------------- the opponent's app

  /** Decomp MENU_ENTRY_CHECK: identify the Pokémon (1 CP), or its name again. */
  const check = (): Step => {
    const m = opponents[cursor]!;
    if (unlocked.identity[cursor]) return say(msg('IdentityRevealed', name(m)), toSelect);
    return ask(
      msg('IdentifyForCP', String(CASTLE_COST.identity)),
      () => {
        if (cp() < CASTLE_COST.identity) return say(msg('NotEnoughCP3'), toSelect);
        spendCastlePoints(ctx.state, type, CASTLE_COST.identity);
        unlocked.identity[cursor] = true;
        se(SE.give);
        return say(msg('IdentityRevealed', name(m)), toSelect);
      },
      () => openMenu(options()),
    );
  };
  /** Decomp MENU_ENTRY_LEVEL: LEVEL +5 (1 CP), LEVEL -5 (15 CP), CANCEL. */
  const level = (): Step => {
    const m = opponents[cursor]!;
    message = msg('MayChangeLevel', name(m));
    const adjust = (to: 'up' | 'down') => (): Step => {
      if (unlocked.level[cursor] === to) return say(msg(to === 'up' ? 'LevelCantGoHigher' : 'LevelCantGoLower'), toSelect);
      const cost = to === 'up' ? CASTLE_COST.levelUp : CASTLE_COST.levelDown;
      return ask(
        msg('WillCostCP', String(cost)),
        () => {
          if (cp() < cost) return say(msg('NotEnoughCP3'), toSelect);
          spendCastlePoints(ctx.state, type, cost);
          unlocked.level[cursor] = adjustOpponentLevel(dex, m, unlocked.level[cursor]!, to);
          se(to === 'up' ? SE.levelUp : SE.levelDown);
          return say(msg(to === 'up' ? 'LevelBoostedBy5' : 'LevelLoweredBy5'), toSelect);
        },
        () => openMenu(options()),
      );
    };
    mode = { k: 'menu', menu: { window: 'level', entries: [{ label: msg('LevelUp5'), enabled: true, run: adjust('up') }, { label: msg('LevelDown5'), enabled: true, run: adjust('down') }, { label: msg('Cancel2'), enabled: true, run: () => openMenu(options()) }], cursor: 0, wrap: true, cancel: () => openMenu(options()) } };
    return;
  };
  /** Decomp sSummaryMenuEntries: SUMMARY (2 CP), MOVES (5 CP, information rank 2), RANK UP (50 CP), CANCEL. */
  const summaryMenu = (): Menu => {
    const r = rank(CASTLE_RANK.summary);
    const back = () => openMenu(summaryMenu());
    const buy = (which: 'stats' | 'moves') => (): Step => {
      if (which === 'moves' && r === 1) return say(msg('TooLowForMoveList'), back);
      if (unlocked[which][cursor]) return panel(which === 'stats' ? 'summary' : 'moves');
      const cost = which === 'stats' ? CASTLE_COST.stats : CASTLE_COST.moves;
      return ask(
        msg(which === 'stats' ? 'CanCheckStats' : 'MayCheckMoveList', String(cost)),
        () => {
          if (cp() < cost) return say(msg(which === 'stats' ? 'NotEnoughCP' : 'NotEnoughCP2'), toSelect);
          spendCastlePoints(ctx.state, type, cost);
          unlocked[which][cursor] = true;
          return panel(which === 'stats' ? 'summary' : 'moves');
        },
        back,
      );
    };
    return {
      window: 'summary',
      entries: [
        { label: msg('Summary2'), enabled: true, run: buy('stats') },
        { label: msg('Moves'), enabled: r !== 1, run: buy('moves') },
        { label: msg('RankUp'), enabled: r !== 2, run: () => rankUp(CASTLE_RANK.summary, back) },
        { label: msg('Cancel3'), enabled: true, run: () => openMenu(options()) },
      ],
      cursor: 0,
      cancel: () => openMenu(options()),
      describe: (i) => (message = msg(['CheckStats', 'CheckMoveList', r === 1 ? 'RankUpToCheckMoves' : 'CantRankUp', 'ReturnToPreviousMenu'][i]!)),
    };
  };

  // ---------------------------------------------------------------- the panels (SUMMARY, MOVES)

  const panel = (which: 'summary' | 'moves'): Step => {
    message = null;
    hint = null;
    mode = { k: 'panel', which };
    return;
  };
  /** Decomp ChangeSelectedMonOnSummaryDisplay / OnMoveDisplay: the player's any slot; the opponent's only those bought. */
  const pagePanel = (which: 'summary' | 'moves', step: number): void => {
    for (let s = cursor, n = 0; n < mons.length; n++) {
      s = (s + step + mons.length) % mons.length;
      if (s === cursor) return;
      if (self || unlocked[which === 'summary' ? 'stats' : 'moves'][s]) {
        cursor = s;
        se(SE.confirm);
        return;
      }
    }
  };
  const panelLines = (which: 'summary' | 'moves'): NonNullable<CastleView['lines']> => {
    const m = mons[cursor]!;
    const dx = self ? 0 : 8;
    if (which === 'moves')
      return m.moves.flatMap((move, i) => [
        { text: msg(`MoveName${i + 1}`, ...Array(i).fill(''), ctx.registries.moves.get(move)?.name ?? move), x: (self ? 24 : 32), y: 12 + i * 24, align: 'left' as const },
        { text: msg('MovePP', '', '', '', '', String(m.pp[i] ?? 0), String(maxPps(dex, m)[i] ?? 0)), x: self ? 137 : 145, y: 12 + i * 24, align: 'centre' as const },
      ]);
    const nature = [...ctx.registries.natures.values()].find((n) => n.sourceIndex === natureIndex(dex, m.pid))?.name ?? '';
    const ability = m.ability ? (ctx.registries.abilities.get(m.ability)?.name ?? '') : '';
    const item = m.heldItem ? itemName(m.heldItem) : '';
    return [
      { text: msg('Item'), x: dx, y: 8, align: 'left' },
      { text: msg('ItemValue', item), x: 64 + dx, y: 8, align: 'left' },
      { text: msg('Nature'), x: dx, y: 24, align: 'left' },
      { text: msg('NatureValue', nature), x: 64 + dx, y: 24, align: 'left' },
      { text: msg('Ability'), x: dx, y: 40, align: 'left' },
      { text: msg('AbilityValue', ability), x: 64 + dx, y: 40, align: 'left' },
      ...SUMMARY_ROWS.flatMap((r) => [
        { text: msg(r.label), x: r.x + dx, y: r.y, align: 'left' as const },
        { text: msg(r.value, String(m.stats[r.stat!]).padStart(3, ' ')), x: r.vx + dx, y: r.y, align: 'right' as const },
      ]),
    ];
  };

  // ---------------------------------------------------------------- input

  /** Decomp UpdateSelectedMon: left and right wrap over the slots, down to EXIT, up back to the slot left. */
  const selectInput = (b: Button): Step => {
    if (b === 'left' || b === 'right') {
      if (cursor === exit) return;
      cursor = (cursor + (b === 'left' ? exit - 1 : 1)) % exit;
    } else if (b === 'up') {
      if (cursor < exit) return;
      cursor = previous;
    } else if (b === 'down') {
      if (cursor >= exit) return;
      previous = cursor;
      cursor = exit;
    } else if (b === 'a') {
      se(SE.confirm);
      if (cursor >= exit) return close();
      hint = null;
      return openMenu(options());
    } else if (b === 'b') {
      if (cursor !== exit) {
        se(SE.confirm);
        cursor = exit;
      }
      return;
    } else return;
    se(SE.confirm);
    return;
  };
  /** Decomp ListMenu_ProcessInput (and the heal menu's wrap): up and down, A an entry, B cancel. */
  const menuInput = (menu: Menu, b: Button): Step => {
    const n = menu.entries.length;
    if (b === 'up' || b === 'down') {
      const next = menu.cursor + (b === 'up' ? -1 : 1);
      if (next < 0 || next >= n) {
        if (!menu.wrap) return;
        menu.cursor = (next + n) % n;
      } else menu.cursor = next;
      se(SE.confirm);
      menu.describe?.(menu.cursor);
      return;
    }
    if (b === 'a') {
      se(SE.confirm);
      return menu.entries[menu.cursor]!.run();
    }
    if (b === 'b') {
      se(SE.confirm);
      return menu.cancel();
    }
    return;
  };
  const listInput = (list: Extract<Mode, { k: 'items' }>, b: Button): Step => {
    const n = rentals(list.kind).length + 1;
    if (b === 'up' || b === 'down') {
      const next = list.cursor + (b === 'up' ? -1 : 1);
      if (next < 0 || next >= n) return;
      list.cursor = next;
      if (list.cursor < list.top) list.top = list.cursor;
      if (list.cursor >= list.top + LIST_ROWS) list.top = list.cursor - LIST_ROWS + 1;
      se(SE.confirm);
      return;
    }
    if (b === 'a') {
      se(SE.confirm);
      if (list.cursor === n - 1) return openMenu(rentalMenu());
      return rent(list.kind, list.cursor);
    }
    if (b === 'b') {
      se(SE.confirm);
      return openMenu(rentalMenu());
    }
    return;
  };
  const answer = (yes: boolean): Step => {
    if (mode.k !== 'yesno') return;
    const m = mode;
    se(SE.confirm);
    message = null;
    return yes ? m.yes() : m.no();
  };

  const view = (): CastleView => {
    const list = mode.k === 'items' ? mode : (mode.k === 'yesno' || mode.k === 'wait') && under ? under : null;
    const panelOf = (): CastleView['panel'] => (list ? 'items' : mode.k === 'panel' ? mode.which : 'main');
    return {
      app: 'castle',
      mode: request.mode,
      panel: panelOf(),
      playerName: player,
      cp: t.message(`${SELF}CastlePoints`, String(cp()).padStart(4, ' ')),
      mons: mons.map((m, i) => ({ species: m.species, form: m.form, gender: monGender(dex, m), shiny: isShiny(m.otId, m.pid), level: m.level, hp: m.hp, maxHp: m.stats.hp, item: m.heldItem !== null, hidden: !self && !unlocked.identity[i], ...(self ? {} : { flags: { stats: unlocked.stats[i] === true, moves: unlocked.moves[i] === true } }) })),
      cursor,
      exit: msg('Exit'),
      menu: mode.k === 'menu' ? { window: mode.menu.window, entries: mode.menu.entries.map((e) => ({ label: e.label, enabled: e.enabled })), cursor: mode.menu.cursor } : null,
      hint: mode.k === 'select' || (mode.k === 'menu' && mode.menu.window === 'options') ? hint : null,
      message,
      yesNo: mode.k === 'yesno' ? { yes: msg('Yes'), no: msg('No'), cursor: mode.cursor } : null,
      items: list
        ? {
            entries: [...rentals(list.kind).map((r) => ({ name: itemName(r.item), cp: t.message(`${SELF}CastlePointsItemSelect`, String(r.cp).padStart(4, ' ')) })), { name: msg('Cancel'), cp: '' }],
            cursor: list.cursor,
            top: list.top,
            item: rentals(list.kind)[list.cursor]?.item ?? null,
            mon: cursor,
            cpLine: t.message(`${SELF}CastlePointsItemSelect`, String(cp()).padStart(4, ' ')),
          }
        : null,
      lines: mode.k === 'panel' ? panelLines(mode.which) : null,
      ...(mode.k === 'sparkle' ? { sparkle: { anim: mode.anim, x: SPARKLE_AT.x + SPARKLE_AT.step * mode.slot, y: SPARKLE_AT.y, tick: mode.tick } } : {}),
    };
  };

  return {
    view,
    tick() {
      if (mode.k !== 'sparkle') return;
      if (++mode.tick < mode.ticks) return;
      return mode.then();
    },
    input(i): Step {
      if (mode.k === 'sparkle') return;
      if ('tap' in i) return tap(i.tap);
      const b = i.button;
      switch (mode.k) {
        case 'select':
          return selectInput(b);
        case 'menu':
          return menuInput(mode.menu, b);
        case 'items':
          return listInput(mode, b);
        case 'yesno':
          if (b === 'up' || b === 'down') {
            mode.cursor = 1 - mode.cursor;
            se(SE.confirm);
            return;
          }
          if (b === 'a') return answer(mode.cursor === 0);
          if (b === 'b') return answer(false);
          return;
        case 'wait':
          if (b !== 'a' && b !== 'b') return;
          se(SE.confirm);
          message = null;
          return mode.then();
        case 'panel':
          if (b === 'left' || b === 'right') {
            pagePanel(mode.which, b === 'left' ? -1 : 1);
            return;
          }
          if (b === 'a' || b === 'b') {
            se(SE.confirm);
            return openMenu(options());
          }
          return;
      }
    },
  };

  /** Taps: the touch screen of the DS has none here; these stand in for the keys at the same places. */
  function tap(id: string): Step {
    if (mode.k === 'select') {
      if (id === 'exit') {
        cursor = exit;
        return selectInput('a');
      }
      const slot = tapIndex(id, 'mon');
      if (slot === null || slot < 0 || slot >= exit) return;
      cursor = slot;
      return selectInput('a');
    }
    if (mode.k === 'menu') {
      const e = tapIndex(id, 'entry');
      if (e === null || e < 0 || e >= mode.menu.entries.length) return;
      mode.menu.cursor = e;
      mode.menu.describe?.(e);
      return menuInput(mode.menu, 'a');
    }
    if (mode.k === 'items') {
      const row = tapIndex(id, 'item');
      if (row === null || row < 0 || row > rentals(mode.kind).length) return;
      mode.cursor = row;
      return listInput(mode, 'a');
    }
    if (mode.k === 'yesno') {
      const e = tapIndex(id, 'answer');
      return e === null ? undefined : answer(e === 0);
    }
    if (mode.k === 'wait' && id === 'next') {
      message = null;
      return mode.then();
    }
    if (mode.k === 'panel') {
      const step = tapIndex(id, 'page');
      if (step !== null) {
        pagePanel(mode.which, step < 0 ? -1 : 1);
        return;
      }
      if (id === 'next') return openMenu(options());
    }
    return;
  }
}
