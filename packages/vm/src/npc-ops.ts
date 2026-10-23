/**
 * Small town and NPC rules (docs/research/villa-journal.md §4; decomp scrcmd.c, scrcmd_party.c): the wall Town Maps,
 * the field-poison survival, the Veilstone Store's regulars, the Pastoria scarf giver's condition read, the Combee
 * pair check, the meteorites' Deoxys forms, the Solaceon News Press and the Hallowed Tower's counter.
 */
import { dexOf, markCaught } from '@opensinnoh/contracts';
import { CONDITIONS, monGender, recalc, type Id } from '@opensinnoh/core';
import { localSeenCount } from '@opensinnoh/services';
import type { Handler, Runner, Thread } from './runner.ts';

/** Decomp VAR_NEWS_PRESS_DEADLINE, VAR_SPIRITOMB_COUNTER, VAR_DEPARTMENT_STORE_REGULAR_COUNTER (system vars by number). */
const VAR = { newsPress: 0x403b, spiritomb: 0x403e, departmentStore: 0x4042 } as const;
/** Decomp SPECIES_COMBEE, SPECIES_DEOXYS, SPECIES_PIKACHU. */
const SPECIES = { combee: 415, deoxys: 386, pikachu: 25 } as const;
/** SystemVars_GetDepartmentStoreBuyCount: a regular from five purchases. */
const REGULAR = 5;

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
  };
}
