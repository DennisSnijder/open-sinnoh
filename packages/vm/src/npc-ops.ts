/**
 * Small town and NPC rules (docs/research/villa-journal.md §4; decomp scrcmd.c, scrcmd_party.c): the wall Town Maps,
 * the field-poison survival, the Veilstone Store's regulars, the Pastoria scarf giver's condition read, the Combee
 * pair check, the meteorites' Deoxys forms, the Solaceon News Press, the Hallowed Tower's counter, the Snowpoint
 * expert's tough words (easy_chat_words.c) and the Jubilife groups man (scrcmd_group_connection.c).
 */
import { dexOf, markCaught } from '@opensinnoh/contracts';
import { CONDITIONS, monGender, recalc, type Id } from '@opensinnoh/core';
import { allToughWordsUnlocked, easyChatWord, easyChatWordText, localSeenCount, unlockRandomToughWord } from '@opensinnoh/services';
import type { Handler, Runner, Thread } from './runner.ts';

/** Decomp VAR_NEWS_PRESS_DEADLINE, VAR_SPIRITOMB_COUNTER, VAR_DEPARTMENT_STORE_REGULAR_COUNTER (system vars by number). */
const VAR = { newsPress: 0x403b, spiritomb: 0x403e, departmentStore: 0x4042 } as const;
/** Decomp SPECIES_COMBEE, SPECIES_DEOXYS, SPECIES_PIKACHU. */
const SPECIES = { combee: 415, deoxys: 386, pikachu: 25 } as const;
/** SystemVars_GetDepartmentStoreBuyCount: a regular from five purchases. */
const REGULAR = 5;
/** Decomp GC_ACTION_* (scrcmd_group_connection.c); JOIN_GROUP (5) and MAKE_NEW_GROUP (6) need a group. */
const GC_ACTION = { checkValid: 0, checkOverride: 1, bufferGroupName: 2, bufferLeaderName: 3, openNaming: 4 } as const;

