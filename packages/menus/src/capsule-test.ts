/**
 * The capsule editor's Test (decomp capsule_menu/manager.c, the THROW_* states; docs/research/seals.md §5.3): a copy of
 * the Pokémon comes out of its ball on the top screen with the capsule as it is on screen, as a foe's send-out does in
 * battle (BallThrow type 1, battler type 1). Headless and frame by frame: the screens' dim, the ball (ov12_02237728's
 * SEND_OUT and recall modes), the battle's send-out effect (`SendOutEffect` on the battle's SPL), the sprite growing in
 * and its front animation, the hold, the recall and the undim. `done` once the editor may go on.
 */
import { SendOutEffect, ParticleCamera, ParticleManager, type SplRandom } from '@opensinnoh/battle/particles';
import type { AnimParticle, BattleAnimData, CapsuleEditorView, ParticleSystem, PokemonSpriteAnim, Registries, SealTables } from '@opensinnoh/contracts';
import type { Pokemon } from '@opensinnoh/core';

/** CAPSULE_MON_SPRITE_X / _Y_BASE; the ball sits 38 px under it (ov12_02237B14, type 1). */
const MON_AT = { x: 192, y: 48 };
const BALL_AT = { x: MON_AT.x, y: MON_AT.y + 38 };
/** BallCapsuleConfig.battlerType: the foe's spot. */
const BATTLER_TYPE = 1;
/** PaletteData_StartFade(…, 0, 0, 10, 0) on the editor's screen: 10/16 toward black, two steps a frame. */
const DIM = 10;
/** ov76_0223DE78 / ov76_0223DEF4: the sprite's scale changes 0x20 a frame (of 0x100). */
const GROW = 0x20;
/** THROW_WAIT_AFTER_ANIMS_END. */
const HOLD = 30;
/** ov12_022378A0 type 1: the ball's parabola takes 12 frames (start and end the same: it does not move). */
const BALL_STEPS = 12;
/** ov12_02236F24: the ball opens on the 6th frame of its opening, then whitens (PaletteFadeContext 0 → 14 by 2 a frame). */
const OPEN_AT = 5;
const OPEN_FRAMES = 15;
const WHITE = 14;
/** ov12_02237474 (Unk_ov12_0223ABBC): the recall's opening frames, each {frame, frames held}; the burst after the second. */
const RECALL = [
  [0, 2],
  [2, 2],
  [2, 6],
  [1, 6],
  [0, 6],
] as const;
/** ov12_02236690 with unk_10: Unk_ov12_0223AE10 row 0xFF + 20, `ball_particle.narc` member 36 and its 2 emitters. */
const RECALL_BURST = { particle: 36, emitters: 2 };
/** fx32 per DS px under the orthographic particle camera; ov12_02236648 places the burst at (x − 190 + 61, 70 − y + 30). */
const FX_PER_PX = 172;

type Step = 'dim' | 'throw' | 'open' | 'grow' | 'anims' | 'hold' | 'recall' | 'undim' | 'done';

/** The ball sprite (ov12_02237728): its mode's states, its animation and its palette's blend toward white. */
class Ball {
  private state = 0;
  private counter = 0;
  private moves = 0;
  private ticking = false;
  private whiten: { frac: number } | null = null;
  private burst: ParticleManager | null = null;
  anim: 0 | 1 = 0;
  tick = 0;
  frame: number | null = null;
  white = 0;
  /** ov12_02237810: the frame the Pokémon comes out. */
  opened = false;
  /** ov12_022377F8 is FALSE. */
  done = false;

  constructor(
    private readonly recall: boolean,
    private readonly system: () => ParticleSystem,
    private readonly rng: SplRandom,
  ) {}

  /** ov12_022376D0: the mode's state, then the sprite's animation; the whitening task after it. */
  step(): void {
    if (!this.done && !(this.recall ? this.recallStep() : this.sendOutStep())) this.done = true;
    if (this.ticking) this.tick++;
    if (this.whiten) {
      // PaletteFadeContext_FadeTask with stepFrames −2: a blend every frame, inactive once the end is blended.
      this.white = this.whiten.frac;
      this.whiten = this.whiten.frac === WHITE ? null : { frac: Math.min(WHITE, this.whiten.frac + 2) };
    }
  }

