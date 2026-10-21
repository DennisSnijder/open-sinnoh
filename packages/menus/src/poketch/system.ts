/**
 * The Pokétch device (decomp poketch_system.c, poketch_graphics.c): the side buttons, the screen closing
 * and opening between apps, the app counter while skipping apps, and the current app. Headless: the game
 * steps it every field tick with the panel touch; the app draws its `PoketchView`.
 */
import { nextPoketchApp, poketchAppIndex, poketchAppName, type CreatePoketch, type PoketchDeps, type PoketchModel, type PoketchTick, type PoketchView } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { plainText } from '../strings.ts';
import { Buttons, rect, SE, type AppCtx, type PoketchApp } from './common.ts';
import { APPS } from './apps.ts';

/** Decomp sMainPoketchButtons: the side button's halves (UP = previous app, DOWN = next). */
const SIDE = [rect(224, 32, 255, 96), rect(224, 96, 255, 160)];
/** Decomp PoketchSystem_ButtonInit: holding UP for 7 ticks acts as a press. */
const UP_HOLD = 7;
/** Decomp TASK_CONCEAL_SCREEN (5 ticks, 8 px of rows a tick from each side) and TASK_REVEAL_SCREEN (4 ticks). */
const CONCEAL = [16, 32, 48, 64, 80];
const REVEAL = [56, 32, 8, 0];
/** Decomp PoketchEvent_UpdateApp: ticks before the next app loads, and the app counter's timeout. */
const SWITCH_WAIT = 3;
const COUNTER_WAIT = 30;

type Phase =
  | { kind: 'reveal'; t: number }
  | { kind: 'run' }
  | { kind: 'conceal'; t: number; dir: 1 | -1; skip: boolean }
  | { kind: 'wait'; t: number }
  | { kind: 'counter'; t: number };

export const createPoketch: CreatePoketch = (deps) => new Poketch(deps);

class Poketch implements PoketchModel {
  private readonly ns: string;
  private readonly sequences = new Map<number, Id>();
  private readonly side = new Buttons(SIDE, { timers: { 0: [UP_HOLD, 0] } });
  private app: { id: Id; model: PoketchApp } | null = null;
  private phase: Phase = { kind: 'reveal', t: 0 };
  private held: { x: number; y: number } | null = null;
  private buttons: PoketchView['buttons'] = { up: 'idle', down: 'idle' };
  private readonly ctx: AppCtx;
  private quiet = false;

  constructor(private readonly deps: PoketchDeps) {
    this.ns = [...deps.registries.newGame.keys()][0]!.split(':')[0]!;
    for (const s of deps.registries.sequences.values()) if (s.sourceIndex !== undefined) this.sequences.set(s.sourceIndex, s.id);
    this.ctx = {
      deps,
      ns: this.ns,
      se: (n) => {
        if (this.quiet || !deps.sound) return;
        const seq = this.sequences.get(n);
        if (seq) deps.sound.playSe(seq);
        else deps.log.stub('poketch:sound-missing', `sequence ${n} is not in the packs: not played`);
      },
      cry: (species, form) => {
        if (!this.quiet) deps.sound?.playCry(species, form);
      },
      text: (name) => {
        const t = deps.registries.texts.get(`${this.ns}:${name}` as Id);
        if (!t) throw new Error(`Pokétch: the base pack has no text ${name}`);
        return plainText(t.text);
      },
    };
    this.load();
  }

  private current(): Id {
    const id = this.deps.state.poketch.current;
    if (id === null) throw new Error('Pokétch: no app is registered');
    return id;
  }

  private load(): void {
    const id = this.current();
    this.app = { id, model: APPS[poketchAppName(id)](this.ctx) };
  }