export function npcHandlers(r: Runner): Record<string, Handler> {
  const dest = (t: Thread, a: Parameters<Runner['ref']>[0], v: number) => r.setVar(t, r.ref(a, 'var'), v);
  const sysVar = (n: number): Id => r.source('vars', n)!;
  const speciesOf = (n: number) => r.source('species', n);
  const partyMon = (op: string, slot: number) => {
    const mon = r.state.party[slot];
    if (!mon) throw new Error(`${op}: no party Pokémon in slot ${slot}`);
    return mon;
  };
  const gender = (m: (typeof r.state.party)[number]) => monGender(dexOf(r.registries), m);
  return {
    /** ScrCmd_OpenRegionMap (TOWN_MAP_MODE_WALL_MAP): the Town Map to look at; the script waits until it closes. */
    open_region_map: (_t, c) => r.openApp(c, { app: 'town-map' }, () => {}),
    /** Pokemon_TrySurvivePoison: a poisoned party Pokémon at 1 HP is cured (TRUE) instead of fainting. */
    survive_poison: (t, _c, a) => {
      const mon = partyMon('survive_poison', r.val(t, a[1]));
      const survives = (mon.status === 'poison' || mon.status === 'toxic') && mon.hp === 1;
      if (survives) mon.status = 'none';
      dest(t, a[0], survives ? 1 : 0);
      return 'continue';
    },
    check_is_department_store_regular: (t, _c, a) => (dest(t, a[0], r.getVar(t, sysVar(VAR.departmentStore)) >= REGULAR ? 1 : 0), 'continue'),
    /** MON_DATA_COOL + contestType. */
    get_party_mon_contest_stat: (t, _c, a) => {
      const condition = CONDITIONS[r.val(t, a[1])];
      if (!condition) throw new Error(`get_party_mon_contest_stat: contest type ${r.val(t, a[1])}`);
      dest(t, a[2], partyMon('get_party_mon_contest_stat', r.val(t, a[0])).condition[condition]);
      return 'continue';
    },
    /** 2 with a male and a female non-egg Combee, 0 with neither, else 1. The handler returns TRUE (a frame). */
    check_party_combee_gender_count: (t, _c, a) => {
      const combee = r.state.party.filter((m) => m.species === speciesOf(SPECIES.combee) && !m.isEgg);
      const male = combee.some((m) => gender(m) === 'male');
      const female = combee.some((m) => gender(m) === 'female');
      dest(t, a[0], male && female ? 2 : male || female ? 1 : 0);
      return 'yield';
    },
    /** Every party Deoxys takes the form, its stats recalculated, and the Pokédex records it (Pokedex_Capture). TRUE. */
    change_deoxys_form: (t, _c, a) => {
      const form = r.val(t, a[0]);
      for (const mon of r.state.party) {
        if (mon.species !== speciesOf(SPECIES.deoxys)) continue;
        mon.form = form;
        recalc(dexOf(r.registries), mon);
        markCaught(r.state, r.registries, mon);
      }
      return 'yield';
    },
    get_news_press_deadline: (t, _c, a) => (dest(t, a[0], r.getVar(t, sysVar(VAR.newsPress))), 'continue'),
    set_news_press_deadline: (t, _c, a) => (r.setVar(t, sysVar(VAR.newsPress), r.val(t, a[0])), 'continue'),
    /**
     * A random species seen in the Sinnoh Pokédex: LCRNG_Next() % the local seen count picks among the seen species with a
     * Sinnoh number, in national order; Pikachu when there is none to pick.
     */
    get_random_seen_species: (t, _c, a) => {
      const count = localSeenCount(r.state, r.registries);
      if (!count) throw new Error('get_random_seen_species: no Sinnoh species seen (the DS divides by zero)');
      const pick = (r.rng() >>> 0) % count;
      const seen = new Set(r.state.pokedex.seen);
      const local = [...r.registries.species.values()].filter((s) => s.sourceIndex !== undefined && s.regionalDex !== undefined && seen.has(s.id)).sort((x, y) => x.sourceIndex! - y.sourceIndex!);
      dest(t, a[0], local[pick]?.sourceIndex ?? SPECIES.pikachu);
      return 'continue';
    },
    get_spiritomb_counter: (t, _c, a) => (dest(t, a[0], r.getVar(t, sysVar(VAR.spiritomb))), 'continue'),
    clear_spiritomb_counter: (t) => (r.setVar(t, sysVar(VAR.spiritomb), 0), 'continue'),
    /** ScrCmd_CheckAllToughWordsUnlocked: TRUE when every tough word is unlocked (EasyChatWords_AreAllToughWordsUnlocked). */
    check_all_tough_words_unlocked: (t, _c, a) => (dest(t, a[0], allToughWordsUnlocked(r.registries, r.state.unlockedToughWords) ? 1 : 0), 'continue'),
    /**
     * ScrCmd_TryBufferAndUnlockRandomToughWord: unlocks a random locked tough word (EasyChatWords_TryUnlockRandomToughWord),
     * sets the var to its bank entry and buffers it into template slot `index`; -1 (0xffff) and no slot when all are unlocked.
     */
    try_buffer_and_unlock_random_tough_word: (t, _c, a) => {
      const picked = unlockRandomToughWord(r.registries, r.state.unlockedToughWords, () => r.rng());
      if (!picked) {
        dest(t, a[0], 0xffff);
        return 'continue';
      }
      r.state.unlockedToughWords = picked.bits;
      dest(t, a[0], picked.entry);
      t.slots[r.val(t, a[1])] = r.textOf(easyChatWordText(r.registries, easyChatWord(r.registries, 'TEXT_BANK_TOUGH_WORDS', picked.entry)));
      return 'continue';
    },
    /**
     * ScrCmd_DoGroupConnectionAction (the Jubilife City groups man), a logged stand-in: the record-mixing groups
     * (RecordMixedRNG) are not kept, so the collection stays as a new game has it (every entry empty). The checks give
     * FALSE (no entry is valid) and TRUE (an empty entry equals the empty override), the names buffer empty, and the
     * group naming screen is not offered: it reads as left empty (returnCode 1, "That's too bad"). Joining and making
     * a group are then unreachable.
     */
    do_group_connection_action: (t, _c, a) => {
      // The extra operands are raw u16s (the decoder gives them no kind): a var at 0x4000 and up, else a value.
      const raw = (i: number) => r.int(a[i]);
      const value = (i: number) => (raw(i) >= 0x4000 ? r.getVar(t, r.source('vars', raw(i))!) : raw(i));
      const set = (i: number, v: number) => r.setVar(t, r.source('vars', raw(i))!, v);
      const action = raw(0);
      r.log.stub('stub:do_group_connection_action', 'record-mixing groups are not kept: no group exists and none can be named');
      if (action === GC_ACTION.checkValid) set(2, 0);
      else if (action === GC_ACTION.checkOverride) set(2, 1);
      else if (action === GC_ACTION.bufferGroupName || action === GC_ACTION.bufferLeaderName) t.slots[value(2)] = '';
      else if (action === GC_ACTION.openNaming) set(1, 1);
      else throw new Error(`do_group_connection_action: action ${action} needs a group, and none exists`);
      return 'continue';
    },
  };
}