  /** ov12_02236F24 for type 1: the still parabola, then the opening animation; done once it has whitened. */
  private sendOutStep(): boolean {
    switch (this.state) {
      case 0:
        this.state = 1;
        return true;
      case 1:
        if (++this.moves > BALL_STEPS) this.state = 2;
        return true;
      case 2:
        this.state = 3;
        return true;
      case 3:
        this.anim = 1;
        this.tick = 0;
        this.ticking = true;
        this.counter = 0;
        this.state = 4;
        return true;
      default:
        if (this.counter === OPEN_AT) {
          this.whiten = { frac: 0 };
          this.opened = true;
        }
        if (++this.counter <= OPEN_FRAMES) return true;
        return this.whiten !== null;
    }
  }

  /** ov12_02237474: the opening held frame by frame, the burst at the ball, done once its emitters end. */
  private recallStep(): boolean {
    this.anim = 1;
    const hold = (row: number) => {
      if (++this.counter < RECALL[row]![1]) return;
      this.frame = RECALL[row]![0];
      this.counter = 0;
      this.state++;
    };
    switch (this.state) {
      case 0:
        hold(0);
        return true;
      case 1:
        hold(1);
        return true;
      case 2:
        this.burst = new ParticleManager(this.system(), new ParticleCamera(), this.rng);
        this.state++;
        return true;
      case 3: {
        for (let i = 0; i < RECALL_BURST.emitters; i++)
          this.burst!.createEmitter(i, (e) => {
            e.setPos(0, FX_PER_PX * (BALL_AT.x - 190 + 61));
            e.setPos(1, FX_PER_PX * (70 - BALL_AT.y + 30));
            e.setPos(2, 0);
          });
        this.state++;
        return true;
      }
      case 4:
      case 5:
      case 6:
        hold(this.state - 2);
        return true;
      case 7:
        if (this.burst!.activeEmitters === 0) {
          this.burst = null;
          this.state++;
        }
        return true;
      default:
        return false;
    }
  }

  /** The burst's particles this frame (drawn, then updated, as the app's particle pass does). */
  particles(out: AnimParticle[]): void {
    if (!this.burst) return;
    this.burst.draw(out);
    this.burst.update();
  }
}

export interface CapsuleTestDeps {
  registries: Registries;
  tables: SealTables;
  rng: SplRandom;
  /** Plays an SDAT sequence by source index. */
  se: (n: number) => void;
  /** THROW_WAIT_AFTER_ANIMS_END's counter: kept by the editor (the DS never resets it while the app runs). */
  held: { frames: number };
}

/** SEQ_SE_DP_CUSTOM05: the Pokémon comes out. */
const SE_OUT = 1734;

export class CapsuleTest {
  private step: Step = 'dim';
  private fade = { cur: 0, end: DIM, active: true };
  private dimLevel = 0;
  private ball: Ball | null = null;
  private effect: SendOutEffect | null = null;
  /** The sprite's scale (of 0x100), or null while hidden; its front animation's ticks once loaded. */
  private scale: number | null = null;
  private animTick: number | null = null;
  private readonly anim: PokemonSpriteAnim;
  private readonly positions: BattleAnimData['positions'];
  private drawn: AnimParticle[] = [];

  /** `mon` is a copy (CapsuleManager_LoadLeadingPokemon) holding the capsule on screen. */
  constructor(
    private readonly deps: CapsuleTestDeps,
    readonly mon: Pokemon,
  ) {
    const reg = deps.registries;
    const sprites = reg.pokemonSprites.get(mon.species);
    if (!sprites) throw new Error(`capsule test: no sprites for ${mon.species}`);
    this.anim = sprites.front;
    const data = [...reg.battleAnimData.values()][0];
    if (!data) throw new Error('capsule test: the packs have no battle animation data (the send-out effect\'s positions)');
    this.positions = data.positions;
  }

  get done(): boolean {
    return this.step === 'done';
  }

  /** The editor's screen dims before the throw and undims after it; the top screen shows the throw in between. */
  get onTop(): boolean {
    return this.step !== 'dim' && this.step !== 'undim' && this.step !== 'done';
  }

  get dim(): number {
    return this.dimLevel / 16;
  }

  /** One frame: the editor's THROW_* state, then the tasks (the palette fade, the ball, the effect, the animation). */
  tick(): void {
    this.state();
    this.fadeFrame();
    this.ball?.step();
    this.drawn = [];
    if (this.effect) {
      this.effect.tick();
      this.drawn.push(...this.effect.particles);
    }
    this.ball?.particles(this.drawn);
    if (this.animTick !== null) this.animTick++;
  }

