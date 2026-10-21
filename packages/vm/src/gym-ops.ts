/**
 * The gym puzzle commands: thin wrappers over the world's map
 * features (`FieldHost.initMapFeatures`, the Eterna clock task). Names and behaviour follow the decomp
 * handlers (scrcmd.c); 'continue' where they return FALSE, 'yield' where they return TRUE.
 */
import { newGameRecord } from '@opensinnoh/contracts';
import type { TextPrinter } from '@opensinnoh/text';
import type { Handler, Runner } from './runner.ts';

export function gymHandlers(r: Runner): Record<string, Handler> {
  return {
    init_persisted_map_features_for_sunyshore_gym: (_t, _c, a) => (r.field.initSunyshoreGym(r.int(a[0])), 'continue'),
    press_sunyshore_gym_button: (_t, c, a) => {
      r.field.pressSunyshoreGymButton(r.int(a[0]));
      const sound = r.namedSequence('SEQ_SE_DP_GAGAGA');
      if (sound) r.audio.playSe(sound);
      return r.pause(c, () => r.field.sunyshoreGymButtonDone());
    },
    /** ScrCmd_InitPersistedMapFeaturesFor*Gym (from onTransition): select and clear the saved slot. */
    init_persisted_map_features_for_eterna_gym: () => (r.field.initMapFeatures('eterna-gym'), 'continue'),
    init_persisted_map_features_for_hearthome_gym: () => (r.field.initMapFeatures('hearthome-gym'), 'continue'),
    init_persisted_map_features_for_veilstone_gym: () => (r.field.initMapFeatures('veilstone-gym'), 'continue'),
    init_persisted_map_features_for_pastoria_gym: () => (r.field.initMapFeatures('pastoria-gym'), 'continue'),
    init_persisted_map_features_for_canalave_gym: () => (r.field.initMapFeatures('canalave-gym'), 'continue'),

    /**
     * ScrCmd_PressPastoriaGymButton → PastoriaGym_PressButton: the water task runs as a call on the script's
     * field task (FieldTask_InitCall), so the script waits for it; the command returns TRUE.
     */
    /**
     * ScrCmd_PlayBoatCutscene (literal travel direction, exit direction, map, x, z) → FieldSystem_PlayBoatCutscene:
     * a nested field task, so the script waits for the whole trip.
     */
    play_boat_cutscene: (t, c, a) => {
      const exit = (['up', 'down', 'left', 'right'] as const)[r.int(a[1])];
      if (!exit) throw new Error(`play_boat_cutscene: exit direction ${r.int(a[1])}`);
      r.field.playBoatCutscene(r.int(a[0]), exit, r.source('zones', r.val(t, a[2]))!, r.val(t, a[3]), r.val(t, a[4]));
      return r.pause(c, () => r.field.boatCutsceneDone());
    },
    press_pastoria_gym_button: (_t, c) => {
      r.field.pressPastoriaGymButton();
      return r.pause(c, () => r.field.pastoriaGymButtonDone());
    },

    /**
     * ScrCmd_AdvanceEternaGymClock → EternaGym_AdvanceClockState. The clock task runs as a call on the script's
     * own field task, so the script waits for it. At the leader state nothing starts and the command still
     * returns TRUE (one frame). The task prints the script bank's fountain message itself (FieldMessage_Print,
     * text speed, A/B speeds it up), waits for a new A or B once it has printed, then removes the window.
     */
    advance_eterna_gym_clock: (t, c) => {
      if (!r.field.advanceEternaGymClock()) return 'yield';
      const text = newGameRecord(r.registries).gyms?.eterna.message;
      if (!text) throw new Error('advance_eterna_gym_clock: NewGame.gyms has no Eterna Gym message');
      let printer: TextPrinter | null = null;
      let printed = false;
      return r.pause(c, (input) => {
        const phase = r.field.eternaGymClock();
        if (phase === 'done') return true;
        if (phase !== 'message') return false;
        if (!printer) {
          printer = r.showMessage(t, text, r.textSpeed());
          return false;
        }
        if (!printed) {
          // FieldMessage_FinishedPrinting, then the same frame's JOY_NEW check (case 11 falls into 12).
          if (!printer.done) return false;
          printed = true;
          r.ui.buttonWait = true;
        }
        if (!input.pressed.includes('a') && !input.pressed.includes('b')) return false;
        r.ui.message = null;
        r.ui.buttonWait = false;
        printer = null;
        printed = false;
        r.field.eternaGymClockContinue();
        return false;
      });
    },
  };
}
