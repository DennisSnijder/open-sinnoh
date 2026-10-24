/**
 * The Jubilife TV gallery's script commands (decomp scripts_jubilife_tv_2f_gallery.s; scrcmd.c ScrCmd_0A6,
 * ScrCmd_SetDressUpPhotoTitle, ScrCmd_DressUpPhotoHasData, ScrCmd_ShowDressUpPhoto, ImageClipsSlotHasData, and
 * ScrCmd_BufferCustomMessageWord for the title's line). The photos are
 * `GameState.dressUpPhotos` (decomp ImageClips savedPhotos); offline only slot 0 is ever written, by the dress-up app.
 */
import { easyChatWordText, WORD_NONE } from '@opensinnoh/services';
import type { Handler, Runner } from './runner.ts';

export function galleryHandlers(r: Runner): Record<string, Handler> {
  const photo = (op: string, slot: number) => {
    if (!Number.isInteger(slot) || slot < 0 || slot >= r.state.dressUpPhotos.length) throw new Error(`${op}: no gallery slot ${slot}`);
    return r.state.dressUpPhotos[slot];
  };
  return {
    /**
     * ScrCmd_0A6 (sub_0203DAC0 → sub_0203DA64): party slot `slot`'s Pokémon in the gallery's dress-up (overlay022
     * ov22_02255D44); the third operand is 1 the first time (the help first). The var is 1 when the photo was saved, else 0.
     */
    scr_cmd_0a6: (t, c, a) => {
      const slot = r.val(t, a[0]);
      const dest = r.ref(a[1], 'var');
      return r.openApp(c, { app: 'gallery-dress-up', slot, first: r.val(t, a[2]) === 1 }, (res) => {
        if (res.app !== 'gallery-dress-up') throw new Error(`scr_cmd_0a6: got ${res.app}`);
        r.setVar(t, dest, res.saved ? 1 : 0);
      });
    },
    /** ScrCmd_SetDressUpPhotoTitle: photo slot 0's title, one Easy Chat word (DressUpPhoto_SetTitle). */
    set_dress_up_photo_title: (t, _c, a) => {
      const p = photo('set_dress_up_photo_title', 0);
      if (!p) throw new Error('set_dress_up_photo_title: the gallery has no photo in slot 0');
      p.title = r.val(t, a[0]);
      return 'continue';
    },
    /** ScrCmd_BufferCustomMessageWord: an Easy Chat word into template slot `idx` (StringTemplate_SetCustomMessageWord; none is empty). */
    buffer_custom_message_word: (t, _c, a) => {
      const word = r.val(t, a[1]);
      t.slots[r.val(t, a[0])] = word === WORD_NONE ? '' : r.textOf(easyChatWordText(r.registries, word));
      return 'continue';
    },
    /** ScrCmd_DressUpPhotoHasData: ImageClipsSlotHasData(…, dress-up photos, slot). */
    dress_up_photo_has_data: (t, _c, a) => (r.setVar(t, r.ref(a[1], 'var'), photo('dress_up_photo_has_data', r.int(a[0])) ? 1 : 0), 'continue'),
    /** ScrCmd_ShowDressUpPhoto (sub_02041DC8): the photo viewer in its dress-up mode; the var is 1 when the slot is empty (no viewer), else 0. */
    show_dress_up_photo: (t, c, a) => {
      const slot = r.int(a[0]);
      const dest = r.ref(a[1], 'var');
      if (!photo('show_dress_up_photo', slot)) {
        r.setVar(t, dest, 1);
        return 'continue';
      }
      r.setVar(t, dest, 0);
      return r.openApp(c, { app: 'gallery-photo', slot }, () => {});
    },
  };
}
