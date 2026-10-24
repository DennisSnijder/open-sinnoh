/**
 * The daycare and egg commands (decomp src/scrcmd_daycare.c, scrcmd_party.c ScrCmd_GiveEgg, scrcmd.c
 * ScrCmd_HatchEgg and the daycare party menu, overlay005 ScrCmd_TryRevertPokemonForm) over core's daycare
 * rules (`egg.ts`). The daycare's party menu and the hatch scene are menu apps the script waits on.
 */
import { compatibilityLevel, createEgg, daycareFee, daycareLevel, daycareLevelsGained, daycareState, depositMon, eggFromDaycare, firstHatchingEgg, hatchEgg, monGender, PARTY_SIZE, withdrawMon, type Arg, type Id, type Pokemon } from '@opensinnoh/core';
import { addPoketchHistory, dexOf, giveItem, markCaught, newGameRecord, saveTvSegment } from '@opensinnoh/contracts';
import { revertForm, scoreCatch, shayminToLand, zoneLabel } from '@opensinnoh/services';
import { plainMarkup } from '@opensinnoh/text';
import type { Handler, Runner, Thread } from './runner.ts';

/** Decomp PARTY_SLOT_NONE. */
const PARTY_SLOT_NONE = 0xff;
/** Decomp ScrCmd_TryRevertPokemonForm: the Griseous Orb could not go back to the bag. */
const ORB_NOT_REMOVED = 0xff;
const local = (id: Id | null) => (id ? id.slice(id.indexOf(':') + 1) : '');

