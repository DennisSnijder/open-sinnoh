/**
 * Poffin cooking, one player (decomp applications/poffin_berry_selection and overlay083): the bag's berries
 * (BAG_MODE_POFFIN_SINGLEPLAYER), then the cooking scene: the berry drops into the pot, the pour and START cues, the
 * stirring (services `PoffinCook`: three phases, burns and spills, the stirring direction), DONE, the RESULTS, the
 * Poffin put away and "Would you like to keep cooking Poffins?". The scene's presentation follows the decomp's
 * timing (ov83_0223B5A0.c states, ov83_0223D6A8.c sprites); its cosmetic randomness (the steam) has a stream of its
 * own, so it never moves the game's.
 *
 * Input: the stylus is `spoon:<x>,<y>` taps (down or moving, DS px of the pot) until `spoon-up`; on keys, Right
 * stirs clockwise and Left counter-clockwise round the pot at a fixed radius, faster with A held.
 */
import { Prng, type Button, type Id } from '@opensinnoh/core';
import { takeItem, type InputFrame, type PoffinCookingView, type Ui2dAnimation } from '@opensinnoh/contracts';
import { addPoffin, addToGameRecord, batterScale, berryFlavors, cookCheck, incrementTrainerScore, poffinLevel, POT_CENTER, POT_SPEED, PoffinCook } from '@opensinnoh/services';
import { bagScreen } from './bag.ts';
import { menuSe, type MenuContext } from './context.ts';
import type { Screen, Step } from './stack.ts';

/** TEXT_BANK_POFFIN_MAKING (pl_msg 464) messages by number. */
const making = (n: number) => `pl_msg_00000464_${String(n).padStart(5, '0')}`;
/** TEXT_BANK_POFFIN_TYPES (pl_msg 465): the Poffin names by type. */
export const poffinTypeName = (n: number) => `pl_msg_00000465_${String(n).padStart(5, '0')}`;
export const POFFIN_TEXTS = [...[1, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20, 21, 24, 25].map(making), ...Array.from({ length: 29 }, (_, i) => poffinTypeName(i))];

/** Decomp RECORD_UNK_052 (Poffins cooked alone) and TRAINER_SCORE_EVENT_UNK_12. */
const RECORD_COOKED_ALONE = 52;
const SCORE_COOKED_ALONE = 12;
/** SEQ_KINOMI1, the cooking's music (Sound_SetSceneAndPlayBGM). */
const BGM_COOKING = 1183;
/** Sounds (SDAT sequence indexes): the berry's splash, the START beeps, the lap ticks, the spills and burns, the arrows, DONE, the results. */
const SE = { splash: 1724, beep: 1725, beepLast: 1726, arrows: 1729, done: 1730, results: 1731, lap: [1713, 1718, 1722], spill: [1714, 1720, 1720], burn: [1715, 1715, 1723] };
/** StartScreenFade(…, 6, 1): the fades' length in frames. */
const FADE = 6;
/** Decomp Unk_ov83_02240460[0]: the berry's drop: x 64→96, y −32→88 over 32 frames, from rest, after 10 frames. */
const DROP = { x0: 64, x1: 96, y0: -32, y1: 88, frames: 32, delay: 10 };
/** B9EC case 3: frames from the last splash to the pour cue. */
const AFTER_DROP = 24;
/** Decomp E908: a banner shows 30 frames; Unk_ov83_02240414/48: the flames' pulse per phase (frames, smallest scale). */
const BANNER_FRAMES = 30;
const PULSE = [
  { frames: 4, min: 4014 },
  { frames: 3, min: 3891 },
  { frames: 2, min: 3768 },
];
/** C600's banner messages: a spill's (Unk 1: 3 + [1, 3, 0]) and a burn's (Unk 2: 3 + [0, 2, 4]), per phase. */
const SPILL_BANNER = [4, 6, 3];
const BURN_BANNER = [3, 5, 7];
/** F410/F44C arrows: 8 frames on, 9 off; an announcement blinks 3 times. */
const BLINK = 17;
const ANNOUNCE = BLINK * 3;
/** BF74: the results' steps (30 frames apart), its wait (600 frames or a press), the put-away message's (150). */
const RESULT_STEP = 30;
const RESULT_WAIT = 600;
const PUT_AWAY_WAIT = 150;
/** Keys: the stylus' stand-in circles the pot at this radius, so many px of arc per frame (faster with A). */
const KEY_RADIUS = 48;
const KEY_ARC = { normal: 32, fast: 48 };

