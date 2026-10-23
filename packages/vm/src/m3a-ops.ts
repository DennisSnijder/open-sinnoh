/**
 * Service commands: the marts open the mart app and wait for it
 * (decomp scrcmd_shop.c → Shop_Start, a field task the script waits on), and the Pokémon Center's
 * healing machine (ScrCmd_PlayPokecenterHealingAnimation → FieldSystem_PlayHealingAnimation_Pokecenter),
 * the party ribbon commands over `Pokemon.ribbons` (decomp scrcmd_party.c, ScrCmd_BufferRibbonName), the
 * trainer score and the game records, card level, Pokédex completion, the signature app and the field money
 * window (decomp scrcmd_money.c).
 */
import { JOURNAL_EVENT, journalEvent, journalMart } from '@opensinnoh/contracts';
import { monGender, type Id, type Pokemon } from '@opensinnoh/core';
import { dexOf, newGameRecord, STORAGE_MODES } from '@opensinnoh/contracts';
import { addToGameRecord, cardStars, incrementTrainerScore, localDexCompleted, nationalDexCompleted } from '@opensinnoh/services';
import { toPrintOps } from '@opensinnoh/text';
import { formatNumber, PADDING_SPACES } from './m1b-ops.ts';
import type { Handler, Runner } from './runner.ts';

/** Decomp MON_NAME_LEN: a nickname's length on the naming screen. */
const MON_NAME_LEN = 10;

/** Decomp PARTY_SLOT_NONE: no Pokémon was picked. */
const PARTY_SLOT_NONE = 0xff;

/** Decomp VAR_DEPARTMENT_STORE_REGULAR_COUNTER (SystemVars_IncrementDepartmentStoreBuyCount). */
const DEPARTMENT_STORE_COUNTER = 0x4042;
/** Decomp ScrCmd_PokeMartSpecialties: the Veilstone Department Store marts count purchases (MART_SPECIALTIES_ID_VEILSTONE_*). */
const DEPARTMENT_STORE_MARTS = new Set([8, 9, 10, 11, 12, 13, 19]);
/** Decomp RIBBON_MAX: script ribbon ids are enum Ribbon, 0..79. */
const RIBBON_MAX = 80;
/** Decomp FieldMenu_CreateMoneyWindow: TEXT_BANK_UNK_0543's label (#18) and amount (#19) in a 10×4-tile window. */
export const MONEY_WINDOW = { bank: 543, label: 18, amount: 19, width: 80, height: 32, digits: 6 } as const;

