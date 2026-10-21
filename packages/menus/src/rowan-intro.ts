/**
 * Rowan's intro (decomp applications/rowan_intro/rowan_intro_app.c, RowanIntro_Run), one DS frame per tick, on one
 * screen: the welcome on black, Rowan fading in with SEQ_OPENING, the info choice (ADVENTURE INFO's six text blocks,
 * or none), "widely inhabited by Pokémon", the Poké Ball on the touch screen (a touch on its button, or A; any
 * other button gets "Not that button!"), its flash and Buneary's jumps and cry, "tell me about yourself", the boy
 * and the girl (left/right, A; YES/NO), the naming keyboard, "Your name is …?" (NO goes back to the gender), the
 * rival with the name choice (New name! opens the keyboard), the closing lines with the music fading, and the
 * avatar shrinking away. Timings are the decomp's: RowanIntro_FadeBgLayer (an init frame, 16 alpha steps, an end
 * frame), RowanIntro_MoveBgLayer (4 px a frame), RowanIntro_Delay(n) (n + 1 frames), StartScreenFade(steps,
 * frames per step), BrightnessController transitions (a step a frame), the text printer at the device's speed.
 *
 * Not the DS's, on one web screen: CONTROL INFO (the DS's buttons and its Touch Screen) is not offered; the Poké
 * Ball takes A as well as a touch (the keyboard has no touch screen); the screen shows the touch screen from the
 * Poké Ball's fade until the flash, where the DS shows both; the TV programme after the intro (RowanIntroTv) is not
 * played. The naming keyboard is the in-game one; OK with nothing entered keeps the default name.
 */
import type { AppMessage, AudioHost, InputFrame, Registries, RowanIntroView, StubLog } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { plainMarkup, TextPrinter, toPrintOps } from '@opensinnoh/text';
import { namingScreen } from './naming.ts';
import type { Screen, Step } from './stack.ts';
import { MenuText, plainText } from './strings.ts';

const P = 'RowanIntro_Text_';
/** The bank's messages the intro uses (TEXT_BANK_ROWAN_INTRO). */
export const INTRO_TEXT = [
  'HelloThere', 'MyNameRowan', 'InfoAnythingElse', 'AdventureInfo0', 'AdventureInfo1', 'AdventureInfo2', 'AdventureInfo3', 'AdventureInfo4', 'AdventureInfo5',
  'WidelyInhabited', 'HavePokeBall', 'PokeBallUseTouchscreen', 'LiveAlongsidePokemon', 'AboutYourself', 'GenderDialogue', 'ConfirmBoy', 'ConfirmGirl',
  'NameDialogue', 'ConfirmNameMale', 'ConfirmNameFemale', 'SoYoure', 'RivalNameDialogue', 'ConfirmRivalName', 'EndDialogue',
  'ChoiceAdventureInfo', 'ChoiceNoInfo', 'ChoiceYes', 'ChoiceNo', 'RivalChoiceNew', 'RivalChoiceBarry', 'RivalChoiceNolan', 'RivalChoiceRoy', 'RivalChoiceGavin',
].map((m) => P + m);

/** Sequence numbers (SDAT): SEQ_OPENING, SE_CONFIRM (SEQ_SE_DP_SELECT), SEQ_SE_DP_SLOT01. */
const SEQ_OPENING = 1029;
const SE_CONFIRM = 1500;
const SE_BALL = 1744;
/** RowanIntro_LoadBunearySprite: BlendPalettes toward this colour. */
const BUNEARY_TINT = 0x6a3c;
/** Buneary's 10×10-tile picture on main BG2 at tile (11, 9). */
const BUNEARY_AT = { x: 88, y: 72 };
const TRAINER_NAME_LEN = 7;

/** Window templates in tiles (left, top, width, height); the frame adds a tile on every side. */
const framedRect = (left: number, top: number, width: number, height: number) => ({ x: (left - 1) * 8, y: (top - 1) * 8, w: (width + 2) * 8, h: (height + 2) * 8 });
const YES_NO = framedRect(2, 3, 6, 4);
const INFO = (n: number) => framedRect(1, 3, 16, n * 2);
const RIVAL_NAMES = framedRect(2, 3, 14, 10);