/**
 * Decomp Unk_ov83_022404B0 (ED3C): each phase's steam (a warning), burn and spill: the scale's start and random range,
 * the outward speed, the start radius and its random range, the length and its random range, frames, the puff set and
 * animation, `burn` (it stays and shrinks once stirred), `grow` (scaled), `turn` (turns with the batter).
 */
const EFFECTS = [
  { scale: 2048, scaleRange: 6144, speed: 0, r0: 32, r0Range: 64, len: 0, lenRange: 0, frames: 32, set: 0, anim: 1, burn: false, grow: false, turn: false },
  { scale: 2048, scaleRange: 4096, speed: 0, r0: 0, r0Range: 8, len: 0, lenRange: 24, frames: 16, set: 0, anim: 2, burn: true, grow: true, turn: true },
  { scale: 2048, scaleRange: 6144, speed: 8192, r0: 32, r0Range: 64, len: 32, lenRange: 64, frames: 16, set: 0, anim: 0, burn: false, grow: false, turn: false },
  { scale: 2048, scaleRange: 6144, speed: 0, r0: 32, r0Range: 64, len: 0, lenRange: 0, frames: 32, set: 1, anim: 1, burn: false, grow: false, turn: false },
  { scale: 2048, scaleRange: 4096, speed: 0, r0: 0, r0Range: 8, len: 0, lenRange: 24, frames: 16, set: 1, anim: 2, burn: true, grow: true, turn: true },
  { scale: 2048, scaleRange: 6144, speed: 16384, r0: 32, r0Range: 64, len: 32, lenRange: 64, frames: 16, set: 1, anim: 0, burn: false, grow: false, turn: false },
  { scale: 2048, scaleRange: 6144, speed: 0, r0: 32, r0Range: 64, len: 0, lenRange: 0, frames: 32, set: 2, anim: 0, burn: false, grow: false, turn: false },
  { scale: 2048, scaleRange: 6144, speed: 0, r0: 32, r0Range: 64, len: 0, lenRange: 0, frames: 32, set: 2, anim: 1, burn: false, grow: false, turn: false },
];
/** At most 8 effects; a new one replaces the oldest. */
const MAX_EFFECTS = 8;

/** Decomp ov83_0223DA34 / DA94: from `from` to `to` in `frames` frames starting at speed `v0` (uniformly accelerated). */
function accelerated(from: number, to: number, v0: number, frames: number, t: number): number {
  const a = (2 * (to - from - v0 * frames)) / (frames * frames);
  return from + v0 * t + (a * t * t) / 2;
}

interface Effect {
  row: (typeof EFFECTS)[number];
  frame: number;
  angle: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  vx: number;
  vy: number;
  s0: number;
  s1: number;
  /** The shrink once stirred (decomp ov83_0223F268): its start scale and frame, or null. */
  shrink: { from: number; frame: number } | null;
  burn: boolean;
  /** The turn with the batter once settled (decomp ov83_0223F0F4). */
  turned: number;
  serial: number;
}

/** A sheet's animation length in frames (Infinity when it loops), from the base pack's ui2d record. */
function animLength(ctx: MenuContext, sheet: string, anim: number): number {
  const id = `${ctx.text.ns}:ui2d/poffin_cooking/${sheet}` as Id;
  const a: Ui2dAnimation | undefined = ctx.registries.ui2d.get(id)?.animations?.[anim];
  if (!a) throw new Error(`poffin cooking: the ${ctx.text.ns} pack has no ${id} animation ${anim}`);
  return a.mode === 'forward' ? a.frames.reduce((n, f) => n + f.ticks, 0) : Infinity;
}

