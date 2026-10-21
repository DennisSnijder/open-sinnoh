/** Native command semantics: scrcmd_jubilife_lottery.c, scrcmd.c (1C1..1C5, 277..27B,
 * 2B5), overlay005/size_contest.c, overlay005/vs_seeker.c, revision 1dc13dc. */
import { FIELD_VARS, initDailyLevel, lotteryWinner, nextFieldRandom, randomizeLottery, readSystemVar, rematchTrainer, sizeFactor, sizeInTenths, writeSystemVar, type Id } from '@opensinnoh/core';
import { newGameRecord } from '@opensinnoh/contracts';
import type { Handler, Runner } from './runner.ts';

export function fieldSystemHandlers(r: Runner): Record<string, Handler> {
  const party = (slot: number) => {
    const mon = r.state.party[slot];
    if (!mon) throw new Error(`size contest: no party slot ${slot}`);
    return mon;
  };
  /** A species' size for a factor, through the pack's interval table (SizeContest). */
  const sizeOf = (species: Id, factor: number) => {
    const intervals = newGameRecord(r.registries).sizeIntervals;
    const height = r.registries.species.get(species)?.dex?.height;
    if (!intervals || height === undefined) throw new Error(`size contest: missing intervals or height for ${species}`);
    return sizeInTenths(intervals, height, factor);
  };
  const buffer = (slots: (string | undefined)[], integer: number, fraction: number, value: number) => {
    slots[integer] = String(Math.floor(value / 10));
    slots[fraction] = String(value % 10);
  };
  return {
    randomize_jubilife_lottery: () => { randomizeLottery(r.registries, r.state, () => nextFieldRandom(r.state)); return 'continue'; },
    get_jubilife_lottery_trainer_id: (t, _c, a) => {
      r.setVar(t, r.ref(a[0], 'var'), readSystemVar(r.registries, r.state, FIELD_VARS.lotteryLow)); return 'continue';
    },
    check_for_jubilife_lottery_winner: (t, _c, a) => {
      const winner = lotteryWinner(r.state, r.val(t, a[3]));
      [winner.index, winner.digits, winner.box].forEach((v, i) => r.setVar(t, r.ref(a[i], 'var'), v));
      return 'continue';
    },
    init_daily_random_level: () => { initDailyLevel(r.registries, r.state, () => nextFieldRandom(r.state)); return 'continue'; },
    get_daily_random_level: (t, _c, a) => {
      r.setVar(t, r.ref(a[0], 'var'), readSystemVar(r.registries, r.state, FIELD_VARS.level)); return 'continue';
    },
    init_size_contest_record: () => { writeSystemVar(r.registries, r.state, FIELD_VARS.size, 33280); return 'continue'; },
    update_size_contest_record: (t, _c, a) => {
      writeSystemVar(r.registries, r.state, FIELD_VARS.size, sizeFactor(party(r.val(t, a[0])))); return 'continue';
    },
    calc_size_contest_result: (t, _c, a) => {
      const mon = party(r.val(t, a[1]));
      const value = sizeOf(mon.species, sizeFactor(mon));
      const record = sizeOf(mon.species, readSystemVar(r.registries, r.state, FIELD_VARS.size));
      // generated/size_contest_results.txt: SMALLER, SAME_SIZE, LARGER.
      r.setVar(t, r.ref(a[0], 'var'), value === record ? 1 : value > record ? 2 : 0);
      if (value > record) r.log.stub('tv:size-contest', 'size record TV segment is not recorded yet');
      return 'continue';
    },
    buffer_size_contest_record: (t, _c, a) => {
      buffer(t.slots, r.val(t, a[0]), r.val(t, a[1]), sizeOf(r.source('species', r.val(t, a[2]))!, readSystemVar(r.registries, r.state, FIELD_VARS.size))); return 'continue';
    },
    buffer_party_pokemon_size: (t, _c, a) => {
      const mon = party(r.val(t, a[2]));
      buffer(t.slots, r.val(t, a[0]), r.val(t, a[1]), sizeOf(mon.species, sizeFactor(mon))); return 'continue';
    },
    get_rematch_trainer_id: (t, _c, a) => {
      const o = r.state.objects.find((o) => o.zone === t.zone && o.localId === t.lastTalked);
      if (!o) throw new Error(`rematch: no talked-to object ${t.lastTalked} in ${t.zone}`);
      r.setVar(t, r.ref(a[1], 'var'), rematchTrainer(r.registries, r.state, r.source('trainers', r.val(t, a[0]))!, o.movementType));
      return 'continue';
    },
    scr_cmd_2b5: (t, _c, a) => {
      r.state.escapeLocation = { zone: r.source('zones', r.val(t, a[0]))!, x: r.val(t, a[1]), z: r.val(t, a[2]), facing: 'down' };
      return 'continue';
    },
  };
}
