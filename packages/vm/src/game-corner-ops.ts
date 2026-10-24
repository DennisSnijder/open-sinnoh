/**
 * The Veilstone Game Corner and Prize Exchange (docs/research/game-corner.md §7): the coin commands (decomp
 * scrcmd_coins.c over coins.c), the slot machine's launcher (ScrCmd_267 → sub_0203E414 / sub_0203E35C), the bonus
 * streak check (ScrCmd_CheckBonusRoundStreak), the prizes (scrcmd_game_corner_prize.c) and the guitarist's Hidden Power
 * type (ov5_021F6454.c ScrCmd_CalcHiddenPowerType).
 */
import { COINS_MAX, newGameRecord, saveTvSegment, SLOT, type SlotTables } from '@opensinnoh/contracts';
import { dailyRandomOf, STATS, type Arg, type Id } from '@opensinnoh/core';
import { addToGameRecord, incrementTrainerScore, slotMode } from '@opensinnoh/services';
import { formatNumber, PADDING_SPACES } from './m1b-ops.ts';
import type { Handler, Runner, Thread } from './runner.ts';

/** Decomp FieldMenu_DrawCoinWindow: COIN_BP_WINDOW_WIDTH × HEIGHT tiles, menu entries pl_msg_00000361_00197, 5 digits. */
const COIN_WINDOW = { width: 10, height: 2, text: 'platinum:pl_msg_00000361_00197' as Id, digits: 5 } as const;
/** TRAINER_SCORE_EVENT_UNK_05 (sub_0203E414) and RECORD_UNK_014 (ov101_021D0F3C). */
const SCORE_SLOTS = 5;
const RECORD_BONUS_ROUNDS = 14;
/** ScrCmd_CheckBonusRoundStreak: a streak of 10 or more. */
const STREAK_GOAL = 10;
/** sub_0206DD38's Records-program segment: coins won of 1000 or more. */
const TV_COINS = 1000;
/** ScrCmd_CalcHiddenPowerType: species that never learn Hidden Power (0xFFFF), and TYPE_MYSTERY (skipped). */
const NO_HIDDEN_POWER = ['CATERPIE', 'METAPOD', 'WEEDLE', 'KAKUNA', 'MAGIKARP', 'DITTO', 'WOBBUFFET', 'SMEARGLE', 'WURMPLE', 'SILCOON', 'CASCOON', 'WYNAUT', 'BELDUM', 'BURMY', 'COMBEE', 'KRICKETOT'];
const TYPE_MYSTERY = 9;