/** The cooking app: the bag first; each berry picked is cooked, until the player stops. */
export function poffinCookingApp(ctx: MenuContext): Screen {
  const zoneBgm = () => ctx.host.sound?.effectiveBgm(ctx.state.player.zone) ?? null;
  return bagScreen(ctx, {
    kind: 'poffin',
    done: (item) => {
      if (item === null) return { close: { app: 'poffin-cooking' } };
      // PoffinBerrySelection_RunBagApp: the berry leaves the bag before the cooking.
      if (!takeItem(ctx.state, item, 1)) throw new Error(`poffin cooking: no ${item} in the bag`);
      return {
        push: cookingScreen(ctx, item, (again) => {
          const field = zoneBgm();
          if (!again) {
            if (field) ctx.host.sound?.playBgm(field);
            return { close: { app: 'poffin-cooking' } };
          }
          return 'pop';
        }),
      };
    },
  });
}

type Stage = 'fade-in' | 'drop' | 'wait' | 'pour' | 'start' | 'cook' | 'done' | 'fade-out' | 'results';

/** The cooking scene of one berry; `done(again)` when the player answers "keep cooking?" (or cannot). */
export function cookingScreen(ctx: MenuContext, berry: Id, done: (again: boolean) => Step): Screen {
  const t = ctx.text;
  const rng = { next: () => mainNext(), below: (n: number) => mainNext() % n };
  const mainNext = (): number => {
    const p = Prng.from(ctx.state.rng);
    const v = p.next();
    ctx.state.rng = p.save();
    return v;
  };
  const cosmetic = new Prng((ctx.state.seed ^ 0x504f4646 ^ ctx.state.tick) >>> 0); // "POFF"
  const cook = new PoffinCook(rng);
  const berryData = berryFlavors(ctx.registries, berry);
  const se = (n: number) => menuSe(ctx, n);
  const bgm = ctx.registries.sequences.get(`${t.ns}:SEQ_KINOMI1` as Id)?.id ?? [...ctx.registries.sequences.values()].find((s) => s.sourceIndex === BGM_COOKING)?.id;
  if (bgm) ctx.host.sound?.playBgm(bgm);

  const lengths = {
    splash: animLength(ctx, 'interface', 1),
    start: animLength(ctx, 'interface', 0),
    pour: animLength(ctx, 'interface', 2),
    done: animLength(ctx, 'done', 0),
    puff: (set: number, anim: number) => animLength(ctx, `puff${set}`, anim),
  };

  let stage: Stage = 'fade-in';
  let frame = 0;
  let tick = 0;
  let top: string | null = null;
  let banner: { text: string; frame: number } | null = null;
  /** The pot's display angle (C3E8: it adds the speed each frame) and the flames' pulse. */
  let displayAngle = 0;
  let pulse = { from: 4096, to: PULSE[0]!.min, frames: PULSE[0]!.frames, t: 0, value: 4096 };
  /** Arrows: the announcement (0 or 2) and its frame, the warning (1 or 3) and its frame. */
  let announce: { arrow: number; frame: number } | null = null;
  let warning: { arrow: number; frame: number } | null = null;
  let effects: Effect[] = [];
  let effectSerial = 0;
  /** The keyboard's stylus: its angle on the KEY_RADIUS circle. */
  let keyAngle = -Math.PI / 2;
  let spoon: { x: number; y: number } | null = null;
  /**
   * The results (BF74's cases): `show` fades in with the title (case 0), the rows after 30 frames (case 2), the Poffin
   * after 30 more (case 3); `wait` holds 600 frames or a press (case 4); `put-away` the Poffin goes in the case and its
   * message holds 150 frames or a press (cases 5–6); `ask` "keep cooking?" (cases 7–8); `refused` the case is full or
   * no berry is left (case 10: 150 frames or a press); `out` fades out.
   */
  let made: ReturnType<PoffinCook['result']> | null = null;
  let results: 'show' | 'wait' | 'put-away' | 'ask' | 'refused' = 'show';
  let message: string | null = null;
  let yesCursor: 0 | 1 = 0;
  let ending: boolean | null = null;
  const ROWS_AT = FADE + RESULT_STEP + 1;
  const MADE_AT = ROWS_AT + RESULT_STEP + 1;

  const startPulse = (phase: number, first: boolean) => {
    const p = PULSE[Math.min(phase, 2)]!;
    pulse = first ? { from: 4096, to: p.min, frames: p.frames, t: 0, value: 4096 } : { from: p.min, to: 4096, frames: p.frames, t: 0, value: p.min };
  };
  /** Decomp ov83_0223E51C: the flames' scale runs from the phase's smallest to 1 and starts again. */
  const stepPulse = () => {
    if (pulse.t > pulse.frames) startPulse(cook.phase, false);
    pulse.value = pulse.from + Math.trunc(((pulse.to - pulse.from) * pulse.t) / pulse.frames);
    pulse.t++;
  };

  /** Decomp ov83_0223EDDC: a puff of steam, a burn's smoke or a spill's drops, in a random direction. */
  const addEffect = (phase: number, kind: 0 | 1 | 2) => {
    const index = phase * 3 + kind;
    if (index >= EFFECTS.length) return;
    const row = EFFECTS[index]!;
    if (effects.length >= MAX_EFFECTS) effects.splice(effects.indexOf(effects.reduce((a, b) => (a.serial < b.serial ? a : b))), 1);
    const angle = (cosmetic.next() & 0xffff) / 0x10000;
    const r0 = row.r0 + (cosmetic.next() % row.r0Range);
    const r1 = r0 + row.len + (row.lenRange ? cosmetic.next() % row.lenRange : 0);
    const sin = Math.sin(angle * Math.PI * 2);
    const cos = Math.cos(angle * Math.PI * 2);
    effects.push({
      row,
      frame: 0,
      angle,
      x0: POT_CENTER.x + sin * r0,
      x1: POT_CENTER.x + sin * r1,
      y0: POT_CENTER.y + cos * r0,
      y1: POT_CENTER.y + cos * r1,
      vx: (sin * row.speed) / 4096,
      vy: (cos * row.speed) / 4096,
      s0: 410,
      s1: row.scale + (cosmetic.next() % row.scaleRange),
      shrink: null,
      burn: row.burn,
      turned: 0,
      serial: effectSerial++,
    });
  };
  /** Decomp ov83_0223EDA4 (ov83_0223F074, F0F4) and ov83_0223EFCC: effects move, settle, turn with the batter, shrink once stirred. */
  const stepEffects = () => {
    if (Math.abs(cook.speed) > POT_SPEED.slow) for (const e of effects) if (e.burn) {
        e.burn = false;
        e.shrink = { from: effectScale(e), frame: 0 };
      }
    effects = effects.filter((e) => {
      e.frame++;
      if (e.shrink) e.shrink.frame++;
      const moved = e.frame >= e.row.frames;
      const animated = e.frame < lengths.puff(e.row.set, e.row.anim);
      if (moved && !animated && e.row.turn) e.turned += cook.speed;
      if (e.shrink) return e.shrink.frame < 8;
      return e.burn || !(moved && !animated);
    });
  };
  const effectScale = (e: Effect): number => {
    if (e.shrink) return e.shrink.from + ((205 - e.shrink.from) * Math.min(e.shrink.frame, 8)) / 8;
    if (!e.row.grow) return 4096;
    return accelerated(e.s0, e.s1, 0, e.row.frames, Math.min(e.frame, e.row.frames));
  };
  const effectView = (e: Effect) => {
    const t2 = Math.min(e.frame, e.row.frames);
    let x = accelerated(e.x0, e.x1, e.vx, e.row.frames, t2);
    let y = accelerated(e.y0, e.y1, e.vy, e.row.frames, t2);
    if (e.turned) {
      const dx = x - POT_CENTER.x;
      const dy = y - POT_CENTER.y;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx) + (e.turned / 0x10000) * Math.PI * 2;
      x = POT_CENTER.x + Math.cos(a) * r;
      y = POT_CENTER.y + Math.sin(a) * r;
    }
    const length = lengths.puff(e.row.set, e.row.anim);
    return { set: e.row.set, anim: e.row.anim, frame: Number.isFinite(length) ? Math.min(e.frame, length - 1) : e.frame, x: Math.round(x), y: Math.round(y), scale: Math.round(effectScale(e)) };
  };

  /** The stylus this frame: the touch (held until `spoon-up`), else the keys' stand-in, else none. */
  let touch: { x: number; y: number } | null = null;
  const readSpoon = (f: InputFrame): { x: number; y: number } | null => {
    const m = f.tap ? /^spoon:(-?\d+),(-?\d+)$/.exec(f.tap) : null;
    if (m) touch = { x: Math.max(0, Math.min(255, Number(m[1]))), y: Math.max(0, Math.min(191, Number(m[2]))) };
    if (f.tap === 'spoon-up') touch = null;
    if (touch) return { ...touch };
    const dir = f.held.includes('right') ? 1 : f.held.includes('left') ? -1 : 0;
    if (!dir) return null;
    keyAngle += (dir * (f.held.includes('a') ? KEY_ARC.fast : KEY_ARC.normal)) / KEY_RADIUS;
    return { x: Math.round(POT_CENTER.x + Math.cos(keyAngle) * KEY_RADIUS), y: Math.round(POT_CENTER.y + Math.sin(keyAngle) * KEY_RADIUS) };
  };

  /** C3E8's sprite and sound updates after a cooking frame. */
  const present = () => {
    const ev = cook.events;
    const sign = cook.speed < 0 ? 1 : 0;
    displayAngle = (displayAngle + cook.speed) & 0xffff;
    stepPulse();
    // C758: a new direction is announced (arrow 0 clockwise, 2 counter-clockwise).
    if (ev.direction) {
      announce = { arrow: cook.direction === 0 ? 0 : 2, frame: 0 };
      warning = null;
      se(SE.arrows);
    } else if (announce && ++announce.frame >= ANNOUNCE) announce = null;
    // C558: stirred against the direction asked for: the warning arrow blinks.
    if (announce || cook.speed === 0 || cook.direction === sign) warning = null;
    else if (!warning) {
      warning = { arrow: cook.direction === 0 ? 1 : 3, frame: 0 };
      se(SE.arrows);
    } else warning.frame++;
    // C600, C6D4: spills and burns: a banner (not while an arrow shows), the effects and their sounds.
    const phase = Math.min(cook.phase, 2);
    if (warning || announce) banner = null;
    else if (ev.spill) banner = { text: t.message(making(SPILL_BANNER[phase]!)), frame: 0 };
    else if (ev.burn) banner = { text: t.message(making(BURN_BANNER[phase]!)), frame: 0 };
    else if (banner && ++banner.frame >= BANNER_FRAMES) banner = null;
    if (ev.spill) {
      addEffect(phase, 2);
      se(SE.spill[phase]!);
    }
    if (ev.burn === 'burn') {
      addEffect(phase, 1);
      se(SE.burn[phase]!);
    }
    else if (ev.burn === 'warn') addEffect(phase, 0);
    stepEffects();
  };

  const finishCooking = () => {
    // BCEC case 3: the game records; case 4: the Poffin (ov83_0223FFD4).
    incrementTrainerScore(ctx.state, ctx.registries, SCORE_COOKED_ALONE);
    addToGameRecord(ctx.state, ctx.registries, RECORD_COOKED_ALONE, 1);
    made = cook.result(berryData);
  };

  /** BF74 case 8: YES cooks again unless the case is full or no berry is left (the message, then out). */
  const answer = (yes: boolean): Step => {
    se(1500);
    if (!yes) return finish(false);
    const check = cookCheck(ctx.state);
    if (check === 0) return finish(true);
    message = t.message(making(check === 2 ? 24 : 25));
    results = 'refused';
    frame = 0;
    return;
  };
  const finish = (again: boolean): Step => {
    stage = 'fade-out';
    frame = 0;
    ending = again;
    message = null;
    results = 'show';
    return;
  };

  const step = (f: InputFrame): Step => {
    tick++;
    frame++;
    const press = (b: Button) => f.pressed.includes(b);
    const confirm = press('a') || press('b') || f.tap === 'next' || f.tap?.startsWith('spoon:');
    switch (stage) {
      case 'fade-in':
        if (frame >= FADE) {
          stage = 'drop';
          frame = 0;
        }
        return;
      case 'drop': {
        // DD30: after its delay the berry drops (the top screen names it), then splashes.
        if (frame === DROP.delay) top = t.message(making(1), berryName());
        if (frame === DROP.delay + DROP.frames) se(SE.splash);
        if (frame >= DROP.delay + DROP.frames + lengths.splash) {
          stage = 'wait';
          frame = 0;
          top = null;
        }
        return;
      }
      case 'wait':
        if (frame > AFTER_DROP) {
          stage = 'pour';
          frame = 0;
        }
        return;
      case 'pour':
        if (frame >= lengths.pour) {
          stage = 'start';
          frame = 0;
        }
        return;
      case 'start': {
        // B9EC case 5: a beep every third frame of START (the last ones higher).
        const f0 = frame - 1;
        if (Math.floor(f0 / 3) !== Math.floor((f0 - 1) / 3) || f0 === 0) se(f0 < 10 ? SE.beep : SE.beepLast);
        if (frame >= lengths.start) {
          stage = 'cook';
          frame = 0;
          startPulse(0, true);
        }
        return;
      }
      case 'cook': {
        spoon = readSpoon(f);
        const lapBefore = cook.angle;
        const sign = cook.speed < 0 ? 1 : 0;
        if (!cook.step(spoon)) {
          stage = 'done';
          frame = 0;
          banner = null;
          announce = null;
          warning = null;
          spoon = null;
          touch = null;
          se(SE.done);
          return;
        }
        if ((sign === 0 && lapBefore > cook.angle) || (sign === 1 && lapBefore < cook.angle)) se(SE.lap[Math.min(cook.phase, 2)]!);
        present();
        return;
      }
      case 'done':
        stepEffects();
        if (frame >= lengths.done) {
          stage = 'fade-out';
          frame = 0;
          finishCooking();
        }
        return;
      case 'fade-out':
        if (frame < FADE) return;
        if (ending !== null) return done(ending);
        stage = 'results';
        results = 'show';
        frame = 0;
        return;
      case 'results':
        return stepResults(confirm);
    }
  };

  /** BF74: RESULTS (fade in, the rows, the Poffin), its wait, the put-away message, the question. */
  const stepResults = (confirm: boolean | undefined): Step => {
    switch (results) {
      case 'show':
        if (frame === ROWS_AT || frame === MADE_AT) se(SE.results);
        if (frame >= MADE_AT) {
          results = 'wait';
          frame = 0;
        }
        return;
      case 'wait':
        if (frame > 1 && (confirm || frame >= RESULT_WAIT)) {
          results = 'put-away';
          frame = 0;
          // Case 5 (ov83_0223C8B0): the Poffin goes in the case.
          if (!addPoffin(ctx.state, made!)) throw new Error('poffin cooking: the case filled up while cooking');
          // Cooking alone, the Poffin's type for the Poffin House reporter (sub_0206CFCC).
          ctx.state.tv.pending.poffin = made!.type;
          message = t.message(making(20), ctx.state.names.player, '', '', poffinName(made!.type));
        }
        return;
      case 'put-away':
        if (frame > 1 && (confirm || frame >= PUT_AWAY_WAIT)) {
          results = 'ask';
          message = t.message(making(21));
          yesCursor = 0;
        }
        return;
      case 'refused':
        if (frame > 1 && (confirm || frame >= PUT_AWAY_WAIT)) return finish(false);
        return;
      case 'ask':
        return;
    }
  };

  const berryName = () => ctx.registries.items.get(berry)!.name;
  const poffinName = (type: number) => t.message(poffinTypeName(type));

  const view = (): PoffinCookingView => {
    const dropT = stage === 'drop' ? frame - DROP.delay : -1;
    const time = cook.time();
    const fade =
      stage === 'fade-in' ? Math.round(16 * (1 - frame / FADE))
      : stage === 'fade-out' ? Math.round((16 * Math.min(frame, FADE)) / FADE)
      : stage === 'results' && results === 'show' && frame < FADE ? Math.round(16 * (1 - frame / FADE))
      : 0;
    const shown = stage === 'results' && (results === 'show' || results === 'wait');
    const rowsShown = results === 'wait' || frame >= ROWS_AT;
    const madeShown = results === 'wait' || frame >= MADE_AT;
    const resultView =
      shown
        ? {
            title: t.message(making(9)),
            rows: [
              ...(rowsShown
                ? [
                    { label: t.message(making(10)), value: t.message(making(11), String(time.minutes).padStart(2, '0'), String(time.seconds).padStart(2, '0'), String(time.hundredths).padStart(2, '0')) },
                    { label: t.message(making(12)), value: t.message(making(cook.spills === 1 ? 13 : 15), String(cook.spills)) },
                    { label: t.message(making(14)), value: t.message(making(cook.burns === 1 ? 13 : 15), String(cook.burns)) },
                  ]
                : []),
            ],
            made: { label: t.message(making(16)), value: madeShown && made ? t.message(making(17), '', String(poffinLevel(made)).padStart(2, ' '), '1', poffinName(made.type)) : '' },
            poffin: madeShown && made ? made.type : -1,
          }
        : null;
    const cooking = stage === 'cook' || stage === 'done';
    const phase = Math.min(cook.phase, 2);
    return {
      app: 'poffin-cooking',
      tick,
      fade,
      top,
      berries: dropT >= 0 && dropT <= DROP.frames ? [{ item: berry, x: Math.round(accelerated(DROP.x0, DROP.x1, 0, DROP.frames, dropT)), y: Math.round(accelerated(DROP.y0, DROP.y1, 0, DROP.frames, dropT)) }] : [],
      splashes: dropT > DROP.frames ? [{ x: DROP.x1, y: DROP.y1, frame: dropT - DROP.frames - 1 }] : [],
      cue: stage === 'pour' ? { kind: 'pour', frame } : stage === 'start' ? { kind: 'start', frame } : stage === 'done' ? { kind: 'done', frame } : null,
      pot:
        stage === 'results'
          ? null
          : { phase, angle: displayAngle, scale: batterScale(cook.speed), pulse: pulse.value, fade: cooking ? cook.fade : 31, flames: stage === 'cook' },
      arrows: stage === 'cook' ? [...(announce && announce.frame % BLINK < 8 ? [announce.arrow] : []), ...(warning && warning.frame % BLINK < 8 ? [warning.arrow] : [])] : [],
      banner: banner?.text ?? null,
      effects: effects.map(effectView),
      spoon: stage === 'cook' && spoon && !touch ? spoon : null,
      results: resultView,
      message: message !== null ? { text: message, waiting: results !== 'ask' } : null,
      yesNo: results === 'ask' && stage === 'results' ? { yes: t.t('yes'), no: t.t('no'), cursor: yesCursor } : null,
    };
  };

  return {
    tick: step,
    view,
    input(i): Step {
      if (stage !== 'results' || results !== 'ask') return;
      if ('tap' in i) {
        if (i.tap === 'yes' || i.tap === 'no') return answer(i.tap === 'yes');
        return;
      }
      if (i.button === 'up' || i.button === 'down') yesCursor = yesCursor ? 0 : 1;
      else if (i.button === 'a') return answer(yesCursor === 0);
      else if (i.button === 'b') return answer(false);
      return;
    },
  };
}