export function m3aHandlers(r: Runner): Record<string, Handler> {
  /** The `marts` record of a decomp mart id (specialties carry it as `sourceIndex`; the common mart is MART_COMMON). */
  const martBy = (pick: (id: Id, sourceIndex: number | undefined) => boolean, what: string): Id => {
    const found = [...r.registries.marts.values()].filter((m) => pick(m.id, m.sourceIndex));
    if (found.length !== 1) throw new Error(`${found.length} marts match ${what}`);
    return found[0]!.id;
  };
  const openMart = (c: Parameters<Handler>[1], mart: Id, countVar: Id | null) => {
    // The greeting stays drawn (close_message_without_erasing); the mart shows it in its own box.
    const greeting = r.ui.message ? r.ui.message.printer.text() : null;
    r.ui.message = null;
    return r.openApp(c, { app: 'mart', mart, countVar, greeting }, (result) => {
      if (result.app === 'mart') journalMart(r.registries, r.state, result.bought ?? 0, result.sold ?? 0);
    });
  };

  /**
   * The party pick of the last party menu a script opened (decomp SCRIPT_MANAGER_PARTY_MANAGEMENT_DATA),
   * until `get_selected_party_slot` reads it: undefined when none is pending.
   */
  let picked: number | null | undefined;

  const partyMon = (op: string, slot: number): Pokemon => {
    const m = r.state.party[slot];
    if (!m) throw new Error(`${op}: no Pokémon in party slot ${slot}`);
    return m;
  };
  const ribbonId = (op: string, n: number): number => {
    if (n >= RIBBON_MAX) throw new Error(`${op}: ribbon ${n} is not a ribbon id (0..${RIBBON_MAX - 1})`);
    return n;
  };

  /** A bank message as one plain line with the thread's slots (the money window prints at TEXT_SPEED_NO_TRANSFER). */
  const plain = (index: number, slots: (string | undefined)[]) =>
    toPrintOps(r.textOf(r.bankText(MONEY_WINDOW.bank, index)), slots)
      .map((op) => (op.kind === 'char' ? op.c : ''))
      .join('');
  /** Decomp FieldMenu_PrintMoneyToWindow: the money, padded to 6 digits with spaces (PADDING_MODE_SPACES). */
  const moneyAmount = () => plain(MONEY_WINDOW.amount, [formatNumber(r.state.money, PADDING_SPACES, MONEY_WINDOW.digits)]);
  const moneyWindow = (op: string) => {
    if (!r.ui.moneyWindow) throw new Error(`${op}: the money window is not shown`);
    return r.ui.moneyWindow;
  };

  return {
    // Decomp ScrCmd_ShowMoney → FieldMenu_CreateMoneyWindow(left, top): the framed window, "Money" and the amount.
    show_money: (t, _c, a) => {
      r.ui.moneyWindow = { x: r.val(t, a[0]) * 8, y: r.val(t, a[1]) * 8, width: MONEY_WINDOW.width, height: MONEY_WINDOW.height, label: plain(MONEY_WINDOW.label, []), amount: moneyAmount() };
      return 'continue';
    },
    // Decomp ScrCmd_HideMoney → FieldMenu_DeleteMoneyWindow.
    hide_money: () => (moneyWindow('hide_money'), (r.ui.moneyWindow = null), 'continue'),
    // Decomp ScrCmd_UpdateMoneyDisplay → FieldMenu_PrintMoneyToWindow: the amount after a payment.
    update_money_display: () => ((moneyWindow('update_money_display').amount = moneyAmount()), 'continue'),
    // Decomp ScrCmd_SelectMoveTutorPokemon: the party menu in PARTY_MENU_MODE_SELECT_NO_PROMPT; the script waits.
    select_move_tutor_pokemon: (_t, c) =>
      r.openApp(c, { app: 'party', mode: 'select' }, (result) => {
        if (result.app !== 'party') throw new Error(`select_move_tutor_pokemon: got a ${result.app} result`);
        picked = result.slot;
      }),
    // Decomp ScrCmd_OpenPartyMenuForTrade: PARTY_MENU_MODE_NPC_TRADE, which picks like SELECT_NO_PROMPT after the Ball Capsule check.
    open_party_menu_for_trade: (_t, c) =>
      r.openApp(c, { app: 'party', mode: 'trade' }, (result) => {
        if (result.app !== 'party') throw new Error(`open_party_menu_for_trade: got a ${result.app} result`);
        picked = result.slot;
      }),
    // Decomp ScrCmd_GetSelectedPartySlot: the picked slot, PARTY_SLOT_NONE when cancelled.
    get_selected_party_slot: (t, _c, a) => {
      if (picked === undefined) throw new Error('get_selected_party_slot: no party menu ran before it');
      r.setVar(t, r.ref(a[0], 'var'), picked ?? PARTY_SLOT_NONE);
      picked = undefined;
      return 'continue';
    },
    // Decomp ScrCmd_CountPartyRibbons: the ribbon ids at least one non-egg party Pokémon has.
    count_party_ribbons: (t, _c, a) => {
      const held = new Set(r.state.party.filter((m) => !m.isEgg).flatMap((m) => m.ribbons));
      r.setVar(t, r.ref(a[0], 'var'), held.size);
      return 'continue';
    },
    count_party_mon_ribbons_unused: (t, _c, a) => (r.setVar(t, r.ref(a[0], 'var'), partyMon('count_party_mon_ribbons_unused', r.val(t, a[1])).ribbons.length), 'continue'),
    get_party_mon_ribbon: (t, _c, a) => {
      const has = partyMon('get_party_mon_ribbon', r.val(t, a[1])).ribbons.includes(ribbonId('get_party_mon_ribbon', r.val(t, a[2])));
      r.setVar(t, r.ref(a[0], 'var'), has ? 1 : 0);
      return 'continue';
    },
    // Decomp ScrCmd_SetPartyMonRibbon (its TV segment, sub_0206DDB8, comes with TV).
    set_party_mon_ribbon: (t, _c, a) => {
      const m = partyMon('set_party_mon_ribbon', r.val(t, a[0]));
      const id = ribbonId('set_party_mon_ribbon', r.val(t, a[1]));
      if (!m.ribbons.includes(id)) m.ribbons = [...m.ribbons, id].sort((x, y) => x - y);
      return 'continue';
    },
    buffer_ribbon_name: (t, _c, a) => {
      const id = ribbonId('buffer_ribbon_name', r.val(t, a[1]));
      const texts = newGameRecord(r.registries).ribbons?.[id];
      if (!texts) throw new Error(`buffer_ribbon_name: the pack has no texts for ribbon ${id}`);
      t.slots[r.int(a[0])] = r.registries.texts.get(texts.name)!.text;
      return 'continue';
    },
    // Decomp ScrCmd_PokeMartCommon: the operand is unused (0 in Sandgem, 1 elsewhere); the stock follows the badges.
    poke_mart_common: (_t, c) => openMart(c, martBy((id) => id.endsWith(':MART_COMMON'), 'MART_COMMON'), null),
    poke_mart_specialties: (t, c, a) => {
      const n = r.val(t, a[0]);
      const countVar = DEPARTMENT_STORE_MARTS.has(n) ? r.source('vars', DEPARTMENT_STORE_COUNTER)! : null;
      return openMart(c, martBy((_id, source) => source === n, `specialty mart ${n}`), countVar);
    },
    // Decomp ScrCmd_CloseMessageWithoutErasing: the printer stops, the box stays drawn until the next message (or the end of the script).
    close_message_without_erasing: () => 'continue',
    // Decomp ScrCmd_OpenPokemonStorage: the PC boxes in one BoxMode (0–4, compare last); the script waits.
    open_pokemon_storage: (t, c, a) => {
      const n = r.val(t, a[0]);
      const mode = STORAGE_MODES[n];
      if (!mode) throw new Error(`open_pokemon_storage: no box mode ${n}`);
      // BoxAppMan_FlagRecordBoxUseInJournal: a session that changed the boxes or the party writes "used a PC box"
      // (the DS flags each move, deposit, withdrawal and release; inferred: any change of either).
      const before = JSON.stringify([r.state.boxes, r.state.party]);
      return r.openApp(c, { app: 'storage', mode }, () => {
        if (JSON.stringify([r.state.boxes, r.state.party]) !== before) journalEvent(r.registries, r.state, JOURNAL_EVENT.pcBox);
      });
    },
    // Decomp ScrCmd_OpenPokemonNamingScreen → sub_0203DFE8: the party Pokémon's nickname; the var gets 1
    // when the name was left unchanged, else 0 and the nickname is set.
    open_pokemon_naming_screen: (t, c, a) => {
      const slot = r.val(t, a[0]);
      const mon = r.state.party[slot];
      if (!mon) throw new Error(`open_pokemon_naming_screen: no Pokémon in party slot ${slot}`);
      const species = r.registries.species.get(mon.species)!.name;
      const pokemon = { species: mon.species, form: mon.form, gender: monGender(dexOf(r.registries), mon) };
      return r.openApp(c, { app: 'naming', kind: 'pokemon', initial: mon.nickname ?? species, maxLength: MON_NAME_LEN, gender: r.state.gender, pokemon }, (result) => {
        if (result.app !== 'naming') throw new Error(`open_pokemon_naming_screen: got a ${result.app} result`);
        if (result.name !== null) mon.nickname = result.name === species ? null : result.name;
        r.setVar(t, r.ref(a[1], 'var'), result.name === null ? 1 : 0);
      });
    },
    // Decomp ScrCmd_IncrementTrainerScore(2): the operand is a TRAINER_SCORE_EVENT_* number (the gyms: BADGE_EARNED).
    increment_trainer_score: (_t, _c, a) => (incrementTrainerScore(r.state, r.registries, r.int(a[0])), 'continue'),
    increment_trainer_score2: (_t, _c, a) => (incrementTrainerScore(r.state, r.registries, r.int(a[0])), 'continue'),
    // Decomp ScrCmd_IncrementGameRecord, ScrCmd_AddToGameRecord(BigValue) → GameRecords_AddToRecordValue: a RECORD_* id and an amount.
    increment_game_record: (_t, _c, a) => (addToGameRecord(r.state, r.registries, r.int(a[0]), 1), 'continue'),
    add_to_game_record: (t, _c, a) => (addToGameRecord(r.state, r.registries, r.int(a[0]), r.val(t, a[1])), 'continue'),
    add_to_game_record_big_value: (_t, _c, a) => (addToGameRecord(r.state, r.registries, r.int(a[0]), r.int(a[1])), 'continue'),
    // Decomp ScrCmd_GetTrainerCardLevel → TrainerCase_CalculateTrainerCardLevel (the nurse's greeting branches on it).
    get_trainer_card_level: (t, _c, a) => (r.setVar(t, r.ref(a[0], 'var'), cardStars(r.state, r.registries)), 'continue'),
    check_local_dex_completed: (t, _c, a) => (r.setVar(t, r.ref(a[0], 'var'), localDexCompleted(r.state, r.registries) ? 1 : 0), 'continue'),
    check_national_dex_completed: (t, _c, a) => (r.setVar(t, r.ref(a[0], 'var'), nationalDexCompleted(r.state, r.registries) ? 1 : 0), 'continue'),
    // Decomp ScrCmd_StartSignatureApp: the signature app (the card's signing mode, without cancel); the script waits.
    start_signature_app: (_t, c) => r.openApp(c, { app: 'signature' }, () => {}),
    play_pokecenter_healing_animation: (t, c, a) => {
      // NOT DS behaviour: a quality-of-life change, as common ROM hacks do (docs/decisions.md
      // 2026-10-16). On the DS the nurse bows and the player keeps facing her (scripts_common.s
      // CommonScript_NurseFarewellAfterHeal); mashing A through the text, above all at fast-forward, then talks
      // to her again. Turning the player away stops that. Not an input bug: one A press cannot both close the
      // goodbye and talk again (tests/integration/services.rom.test.ts).
      if (t.lastTalked !== undefined) {
        const opposite = { up: 'down', down: 'up', left: 'right', right: 'left' } as const;
        t.turnAfterHealing = opposite[r.state.player.facing];
      }
      r.field.healAnimation(r.val(t, a[0]));
      return r.pause(c, () => r.field.healAnimationDone());
    },
  };
}