  private state(): void {
    switch (this.step) {
      case 'dim': // THROW_INIT_GFX (the fade started), THROW_WAIT_INIT_THROW: the ball once the screens have dimmed
        if (this.fade.active) return;
        this.ball = new Ball(false, () => this.system(RECALL_BURST.particle), this.deps.rng);
        this.step = 'throw';
        return;
      case 'throw': // THROW_SET_CAPSULE: the effect for a copy holding the capsule as it is on screen (its loading, 4 frames, ends long before the ball opens)
        this.step = 'open';
        return;
      case 'open': // THROW_WAIT_FOR_END
        if (!this.ball!.opened) return;
        if (!this.mon.capsule) throw new Error('capsule test: the copy holds no capsule');
        this.effect = new SendOutEffect(this.deps.tables, this.positions, BATTLER_TYPE, { capsule: this.mon.capsule }, (n) => this.system(n), this.deps.rng);
        this.scale = 0;
        this.deps.se(SE_OUT);
        this.step = 'grow';
        return;
      case 'grow': {
        // THROW_WAIT_FOR_ROTATION_END: the sprite grows; once grown and the ball done, the ball goes and the animation starts
        const growing = this.scale! < 0x100;
        if (growing) this.scale = Math.min(0x100, this.scale! + GROW);
        if (!this.ball!.done || growing) return;
        this.ball = null;
        this.animTick = 0;
        this.step = 'anims';
        return;
      }
      case 'anims': // THROW_WAIT_FOR_ANIMS_END: the seals' systems and the front animation end
        if (this.effect!.active || this.animTick! < this.anim.frames.reduce((n, f) => n + f.ticks, 0)) return;
        this.effect = null;
        this.animTick = null;
        this.step = 'hold';
        return;
      case 'hold': // THROW_WAIT_AFTER_ANIMS_END
        if (++this.deps.held.frames < HOLD) return;
        this.ball = new Ball(true, () => this.system(RECALL_BURST.particle), this.deps.rng);
        this.step = 'recall';
        return;
      case 'recall': {
        // THROW_WAIT_FREE: the sprite shrinks back while the ball takes it; then the screens undim
        const shrinking = this.scale! > 0;
        if (shrinking) this.scale = Math.max(0, this.scale! - GROW);
        if (!this.ball!.done || shrinking) return;
        this.ball = null;
        this.scale = null;
        Object.assign(this.fade, { cur: DIM, end: 0, active: true });
        this.step = 'undim';
        return;
      }
      case 'undim': // the default state: back to the editor once undimmed
        if (!this.fade.active) this.step = 'done';
        return;
      case 'done':
        return;
    }
  }

  /** PaletteData_StartFade with wait 0: the level applied each frame, two steps at a time, inactive once at its end. */
  private fadeFrame(): void {
    const f = this.fade;
    if (!f.active) return;
    this.dimLevel = f.cur;
    if (f.cur === f.end) f.active = false;
    else f.cur = f.cur < f.end ? Math.min(f.end, f.cur + 2) : Math.max(f.end, f.cur - 2);
  }

  /** A `ball_particle.narc` system record. */
  private system(member: number): ParticleSystem {
    for (const p of this.deps.registries.particleSystems.values()) if (p.archive === 'ball' && p.sourceIndex === member) return p;
    throw new Error(`capsule test: no ball_particle system ${member} in the packs`);
  }

  view(test: { species: Pokemon['species']; form: number; female: boolean; shiny: boolean }): NonNullable<CapsuleEditorView['test']> {
    let sprite: NonNullable<CapsuleEditorView['test']>['sprite'] = null;
    if (this.scale !== null) {
      let frame = 0;
      let dx = 0;
      let dy = 0;
      if (this.animTick !== null) {
        let t = this.animTick;
        for (const f of this.anim.frames) {
          if (t < f.ticks) {
            ({ frame, dx, dy } = f);
            break;
          }
          t -= f.ticks;
        }
      }
      sprite = { scale: this.scale / 0x100, frame, dx, dy };
    }
    const b = this.ball;
    return {
      ...test,
      sprite,
      ball: b ? { item: this.mon.ball, ...BALL_AT, anim: b.anim, tick: b.tick, frame: b.frame, white: b.white / 16 } : null,
      particles: this.drawn,
    };
  }
}
