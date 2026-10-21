/**
 * The Poffin and contest-item script commands: Poffins (scrcmd.c ScrCmd_CheckCanCookPoffin, ScrCmd_OpenPoffinCooking,
 * ScrCmd_GivePoffin, ScrCmd_CheckHasEmptyPoffinCaseSlot, ScrCmd_GetEmptyPoffinCaseSlotCount), the Fashion Case
 * (ScrCmd_AddAccessory, ScrCmd_CanFitAccessory, ScrCmd_RemoveAccessory, ScrCmd_AddContestBackdrop, ScrCmd_CheckBackdrop,
 * ScrCmd_TryGetRandomMassageGirlAccessory) and Amity Square (scrcmd_amity_square.c; ov5_021F6454.c ScrCmd_338/339).
 * The rules are services' (poffins.ts, fashion.ts); 'yield' where the decomp handler returns TRUE.
 */
import { POFFIN_CASE_SIZE, newGameRecord, type AmitySquareTables } from '@opensinnoh/contracts';
import { type Arg } from '@opensinnoh/core';
import {
  addAccessory, addBackdrop, addPoffin, canFitAccessory, cookCheck, hasBackdrop, makePoffin, MASSAGE_ACCESSORIES, removeAccessory,
} from '@opensinnoh/services';
import type { Handler, Runner, Thread } from './runner.ts';

/** Decomp POFFIN_NONE: give_poffin's result when the case is full. */
const POFFIN_NONE = 0xffff;
/** CalcAmitySquareFoundAccessory: the ten finds' odds in 100 (15, 15, 15, 15, 10, 10, 8, 5, 5, 2). */
const FIND_ODDS = [15, 30, 45, 60, 70, 80, 88, 93, 98, 100];

