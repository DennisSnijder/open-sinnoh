/**
 * The Jubilife TV gallery (decomp scripts_jubilife_tv_2f_gallery.s): the dress-up (ScrCmd_0A6 → sub_0203DAC0 → overlay022
 * ov22_02255D44 / ov22_02255E50 / ov22_02256098) and the frames' photo viewer (ScrCmd_ShowDressUpPhoto → ov22_0225B660 in
 * its dress-up mode).
 *
 * The dress-up is the visual round's case and stage (contest/dress-up.ts) in its gallery mode: ten accessories, no
 * clock, the Pokémon at (192, 56) and movable, the field's BGM going on (SOUND_SCENE_SUB_53 with SEQ_NONE).
 * - ov22_02255E50 states 0–2: the screen fades in. 3–5, the first time only: bank 385 message 47 in the top screen's
 *   window, its pages on A, B or a touch; then 48 (empty).
 * - 6: the dress-up until DONE. 7 (ov22_02256C48 → ov22_02256C70): the case turns to an empty page, the background darkens,
 *   the buttons slide down (8 px a frame for 8 frames), the stage moves to the photo's place ((−8, +5) a frame for 8
 *   frames), the photo's background (imageclip 123/124) and the touch YES/NO with message 1 come up, the background
 *   lightens.
 * - 8: YES/NO (ov22_02257278). NO: 10, the way back (ov22_02256DB8 → ov22_02256DE0) to the dress-up. YES: 9, message 2
 *   and YES/NO again (ov22_022575B4, ov22_02257624): YES saves, NO does not; either fades out (11–12) and closes.
 * - ov22_02256098: a save writes the photo (ov22_02256F38: DressUpPhoto_Init, the Pokémon and its place, the trainer's
 *   name and gender, every accessory on the stage, the backdrop; the title stays empty for SetDressUpPhotoTitle) and
 *   TRAINER_SCORE_EVENT_UNK_07.
 * A touch button's press animates for 6 frames before it counts (YesNoTouchMenu_ProcessInput). Keys (not DS: the
 * YES/NO is touch only): up/down choose, A takes the choice, B is NO.
 *
 * The case's scatter uses the DS's MTRNG: here a local LCRNG seeded from the game's stream (read, not drawn).
 */
import type { DressUpPhoto, GalleryDressUpView, GalleryPhotoView } from '@opensinnoh/contracts';
import { contestTables, easyChatWordText, incrementTrainerScore } from '@opensinnoh/services';
import type { Id } from '@opensinnoh/core';
import { menuSe, type MenuContext } from './context.ts';
import type { Screen, Step } from './stack.ts';
import { dressUpStage, msg385, STAGE_TEXTS } from './contest/dress-up.ts';
import { contestPicture, PHOTO_FRAME, PHOTO_SHIFT } from './contest/picture.ts';

/** Bank 385: DONE!, the two questions, the first time's help, the viewer's title line. */
const GALLERY = { done: msg385(0), finished: msg385(1), save: msg385(2), help: msg385(47), title: msg385(45) } as const;
export const GALLERY_TEXTS = [...STAGE_TEXTS, ...Object.values(GALLERY)];
/** The accessories the gallery's stage holds (ov22_02256708(…, 10, …); decomp PHOTO_ACCESSORY_COUNT). */
const LIMIT = 10;
/** Decomp TRAINER_SCORE_EVENT_UNK_07. */
const SCORE_EVENT = 7;
/** SEQ_SE_DP_BUTTON9 (YesNoTouchMenu_ButtonPressedCallback); SE_CONFIRM (a message page, sequence 1500). */
const SE = { button: 'SEQ_SE_DP_BUTTON9', confirm: 1500 } as const;
/** Frames: a screen fade (speed 6), the case's page turn, a brightness change (8 steps), the buttons' and the stage's slides, a touch button's press. */
const FADE = 8;
const CASE_TURN = 8;
const SHADE = 8;
const SLIDE = 8;
const STAGE_SLIDE = 9;
const PRESS = 6;
/** The stage's move per frame (ov22_02257098(…, −8, 5, 8)) and the buttons' (ov22_02259FC4(…, 0, 8)). */
const STEP = { x: PHOTO_SHIFT.x / SLIDE, y: PHOTO_SHIFT.y / SLIDE, buttons: 8 } as const;

/** The finish's timeline (ov22_02256C70) and its way back (ov22_02256DE0), by frame. */
const TO_PHOTO = { caseTurn: 0, darken: CASE_TURN, buttons: CASE_TURN + SHADE, stage: CASE_TURN + SHADE + SLIDE, lighten: CASE_TURN + SHADE + SLIDE + STAGE_SLIDE, end: CASE_TURN + 2 * SHADE + SLIDE + STAGE_SLIDE } as const;
const BACK = { darken: 0, stage: SHADE, buttons: SHADE + STAGE_SLIDE, lighten: SHADE + STAGE_SLIDE + SLIDE, caseTurn: 2 * SHADE + STAGE_SLIDE + SLIDE, end: 2 * SHADE + STAGE_SLIDE + SLIDE + CASE_TURN } as const;