  step(tick: PoketchTick): void {
    const tapped = tick.touch !== null && this.held === null;
    this.held = tick.touch;
    const touch = { held: tick.touch, tapped };
    const changing = this.phase.kind !== 'run';
    // The app counter and app changes gate sounds as the decomp's appChanging does.
    this.quiet = tick.busy || changing;
    // A script took the current app away (should not happen: apps are only added).
    if (this.app && this.app.id !== this.current() && this.phase.kind === 'run') this.load();

    const side = tick.busy ? null : this.side.update(touch);
    if (side) {
      const key = side.id === 0 ? 'up' : 'down';
      if (side.event === 'touch') {
        // Decomp PoketchSystem_OnButtonEvent: held down, or half pressed while an app is starting (then ignored).
        const starting = this.phase.kind === 'reveal';
        this.buttons[key] = starting ? 'half' : 'pressed';
        this.sideSound(starting);
      } else if (side.event === 'tap' || side.event === 'drag' || side.event === 'timer0') {
        this.buttons[key] = 'idle';
        if (side.event === 'timer0') this.side.reset(0);
        if (side.event !== 'drag') this.press(side.id === 0 ? -1 : 1);
      }
    }

    const app = this.app!.model;
    switch (this.phase.kind) {
      case 'reveal':
        if (++this.phase.t >= REVEAL.length) this.phase = { kind: 'run' };
        break;
      case 'run':
        app.step({ touch: tick.busy ? { held: null, tapped: false } : touch, busy: tick.busy, moved: tick.moved });
        break;
      case 'conceal':
        if (++this.phase.t >= CONCEAL.length) {
          this.switchApp(this.phase.dir);
          this.phase = this.phase.skip ? { kind: 'counter', t: COUNTER_WAIT } : { kind: 'wait', t: SWITCH_WAIT };
        }
        break;
      case 'wait':
        if (--this.phase.t <= 0) this.open();
        break;
      case 'counter':
        if (--this.phase.t <= 0) this.open();
        break;
    }
  }

  /** Decomp: a side button press (TAP, or UP held) starts an app change; more presses skip apps (the counter). */
  private press(dir: 1 | -1): void {
    const p = this.phase;
    if (p.kind === 'run') {
      if (this.deps.state.poketch.apps.length < 2) return;
      this.app!.model.close?.();
      this.phase = { kind: 'conceal', t: 0, dir, skip: false };
    } else if (p.kind === 'conceal') p.skip = true;
    else if (p.kind === 'wait') this.phase = { kind: 'counter', t: COUNTER_WAIT };
    else if (p.kind === 'counter') {
      this.switchApp(dir);
      p.t = COUNTER_WAIT;
    }
  }

  private sideSound(half: boolean): void {
    // Decomp TASK_UP/DOWN_PRESSED plays DENSI01; the half-pressed image DENSI04 (heard even while busy).
    const seq = this.sequences.get(half ? SE.DENSI04 : SE.DENSI01);
    if (seq) this.deps.sound?.playSe(seq);
  }

  private switchApp(dir: 1 | -1): void {
    const next = nextPoketchApp(this.deps.state.poketch, dir);
    if (next !== null) this.deps.state.poketch.current = next;
  }

  private open(): void {
    this.load();
    this.phase = { kind: 'reveal', t: 0 };
  }

  view(): PoketchView {
    const app = this.app!;
    const l = app.model.view();
    const p = this.phase;
    const cover = p.kind === 'reveal' ? REVEAL[p.t]! : p.kind === 'conceal' ? CONCEAL[p.t]! : p.kind === 'run' ? 0 : 80;
    const counter = p.kind === 'counter' ? poketchAppIndex(this.current()) + 1 : null;
    return {
      app: app.id,
      color: this.deps.state.poketch.color,
      backlight: l.backlight,
      fill: l.fill,
      bg: l.bg,
      blits: l.blits,
      bitmap: l.bitmap,
      icons: l.icons,
      sprites: l.sprites,
      text: l.text,
      mosaic: l.mosaic,
      cover,
      buttons: { ...this.buttons },
      counter,
      targets: l.targets,
      info: l.info,
    };
  }
}
