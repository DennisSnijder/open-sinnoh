/**
 * The evolution scene (decomp evolution.c, Evolution_Main): a port of its state machine, one decomp frame
 * per 30 Hz tick. SysTask_Evolution is a main-loop task and NitroMain waits two vblanks per loop; the
 * palette fade task, the sprite fades (VBlank callback), the sprite animations, the particles
 * (sub_0207C770) and the cry delay also step once per loop, the text printer twice. The Pokémon flashes
 * white, the two silhouettes swap by shrinking and growing faster and faster (8, 16, 32, then 64 scale
 * steps a frame) while the ROM's particle emitters run (the swapping stops when they are all done), the
 * window clamps in and out, the screen flashes white and the new Pokémon appears with its cry. B stops it while it swaps (when the
 * caller allows it). Then "Congratulations!", the data change, the Pokédex, the moves of the new level
 * (with the forget-a-move flow through the summary screen) and the Shedinja copy or the used-up held item.
 *
 * Messages are the battle strings bank's (decomp TEXT_BANK_BATTLE_STRINGS) through the DS text printer
 * with its callbacks ({wait 3} the evolution fanfare, {wait 5} the move fanfare, {wait 2} waits for a
 * fanfare to end, {wait 4} the "Poof!" sound).
 */
import { addPoketchHistory, dexOf, itemCount, markCaught, takeItem, type AppYesNo, type EvolutionRequest, type EvolutionSpriteView, type EvolutionView, type InputFrame, type Ui2dEmitter } from '@opensinnoh/contracts';
import { evolve, isShiny, monGender, movesAtLevel, PARTY_SIZE, setMoveSlot, shedinjaFrom, type Id, type Pokemon } from '@opensinnoh/core';
import { TEXT_SPEED, TextPrinter, plainMarkup, toPrintOps } from '@opensinnoh/text';
import type { MenuContext } from './context.ts';
import { monName } from './party.ts';
import { ParticleSystem } from './particles.ts';
import type { Screen, Step } from './stack.ts';
import { summaryScreen } from './summary.ts';

/** The battle strings this scene prints (decomp battle_strings.gmm names, `<ns>:BattleStrings_Text_<name>`). */
export const EVOLUTION_STRINGS = [
  'What',
  'PokemonIsEvolving',
  'WhatPokemonIsEvolving',
  'CongratulationsYourPokemonEvolvedIntoPokemon',
  'HuhPokemonStoppedEvolving',
  'PokemonLearnedMove',
  'PokemonWantsToLearnTheMove',
  'HoweverPokemonAlreadyKnowsFourMoves',
  'ShouldAMoveBeDeleted',
  'StopTryingToTeachMove',
  'PokemonDidNotLearnTheMove',
  'EvolutionOneTwoAndPoof',
  'PokemonForgotHowToUseMove',
  'EvolutionAndDotDotDot',
  'EvolvedPokemonLearnedMove',
].map((n) => `BattleStrings_Text_${n}`);

/** Decomp sequence numbers (SEQ_*), played by `sourceIndex`; a pack without one plays nothing (logged). */
const SEQ = { shinka: 1141, fanfa1: 1155, fanfa5: 1156, confirm: 1500, kon: 1510, w025: 1529, w060c: 1530, w062: 1531, w080: 1532 } as const;
/** Decomp sub_0207C854: the emitters start 8 · 172 / 4096 units above the centre. */
const PARTICLE_ORIGIN: [number, number, number] = [0, (8 * 172) / 4096, 0];
/** MON_AFFINE_SCALE(1). */
const FULL = 256;

type Fade = { cur: number; end: number; wait: number; waitStep: number; color: 'black' | 'white'; box: boolean; active: boolean };
type SpriteState = { species: Id; scale: number; level: number; step: number; target: number; delay: number; counter: number; color: 'black' | 'white'; fading: boolean; anim: number | null };