function checkTexts(ctx: MenuContext, names: readonly string[], what: string): void {
  const missing = names.filter((n) => !ctx.registries.texts.has(ctx.text.id(n)));
  if (missing.length) throw new Error(`${what}: the pack has no text ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}`);
}

export function galleryDressUpScreen(ctx: MenuContext, slot: number, first: boolean): Screen {
  const mon = ctx.state.party[slot];
  if (!mon) throw new Error(`gallery dress-up: no Pokémon in party slot ${slot}`);
  if (mon.isEgg) throw new Error(`gallery dress-up: party slot ${slot} holds an Egg`);
  checkTexts(ctx, GALLERY_TEXTS, 'gallery dress-up');
  const t = ctx.text;
  const ns = t.ns;
  const sound = ctx.host.sound;
  const se = (name: string) => {
    if (!sound) return;
    const id = `${ns}:${name}` as Id;
    if (ctx.registries.sequences.has(id)) sound.playSe(id);
    else ctx.log.stub('audio:sequence-missing', `no sequence ${id} in the packs: not played`);
  };
  const stage = dressUpStage({
    registries: ctx.registries,
    tables: contestTables(ctx.registries),
    fashionCase: ctx.state.fashionCase,
    mon,
    limit: LIMIT,
    seed: ctx.state.rng.seed,
    se,
    line: (name) => t.messagePages(name).join(' '),
    gallery: true,
    label: 'gallery dress-up',
  });

  type Phase = 'fade-in' | 'intro' | 'dress' | 'to-photo' | 'confirm' | 'back' | 'fade-out';
  let phase: Phase = 'fade-in';
  let timer = 0;
  let fade = 16;
  let message: { pages: string[]; page: number } | null = null;
  let question: { which: 'finished' | 'save'; cursor: 'yes' | 'no'; pressed: 'yes' | 'no' | null; frames: number } | null = null;
  let saved = false;

  // The finish's look by its frame (to the photo's place, or back from it).
  const look = { shade: 0, buttons: 0, slide: 0, caseShown: true, photoBg: false };
  const toPhoto = (k: number) => {
    look.caseShown = k < TO_PHOTO.caseTurn + CASE_TURN / 2;
    if (k >= TO_PHOTO.darken && k < TO_PHOTO.buttons) look.shade = Math.round((16 * (k - TO_PHOTO.darken + 1)) / SHADE);
    if (k >= TO_PHOTO.buttons && k < TO_PHOTO.stage) look.buttons = k - TO_PHOTO.buttons + 1;
    if (k >= TO_PHOTO.stage && k < TO_PHOTO.lighten) look.slide = Math.min(SLIDE, k - TO_PHOTO.stage + 1);
    if (k === TO_PHOTO.lighten) {
      look.photoBg = true;
      question = { which: 'finished', cursor: 'yes', pressed: null, frames: 0 };
    }
    if (k >= TO_PHOTO.lighten) look.shade = 16 - Math.round((16 * (k - TO_PHOTO.lighten + 1)) / SHADE);
  };
  const back = (k: number) => {
    if (k < BACK.stage) look.shade = Math.round((16 * (k + 1)) / SHADE);
    if (k === BACK.stage) {
      look.photoBg = false;
      question = null;
    }
    if (k >= BACK.stage && k < BACK.buttons) look.slide = Math.max(0, SLIDE - (k - BACK.stage + 1));
    if (k >= BACK.buttons && k < BACK.lighten) look.buttons = SLIDE - (k - BACK.buttons + 1);
    if (k >= BACK.lighten && k < BACK.caseTurn) look.shade = 16 - Math.round((16 * (k - BACK.lighten + 1)) / SHADE);
    if (k >= BACK.caseTurn) look.caseShown = k >= BACK.caseTurn + CASE_TURN / 2;
  };

  // ov22_02256098: the save.
  const save = () => {
    const shot = stage.galleryPhoto();
    const photo: DressUpPhoto = {
      mon: { species: mon.species, form: mon.form, pid: mon.pid, otId: mon.otId, nickname: mon.nickname, x: shot.x, y: shot.y },
      trainerName: ctx.state.names.player,
      trainerGender: ctx.state.gender,
      dressUp: shot.dressUp,
      title: null,
    };
    ctx.state.dressUpPhotos[0] = photo;
    incrementTrainerScore(ctx.state, ctx.registries, SCORE_EVENT);
  };

  const answer = (yes: boolean) => {
    const q = question!;
    if (q.which === 'finished') {
      if (yes) question = { which: 'save', cursor: 'yes', pressed: null, frames: 0 };
      else {
        phase = 'back';
        timer = 0;
      }
      return;
    }
    saved = yes;
    if (yes) save();
    question = null;
    phase = 'fade-out';
    timer = 0;
  };
  const press = (which: 'yes' | 'no') => {
    const q = question!;
    q.pressed = which;
    q.cursor = which;
    q.frames = 0;
    se(SE.button);
  };

  return {
    tick(f): Step {
      stage.tick();
      switch (phase) {
        case 'fade-in':
          fade = Math.max(0, 16 - Math.round((16 * ++timer) / FADE));
          if (fade === 0) {
            if (first) {
              phase = 'intro';
              message = { pages: t.messagePages(GALLERY.help), page: 0 };
            } else phase = 'dress';
          }
          return;
        case 'intro': {
          const m = message!;
          if (!(f.pressed.includes('a') || f.pressed.includes('b') || f.tap === 'next' || (f.tap?.startsWith('dress:') ?? false))) return;
          menuSe(ctx, SE.confirm);
          if (m.page + 1 < m.pages.length) m.page++;
          else {
            // Message 48 is empty: the window clears.
            message = null;
            phase = 'dress';
          }
          return;
        }
        case 'dress':
          // ov22_02255E50 state 6: DONE seen ends the dress-up's input (ov22_02256C48).
          if (stage.done) {
            stage.release();
            phase = 'to-photo';
            timer = 0;
            toPhoto(0);
            stage.moveReturning();
            return;
          }
          stage.input(f);
          stage.moveReturning();
          return;
        case 'to-photo':
          stage.moveReturning();
          toPhoto(++timer);
          if (timer >= TO_PHOTO.end) phase = 'confirm';
          return;
        case 'confirm': {
          const q = question!;
          if (q.pressed) {
            if (++q.frames >= PRESS) answer(q.pressed === 'yes');
            return;
          }
          if (f.tap === 'yes' || f.tap === 'no') press(f.tap);
          else if (f.pressed.includes('up') || f.pressed.includes('down')) q.cursor = q.cursor === 'yes' ? 'no' : 'yes';
          else if (f.pressed.includes('a')) press(q.cursor);
          else if (f.pressed.includes('b')) press('no');
          return;
        }
        case 'back':
          back(timer++);
          if (timer > BACK.end) {
            stage.clearDone();
            phase = 'dress';
          }
          return;
        case 'fade-out':
          fade = Math.min(16, Math.round((16 * ++timer) / FADE));
          if (fade === 16) return { close: { app: 'gallery-dress-up', saved } };
          return;
      }
    },
    input(): Step {
      return undefined;
    },
    view(): GalleryDressUpView {
      const q = question;
      const text = q ? t.message(q.which === 'finished' ? GALLERY.finished : GALLERY.save) : null;
      return {
        app: 'gallery-dress-up',
        phase: phase === 'intro' ? 'intro' : phase === 'to-photo' || phase === 'back' ? 'finish' : phase === 'confirm' ? 'confirm' : 'dress',
        fade,
        shade: look.shade,
        message: message ? { text: message.pages[message.page]!, waiting: true } : null,
        stage: stage.view(phase === 'dress'),
        shift: { x: look.slide * STEP.x, y: look.slide * STEP.y },
        buttonsDrop: look.buttons * STEP.buttons,
        caseShown: look.caseShown,
        photoBg: look.photoBg,
        question: q && text !== null ? { text, yes: t.t('yes'), no: t.t('no'), cursor: q.cursor, pressed: q.pressed, frame: q.pressed ? Math.min(3, Math.floor(q.frames / 2) + 1) : 0 } : null,
      };
    },
  };
}