export function gameCornerHandlers(r: Runner): Record<string, Handler> {
  const val = (t: Thread, a: Arg | undefined) => r.val(t, a);
  const dest = (t: Thread, a: Arg | undefined, v: number) => r.setVar(t, r.ref(a, 'var'), v);
  const tables = (op: string): SlotTables => {
    const s = newGameRecord(r.registries).slots;
    if (!s) throw new Error(`${op}: the packs have no Game Corner tables (NewGame.slots)`);
    return s;
  };
  const coinText = () => r.plainSlots(r.textOf(COIN_WINDOW.text), [formatNumber(r.state.coins, PADDING_SPACES, COIN_WINDOW.digits)]);
  const coinWindow = (op: string) => {
    if (!r.ui.coinWindow) throw new Error(`${op}: the coin window is not shown`);
    return r.ui.coinWindow;
  };
  /** Coins_Subtract: only when there are enough. */
  const subtract = (n: number) => {
    if (r.state.coins >= n) r.state.coins -= n;
  };

  return {
    // Decomp ScrCmd_ShowCoins → FieldMenu_DrawCoinWindow(left, top).
    show_coins: (t, _c, a) => {
      r.ui.coinWindow = { x: val(t, a[0]) * 8, y: val(t, a[1]) * 8, width: COIN_WINDOW.width * 8, height: COIN_WINDOW.height * 8, text: coinText() };
      return 'continue';
    },
    hide_coins: () => (coinWindow('hide_coins'), (r.ui.coinWindow = null), 'continue'),
    update_coin_display: () => ((coinWindow('update_coin_display').text = coinText()), 'continue'),
    get_coins_amount: (t, _c, a) => (dest(t, a[0], r.state.coins), 'continue'),
    // Coins_Add: nothing at the cap; the u16 sum (it can wrap past 65535, as on the DS) is clamped to MAX_COINS.
    add_coins: (t, _c, a) => {
      if (r.state.coins < COINS_MAX) r.state.coins = Math.min(COINS_MAX, (r.state.coins + val(t, a[0])) & 0xffff);
      return 'continue';
    },
    subtract_coins_from_value: (t, _c, a) => (subtract(val(t, a[0])), 'continue'),
    subtract_coins_from_var: (t, _c, a) => (subtract(r.getVar(t, r.ref(a[0], 'var'))), 'continue'),
    has_coins_from_value: (t, _c, a) => (dest(t, a[0], r.state.coins >= r.int(a[1]) ? 1 : 0), 'continue'),
    has_coins_from_var: (t, _c, a) => (dest(t, a[0], r.state.coins >= r.getVar(t, r.ref(a[1], 'var')) ? 1 : 0), 'continue'),
    // Coins_CanAdd: the sum stays within MAX_COINS.
    check_can_add_coins: (t, _c, a) => (dest(t, a[0], r.state.coins + val(t, a[1]) <= COINS_MAX ? 1 : 0), 'continue'),
    check_bonus_round_streak: (t, _c, a) => (dest(t, a[0], r.getFieldVar(tables('check_bonus_round_streak').streakVar) >= STREAK_GOAL ? 1 : 0), 'continue'),
    get_game_corner_prize_data: (t, _c, a) => {
      const i = val(t, a[0]);
      const prize = tables('get_game_corner_prize_data').prizes[i];
      if (!prize) throw new Error(`get_game_corner_prize_data: no prize ${i}`);
      const item = r.registries.items.get(prize.item)?.sourceIndex;
      if (item === undefined) throw new Error(`get_game_corner_prize_data: item ${prize.item} has no ROM index`);
      dest(t, a[1], item);
      dest(t, a[2], prize.price);
      return 'continue';
    },
    /**
     * Decomp ScrCmd_267 → sub_0203E414: the machine's mode for the day (sub_0203E484 over the daily random), the trainer
     * score, then the slot app; on its return (sub_0203E35C, ov101_021D0F3C): the coins, the bonus rounds played into
     * RECORD_UNK_014, the streak var raised to the session's best; 1000 coins or more won are a TV record (sub_0206DD38,
     * with the minutes played: here the ticks the app ran).
     */
    scr_cmd_267: (t, c, a) => {
      const machine = val(t, a[0]);
      if (machine >= SLOT.machines) throw new Error(`scr_cmd_267: no slot machine ${machine}`);
      const mode = slotMode(tables('scr_cmd_267'), dailyRandomOf(r.state), machine);
      const before = r.state.coins;
      const start = r.state.tick;
      incrementTrainerScore(r.state, r.registries, SCORE_SLOTS);
      return r.openApp(c, { app: 'slots', machine, mode, seed: r.rngSource().next() }, (result) => {
        if (result.app !== 'slots') throw new Error(`scr_cmd_267: got a ${result.app} result`);
        if (result.coins >= before + TV_COINS) saveTvSegment(r.state, { kind: 'slots', before, after: result.coins, spent: Math.floor((r.state.tick - start) / (30 * 60)) });
        r.state.coins = result.coins;
        addToGameRecord(r.state, r.registries, RECORD_BONUS_ROUNDS, result.rounds);
        const streakVar = tables('scr_cmd_267').streakVar;
        if (result.streak > r.getFieldVar(streakVar)) r.setFieldVar(streakVar, result.streak);
      });
    },
    // Decomp ScrCmd_CalcHiddenPowerType (CalcHiddenPowerTypeAndPower): 0xFFFF for the species that cannot learn it.
    calc_hidden_power_type: (t, _c, a) => {
      const slot = val(t, a[0]);
      const mon = r.state.party[slot];
      if (!mon) throw new Error(`calc_hidden_power_type: no Pokémon in party slot ${slot}`);
      const name = mon.species.slice(mon.species.indexOf(':') + 1).replace(/^SPECIES_/, '');
      if (!mon.isEgg && NO_HIDDEN_POWER.includes(name)) {
        dest(t, a[1], 0xffff);
        return 'continue';
      }
      let bits = 0;
      STATS.forEach((s, i) => (bits |= (mon.ivs[s] & 1) << i));
      const type = Math.trunc((bits * 15) / 63) + 1;
      dest(t, a[1], type >= TYPE_MYSTERY ? type + 1 : type);
      return 'continue';
    },
  };
}
