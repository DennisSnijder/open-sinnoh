/**
 * Rotom's forms, the titans' and Regigigas's party checks, the fateful
 * encounter, the summary's teach-move continuation and Route 224's tablet. Names and behaviour follow the decomp
 * handlers (scrcmd.c, overlay005/ov5_021F6454.c, scrcmd_strings.c, unk_0205DFC4.c); 'continue' where they return
 * FALSE, 'yield' where they return TRUE. The form rules themselves are services' (forms.ts).
 */
import type { Arg, Pokemon } from '@opensinnoh/core';
import { markCaught, TABLET_NAME_LENGTH } from '@opensinnoh/contracts';
import { bySource, isSpecies, setRotomForm, SPECIES } from '@opensinnoh/services';
import { scriptBattle } from './m2a-ops.ts';
import type { Handler, Runner, Thread } from './runner.ts';

/** Decomp PARTY_SLOT_NONE and LEARNED_MOVES_MAX (the summary's "no move picked"). */
const PARTY_SLOT_NONE = 0xff;
const LEARNED_MOVES_MAX = 4;
/** Decomp ROTOM_FORM_HEAT, _WASH, _FROST, _FAN, _MOW: GetRotomFormsInSave's five vars, in that order. */
const ROTOM_FORMS_IN_ORDER = [1, 2, 3, 4, 5];
/** Decomp NAMING_SCREEN_CODE_OK / NAMING_SCREEN_CODE_NO_INPUT: what `open_shaymin_tablet_naming_screen` writes. */
const NAMING_OK = 0;
const NAMING_NO_INPUT = 1;

