/**
 * The Villa's script commands (docs/research/villa-journal.md §1.7; decomp scrcmd.c ScrCmd_InitPersistedMapFeaturesForVilla,
 * ScrCmd_CheckABPress, ScrCmd_SetScenePlayBGMMusicBox, ScrCmd_SetFieldScene; ov5_021F6454.c
 * ScrCmd_CheckMetFurnitureRequirements). The furniture itself is the world's map feature (world villa.ts). The TV
 * segments (`save_tv_segment_home_and_manor*`) stay counted stubs.
 */
import { newGameRecord, type VillaTables } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import type { Handler, Runner } from './runner.ts';

/** Decomp RECORD_* (generated/game_records.txt) the furniture gates read. */
const RECORD = { steps: 0, berriesPlanted: 4, eggsHatched: 11, towerWins: 29, battleground: 57, factoryWins: 60, castleWins: 61, hallWins: 62, arcadeWins: 63, hallOfFame: 73 } as const;
/** Decomp VILLA_FURNITURE_* + 1, as the script passes it. */
const GATE = { bust: 13, silverBust: 14, piano: 15, guestSet: 16, wallClock: 17, masterpiece: 18, chandelier: 20 } as const;
/** Decomp SEQ_PL_TOWN02: the music box's tune (Sound_SetSceneAndPlayBGM(SOUND_SCENE_VILLA_MUSIC_BOX, …)). */
const SEQ_MUSIC_BOX = 1218;
const PRINT_STATES = ['FACTORY', 'HALL', 'CASTLE', 'ARCADE', 'TOWER'].map((f) => `VAR_BATTLE_${f}_PRINT_STATE`);

/** `NewGame.villa`, required where a Villa command runs. */
export function villaTables(r: Runner): VillaTables {
  const v = newGameRecord(r.registries).villa;
  if (!v) throw new Error('the Villa needs NewGame.villa (the import reads overlay 5)');
  return v;
}

export function villaHandlers(r: Runner): Record<string, Handler> {
  const record = (id: number) => r.state.records.counts[id] ?? 0;
  const ns = () => newGameRecord(r.registries).id.split(':')[0]!;
  const seq = (n: number) => {
    const id = n ? r.source('sequences', n, false) : undefined;
    if (n && !id) r.log.stub('audio:sequence-missing', `no sequence with sourceIndex ${n} in the packs: not played`);
    return id ?? null;
  };
  return {
    /** InitPersistedMapFeaturesForVilla: the slot is the Villa's (a dummy, zeroed); every map load builds the furniture. */
    init_persisted_map_features_for_villa: () => (villaTables(r), r.field.initMapFeatures('villa'), 'continue'),
    /** TRUE unless the piece's gate is not met (any piece without a gate is TRUE). */
    check_met_furniture_requirements: (t, _c, a) => {
      const furniture = r.val(t, a[0]);
      let met = true;
      if (furniture === GATE.bust) met = [RECORD.towerWins, RECORD.factoryWins, RECORD.castleWins, RECORD.hallWins, RECORD.arcadeWins].every((id) => record(id) >= 1);
      else if (furniture === GATE.silverBust) met = PRINT_STATES.some((v) => r.getVar(t, `${ns()}:${v}` as Id) >= 2);
      else if (furniture === GATE.piano) met = record(RECORD.hallOfFame) >= 10;
      else if (furniture === GATE.guestSet) met = record(RECORD.battleground) >= 50;
      else if (furniture === GATE.wallClock) met = record(RECORD.berriesPlanted) >= 50;
      else if (furniture === GATE.masterpiece) met = record(RECORD.eggsHatched) >= 30;
      else if (furniture === GATE.chandelier) met = record(RECORD.steps) >= 300000;
      r.setVar(t, r.ref(a[1], 'var'), met ? 1 : 0);
      return 'continue';
    },
    /** A or B held this frame (gSystem.heldKeys). */
    check_ab_press: (t, _c, a) => (r.setVar(t, r.ref(a[0], 'var'), r.input.held.includes('a') || r.input.held.includes('b') ? 1 : 0), 'continue'),
    set_scene_play_bgm_music_box: () => (r.audio.playBgm(seq(SEQ_MUSIC_BOX)), 'continue'),
    /** Sound_SetSceneAndPlayBGM(SOUND_SCENE_FIELD, bgm): back to the field with the saved BGM. */
    set_field_scene: (t, _c, a) => (r.audio.playBgm(seq(r.val(t, a[0]))), 'continue'),
  };
}
