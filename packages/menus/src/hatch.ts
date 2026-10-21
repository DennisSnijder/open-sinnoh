/**
 * The egg hatching scene (decomp cutscenes/egg_hatch/main.c EggHatchCutscene_Normal and graphics.c
 * EggHatch_ShakeEgg; FieldTask_HatchEgg for the naming screen), one decomp frame per tick: the egg waits
 * 25 ticks, cracks through four shakes (minor twice, big, bigger, explosive) with its six frames and the
 * EGG01 sound, bursts (BOWA3), the scene fades to white while the black bars slide off, the Pokémon
 * appears and the scene fades back in; then its cry, "… hatched from the Egg!", the fanfare, and "Would
 * you like to nickname …?" with YES/NO. YES opens the naming screen. The egg's shards and sparkles
 * (particle emitters) are not drawn and take no time. The `hatch_egg` op has already hatched the Pokémon.
 */
import { isShiny, monGender, type Button, type Id } from '@opensinnoh/core';
import { dexOf, type HatchView } from '@opensinnoh/contracts';
import type { MenuContext } from './context.ts';
import { namingScreen } from './naming.ts';
import type { Screen, Step } from './stack.ts';

type Input = { button: Button } | { tap: string };

/** Decomp MON_NAME_LEN. */
const MON_NAME_LEN = 10;
/** Decomp EggHatch_CreateSprites: the egg's position; the bars rest at y −16 and 144 (48 px tall). */
const EGG_X = 128;
const EGG_Y = 120;
const BAR_TOP_REST = -16;
const BAR_TOP_GONE = -48;
const BAR_BOTTOM_REST = 192 - 48;
/** Decomp palette fades: 16 steps (one per tick). */
const FADE = 16;

/** Decomp sXOffsets, sYOffsets, sXScales, sYScales (0xFF ends an offset list, 0 a scale list). */
type Shake = 'minor' | 'big' | 'bigger' | 'explosive';
const END = 0xff;
const pad = (a: number[], fill: number) => [...a, ...Array<number>(10 - a.length).fill(fill)];
const SHAKES: Record<Shake, { x: number[]; y: number[]; sx: number[]; sy: number[] }> = {
  minor: { x: pad([-1, 1, 1, -1, -1, 1, 1, -1, END, END], 0), y: pad([0, END], 0), sx: pad([1], 0), sy: pad([1], 0) },
  big: { x: pad([-2, 2, 2, -2, -2, 2, 2, -2, END, END], 0), y: pad([0, 0, 1, 1, 0, -1, -1, 0, 0, END], 0), sx: pad([1, 1, 1.1, 1.1, 1.1, 1.1, 1.1, 1, 1], 0), sy: pad([1, 1, 0.9, 0.9, 0.9, 0.9, 0.9, 1, 1], 0) },
  bigger: { x: pad([-3, 3, 3, -3, -3, 3, END, END], 0), y: [0, 0, 1, 1, 1, -1, -1, -1, 0, 0], sx: [1, 1.1, 1.1, 1.2, 1.2, 1.2, 1.1, 1.1, 1, 0], sy: [1, 1, 0.9, 0.8, 0.7, 0.7, 0.8, 0.9, 1, 1] },
  explosive: { x: pad([-3, 3, 3, -3, -3, 3, END, END], 0), y: [0, 0, 1, 1, 1, -1, -1, -1, 0, 0], sx: [1, 1.1, 1.1, 1.2, 1.2, 1.2, 1.1, 1.1, 1, 0], sy: [1, 1, 0.9, 0.8, 0.7, 0.7, 0.8, 0.9, 1, 1] },
};