/** Decomp enum EvolutionState, the states this port uses. */
type State =
  | 'start-delay'
  | 'reset-brightness'
  | 'print-what'
  | 'wait-what'
  | 'print-evolving'
  | 'wait-evolving'
  | 'start-fade'
  | 'clamp-in'
  | 'alternate'
  | 'clamp-out'
  | 'evolved-cry'
  | 'set-values'
  | 'log'
  | 'check-learn'
  | 'print-wants'
  | 'wait-wants'
  | 'print-four'
  | 'wait-four'
  | 'print-delete'
  | 'wait-delete'
  | 'ask-delete'
  | 'answer-delete'
  | 'summary-fade'
  | 'summary'
  | 'summary-back'
  | 'print-poof'
  | 'wait-poof'
  | 'print-forgot'
  | 'wait-forgot'
  | 'print-and'
  | 'wait-and'
  | 'print-learned'
  | 'print-stop'
  | 'ask-stop'
  | 'answer-stop'
  | 'wait-not-learned'
  | 'wait-learned'
  | 'learned-fanfare'
  | 'no-move'
  | 'end'
  | 'cancel'
  | 'cancel-cry'
  | 'stopped'
  | 'fade-stopped'
  | 'end-stopped'
  | 'done';

/** Moves through the waiting messages: these states go to the next one in this list. */
const WAIT_NEXT: Partial<Record<State, State>> = {
  'wait-wants': 'print-four',
  'wait-four': 'print-delete',
  'wait-delete': 'ask-delete',
  'wait-poof': 'print-forgot',
  'wait-forgot': 'print-and',
  'wait-and': 'print-learned',
  'wait-not-learned': 'check-learn',
};