export function formHandlers(r: Runner): Record<string, Handler> {
  const val = (t: Thread, a: Arg | undefined) => r.val(t, a);
  const dest = (t: Thread, a: Arg | undefined, v: number) => r.setVar(t, r.ref(a, 'var'), v);
  const partyMon = (op: string, slot: number): Pokemon => {
    const m = r.state.party[slot];
    if (!m) throw new Error(`${op}: no Pokémon in party slot ${slot}`);
    return m;
  };
  const isRotom = (m: Pokemon | null | undefined): m is Pokemon => !!m && !m.isEgg && isSpecies(r.registries, m, SPECIES.rotom);
  /** The summary's pick (`open_summary_screen_teach_move`) until `get_summary_selected_move_slot` reads it; undefined when none is pending. */
  let summaryPick: number | null | undefined;

  return {
    /**
     * ScrCmd_SetRotomForm: the party Rotom's form and appliance move (forms.ts `setRotomForm`, which keeps a slot to
     * replace in `moveSlot`), then the Pokédex records the form (Pokedex_Capture). The third operand is unused.
     */
    set_rotom_form: (t, _c, a) => {
      const mon = partyMon('set_rotom_form', val(t, a[0]));
      setRotomForm(r.registries, mon, val(t, a[3]), val(t, a[1]));
      markCaught(r.state, r.registries, mon);
      return 'continue';
    },

    /**
     * ScrCmd_GetRotomFormsInSave (SaveData_GetRotomFormsInSave): whether a Rotom in each appliance form is in the
     * party, the Day Care or the PC (eggs not counted). TRUE.
     */
    get_rotom_forms_in_save: (t, _c, a) => {
      const s = r.state;
      const mons = [...s.party, ...s.daycare.mons.map((d) => d?.mon ?? null), ...s.boxes.flatMap((b) => b.slots)];
      const forms = new Set(mons.filter(isRotom).map((m) => m.form));
      ROTOM_FORMS_IN_ORDER.forEach((form, i) => dest(t, a[i], forms.has(form) ? 1 : 0));
      return 'yield';
    },

    /** ScrCmd_GetPartyRotomCountAndFirst: how many party Rotom are in an appliance form, and the first one's slot (PARTY_SLOT_NONE). */
    get_party_rotom_count_and_first: (t, _c, a) => {
      const slots = r.state.party.flatMap((m, i) => (isRotom(m) && m.form !== 0 ? [i] : []));
      dest(t, a[0], slots.length);
      dest(t, a[1], slots[0] ?? PARTY_SLOT_NONE);
      return 'continue';
    },

    /** ScrCmd_CheckHasAllLegendaryTitansInParty (HasAllLegendaryTitansInParty): Regirock, Regice and Registeel are all in the party (by species, eggs too). */
    check_has_all_legendary_titans_in_party: (t, _c, a) => {
      const titans = [SPECIES.regirock, SPECIES.regice, SPECIES.registeel];
      dest(t, a[0], titans.every((s) => r.state.party.some((m) => isSpecies(r.registries, m, s))) ? 1 : 0);
      return 'continue';
    },

    /** ScrCmd_CheckPartyHasFatefulEncounterRegigigas: a party Regigigas (not an egg) with the fateful-encounter bit. */
    check_party_has_fateful_encounter_regigigas: (t, _c, a) => {
      dest(t, a[0], r.state.party.some((m) => !m.isEgg && isSpecies(r.registries, m, SPECIES.regigigas) && m.fatefulEncounter) ? 1 : 0);
      return 'continue';
    },

    /** ScrCmd_FindPartySlotWithFatefulEncounterSpecies: the first party slot (not an egg) of that species with the fateful bit, else 0xFF (Floaroma's Gracidea). */
    find_party_slot_with_fateful_encounter_species: (t, _c, a) => {
      const species = r.source('species', val(t, a[1]), false);
      const slot = r.state.party.findIndex((m) => !m.isEgg && m.species === species && m.fatefulEncounter);
      dest(t, a[0], slot < 0 ? PARTY_SLOT_NONE : slot);
      return 'continue';
    },

    /**
     * ScrCmd_StartFatefulEncounter (Encounter_NewFatefulVsSpeciesAtLevel, isLegendary TRUE): a scripted wild battle
     * whose Pokémon carries the fateful-encounter bit (Shaymin in Flower Paradise), the result kept for the script.
     */
    start_fateful_encounter: (t, c, a) => {
      const species = r.source('species', val(t, a[0]))!;
      return scriptBattle(r, t, c, { kind: 'legendary', trainers: [], wild: [{ species, level: val(t, a[1]) & 0xff, fateful: true }] });
    },

    /**
     * ScrCmd_OpenSummaryScreenTeachMove: the summary of party slot `a[0]` picking a move to forget for move `a[1]`
     * (the `summary-teach` app); the script waits for it.
     */
    open_summary_screen_teach_move: (t, c, a) => {
      const slot = val(t, a[0]);
      partyMon('open_summary_screen_teach_move', slot);
      const move = bySource(r.registries, 'moves', val(t, a[1]));
      if (!move) throw new Error(`open_summary_screen_teach_move: no move ${val(t, a[1])}`);
      return r.openApp(c, { app: 'summary-teach', slot, move }, (result) => {
        if (result.app !== 'summary-teach') throw new Error(`open_summary_screen_teach_move: got a ${result.app} result`);
        summaryPick = result.forget;
      });
    },
    /** ScrCmd_GetSummarySelectedMoveSlot: the move slot picked, LEARNED_MOVES_MAX for none. TRUE. */
    get_summary_selected_move_slot: (t, _c, a) => {
      if (summaryPick === undefined) throw new Error('get_summary_selected_move_slot: no summary ran (open_summary_screen_teach_move)');
      dest(t, a[0], summaryPick ?? LEARNED_MOVES_MAX);
      summaryPick = undefined;
      return 'yield';
    },

    /**
     * ScrCmd_OpenShayminTabletNamingScreen: the naming screen for Route 224's tablet. A word is kept as
     * `GameState.tabletName` (MiscSaveBlock_SetTabletName) and the var reads NAMING_SCREEN_CODE_OK; an empty entry
     * keeps the old word and reads NO_INPUT.
     */
    open_shaymin_tablet_naming_screen: (t, c, a) => {
      const v = r.ref(a[0], 'var');
      return r.openApp(c, { app: 'naming', kind: 'tablet', initial: '', maxLength: TABLET_NAME_LENGTH, gender: r.state.gender, pokemon: null }, (result) => {
        if (result.app !== 'naming') throw new Error(`open_shaymin_tablet_naming_screen: got a ${result.app} result`);
        if (result.name !== null) r.state.tabletName = result.name;
        r.setVar(t, v, result.name === null ? NAMING_NO_INPUT : NAMING_OK);
      });
    },
    /** ScrCmd_BufferTabletName: the tablet's word into buffer `a[0]` (empty before one is written). */
    buffer_tablet_name: (t, _c, a) => {
      t.slots[r.int(a[0])] = r.state.tabletName ?? '';
      return 'continue';
    },
    /** ScrCmd_SetPlayerVolume: the field player's volume (Sound_SetPlayerVolume(PLAYER_FIELD, …)). */
    set_player_volume: (t, _c, a) => {
      r.audio.setFieldVolume(val(t, a[0]));
      return 'continue';
    },
  };
}