export interface RowanIntroOptions {
  registries: Registries;
  log: StubLog;
  sound?: AudioHost;
  /** Render calls per character (TEXT_FRAME_DELAY of the device's text speed). */
  textDelay: number;
  /** The names OK keeps when nothing was entered. */
  defaults: { player: string; rival: string };
  /** The device's auto-lowercase naming option (absent: off, the DS behaviour). */
  autoLowercase?: () => boolean;
  /**
   * The intro skip (OpenSinnoh, on a device that has finished the intro; not the DS's): from the first fade straight to
   * the boy and the girl, with SEQ_OPENING, then the names, and after the rival's name the screens fade out.
   */
  skip?: boolean;
}

interface Layer {
  cell: string | null;
  /** Bg_SetOffset x and y: the layer's content shows at minus these. */
  sx: number;
  sy: number;
  alpha: number;
  on: boolean;
}

/** StartScreenFade: master brightness from or to black in `steps` steps of `perStep` frames. */
class ScreenFade {
  private f = 0;
  constructor(
    private readonly toBlack: boolean,
    private readonly steps: number,
    private readonly perStep: number,
  ) {}
  step(): void {
    if (!this.done) this.f++;
  }
  get done(): boolean {
    return this.f >= this.steps * this.perStep;
  }
  get value(): number {
    const k = Math.floor(this.f / this.perStep) / this.steps;
    return -Math.round(16 * (this.toBlack ? k : 1 - k));
  }
}

/** BrightnessController_StartTransition: `from` to `to` in `steps`, a step a frame. */
class Transition {
  private k = 0;
  constructor(
    private readonly steps: number,
    private readonly to: number,
    private readonly from: number,
  ) {}
  step(): void {
    if (this.k < this.steps) this.k++;
  }
  get done(): boolean {
    return this.k >= this.steps;
  }
  get value(): number {
    return Math.round(this.from + ((this.to - this.from) * this.k) / this.steps);
  }
}

type Choice = { entries: string[]; values: number[]; rect: { x: number; y: number; w: number; h: number }; allowCancel: boolean; cursor: number };