export function poffinHandlers(r: Runner): Record<string, Handler> {
  const val = (t: Thread, a: Arg | undefined) => r.val(t, a);
  const dest = (t: Thread, a: Arg | undefined, v: number) => r.setVar(t, r.ref(a, 'var'), v);
  const fc = () => r.state.fashionCase;
  const amity = (op: string): AmitySquareTables => {
    const tables = newGameRecord(r.registries).amitySquare;
    if (!tables) throw new Error(`${op}: the packs have no NewGame.amitySquare`);
    return tables;
  };
  const species = (n: number) => r.source('species', n, false);

  return {
    // ---------------------------------------------------------------- Poffins
    /** ScrCmd_CheckCanCookPoffin: 1 with no berry, 2 with a full case, else 0. */
    check_can_cook_poffin: (t, _c, a) => (dest(t, a[0], cookCheck(r.state)), 'continue'),
    /**
     * ScrCmd_OpenPoffinCooking: alone (FALSE), the cooking app (the berry bag, the pot, the results) until the player
     * stops; the script's ReturnToField waits for it. In a group (TRUE) it needs a link (the Union Room's comm): logged.
     */
    open_poffin_cooking: (_t, c, a) => {
      if (r.int(a[0])) {
        r.log.stub('stub:open_poffin_cooking:group', 'cooking Poffins in a group needs a wireless link (not supported)');
        return 'yield';
      }
      return r.openApp(c, { app: 'poffin-cooking' }, () => {});
    },
    /** ScrCmd_GivePoffin (Poffin_MakePoffin, PoffinCase_AddPoffin): the Poffin's type, or POFFIN_NONE when the case is full. */
    give_poffin: (t, _c, a) => {
      const flavors = [1, 2, 3, 4, 5].map((i) => val(t, a[i]) & 0xff);
      const p = makePoffin(flavors, val(t, a[6]) & 0xff, false, r.rngSource());
      dest(t, a[0], addPoffin(r.state, p) ? p.type : POFFIN_NONE);
      return 'continue';
    },
    check_has_empty_poffin_case_slot: (t, _c, a) => (dest(t, a[0], r.state.poffins.length < POFFIN_CASE_SIZE ? 1 : 0), 'continue'),
    get_empty_poffin_case_slot_count: (t, _c, a) => (dest(t, a[0], POFFIN_CASE_SIZE - r.state.poffins.length), 'continue'),

    // ---------------------------------------------------------------- the Fashion Case
    add_accessory: (t, _c, a) => (addAccessory(fc(), val(t, a[0]), val(t, a[1])), 'continue'),
    can_fit_accessory: (t, _c, a) => (dest(t, a[2], canFitAccessory(fc(), val(t, a[0]), val(t, a[1])) ? 1 : 0), 'continue'),
    remove_accessory: (t, _c, a) => (removeAccessory(fc(), val(t, a[0]), val(t, a[1])), 'continue'),
    add_contest_backdrop: (t, _c, a) => (addBackdrop(fc(), val(t, a[0])), 'continue'),
    check_backdrop: (t, _c, a) => (dest(t, a[1], hasBackdrop(fc(), val(t, a[0])) ? 1 : 0), 'continue'),
    /**
     * ScrCmd_TryGetRandomMassageGirlAccessory: one of Pretty Dewdrop … Glitter Powder that still fits (LCRNG % their
     * count, here the main stream), or 0xFFFF when all are held.
     */
    try_get_random_massage_girl_accessory: (t, _c, a) => {
      const open = Array.from({ length: MASSAGE_ACCESSORIES.count }, (_, i) => MASSAGE_ACCESSORIES.first + i).filter((id) => canFitAccessory(fc(), id, 1));
      dest(t, a[0], open.length ? open[r.rngSource().next() % open.length]! : 0xffff);
      return 'continue';
    },

    // ---------------------------------------------------------------- Amity Square
    clear_amity_square_step_count: (t) => (r.setVar(t, amity('clear_amity_square_step_count').stepVar, 0), 'continue'),
    get_amity_square_step_count: (t, _c, a) => (dest(t, a[0], r.getVar(t, amity('get_amity_square_step_count').stepVar)), 'continue'),
    /**
     * ScrCmd_CalcAmitySquareFoundAccessory: the roll (LCRNG % 100) picks one of the follower's pool's ten; a species in
     * no pool takes the first (the decomp's switch default).
     */
    calc_amity_square_found_accessory: (t, _c, a) => {
      const tables = amity('calc_amity_square_found_accessory');
      const roll = r.rngSource().next() % 100;
      const who = species(val(t, a[1]));
      const pool = tables.finds.find((p) => who !== undefined && p.species.includes(who)) ?? tables.finds[0]!;
      dest(t, a[0], pool.accessories[FIND_ODDS.findIndex((n) => roll < n)]!);
      return 'continue';
    },
    calc_amity_square_berry_and_accessory_man_option_id: (t, _c, a) => {
      const tables = amity('calc_amity_square_berry_and_accessory_man_option_id');
      dest(t, a[0], r.rngSource().next() % tables.gifts.length);
      return 'continue';
    },
    check_amity_square_man_gift_is_accessory: (t, _c, a) => (dest(t, a[1], val(t, a[0]) >= amity('check_amity_square_man_gift_is_accessory').itemGifts ? 1 : 0), 'continue'),
    get_amity_square_berry_or_accessory_id_from_man: (t, _c, a) => {
      const gift = amity('get_amity_square_berry_or_accessory_id_from_man').gifts[val(t, a[0])];
      if (gift === undefined) throw new Error(`get_amity_square_berry_or_accessory_id_from_man: no gift ${val(t, a[0])}`);
      dest(t, a[1], gift);
      return 'continue';
    },
    /**
     * Decomp ScrCmd_338 and ScrCmd_339 (the hut warps): 338 sets MAP_OBJ_STATUS_13 on the gift man (local 15) and puts
     * him at a fixed height for his place (the DS streams map chunks, so his far chunk's terrain may be unknown), 339
     * clears it. Our world loads every chunk, so he already stands on his terrain: nothing to change (as Eterna's
     * ScrCmd_32D, m5-ops.ts).
     */
    scr_cmd_338: () => 'continue',
    scr_cmd_339: () => 'continue',
  };
}
