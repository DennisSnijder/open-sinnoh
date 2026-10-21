/**
 * The Distortion World script commands (scrcmd.c), thin wrappers over the
 * world's Distortion World feature. 'continue' where the decomp handler returns FALSE.
 */
import type { Handler, Runner } from './runner.ts';

/** dw_warp.c: the fade in (16 frames), DWARP_ANM_DURATION + 1 frames with the sound at the 16th, the fade out (20). */
const DW_WARP = { fadeIn: 16, loop: 86, sound: 15, fadeOut: 21 } as const;
/** SEQ_SE_PL_SYUWA2's decomp number is resolved by name. */
const DW_WARP_SOUND = 'SEQ_SE_PL_SYUWA2';

export function dwHandlers(r: Runner): Record<string, Handler> {
  return {
    /** ScrCmd_InitPersistedMapFeaturesForDistortionWorld (each room's onTransition): select and clear the slot. */
    init_persisted_map_features_for_distortion_world: () => (r.field.initMapFeatures('distortion-world'), 'continue'),
    /**
     * ScrCmd_GetPlayer3DPos: the map object's tile X and Z, and its Y grid (height / 8) halved: whole tiles of
     * height in the Distortion World's shared space.
     */
    /** ScrCmd_AddDistortionWorldMapObject / ScrCmd_DeleteDistortionWorldMapObject. */
    add_distortion_world_map_object: (t, _c, a) => (r.field.distortionObject(r.val(t, a[0]), true), 'continue'),
    delete_distortion_world_map_object: (t, _c, a) => (r.field.distortionObject(r.val(t, a[0]), false), 'continue'),
    reset_distortion_world_persisted_camera_angles: () => (r.field.resetDistortionCameraAngles(), 'continue'),
    /** ScrCmd_StartDistortionWorldGiratinaShadowEvent (event index) / ScrCmd_FinishDistortionWorldGiratinaShadowEvent. */
    start_distortion_world_giratina_shadow_event: (t, _c, a) => (r.field.giratinaShadowEvent(r.val(t, a[0])), 'continue'),
    finish_distortion_world_giratina_shadow_event: () => (r.field.giratinaShadowEvent(null), 'continue'),
    /**
     * ScrCmd_DoDWWarp: the Distortion World warp application runs until it exits (its timeline: fade in, the warp
     * with its sound, fade out). Its standalone scene replaces the field, including the field's held fade.
     */
    do_dw_warp: (_t, c) => {
      let frame = 0;
      const present = () => r.field.setStoryScene({ kind: 'dw-warp', phase: 'warp', tick: frame, actors: [], brightness: 0 });
      present();
      const sound = r.namedSequence(DW_WARP_SOUND);
      return r.pause(c, () => {
        if (frame === DW_WARP.fadeIn + DW_WARP.sound) {
          if (sound) r.audio.playSe(sound);
        }
        if (++frame >= DW_WARP.fadeIn + DW_WARP.loop + DW_WARP.fadeOut) {
          r.field.setStoryScene(null);
          return true;
        }
        present();
        return false;
      });
    },
    get_player3_d_pos: (t, _c, a) => {
      const p = r.field.player();
      r.setVar(t, r.ref(a[0], 'var'), p.x);
      r.setVar(t, r.ref(a[1], 'var'), Math.trunc(Math.trunc(p.y / 8) / 2));
      r.setVar(t, r.ref(a[2], 'var'), p.z);
      return 'continue';
    },
  };
}