export function hatchScreen(ctx: MenuContext, slot: number): Screen {
  const t = ctx.text;
  const mon = ctx.state.party[slot];
  if (!mon || mon.isEgg) throw new Error(`hatch: party slot ${slot} holds no hatched Pokémon`);
  const sound = ctx.host.sound;
  const name = mon.nickname ?? ctx.registries.species.get(mon.species)!.name;
  const seq = (n: string): Id | null => {
    const id = t.id(n);
    if (ctx.registries.sequences.has(id)) return id;
    ctx.log.stub('menus:hatch-sound', `the pack has no ${n}: the hatch scene plays without it`);
    return null;
  };
  const se = (n: string) => {
    const id = seq(n);
    if (id && sound) sound.playSe(id);
  };

  let phase = 0;
  let sub = 0;
  let timer = 0;
  let frame = 0;
  const egg = { x: EGG_X, y: EGG_Y, sx: 1, sy: 1, shown: true };
  const shake = { progress: 0 };
  let bars: { top: number; bottom: number } | null = { top: BAR_TOP_REST, bottom: BAR_BOTTOM_REST };
  let white = 0;
  let fade: { from: number; to: number } | null = null;
  let showMon = false;
  let message: string | null = null;
  let yesNo: { cursor: 0 | 1 } | null = null;
  let answer: boolean | null = null;

  /** Decomp IncrementShakeAnimation + EggHatch_ShakeEgg: 'half' at progress 6, 'finished' one call after the lists end. */
  const shakeStep = (kind: Shake): 'started' | 'half' | 'finished' => {
    const s = SHAKES[kind];
    const p = shake.progress;
    if (p >= 10) {
      shake.progress = 0;
      return 'finished';
    }
    let done = 0;
    let x = s.x[p]!;
    let y = s.y[p]!;
    if (x === END) [x, done] = [0, done + 1];
    if (y === END) [y, done] = [0, done + 1];
    egg.x += x;
    egg.y += y;
    if (s.sx[p] !== 0) [egg.sx, egg.sy] = [s.sx[p]!, s.sy[p]!];
    else done++;
    if (done === 3) {
      shake.progress = 0;
      return 'finished';
    }
    shake.progress++;
    return shake.progress === 6 ? 'half' : 'started';
  };
  const next = () => {
    phase++;
    sub = 0;
    timer = 0;
  };
  const stepFade = (): boolean => {
    if (!fade) return true;
    white += Math.sign(fade.to - fade.from);
    if (white === fade.to) fade = null;
    return fade === null;
  };

  /** One decomp frame of EggHatchCutscene_Normal from state 3 (the fade-in is the field's). */
  const tick = (): Step => {
    switch (phase) {
      case 0:
        // State 2: Sound_SetSceneAndPlayBGM(SEQ_SHINKA).
        if (sound) sound.playBgm(seq('SEQ_SHINKA'));
        next();
        return;
      case 1: // InitializeEggAnimation
        if (++timer >= 25) {
          se('SEQ_SE_DP_EGG01');
          next();
        }
        return;
      case 2: // StartBreakingEgg
        if (sub === 0) [frame, sub] = [1, 1];
        else if (shakeStep('minor') === 'finished') {
          if (sub === 1) {
            se('SEQ_SE_DP_EGG01');
            [frame, sub] = [2, 2];
          } else {
            frame = 2;
            next();
          }
        }
        return;
      case 3: // FirstEggShardsBreakOff
      case 4: {
        // MoreEggShardsBreakAway
        if (sub === 0) return void (sub = 1);
        if (sub === 2) return void next();
        const r = shakeStep(phase === 3 ? 'big' : 'bigger');
        if (r === 'half') {
          se('SEQ_SE_DP_EGG01');
          frame = phase === 3 ? 3 : 4;
        }
        if (r === 'finished') sub = 2;
        return;
      }
      case 5: // CompleteEggAnimation
        if (sub === 0) [frame, sub] = [4, 1];
        else if (sub === 1) {
          const r = shakeStep('explosive');
          if (r === 'half') {
            frame = 5;
            se('SEQ_SE_DP_BOWA3');
          }
          if (r === 'finished') [egg.shown, sub, timer] = [false, 2, 0];
        } else if (sub === 2) {
          if (++timer >= 10) [fade, sub] = [{ from: 0, to: FADE }, 3];
        } else if (sub === 3) {
          const faded = stepFade();
          bars!.top = Math.max(BAR_TOP_GONE, bars!.top - 4);
          bars!.bottom = Math.min(192, bars!.bottom + 4);
          if (faded && bars!.top <= BAR_TOP_GONE && bars!.bottom >= 192) [showMon, bars, sub, timer] = [true, null, 4, 0];
        } else if (sub === 4) {
          if (++timer >= 25) [fade, sub] = [{ from: FADE, to: 0 }, 5];
        } else if (stepFade()) {
          // State 7's end: the Pokémon's cry and the message (EggHatch_PlayMonAnim's animation is not modelled).
          if (sound) sound.playCry(mon.species, mon.form);
          message = t.t('hatchHatched', name);
          next();
        }
        return;
      case 6: // states 8–9: the cry, then the fanfare
        if (sound?.cryPlaying()) return;
        if (sub === 0) {
          const f = seq('SEQ_FANFA5');
          if (f && sound) sound.playFanfare(f);
          sub = 1;
        }
        if (sound?.waitFanfare()) return;
        message = t.t('hatchNickname', name);
        yesNo = { cursor: 0 };
        next();
        return;
      default:
        return;
    }
  };

  const finish = (yes: boolean): Step => {
    yesNo = null;
    answer = yes;
    // Back to the field's BGM (decomp FieldTransition_StartMap).
    if (sound) sound.playBgm(sound.effectiveBgm(ctx.state.player.zone));
    if (!yes) return { close: { app: 'hatch', nickname: null } };
    const pokemon = { species: mon.species, form: mon.form, gender: monGender(dexOf(ctx.registries), mon) };
    return {
      push: namingScreen(ctx, { app: 'naming', kind: 'pokemon', initial: name, maxLength: MON_NAME_LEN, gender: ctx.state.gender, pokemon }, (nickname) => ({ close: { app: 'hatch', nickname } }), () => ctx.host.options().autoLowercase === 0),
    };
  };

  return {
    tick,
    view(): HatchView {
      const female = monGender(dexOf(ctx.registries), mon) === 'female';
      return {
        app: 'hatch',
        mon: { species: mon.species, form: mon.form, shiny: isShiny(mon.otId, mon.pid), female },
        egg: egg.shown ? { frame, x: egg.x, y: egg.y, scaleX: egg.sx, scaleY: egg.sy } : null,
        bars: bars ? { ...bars } : null,
        white,
        showMon,
        message: message === null ? null : { text: message, waiting: false },
        yesNo: yesNo ? { yes: t.t('hatchYes'), no: t.t('hatchNo'), cursor: yesNo.cursor } : null,
      };
    },
    input(i: Input): Step {
      if (!yesNo || answer !== null) return;
      if ('tap' in i) {
        if (i.tap === 'yes') return finish(true);
        if (i.tap === 'no' || i.tap === 'back') return finish(false);
        return;
      }
      if (i.button === 'up' || i.button === 'down') yesNo.cursor = yesNo.cursor === 0 ? 1 : 0;
      else if (i.button === 'a') return finish(yesNo.cursor === 0);
      else if (i.button === 'b') return finish(false);
      return;
    },
  };
}