export function evolutionScreen(ctx: MenuContext, req: Omit<EvolutionRequest, 'app'>, done: (evolved: boolean) => Step): Screen {
  const reg = ctx.registries;
  const dex = dexOf(reg);
  const ns = ctx.text.ns;
  const mon = ctx.state.party[req.slot];
  if (!mon || mon.isEgg) throw new Error(`evolution: no Pokémon in party slot ${req.slot}`);
  dex.species(req.target);
  const canCancel = req.source === 'battle' || req.source === 'level';
  const sound = ctx.host.sound;
  const bySource = new Map<number, Id>();
  for (const s of reg.sequences.values()) if (s.sourceIndex !== undefined) bySource.set(s.sourceIndex, s.id);
  const seq = (n: number): Id | null => {
    const id = bySource.get(n) ?? null;
    if (!id && sound) ctx.log.stub('audio:sequence-missing', `no sequence with sourceIndex ${n} in the packs: not played`);
    return id;
  };
  const playSe = (n: number) => {
    const id = sound && seq(n);
    if (id) sound.playSe(id);
  };
  const sheet = reg.ui2d.get(`${ns}:ui2d/evolution/particles` as Id);
  if (!sheet?.emitters) throw new Error(`evolution: the ${ns} pack has no ui2d/evolution/particles emitters`);
  const emitters: readonly Ui2dEmitter[] = sheet.emitters;
  // The particles' own randomness: from the Pokémon, so a replay draws the same sparkles.
  const particles = new ParticleSystem(emitters, PARTICLE_ORIGIN, (mon.pid ^ req.slot) >>> 0);
  const startEmitters = (...ids: number[]) => ids.forEach((i) => particles.start(i));

  const sprite = (species: Id, scale: number): SpriteState => ({ species, scale, level: 16, step: 16, target: 16, delay: 0, counter: 0, color: 'black', fading: false, anim: null });
  const sprites: [SpriteState, SpriteState] = [sprite(mon.species, FULL), sprite(req.target, 0)];
  let hidden1 = false;
  const fade: Fade = { cur: 0, end: 0, wait: 0, waitStep: 0, color: 'black', box: true, active: false };
  const win = { top: 0, bottom: 160 };
  let shrink = 0;
  let delta = 0;
  let state: State = 'start-delay';
  let delay = 2;
  let printer: TextPrinter | null = null;
  let yesNo: (AppYesNo & { question: 'forget' | 'give-up'; then: (yes: boolean) => void }) | null = null;
  let summaryResult: number | null | undefined;
  /** The cry waiting for its delay (Sound_PlayDelayedPokemonCry), in ticks. */
  let cry: { species: Id; frames: number } | null = null;
  let pendingMoves: Id[] = [];
  let move: Id | null = null;
  let moveSlot = 0;
  const oldName = monName(ctx, mon);
  const name = () => monName(ctx, mon);
  const moveName = (id: Id) => reg.moves.get(id)?.name ?? id;

  // --- fades (decomp PaletteData_StartFade: two steps a frame after `wait` frames; PokemonSprite_StartFade: one step after `delay`) ---
  const startFade = (from: number, to: number, wait: number, color: 'black' | 'white', box: boolean) => Object.assign(fade, { cur: from, end: to, wait, waitStep: wait, color, box, active: true });
  const fadeFrame = () => {
    if (!fade.active) return;
    if (fade.waitStep < fade.wait) {
      fade.waitStep++;
      return;
    }
    fade.waitStep = 0;
    applied = fade.cur;
    if (fade.cur === fade.end) fade.active = false;
    else fade.cur = fade.cur < fade.end ? Math.min(fade.end, fade.cur + 2) : Math.max(fade.end, fade.cur - 2);
  };
  /** The level the screen shows (the last applied step). */
  let applied = 16;
  const startSpriteFade = (s: SpriteState, from: number, to: number, delayLength: number, color: 'black' | 'white') =>
    Object.assign(s, { step: from, target: to, delay: delayLength, counter: 0, color, fading: true });
  /** PokemonSpriteManager_UpdateCharAndPltt: every `delay` + 1 frames the colour blends at the step, which moves one toward the target. */
  const spriteFadeFrame = (s: SpriteState) => {
    if (!s.fading) return;
    if (s.counter) {
      s.counter--;
      return;
    }
    s.counter = s.delay;
    s.level = s.step;
    if (s.step === s.target) s.fading = false;
    else s.step += s.step > s.target ? -1 : 1;
  };

  // --- the Pokémon's front animation (PokemonSprite_InitAnim: the record's frames, in ticks) ---
  const frontAnim = (species: Id) => reg.pokemonSprites.get(species)?.front ?? null;
  const animFrames = (species: Id) => {
    const a = frontAnim(species);
    return a ? a.frames.reduce((n, f) => n + f.ticks, 0) : 0;
  };
  const startAnim = (i: 0 | 1) => {
    sprites[i].anim = 0;
    const a = frontAnim(sprites[i].species);
    cry = { species: sprites[i].species, frames: a?.cryDelay ?? 0 };
  };
  const animDone = (i: 0 | 1) => sprites[i].anim === null || sprites[i].anim! >= animFrames(sprites[i].species);
  const cryBusy = () => cry !== null || (sound?.cryPlaying() ?? false);

  // --- text (Evolution_PrintString, Evolution_TextPrinterCallback) ---
  const callback = (param: number): boolean => {
    switch (param) {
      case 1:
        return false; // Sound_IsAnyEffectPlaying: not used by these strings.
      case 2:
        return sound?.waitFanfare() ?? false;
      case 3: {
        const id = sound && seq(SEQ.fanfa5);
        if (id) sound.playFanfare(id);
        return false;
      }
      case 4:
        playSe(SEQ.kon);
        return false;
      case 5: {
        const id = sound && seq(SEQ.fanfa1);
        if (id) sound.playFanfare(id);
        return false;
      }
      default:
        return false;
    }
  };
  const print = (name: string, ...slots: string[]) => {
    const rec = reg.texts.get(`${ns}:BattleStrings_Text_${name}` as Id);
    if (!rec) throw new Error(`evolution: the ${ns} pack has no BattleStrings_Text_${name}`);
    const speed = [TEXT_SPEED.slow, TEXT_SPEED.normal, TEXT_SPEED.fast][ctx.host.options().textSpeed] ?? TEXT_SPEED.normal;
    printer = new TextPrinter(toPrintOps(rec.text, slots.map(plainMarkup)), { speed, canSpeedUp: true, callback });
  };
  const printing = () => printer !== null && !printer.done;
  const ask = (question: 'forget' | 'give-up', then: (yes: boolean) => void) => {
    yesNo = { yes: ctx.text.t('yes'), no: ctx.text.t('no'), cursor: 0, question, then };
  };

  // --- the end (Evolution_ProcessEvolutionEffects) ---
  const effects = () => {
    if (req.method === 'LEVEL_NINJASK' || req.method === 'LEVEL_SHEDINJA') {
      const ball = `${ns}:ITEM_POKE_BALL` as Id;
      if (itemCount(ctx.state, ball) > 0 && ctx.state.party.length < PARTY_SIZE) {
        const shedinja = shedinjaFrom(dex, mon, `${ns}:SPECIES_SHEDINJA` as Id, ball);
        ctx.state.party.push(shedinja);
        markCaught(ctx.state, ctx.registries, shedinja);
        ctx.log.stub('evolution:records', 'the game records (RECORD_POKEMON_EVOLVED, trainer score) are not kept');
        addPoketchHistory(ctx.state, shedinja);
        takeItem(ctx.state, ball, 1);
      }
    } else if (req.method === 'TRADE_WITH_HELD_ITEM' || req.method === 'LEVEL_WITH_HELD_ITEM_DAY' || req.method === 'LEVEL_WITH_HELD_ITEM_NIGHT') {
      mon.heldItem = null;
    }
  };

  /** Evolution_Main for one frame; `b` is this frame's new B press. */
  const main = (b: boolean): Step => {
    if (shrink) {
      const [s0, s1] = sprites;
      if ((shrink & 1) === 0) {
        s0.scale -= delta;
        s1.scale += delta;
        if (s0.scale === 0) shrink ^= 1;
      } else {
        s0.scale += delta;
        s1.scale -= delta;
        if (s1.scale === 0) {
          shrink ^= 1;
          if (delta < 64) delta *= 2;
        }
      }
    }
    if (canCancel && state === 'alternate' && b) {
      startFade(0, 16, 0, 'white', false);
      state = 'cancel';
    }
    if (yesNo) return;
    switch (state) {
      case 'start-delay':
        if (--delay === 0) state = 'reset-brightness';
        break;
      case 'reset-brightness':
        state = req.source === 'battle' ? 'print-what' : 'print-evolving';
        break;
      case 'print-what':
        if (!fade.active) {
          print('What');
          state = 'wait-what';
        }
        break;
      case 'wait-what':
        if (!printing()) state = 'print-evolving';
        break;
      case 'print-evolving':
        if (!fade.active) {
          startAnim(0);
          if (req.source === 'battle') print('PokemonIsEvolving', oldName);
          else print('WhatPokemonIsEvolving', oldName);
          state = 'wait-evolving';
        }
        break;
      case 'wait-evolving':
        if (!printing() && !cryBusy() && animDone(0)) {
          const id = sound && seq(SEQ.shinka);
          if (id) sound.playBgm(id);
          delay = 20;
          state = 'start-fade';
        }
        break;
      case 'start-fade':
        if (--delay === 0) {
          startEmitters(0);
          startSpriteFade(sprites[0], 0, 16, 4, 'white');
          startSpriteFade(sprites[1], 0, 16, 4, 'white');
          playSe(SEQ.w025);
          delay = 40;
          state = 'clamp-in';
        }
        break;
      case 'clamp-in':
        if (win.top < 40) {
          win.top += 2;
          win.bottom -= 2;
        }
        if (--delay === 0) {
          startEmitters(1, 2, 7, 8, 9, 11);
          playSe(SEQ.w060c);
          shrink = 0x10;
          delta = 8;
          state = 'alternate';
        }
        break;
      case 'alternate':
        if (!particles.active) {
          startEmitters(3, 4, 5, 6, 10);
          startFade(0, 16, 2, 'white', false);
          sprites[0].scale = 0;
          sprites[1].scale = FULL;
          playSe(SEQ.w062);
          shrink = 0;
          delay = 8;
          state = 'clamp-out';
        }
        break;
      case 'clamp-out':
        if (win.top) {
          win.top -= 2;
          win.bottom += 2;
        }
        if (!fade.active && --delay === 0) {
          startEmitters(12);
          startFade(16, 0, 4, 'white', false);
          startSpriteFade(sprites[0], 16, 0, 3, 'white');
          startSpriteFade(sprites[1], 16, 0, 3, 'white');
          playSe(SEQ.w080);
          state = 'evolved-cry';
        }
        break;
      case 'evolved-cry':
        if (!fade.active && !particles.active) {
          startAnim(1);
          state = 'set-values';
        }
        break;
      case 'set-values':
        if (!cryBusy() && animDone(1)) {
          evolve(dex, mon, req.target);
          // Pokemon_BuildSpriteTemplate keeps a form only where the species has one (Burmy's cloak, Shellos' sea).
          const pictures = reg.pokemonSprites.get(req.target);
          if (pictures && !pictures.forms[mon.form]) mon.form = 0;
          // The nickname slot still holds the old name: an un-nicknamed Pokémon takes the new one at the log step.
          print('CongratulationsYourPokemonEvolvedIntoPokemon', oldName, reg.species.get(req.target)!.name);
          delay = 40;
          state = 'log';
        }
        break;
      case 'log':
        if (!printing() && --delay === 0) {
          markCaught(ctx.state, ctx.registries, mon);
          ctx.log.stub('evolution:records', 'the game records (RECORD_POKEMON_EVOLVED, trainer score) are not kept');
          addPoketchHistory(ctx.state, mon);
          pendingMoves = movesAtLevel(dex, mon);
          state = 'check-learn';
        }
        break;
      case 'check-learn': {
        const next = pendingMoves.shift();
        if (next === undefined) {
          state = 'no-move';
          break;
        }
        if (mon.moves.includes(next)) break;
        move = next;
        if (mon.moves.length >= 4) {
          state = 'print-wants';
          break;
        }
        setMoveSlot(dex, mon, mon.moves.length, next);
        print('PokemonLearnedMove', name(), moveName(next));
        delay = 30;
        state = 'wait-learned';
        break;
      }
      case 'print-wants':
        print('PokemonWantsToLearnTheMove', name(), moveName(move!));
        delay = 30;
        state = 'wait-wants';
        break;
      case 'print-four':
        print('HoweverPokemonAlreadyKnowsFourMoves', name());
        delay = 30;
        state = 'wait-four';
        break;
      case 'print-delete':
        print('ShouldAMoveBeDeleted');
        delay = 1;
        state = 'wait-delete';
        break;
      case 'wait-wants':
      case 'wait-four':
      case 'wait-delete':
      case 'wait-poof':
      case 'wait-forgot':
      case 'wait-and':
      case 'wait-not-learned':
        if (!printing() && --delay === 0) state = WAIT_NEXT[state]!;
        break;
      case 'ask-delete':
        ask('forget', (yes) => {
          if (yes) {
            startFade(0, 16, 1, 'black', true);
            startSpriteFade(sprites[0], 0, 16, 0, 'black');
            startSpriteFade(sprites[1], 0, 16, 0, 'black');
            state = 'summary-fade';
          } else state = 'print-stop';
        });
        state = 'answer-delete';
        break;
      case 'summary-fade':
        if (!fade.active) {
          summaryResult = undefined;
          state = 'summary';
          return {
            push: summaryScreen(ctx, {
              party: () => ctx.state.party,
              slot: req.slot,
              mode: {
                kind: 'teach',
                move: move!,
                done: (forget) => {
                  summaryResult = forget;
                  return 'pop';
                },
              },
            }),
          };
        }
        break;
      case 'summary':
        // Back from the summary screen (Evolution_InitGraphics and the fade in).
        startFade(16, 0, 1, 'black', true);
        startSpriteFade(sprites[0], 16, 0, 0, 'black');
        startSpriteFade(sprites[1], 16, 0, 0, 'black');
        state = 'summary-back';
        break;
      case 'summary-back':
        if (!fade.active) {
          if (summaryResult === null || summaryResult === undefined) state = 'print-stop';
          else {
            moveSlot = summaryResult;
            state = 'print-poof';
          }
        }
        break;
      case 'print-poof':
        print('EvolutionOneTwoAndPoof');
        delay = 30;
        state = 'wait-poof';
        break;
      case 'print-forgot':
        print('PokemonForgotHowToUseMove', name(), moveName(mon.moves[moveSlot]!));
        delay = 30;
        state = 'wait-forgot';
        break;
      case 'print-and':
        print('EvolutionAndDotDotDot');
        delay = 30;
        state = 'wait-and';
        break;
      case 'print-learned':
        print('EvolvedPokemonLearnedMove', name(), moveName(move!));
        setMoveSlot(dex, mon, moveSlot, move!);
        delay = 30;
        state = 'wait-learned';
        break;
      case 'print-stop':
        print('StopTryingToTeachMove', moveName(move!));
        delay = 1;
        state = 'ask-stop';
        break;
      case 'ask-stop':
        if (printing()) break;
        ask('give-up', (yes) => {
          if (yes) {
            print('PokemonDidNotLearnTheMove', name(), moveName(move!));
            delay = 30;
            state = 'wait-not-learned';
          } else state = 'print-wants';
        });
        state = 'answer-stop';
        break;
      case 'wait-learned':
        if (!printing()) state = 'learned-fanfare';
        break;
      case 'learned-fanfare':
        if (!(sound?.waitFanfare() ?? false) && --delay === 0) state = 'check-learn';
        break;
      case 'no-move':
        startFade(0, 16, 1, 'black', true);
        startSpriteFade(sprites[0], 0, 16, 0, 'black');
        startSpriteFade(sprites[1], 0, 16, 0, 'black');
        state = 'end';
        break;
      case 'end':
        if (!fade.active) {
          particles.clear();
          effects();
          state = 'done';
          return done(true);
        }
        break;
      case 'cancel':
        if (!fade.active) {
          sprites[0].scale = FULL;
          sprites[1].scale = 0;
          hidden1 = true;
          startFade(16, 0, 0, 'white', false);
          startSpriteFade(sprites[0], 16, 0, 0, 'white');
          startSpriteFade(sprites[1], 16, 0, 0, 'white');
          win.top = 0;
          win.bottom = 160;
          shrink = 0;
          sound?.stopBgm();
          particles.clear();
          state = 'cancel-cry';
        }
        break;
      case 'cancel-cry':
        if (!fade.active) {
          startAnim(0);
          state = 'stopped';
        }
        break;
      case 'stopped':
        if (!cryBusy() && animDone(0)) {
          print('HuhPokemonStoppedEvolving', oldName);
          delay = 20;
          state = 'fade-stopped';
        }
        break;
      case 'fade-stopped':
        if (!printing() && --delay === 0) {
          startFade(0, 16, 1, 'black', true);
          startSpriteFade(sprites[0], 0, 16, 0, 'black');
          startSpriteFade(sprites[1], 0, 16, 0, 'black');
          state = 'end-stopped';
        }
        break;
      case 'end-stopped':
        if (!fade.active) {
          state = 'done';
          return done(false);
        }
        break;
      case 'answer-delete':
      case 'answer-stop':
      case 'done':
        break;
    }
    return;
  };

  /** The rest of the DS frame after Evolution_Main: sprites, particles, the palette fade (VBlank). */
  const after = () => {
    for (const i of [0, 1] as const) {
      spriteFadeFrame(sprites[i]);
      const s = sprites[i];
      if (s.anim !== null) s.anim++;
    }
    if (cry && --cry.frames <= 0) {
      sound?.playCry(cry.species, mon.form);
      cry = null;
    }
    particles.update();
    fadeFrame();
  };

  // Evolution_Begin: everything fades in from black (palettes 16 → 0, the sprites too).
  startFade(16, 0, 1, 'black', true);
  startSpriteFade(sprites[0], 16, 0, 0, 'black');
  startSpriteFade(sprites[1], 16, 0, 0, 'black');

  const spriteView = (i: 0 | 1): EvolutionSpriteView => {
    const s = sprites[i];
    const a = frontAnim(s.species);
    let frame = 0;
    let dx = 0;
    let dy = 0;
    if (a && s.anim !== null) {
      let t = s.anim;
      for (const f of a.frames) {
        if (t < f.ticks) {
          ({ frame, dx, dy } = f);
          break;
        }
        t -= f.ticks;
      }
    }
    const gender = (species: Id) => {
      const probe: Pokemon = { ...mon, species };
      return monGender(dex, probe) === 'female';
    };
    return { species: s.species, form: mon.form, shiny: isShiny(mon.otId, mon.pid), female: gender(s.species), frame, dx, dy, scale: i === 1 && hidden1 ? 0 : s.scale, fade: { level: s.level, color: s.color } };
  };

  /** One DS loop: Evolution_Main, then the print task twice (main.c runs printTaskMgr before and after its first vblank), then the rest. */
  const stepFrame = (input: { b: boolean; ab: { pressed: boolean; held: boolean } }): Step => {
    const step = main(input.b);
    // SE_CONFIRM for each press that ends a {clear}/{scroll} wait (decomp TextPrinter_Continue).
    for (let i = 0; i < 2; i++) if (printer && !printer.done && printer.subStep(input.ab)) playSe(SEQ.confirm);
    after();
    return step;
  };

  return {
    view(): EvolutionView {
      return {
        app: 'evolution',
        sprites: [spriteView(0), spriteView(1)],
        fade: { level: applied, color: fade.color, box: fade.box },
        window: { ...win },
        particles: particles.view(),
        message: printer ? { text: printer.text(), waiting: printer.waiting } : null,
        yesNo: yesNo ? { yes: yesNo.yes, no: yesNo.no, cursor: yesNo.cursor } : null,
        cancellable: canCancel && state === 'alternate',
        question: yesNo?.question ?? null,
      };
    },
    input: () => undefined,
    tick(f: InputFrame): Step {
      const tap = f.tap;
      const pressed = (b: string) => f.pressed.includes(b as never);
      if (yesNo) {
        const q = yesNo;
        let answer: boolean | null = null;
        if (tap === 'yes') answer = true;
        else if (tap === 'no' || tap === 'back') answer = false;
        else if (pressed('up') || pressed('down')) q.cursor = q.cursor ? 0 : 1;
        else if (pressed('a')) answer = q.cursor === 0;
        else if (pressed('b')) answer = false;
        if (answer !== null) {
          yesNo = null;
          q.then(answer);
        }
        // The answer's press does not reach the next message.
        return stepFrame({ b: false, ab: { pressed: false, held: false } });
      }
      const advance = pressed('a') || pressed('b') || tap === 'next' || tap === 'back';
      const b = pressed('b') || tap === 'back';
      const held = f.held.includes('a') || f.held.includes('b');
      return stepFrame({ b, ab: { pressed: advance, held: held || advance } });
    },
  };
}