export function daycareHandlers(r: Runner): Record<string, Handler> {
  const dest = (t: Thread, a: Arg | undefined, v: number) => r.setVar(t, r.ref(a, 'var'), v);
  const val = (t: Thread, a: Arg | undefined) => r.val(t, a);
  const dex = () => dexOf(r.registries);
  const state = () => r.state;
  const daycare = () => r.state.daycare;
  const trainer = () => ({ otId: r.state.trainerId, otName: r.state.names.player, otGender: r.state.gender });
  const ball = () => newGameRecord(r.registries).pokeBall;
  const native = (species: Id) => {
    const n = r.registries.species.get(species)?.sourceIndex;
    if (n === undefined) throw new Error(`species ${species} has no sourceIndex`);
    return n;
  };
  /** Decomp StringTemplate_SetNickname: the nickname, an egg's name, or the species name. */
  const nickname = (m: Pokemon) => {
    if (m.isEgg) return plainMarkup(r.registries.species.get(`${m.species.slice(0, m.species.indexOf(':'))}:SPECIES_EGG` as Id)!.name);
    return plainMarkup(m.nickname ?? r.registries.species.get(m.species)!.name);
  };
  const daycareMon = (slot: number): Pokemon => {
    const m = daycare().mons[slot];
    if (!m) throw new Error(`daycare slot ${slot} is empty`);
    return m.mon;
  };
  const partyMon = (slot: number): Pokemon => {
    const m = state().party[slot];
    if (!m) throw new Error(`no party member ${slot} (party of ${state().party.length})`);
    return m;
  };
  const met = () => ({ zone: state().player.zone, level: 0, date: r.clock().date });
  /** The daycare party menu's pick until `get_day_care_party_menu_result` reads it (decomp SCRIPT_MANAGER_PARTY_MANAGEMENT_DATA). */
  let pick: number | null | undefined;

  return {
    // Decomp ov5_021E72BC: slot 0 = the first Pokémon's nickname, 1 = the second's, 2 = the first's OT name.
    buffer_daycare_mon_nicknames: (t) => {
      const [a, b] = daycare().mons;
      if (a) {
        t.slots[0] = nickname(a.mon);
        t.slots[2] = plainMarkup(a.mon.otName);
      }
      if (b) t.slots[1] = nickname(b.mon);
      return 'continue';
    },
    get_daycare_state: (t, _c, a) => (dest(t, a[0], daycareState(daycare())), 'continue'),
    check_daycare_has_egg: (t, _c, a) => (dest(t, a[0], daycare().offspring ? 1 : 0), 'continue'),
    reset_daycare_personality_and_step_counter: () => {
      daycare().offspring = 0;
      daycare().stepCounter = 0;
      return 'continue';
    },
    get_daycare_compatibility_level: (t, _c, a) => (dest(t, a[0], compatibilityLevel(dex(), daycare())), 'continue'),
    // Decomp Daycare_GiveEggFromDaycare: the script checked the party has room.
    give_egg_from_daycare: () => {
      if (state().party.length >= PARTY_SIZE) throw new Error('give_egg_from_daycare: the party is full');
      state().party.push(eggFromDaycare(dex(), daycare(), r.rngSource(), { trainer: trainer(), ball: ball(), met: met() }));
      return 'continue';
    },
    // Decomp ScrCmd_GiveEgg → Egg_CreateEgg (party only; nothing when it is full).
    give_egg: (t, _c, a) => {
      if (state().party.length >= PARTY_SIZE) return 'continue';
      state().party.push(createEgg(dex(), r.rngSource(), { species: r.source('species', val(t, a[0]))!, trainer: trainer(), ball: ball(), met: met() }));
      return 'continue';
    },
    // Decomp ScrCmd_OpenPartyMenuForDaycare + GetDayCarePartyMenuResult: the app handles SUMMARY itself, so the
    // summary flag is always 0 (the script's SetMonSummary loop is not taken).
    open_party_menu_for_daycare: (_t, c) =>
      r.openApp(c, { app: 'daycare-select' }, (result) => {
        if (result.app !== 'daycare-select') throw new Error(`open_party_menu_for_daycare: got a ${result.app} result`);
        pick = result.slot;
      }),
    get_day_care_party_menu_result: (t, _c, a) => {
      const slot = pick;
      if (slot === undefined) throw new Error('get_day_care_party_menu_result: no daycare party menu ran');
      pick = undefined;
      dest(t, a[0], slot ?? PARTY_SLOT_NONE);
      dest(t, a[1], 0);
      return 'continue';
    },
    try_revert_pokemon_form: (t, _c, a) => {
      const slot = val(t, a[0]);
      dest(t, a[1], 0);
      if (slot === PARTY_SLOT_NONE) return 'continue';
      const m = partyMon(slot);
      if (local(m.heldItem) === 'ITEM_GRISEOUS_ORB') {
        if (!giveItem(state(), r.registries, m.heldItem!, 1)) {
          dest(t, a[1], ORB_NOT_REMOVED);
          return 'continue';
        }
        m.heldItem = null;
      }
      revertForm(r.registries, m);
      return 'continue';
    },
    // Decomp Party_StringTemplateSetNicknameReturnSpecies (the first operand is unused).
    buffer_party_mon_nickname_return_species: (t, _c, a) => {
      const m = partyMon(val(t, a[1]));
      t.slots[0] = nickname(m);
      dest(t, a[2], native(m.species));
      return 'continue';
    },
    store_party_mon_into_daycare: (t, _c, a) => {
      const slot = val(t, a[0]);
      const m = partyMon(slot);
      if (m.isEgg) throw new Error('store_party_mon_into_daycare: an egg');
      // Decomp Daycare_MoveToDaycareMonFromParty: a Sky Forme Shaymin is stored as Land.
      shayminToLand(r.registries, [m]);
      state().party.splice(slot, 1);
      depositMon(dex(), daycare(), m);
      return 'continue';
    },
    // Decomp Daycare_BufferGainedLevelsInSlot: 0 for an empty slot.
    buffer_daycare_gained_levels_by_slot: (t, _c, a) => {
      const slot = val(t, a[1]);
      if (!daycare().mons[slot]) return (dest(t, a[0], 0), 'continue');
      const levels = daycareLevelsGained(dex(), daycare(), slot);
      t.slots[0] = nickname(daycareMon(slot));
      t.slots[1] = String(levels);
      dest(t, a[0], levels);
      return 'continue';
    },
    // Decomp Daycare_BufferNicknameLevelGender: the level after the steps' exp; no gender mark for an un-nicknamed Nidoran.
    buffer_daycare_nickname_level_gender: (t, _c, a) => {
      const slot = val(t, a[3]);
      const m = daycareMon(slot);
      t.slots[val(t, a[0])] = nickname(m);
      t.slots[val(t, a[1])] = String(daycareLevel(dex(), daycare(), slot));
      let gender = monGender(dex(), m);
      if (m.nickname === null && (local(m.species) === 'SPECIES_NIDORAN_F' || local(m.species) === 'SPECIES_NIDORAN_M')) gender = 'none';
      t.slots[val(t, a[2])] = gender === 'male' ? '♂' : gender === 'female' ? '♀' : '';
      return 'continue';
    },
    buffer_daycare_price_by_slot: (t, _c, a) => {
      const slot = val(t, a[1]);
      const fee = daycareFee(dex(), daycare(), slot);
      t.slots[0] = nickname(daycareMon(slot));
      t.slots[1] = String(fee);
      dest(t, a[0], fee);
      return 'continue';
    },
    // Decomp Daycare_MoveToPartyFromDaycareSlot: the nickname in slot 0, the species to the var.
    move_mon_to_party_from_daycare_slot: (t, _c, a) => {
      const slot = val(t, a[1]);
      if (state().party.length >= PARTY_SIZE) throw new Error('move_mon_to_party_from_daycare_slot: the party is full');
      t.slots[0] = nickname(daycareMon(slot));
      const m = withdrawMon(dex(), daycare(), slot);
      state().party.push(m);
      dest(t, a[0], native(m.species));
      return 'continue';
    },
    // Decomp ScrCmd_HatchEgg → FieldTask_HatchEgg: the first egg with no cycles left hatches (Egg_CreateHatchedMon,
    // met here and today, the Pokédex's caught mark), the scene runs, then the nickname from the naming screen.
    hatch_egg: (_t, c) => {
      const slot = firstHatchingEgg(state().party);
      if (slot < 0) throw new Error('hatch_egg: no party egg is ready to hatch');
      // FieldSystem_HatchEgg: the Happy Happy Egg Club's segment (the party's first Egg, here).
      const egg = state().party.find((p) => p.isEgg)!;
      saveTvSegment(state(), { kind: 'egg', species: egg.species, location: zoneLabel(r.registries, state().player.zone) });
      const m = state().party[slot]!;
      hatchEgg(dex(), m, { ball: ball(), zone: state().player.zone, date: r.clock().date });
      // Decomp egg_hatch.c → SaveData_UpdateCatchRecords: a first catch of the species scores (CAUGHT_SPECIES), the Pokédex, the Pokétch history.
      scoreCatch(state(), r.registries, m.species);
      markCaught(state(), r.registries, m);
      addPoketchHistory(state(), m);
      return r.openApp(c, { app: 'hatch', slot }, (result) => {
        if (result.app !== 'hatch') throw new Error(`hatch_egg: got a ${result.app} result`);
        if (result.nickname !== null) m.nickname = result.nickname;
      });
    },
  };
}