/**
 * The gallery's frames (ov22_0225B660 with a DressUpPhoto: ov22_0225AF8C, ov22_0225BB00): the photo at (72, 16) with its
 * backdrop, the Pokémon where it stood, the trainer's name and the title word (bank 385 message 45). A or B closes it.
 */
export function galleryPhotoScreen(ctx: MenuContext, slot: number): Screen {
  const photo = ctx.state.dressUpPhotos[slot];
  if (!photo) throw new Error(`gallery photo: no photo in slot ${slot}`);
  checkTexts(ctx, [GALLERY.title], 'gallery photo');
  const t = ctx.text;
  const word = photo.title === null ? '' : t.text(easyChatWordText(ctx.registries, photo.title));
  const lines: [string, string] = [photo.trainerName, t.message(GALLERY.title, word)];
  // The photo's frame on this screen (the photo at (72, 16)); the Pokémon at its saved centre.
  const dy = 16 - PHOTO_FRAME.y;
  const picture = contestPicture(ctx.registries, photo.mon, photo.dressUp, 0, dy, true);
  picture.mon = { ...picture.mon, x: photo.mon.x, y: photo.mon.y + dy };
  const close = (): Step => ({ close: { app: 'gallery-photo' } });
  return {
    input(i): Step {
      if ('button' in i) return i.button === 'a' || i.button === 'b' ? close() : undefined;
      return i.tap === 'next' || i.tap === 'back' ? close() : undefined;
    },
    view: (): GalleryPhotoView => ({ app: 'gallery-photo', picture, lines }),
  };
}