export function rowanIntroScreen(o: RowanIntroOptions, done: (result: { names: { player: string; rival: string }; gender: 'male' | 'female' }) => Step): Screen {
  const text = new MenuText(o.registries, INTRO_TEXT);
  const markup = (name: string) => o.registries.texts.get(text.id(P + name))!.text;
  const label = (name: string) => plainText(markup(name));
  const bySource = new Map([...o.registries.sequences.values()].flatMap((s) => (s.sourceIndex === undefined ? [] : [[s.sourceIndex, s.id] as const])));
  const sequence = (n: number): Id | null => {
    const id = bySource.get(n) ?? null;
    if (!id) o.log.stub('audio:sequence-missing', `no sequence with sourceIndex ${n} in the packs: not played`);
    return id;
  };
  const se = (n: number) => {
    const s = o.sound && sequence(n);
    if (s) o.sound!.playSe(s);
  };
  const buneary = text.id('SPECIES_BUNEARY');
  const hasBuneary = o.registries.species.has(buneary);
  if (!hasBuneary) o.log.stub('menus:intro-buneary', `the pack has no ${buneary}: the Poké Ball opens on nothing`);

  // --- state (RowanIntro) ---
  let state = 'first-fade';
  let buffered = '';
  let gender: 'male' | 'female' = 'male';
  let player = '';
  let rival = '';
  let screen: 'main' | 'touch' = 'main';
  let backdrop: RowanIntroView['backdrop'] = null;
  const bg1: Layer = { cell: null, sx: 0, sy: 0, alpha: 16, on: false };
  const bg2: Layer = { cell: null, sx: 0, sy: 0, alpha: 16, on: false };
  /** BG0's blend while a text block fades. */
  const bg0: Layer = { cell: null, sx: 0, sy: 0, alpha: 16, on: true };
  const pokemon: Layer & { tint: number } = { cell: null, sx: 0, sy: 0, alpha: 16, on: false, tint: 0 };
  let ball: string | null = null;
  let mainBright = -16;
  let fade: ScreenFade | null = null;
  let flash: Transition | null = null;
  let flashValue = 0;
  let printer: TextPrinter | null = null;
  let messageShown = false;
  let messageState: 'init' | 'print' | 'end' = 'init';
  let block: { text: string; y: number } | null = null;
  let blockState = 'init';
  let blockIndex = 0;
  let choice: Choice | null = null;
  let picked = 0;
  let fadeState: 'init' | 'in' | 'out' | 'end' = 'init';
  let fadeAlpha = 0;
  let delay = 0;
  const run = { frame: 0, counter: 0 };
  const other = { frame: 0, counter: 0 };
  let progress = 0;
  let animDelay = 0;
  const jump = { state: 'init', carry: 0, coeff: 0, t: 0, blend: 0, touchY: 0 };
  let exiting: ScreenFade | null = null;

  /** StartScreenFade runs its first step at once (TryScreenFadeFunc): the start brightness shows this frame. */
  const startFade = (toBlack: boolean, steps = 6, perStep = 1) => {
    fade = new ScreenFade(toBlack, steps, perStep);
    mainBright = fade.value;
  };
  const fadeDone = () => fade === null || fade.done;
  const clearMessage = () => {
    messageShown = false;
  };

  /** RowanIntro_DisplayMessage(textID, endEarly = TRUE): true the frame after the printer finishes. */
  const message = (name: string): boolean => {
    if (messageState === 'init') {
      const slots = [player, rival].map(plainMarkup);
      printer = new TextPrinter(toPrintOps(markup(name), slots), { speed: o.textDelay, canSpeedUp: true });
      messageShown = true;
      messageState = 'print';
      return false;
    }
    if (messageState === 'print') {
      if (printer!.done) messageState = 'end';
      return false;
    }
    messageState = 'init';
    return true;
  };

  /** RowanIntro_FadeBgLayer: one layer at a time. */
  const fadeLayer = (l: Layer, dir: 'in' | 'out'): boolean => {
    switch (fadeState) {
      case 'init':
        if (dir === 'in') {
          [fadeAlpha, fadeState] = [0, 'in'];
          [l.alpha, l.on] = [0, true];
        } else [fadeAlpha, fadeState] = [16, 'out'];
        return false;
      case 'in':
        if (fadeAlpha < 16) l.alpha = ++fadeAlpha;
        else fadeState = 'end';
        return false;
      case 'out':
        if (fadeAlpha > 0) l.alpha = --fadeAlpha;
        else [fadeState, l.on] = ['end', false];
        return false;
      case 'end':
        fadeState = 'init';
        for (const x of [bg0, bg1, bg2, pokemon]) x.alpha = 16; // G2_BlendNone
        return true;
    }
  };

  /** RowanIntro_MoveBgLayer: 4 px a frame to the centre (0), right (−48) or left (0). */
  const moveLayer = (l: Layer, to: 'centre' | 'right' | 'left'): boolean => {
    const target = to === 'right' ? -48 : 0;
    if (l.sx === target) return true;
    l.sx += l.sx > target ? -4 : 4;
    return false;
  };

  const wait = (n: number): boolean => {
    if (delay < n) {
      delay++;
      return false;
    }
    delay = 0;
    return true;
  };

  const openChoice = (entries: string[], rect: Choice['rect'], allowCancel: boolean, values = entries.map((_, i) => i + 1)) => {
    choice = { entries, values, rect, allowCancel, cursor: 0 };
  };
  /** RowanIntro_ChoiceBox's input: true once chosen (`picked`: the choice's value, or 0 for B where cancelling is allowed). */
  const choose = (f: InputFrame): boolean => {
    const c = choice!;
    const pressed = (b: string) => f.pressed.includes(b as never);
    const tap = f.tap?.startsWith('menu:') ? Number(f.tap.slice(5)) : null;
    let value: number | null = null;
    if (tap !== null && c.entries[tap] !== undefined) [c.cursor, value] = [tap, c.values[tap]!];
    else if (pressed('a')) value = c.values[c.cursor]!;
    else if (pressed('b') && !c.allowCancel) value = 0;
    else if (pressed('up') && c.cursor > 0) {
      c.cursor--;
      se(SE_CONFIRM);
    } else if (pressed('down') && c.cursor < c.entries.length - 1) {
      c.cursor++;
      se(SE_CONFIRM);
    }
    if (value === null) return false;
    picked = value;
    choice = null;
    se(SE_CONFIRM);
    return true;
  };

  /** RowanIntro_DisplayTextBlock (ADVENTURE INFO): BG0 off, the block, its fade in, A or B, its fade out. */
  const textBlock = (name: string, f: InputFrame): boolean => {
    switch (blockState) {
      case 'init': {
        const t = label(name);
        const lines = t.split('\n').length;
        block = { text: t, y: (12 - lines) * 8 };
        bg0.on = false;
        blockState = 'copy';
        return false;
      }
      case 'copy':
        blockState = 'fade-in';
        return false;
      case 'fade-in':
        if (fadeLayer(bg0, 'in')) blockState = 'wait';
        return false;
      case 'wait':
        if (f.pressed.includes('a') || f.pressed.includes('b') || f.tap === 'next') {
          se(SE_CONFIRM);
          blockState = 'fade-out';
        }
        return false;
      case 'fade-out':
        if (fadeLayer(bg0, 'out')) blockState = 'exit';
        return false;
      default:
        block = null;
        blockState = 'init';
        return true;
    }
  };

  const avatar = () => (gender === 'male' ? bg1 : bg2);
  /** RowanIntro_LoadTilemap's pictures: the boy on BG1, the girl on BG2. */
  const loadAvatars = () => {
    [run.frame, run.counter, other.frame, other.counter] = [0, 0, 0, 0];
    [bg1.cell, bg2.cell] = ['boy-0', 'girl-0'];
    [bg1.sx, bg2.sx] = [-48, 48];
  };
  /** RowanIntro_AnimateAvatarRun: the picked one runs (a frame every 5), the other dims to 6/16. */
  const animateRun = () => {
    const a = gender === 'male' ? run : other;
    if (a.counter) a.counter--;
    else [a.frame, a.counter] = [(a.frame + 1) & 3, 4];
    const [me, them] = gender === 'male' ? [bg1, bg2] : [bg2, bg1];
    me.cell = `${gender === 'male' ? 'boy' : 'girl'}-${a.frame}`;
    [me.alpha, them.alpha] = [16, 6];
  };

  /** RowanIntro_AnimateBuneary: up out of the ball (touch screen), then on the main screen: a jump up, right, left; the cry. */
  const animateBuneary = (): boolean => {
    let finished = false;
    switch (jump.state) {
      case 'init':
        [pokemon.sx, pokemon.sy] = [0, -8 * 13];
        [jump.carry, jump.coeff, jump.t, jump.blend, jump.touchY] = [0, 8, 0, 16 * 3, 0];
        jump.state = 'touch-up';
        break;
      case 'touch-up': {
        // The touch screen's copy rises while its y offset is under 88 (drawn there only: not on this screen).
        const y = jump.coeff * 9 * jump.t - Math.trunc((9 * jump.t * jump.t) / 2);
        if (jump.touchY < 8 * 11) {
          jump.t++;
          pokemon.sx += 2;
          jump.touchY = y;
        } else [jump.t, jump.state] = [0, 'show'];
        break;
      }
      case 'show':
        pokemon.on = true;
        [jump.carry, jump.coeff, jump.t] = [0, 9, 0];
        jump.state = 'up-down';
        break;
      case 'up-down': {
        const y = -8 * 13 + jump.coeff * 9 * jump.t - Math.trunc((9 * jump.t * jump.t) / 2);
        if (jump.carry > 0 && y <= 0) {
          pokemon.sy = 0;
          [jump.carry, jump.coeff, jump.t, jump.state] = [0, 3, 0, 'right'];
        } else {
          jump.t++;
          jump.carry = y;
          pokemon.sx += 1;
          pokemon.sy = Math.min(y >> 1, 8 * 18);
        }
        break;
      }
      case 'right':
      case 'left': {
        const y = jump.coeff * 9 * jump.t - Math.trunc((9 * jump.t * jump.t) / 3);
        if (jump.carry > 0 && y <= 0) {
          pokemon.sy = 0;
          if (jump.state === 'right') [jump.carry, jump.coeff, jump.t, jump.state] = [0, 3, 0, 'left'];
          else jump.state = 'end';
        } else {
          jump.t++;
          pokemon.sx += jump.state === 'right' ? -2 : 4;
          pokemon.sy = y;
          jump.carry = y;
        }
        break;
      }
      case 'end':
        if (hasBuneary) o.sound?.playCry(buneary);
        finished = true;
        break;
    }
    // RowanIntro_AnimateBuneary_BlendSpritePalette: the tint fades over 48 frames.
    if (jump.blend > 0) pokemon.tint = Math.trunc(--jump.blend / 3);
    return finished;
  };

  /** The naming keyboard, a new application: the frame that opens it is the intro's (its presses do not type). */
  const naming = (kind: 'player' | 'rival'): Step => {
    const keyboard = namingScreen({ registries: o.registries, text, log: o.log, host: o.sound ? { sound: o.sound } : {} },{ app: 'naming', kind, initial: '', maxLength: TRAINER_NAME_LEN, gender, pokemon: null }, (name) => {
      if (kind === 'player') player = name ?? o.defaults.player;
      else rival = name ?? o.defaults.rival;
      // RI_APP_STATE_INIT_AGAIN: the graphics again, black, BG0 cleared.
      [mainBright, fade] = [-16, null];
      clearMessage();
      state = kind === 'player' ? 'name-keyboard' : 'rival-keyboard';
      return 'pop';
    }, o.autoLowercase);
    let opened = false;
    return {
      push: {
        view: () => keyboard.view(),
        tick: () => void (opened = true),
        input: (i) => (opened ? keyboard.input(i) : undefined),
      },
    };
  };

  const result = () => ({ names: { player, rival }, gender });

  const tick = (f: InputFrame): Step => {
    // The fade and brightness tasks, then the printer (two render calls a frame), then RowanIntro_Run.
    if (fade) {
      fade.step();
      mainBright = fade.value;
    }
    if (flash) {
      flash.step();
      flashValue = flash.value;
    }
    if (printer && !printer.done && messageState === 'print') {
      const ab = { pressed: f.pressed.includes('a') || f.pressed.includes('b') || f.tap === 'next', held: f.held.includes('a') || f.held.includes('b') };
      // SE_CONFIRM for each press that ends a {clear}/{scroll} wait (decomp TextPrinter_Continue).
      for (let i = 0; i < 2; i++) if (printer.subStep(ab)) se(SE_CONFIRM);
    }
    if (exiting) {
      exiting.step();
      mainBright = exiting.value;
      return exiting.done ? done(result()) : undefined;
    }
    const pressed = (b: string) => f.pressed.includes(b as never);
    switch (state) {
      case 'first-fade':
        startFade(false);
        state = 'first-fade-wait';
        break;
      case 'first-fade-wait':
        if (!fadeDone() || !wait(40)) break;
        if (o.skip) {
          const bgm = o.sound && sequence(SEQ_OPENING);
          if (bgm) o.sound!.playBgm(bgm);
          backdrop = 'plain';
          state = 'avatars';
        } else state = 'welcome';
        break;
      case 'welcome':
        if (message('HelloThere')) [state, messageShown] = ['rowan-in', false];
        break;
      case 'rowan-in': {
        const bgm = o.sound && sequence(SEQ_OPENING);
        if (bgm) o.sound!.playBgm(bgm);
        [bg1.cell, bg1.sx, bg1.on, bg1.alpha, backdrop] = ['rowan', 0, true, 16, 'plain'];
        startFade(false, 16, 4);
        state = 'rowan-in-wait';
        break;
      }
      case 'rowan-in-wait':
        if (fadeDone()) state = 'my-name';
        break;
      case 'my-name':
        if (message('MyNameRowan')) state = 'info-right';
        break;
      case 'info-right':
        if (moveLayer(bg1, 'right')) {
          openChoice([label('ChoiceAdventureInfo'), label('ChoiceNoInfo')], INFO(2), true, [2, 3]);
          state = 'info-choice';
        }
        break;
      case 'info-choice':
        if (choose(f)) {
          if (picked === 2) {
            clearMessage();
            startFade(true);
            state = 'info-black';
          } else state = 'info-left';
        }
        break;
      case 'info-black':
        if (fadeDone()) {
          clearMessage();
          bg1.on = false;
          state = 'adventure-start';
        }
        break;
      case 'adventure-start':
        backdrop = 'adventure';
        startFade(false);
        [blockIndex, state] = [0, 'adventure-in'];
        break;
      case 'adventure-in':
        if (fadeDone()) state = 'adventure';
        break;
      case 'adventure':
        if (textBlock(`AdventureInfo${blockIndex}`, f) && ++blockIndex === 6) state = 'adventure-fade';
        break;
      case 'adventure-fade':
        startFade(true);
        state = 'adventure-out';
        break;
      case 'adventure-out':
        if (fadeDone()) {
          clearMessage();
          bg0.on = true;
          state = 'rowan-again';
        }
        break;
      case 'rowan-again':
        backdrop = 'plain';
        [bg1.on, bg1.sx] = [true, 0];
        startFade(false);
        state = 'rowan-again-wait';
        break;
      case 'rowan-again-wait':
        if (fadeDone()) state = 'anything-else';
        break;
      case 'anything-else':
        if (message('InfoAnythingElse')) state = 'info-right';
        break;
      case 'info-left':
        if (moveLayer(bg1, 'left')) state = 'inhabited';
        break;
      case 'inhabited':
        if (message('WidelyInhabited')) state = 'ball-fade';
        break;
      case 'ball-fade':
        // The touch screen fades to black and back with the Poké Ball (one screen here: it replaces the main one).
        startFade(true);
        state = 'ball-black';
        break;
      case 'ball-black':
        if (fadeDone()) {
          [screen, ball] = ['touch', 'button-0'];
          startFade(false);
          state = 'ball-in';
        }
        break;
      case 'ball-in':
        if (fadeDone()) state = 'have-ball';
        break;
      case 'have-ball':
        if (message('HavePokeBall')) state = 'ball-wait';
        break;
      case 'ball-wait':
        if (f.tap === 'ball' || pressed('a')) {
          [progress, animDelay] = [0, 0];
          clearMessage();
          state = 'ball-push';
        } else if (f.pressed.length) state = 'not-that-button';
        break;
      case 'not-that-button':
        if (message('PokeBallUseTouchscreen')) state = 'ball-wait';
        break;
      case 'ball-push':
        if (animDelay) animDelay--;
        else if (progress < 2) [ball, animDelay] = [`button-${++progress}`, 4];
        else {
          se(SE_BALL);
          flash = new Transition(1, 16, 0);
          state = 'flash-1';
        }
        break;
      case 'flash-1':
        if (flash!.done) [flash, state] = [new Transition(1, 0, 16), 'flash-2'];
        break;
      case 'flash-2':
        if (flash!.done) [flash, state] = [new Transition(4, 16, 0), 'flash-3'];
        break;
      case 'flash-3':
        if (flash!.done) state = 'spawn';
        break;
      case 'spawn':
        // Under the white: back to the main screen, Buneary rises out of the ball.
        [screen, ball] = ['main', null];
        [pokemon.on, pokemon.alpha, pokemon.tint] = [false, 16, 16];
        jump.state = 'init';
        animateBuneary();
        flash = new Transition(16, 0, 16);
        state = 'spawn-flash';
        break;
      case 'spawn-flash':
        animateBuneary();
        if (flash!.done) state = 'bounce';
        break;
      case 'bounce':
        if (animateBuneary()) state = 'bounce-wait';
        break;
      case 'bounce-wait':
        if (wait(40)) state = 'live-alongside';
        break;
      case 'live-alongside':
        if (message('LiveAlongsidePokemon')) [state, messageShown] = ['put-away', false];
        break;
      case 'put-away':
        if (fadeLayer(pokemon, 'out')) state = 'yourself-wait';
        break;
      case 'yourself-wait':
        if (wait(30)) state = 'yourself';
        break;
      case 'yourself':
        if (message('AboutYourself')) state = 'rowan-out';
        break;
      case 'rowan-out':
        if (fadeLayer(bg1, 'out')) state = 'avatars';
        break;
      case 'avatars':
        loadAvatars();
        state = 'boy-in';
        break;
      case 'boy-in':
        if (fadeLayer(bg1, 'in')) state = 'girl-in';
        break;
      case 'girl-in':
        if (fadeLayer(bg2, 'in')) state = 'gender-ask';
        break;
      case 'gender-ask':
        if (message('GenderDialogue')) [gender, state] = ['male', 'gender'];
        break;
      case 'gender': {
        const tap = f.tap === 'boy' ? 'male' : f.tap === 'girl' ? 'female' : null;
        if (pressed('a') || (tap !== null && tap === gender)) {
          // The other one fades out from its dimmed 6/16.
          [fadeAlpha, fadeState] = [6, 'out'];
          state = 'gender-picked';
          break;
        }
        if (pressed('left') || pressed('right') || (tap !== null && tap !== gender)) {
          gender = gender === 'male' ? 'female' : 'male';
          se(SE_CONFIRM);
        }
        animateRun();
        break;
      }
      case 'gender-picked':
        if (fadeLayer(gender === 'male' ? bg2 : bg1, 'out')) state = 'gender-centre';
        break;
      case 'gender-centre':
        if (moveLayer(avatar(), 'centre')) {
          for (const l of [bg1, bg2]) l.alpha = 16;
          state = 'gender-confirm';
        }
        break;
      case 'gender-confirm':
        if (message(gender === 'male' ? 'ConfirmBoy' : 'ConfirmGirl')) {
          openChoice([label('ChoiceYes'), label('ChoiceNo')], YES_NO, false);
          state = 'gender-yes-no';
        }
        break;
      case 'gender-yes-no':
        if (choose(f)) {
          if (picked === 1) state = 'name-ask';
          else {
            clearMessage();
            state = 'gender-again';
          }
        }
        break;
      case 'gender-again':
        if (fadeLayer(avatar(), 'out')) state = 'avatars';
        break;
      case 'name-ask':
        if (message('NameDialogue')) state = 'name-app-start';
        break;
      case 'name-app-start':
        // A new application: the screens fade out first (RowanIntro_Main, RI_APP_STATE_CHANGE_APP_WAIT_FADE).
        startFade(true);
        state = 'name-app';
        break;
      case 'name-app':
        if (fadeDone()) return naming('player');
        break;
      case 'name-keyboard': {
        bg0.on = true;
        const a = avatar();
        [a.cell, a.on, a.sx, a.alpha] = [gender === 'male' ? 'boy-0' : 'girl-0', true, 0, 16];
        (a === bg1 ? bg2 : bg1).on = false;
        startFade(false);
        state = 'name-keyboard-in';
        break;
      }
      case 'name-keyboard-in':
        if (fadeDone()) state = 'name-confirm';
        break;
      case 'name-confirm':
        if (message(gender === 'male' ? 'ConfirmNameMale' : 'ConfirmNameFemale')) {
          openChoice([label('ChoiceYes'), label('ChoiceNo')], YES_NO, false);
          state = 'name-yes-no';
        }
        break;
      case 'name-yes-no':
        if (choose(f)) {
          clearMessage();
          if (picked === 1) buffered = 'rowan-after-name';
          else [player, buffered] = ['', 'avatars'];
          state = 'name-out';
        }
        break;
      case 'name-out':
        if (fadeLayer(avatar(), 'out')) state = buffered;
        break;
      case 'rowan-after-name':
        [bg1.cell, bg1.sx] = ['rowan', 0];
        bg2.on = false;
        state = 'rowan-after-name-in';
        break;
      case 'rowan-after-name-in':
        if (fadeLayer(bg1, 'in')) state = 'so-youre';
        break;
      case 'so-youre':
        if (message('SoYoure')) state = 'rowan-out-for-rival';
        break;
      case 'rowan-out-for-rival':
        if (fadeLayer(bg1, 'out')) {
          bg1.cell = 'rival';
          state = 'rival-in';
        }
        break;
      case 'rival-in':
        if (fadeLayer(bg1, 'in')) state = 'rival-ask';
        break;
      case 'rival-ask':
        if (message('RivalNameDialogue')) state = 'rival-right';
        break;
      case 'rival-right':
        if (moveLayer(bg1, 'right')) {
          openChoice(['RivalChoiceNew', 'RivalChoiceBarry', 'RivalChoiceNolan', 'RivalChoiceRoy', 'RivalChoiceGavin'].map(label), RIVAL_NAMES, true);
          state = 'rival-choice';
        }
        break;
      case 'rival-choice':
        if (choose(f)) {
          if (picked === 1) state = 'rival-app-start';
          else {
            rival = label(['RivalChoiceBarry', 'RivalChoiceNolan', 'RivalChoiceRoy', 'RivalChoiceGavin'][picked - 2]!);
            state = 'rival-left';
          }
        }
        break;
      case 'rival-left':
        if (moveLayer(bg1, 'left')) state = 'rival-confirm';
        break;
      case 'rival-app-start':
        startFade(true);
        state = 'rival-app';
        break;
      case 'rival-app':
        if (fadeDone()) return naming('rival');
        break;
      case 'rival-keyboard':
        bg0.on = true;
        [bg1.on, bg1.sx, bg1.alpha] = [true, 0, 16];
        startFade(false);
        state = 'rival-keyboard-in';
        break;
      case 'rival-keyboard-in':
        if (fadeDone()) state = 'rival-confirm';
        break;
      case 'rival-confirm':
        if (message('ConfirmRivalName')) {
          openChoice([label('ChoiceYes'), label('ChoiceNo')], YES_NO, false);
          state = 'rival-yes-no';
        }
        break;
      case 'rival-yes-no':
        if (choose(f)) {
          if (picked === 1) {
            clearMessage();
            state = 'rival-out';
          } else [rival, state] = ['', 'rival-ask'];
        }
        break;
      case 'rival-out':
        if (!fadeLayer(bg1, 'out')) break;
        if (o.skip) {
          o.sound?.fadeOutBgm(0, 50);
          state = 'exit';
          break;
        }
        bg1.cell = 'rowan';
        state = 'rowan-end-in';
        break;
      case 'rowan-end-in':
        if (fadeLayer(bg1, 'in')) state = 'end-wait';
        break;
      case 'end-wait':
        if (wait(30)) state = 'end';
        break;
      case 'end':
        if (message('EndDialogue')) {
          o.sound?.fadeOutBgm(0, 50);
          state = 'rowan-end-out';
        }
        break;
      case 'rowan-end-out':
        if (fadeLayer(bg1, 'out')) {
          clearMessage();
          state = 'mini-wait';
        }
        break;
      case 'mini-wait':
        if (wait(30)) state = 'mini-load';
        break;
      case 'mini-load':
        bg1.cell = gender === 'male' ? 'boy-0' : 'girl-0';
        state = 'mini-in';
        break;
      case 'mini-in':
        if (fadeLayer(bg1, 'in')) [progress, animDelay, state] = [0, 0, 'shrink-wait'];
        break;
      case 'shrink-wait':
        if (wait(30)) state = 'shrink';
        break;
      case 'shrink':
        // RowanIntro_AnimateAvatarShrink: the next picture every 9 frames, then gone.
        if (animDelay) animDelay--;
        else [progress, animDelay] = [progress + 1, 8];
        if (progress === 5) state = 'tv';
        else bg1.cell = `${gender === 'male' ? 'boy' : 'girl'}-shrink-${progress}`;
        break;
      case 'tv':
        // RI_STATE_END starts the TV programme (not played here), RI_STATE_EXIT ends; then the screens fade out.
        state = 'exit';
        break;
      case 'exit':
        exiting = new ScreenFade(true, 6, 1);
        break;
    }
    return undefined;
  };

  const view = (): RowanIntroView => {
    const layers: RowanIntroView['layers'] = [];
    for (const l of [bg1, bg2]) if (l.on && l.cell && screen === 'main') layers.push({ cell: l.cell, x: 0 - l.sx, y: 0 - l.sy, alpha: l.alpha });
    const msg: AppMessage | null = messageShown && printer && bg0.on ? { text: printer.text(), waiting: printer.waiting } : null;
    return {
      app: 'rowan-intro',
      screen,
      backdrop: screen === 'main' ? backdrop : null,
      layers,
      pokemon: pokemon.on && hasBuneary && screen === 'main' ? { species: buneary, x: BUNEARY_AT.x - pokemon.sx, y: BUNEARY_AT.y - pokemon.sy, alpha: pokemon.alpha, tint: { color: BUNEARY_TINT, level: pokemon.tint } } : null,
      ball: screen === 'touch' ? ball : null,
      brightness: mainBright,
      flash: flashValue,
      message: msg,
      block: block ? { ...block, alpha: bg0.alpha, waiting: blockState === 'wait' } : null,
      menu: choice ? { entries: choice.entries, cursor: choice.cursor, rect: choice.rect } : null,
      gender: state === 'gender' ? gender : null,
    };
  };

  return { view, tick, input: () => undefined };
}
