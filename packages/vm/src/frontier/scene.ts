/**
 * A frontier scene's room, headless (decomp overlay 104 frontier_graphics.c and overlay 63's 2D objects): the loaded
 * 2D characters (FrontierScrCmd_22/23), the actors (24/25) and their movement tasks (ApplyMovement,
 * FrontierObject_DoAnimation), the frontier_obj sprites (2A–33), the camera on the player's actor and the screen fade.
 *
 * One `step` is one main-loop frame, in the decomp's SysTask order: the 2D objects step (ov63_0222BE84, priority
 * 60000), the movement tasks feed them (60100), the queued commands start (ov104_0223C8E8, 61000), then the sprites
 * follow their objects and animate (ov104_0223C738, 80000).
 */
import type { FrontierActorView, FrontierObjectView, FrontierSceneData, FrontierTables, FrontierView, Movement, Ui2dAnimation } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';

/** Decomp DIR_NORTH..DIR_EAST, the 2D objects' directions. */
const DIRS = ['up', 'down', 'left', 'right'] as const;
/** The camera slot (decomp: the player's actor is created in object slot 31, ov104_0223C738 follows it). */
const CAMERA_SLOT = 31;
/** Decomp ov63_0222D160: the view's top-left is the followed object's position − (112, 96). */
const CAMERA = { x: 112, y: 96 };
/** Decomp FrontierScrCmd_24: an actor's table position is its foot; the object sits 8, 16 up-left of it. */
const ACTOR_OFFSET = { x: 8, y: 16 };

/**
 * Decomp ov63_0222C350's commands: its frames (0 = done at once) and whether it moves a tile. Index = command
 * (sFrontierMovementActions' first value).
 */
const COMMANDS: { frames: number; moves: boolean }[] = [
  { frames: 0, moves: false }, // 0 stand (face)
  { frames: 2, moves: false }, // 1 turn
  { frames: 8, moves: true }, // 2 walk
  { frames: 4, moves: true }, // 3 walk
  { frames: 0, moves: false }, // 4 (unused by the frontier)
  { frames: 16, moves: false }, // 5
  { frames: 16, moves: true }, // 6 walk slow
  { frames: 4, moves: true }, // 7 walk fast
  { frames: 2, moves: false }, // 8 walk on the spot fast
  { frames: 4, moves: false }, // 9 walk on the spot faster
  { frames: 8, moves: false }, // 10 walk on the spot
  { frames: 16, moves: false }, // 11 walk on the spot slow
];
/** Decomp sFrontierMovementActions by `fr_<action>` step op: [command, direction]. */
const MOVEMENT_ACTIONS: Record<string, [number, number]> = Object.fromEntries(
  (
    [
      ['face', 0],
      ['walk', 2],
      ['walk_slow', 6],
      ['walk_fast', 7],
      ['walk_on_spot', 10],
      ['walk_on_spot_slow', 11],
      ['walk_on_spot_fast', 8],
      ['walk_on_spot_faster', 9],
    ] as const
  ).flatMap(([name, command]) => ['north', 'south', 'west', 'east'].map((d, dir) => [`fr_${name}_${d}`, [command, dir] as [number, number]])),
);
/** Decomp sFrontierMovementDelayLengths. */
const DELAYS: Record<string, number> = { fr_delay_1: 1, fr_delay_2: 2, fr_delay_4: 4, fr_delay_8: 8, fr_delay_15: 15, fr_delay_16: 16, fr_delay_32: 32 };

/** Decomp ov63_0222D0C4: the sprite's animation type per object command (a stand-only character always 0). */
const ANIM_TYPE = [0, 3, 2, 4, 0, 5, 6, 8, 7, 8, 2, 6];
/**
 * Decomp ov63_0222B308 and ov63_0222BB38 per animation type: the sequence (`dir` = the direction, `prevDir` the
 * direction before a turn), the advance per update (frames), and how many updates it gets (Unk_ov63_0222D904; 0xFF
 * without end). Types 0 and 9 never advance.
 */
const ANIM = [
  { seq: (dir: number) => dir, rate: 0, updates: 0 },
  { seq: () => 4, rate: 2, updates: 0xff },
  { seq: (dir: number) => 5 + dir, rate: 2, updates: 8 },
  { seq: (_dir: number, prevDir: number) => 5 + prevDir, rate: 0, updates: 2 },
  { seq: (dir: number) => 9 + dir, rate: 2, updates: 4 },
  { seq: (dir: number) => 5 + dir, rate: 1, updates: 16 },
  { seq: (dir: number) => 5 + dir, rate: 1, updates: 16 },
  { seq: (dir: number) => 5 + dir, rate: 8, updates: 2 },
  { seq: (dir: number) => 5 + dir, rate: 6, updates: 4 },
];
/** Decomp ov63_0222D110's v2: the walking types whose animation frame is kept when another type interrupts them. */
const KEEPS_FRAME = [false, false, true, false, true, true, true, true, true, false];

/** A playing NNS cell animation: its sequence, frame and the time spent in that frame. */
class Anim {
  seq = -1;
  frame = 0;
  time = 0;
  constructor(private readonly sequences: readonly Ui2dAnimation[]) {}

  /** Sprite_SetAnimNoRestart. */
  set(seq: number): void {
    if (seq === this.seq) return;
    this.restart(seq);
  }

  /** Sprite_SetAnim. */
  restart(seq: number): void {
    if (!this.sequences[seq]) throw new Error(`frontier: the 2D character has no animation ${seq} (of ${this.sequences.length})`);
    this.seq = seq;
    this.frame = 0;
    this.time = 0;
  }

  /** Sprite_SetAnimFrame. */
  setFrame(frame: number): void {
    this.frame = frame;
    this.time = 0;
  }

  /** Sprite_UpdateAnim: `amount` frames on; a loop wraps to its loop start, a forward sequence holds its last frame. */
  update(amount: number): void {
    const s = this.sequences[this.seq];
    if (!s) throw new Error('frontier: a 2D animation updated before it was set');
    this.time += amount;
    for (;;) {
      const f = s.frames[this.frame]!;
      if (this.time < f.ticks) return;
      this.time -= f.ticks;
      if (this.frame + 1 < s.frames.length) this.frame++;
      else if (s.mode === 'loop' || s.mode === 'pingpong-loop') this.frame = s.loopStart;
      else {
        // A forward sequence holds its last frame, ended (NNS: the animation is no longer active).
        this.time = f.ticks;
        return;
      }
    }
  }

  /** Whether a forward sequence has reached its end (Sprite_IsAnimated). */
  get playing(): boolean {
    const s = this.sequences[this.seq];
    if (!s) return false;
    if (s.mode === 'loop' || s.mode === 'pingpong-loop') return true;
    return this.frame + 1 < s.frames.length || this.time < s.frames[this.frame]!.ticks;
  }
}

/** A movement task (decomp FrontierAnimData): its list, step and state. */
interface MovementTask {
  steps: Movement['steps'];
  index: number;
  /** Steps of the current action done (decomp elapsed) and ticks of a delay (decomp delay). */
  elapsed: number;
  delay: number;
  /** Decomp state: 0 next action, 2 the end reached, waiting for the object to stand. */
  state: 0 | 2;
}

/** An actor (decomp ov63 object + its 2D sprite). Positions are the object's (the sprite origin), in room px. */
class Actor {
  /** Decomp unk_08 (where the command started) and unk_04 (where it ends). */
  prev: { x: number; y: number };
  cur: { x: number; y: number };
  /** Decomp unk_15 (command), unk_14 (direction), unk_10 / unk_12 (frame and frames). */
  command = 0;
  dir: number;
  frame = 0;
  frames = 0;
  visible: boolean;
  task: MovementTask | null = null;
  readonly anim: Anim;
  /** The sprite's last seen command and direction (decomp UnkStruct_ov63_0222CE44 unk_08, unk_0A). */
  private seen: { command: number; dir: number } = { command: -1, dir: -1 };
  /** Decomp ov63_0222BB38's unk_0C (animation type), unk_14 (updates since set), unk_10 (direction it shows). */
  private animType = 0;
  private updates = 0;
  private shownDir: number;
  /** Decomp ov63_0222D110's saved walking animation: its type and frame (unk_10, unk_0E). */
  private kept: { type: number; frame: number } = { type: -1, frame: 0 };

  constructor(
    readonly localId: number,
    readonly gfx: number,
    readonly sheet: Id,
    sequences: readonly Ui2dAnimation[],
    x: number,
    y: number,
    dir: number,
    visible: boolean,
    /** A type-2 character (stand cells only, decomp ov63_0222B2BC == 2). */
    private readonly standOnly: boolean,
  ) {
    this.prev = { x, y };
    this.cur = { x, y };
    this.dir = dir;
    this.shownDir = dir;
    this.visible = visible;
    this.anim = new Anim(sequences);
    // Decomp ov63_0222B0C0: the sprite starts on animation 1 (6 for a type-1 character), then follows its object.
    this.anim.restart(1);
  }

  get idle(): boolean {
    return this.command === 0;
  }

  /** Decomp ov63_0222C350: a command starts (positions, direction, frames). */
  start(command: number, dir: number): void {
    const c = COMMANDS[command];
    if (!c) throw new Error(`frontier: no 2D object command ${command}`);
    const from = this.cur;
    this.prev = { ...from };
    this.cur = c.moves ? { x: from.x + [0, 0, -16, 16][dir]!, y: from.y + [-16, 16, 0, 0][dir]! } : { ...from };
    this.dir = dir;
    this.command = command;
    this.frame = 0;
    this.frames = c.frames;
  }

  /** Decomp ov63_0222C37C: one tick of the command; a finished one stands at its end. */
  step(): void {
    if (this.command === 0) return;
    if (this.frame < this.frames) this.frame++;
    if (this.frame < this.frames) return;
    this.prev = { ...this.cur };
    this.command = 0;
    this.frame = 0;
    this.frames = 0;
  }

  /** Decomp ov63_0222C0FC: the drawn position, between `prev` and `cur` by the frame. */
  get position(): { x: number; y: number } {
    if (this.frames <= 0) return { ...this.cur };
    const k = (n: number, from: number) => from + Math.trunc(((n - from) * this.frame) / this.frames);
    return { x: k(this.cur.x, this.prev.x), y: k(this.cur.y, this.prev.y) };
  }

  /** Decomp ov63_0222CF14: the sprite follows its object (animation type and direction), then animates. */
  updateSprite(): void {
    if (this.command !== this.seen.command || this.dir !== this.seen.dir || this.frame === 0) {
      this.seen = { command: this.command, dir: this.dir };
      this.setAnimType(this.standOnly ? 0 : ANIM_TYPE[this.command]!, this.dir);
    }
    const a = ANIM[this.animType];
    if (!a) return;
    if (a.updates !== 0xff && a.updates < this.updates + 1) return;
    this.updates++;
    if (this.animType === 3) {
      // Decomp ov63_0222BC00 (a turn): the old direction's walk at frame 1, then the new direction's walk.
      if (this.updates === 1) this.anim.setFrame(1);
      else this.anim.restart(5 + this.shownDir);
    } else if (a.rate) this.anim.update(a.rate);
  }

  /** Decomp ov63_0222D110 and ov63_0222B308. */
  private setAnimType(type: number, dir: number): void {
    const before = this.animType;
    const beforeFrame = this.anim.frame;
    const prevDir = this.shownDir;
    this.animType = type;
    this.updates = 0;
    this.shownDir = dir;
    const a = ANIM[type];
    if (!a) throw new Error(`frontier: no 2D animation type ${type}`);
    this.anim.set(a.seq(dir, prevDir));
    if (before !== type) {
      if (KEEPS_FRAME[type] && this.kept.type === type) this.anim.setFrame(this.kept.frame);
      if (KEEPS_FRAME[before]) this.kept = { type: before, frame: beforeFrame };
    }
  }
}

/** A frontier_obj sprite (decomp ManagedSprite in FrontierGraphics unk_3C). */
interface ObjectSprite {
  id: number;
  sheet: Id;
  x: number;
  y: number;
  visible: boolean;
  /** Decomp unk_30's bit: it animates every frame (ManagedSprite_TickFrame). */
  animating: boolean;
  /** Decomp FrontierScrCmd_2F (Sprite_SetFlipMode2 1): drawn mirrored left to right. */
  flip?: true;
  anim: Anim;
  tick: number;
}

export class FrontierScene {
  /** Decomp unk_24: the 2D character graphics loaded (FrontierScrCmd_22), by gfx. */
  private readonly loaded = new Set<number>();
  /** Decomp unk_6C: the actors by object slot (32). */
  private readonly actors: (Actor | null)[] = Array(32).fill(null);
  /** Decomp the frontier_obj resources loaded (FrontierScrCmd_2A) and the sprites by slot (8). */
  private readonly resources = new Set<number>();
  private readonly sprites: (ObjectSprite | null)[] = Array(8).fill(null);
  /** Movement tasks running (decomp scriptMan->movementCount). */
  movements = 0;
  /** Decomp unk_1C: the view's top-left, following the player's actor while it exists (zeroed at the start). */
  private camera = { x: 0, y: 0 };
  /** The brightness fade: from, to, ticks, elapsed; `alpha` 1 = full colour. */
  private fade: { color: 'black' | 'white'; alpha: number; anim: { from: number; to: number; ticks: number; elapsed: number } | null };
  /** BG2: its scroll, the Factory corridor's floor task (UpdateCorridorFloorBG), shown or not, drawn under BG3. */
  private fgScroll = { x: 0, y: 0 };
  corridorFloor = false;
  fgHidden = false;
  fgBelow = false;
  /** Decomp unk_A4 (FrontierScrCmd_4C, ov104_0223319C): the shake offset, its frame counter, interval and swings left. */
  private shakeTask: { x: number; y: number; frame: number; every: number; left: number } | null = null;
  /** Decomp unk_B0 (FrontierScrCmd_4E, ov104_022331E8): window 0 after `delay` frames (or off), and the window now. */
  private windowTask: { rect: { x1: number; y1: number; x2: number; y2: number }; delay: number; on: boolean } | null = null;
  private window: { x1: number; y1: number; x2: number; y2: number } | null = null;
  /** Decomp FrontierScrCmd_45's sprite (ov104_02232CE0), by its resource id. */
  private pokemon: { id: number; view: NonNullable<FrontierView['pokemon']> } | null = null;

  constructor(
    readonly id: number,
    readonly data: FrontierSceneData,
    private readonly tables: FrontierTables,
    private readonly animationsOf: (sheet: Id) => readonly Ui2dAnimation[],
    /** The screen when the scene starts (the field faded out before the frontier; a sub-app returns faded out too). */
    fade: { color: 'black' | 'white'; alpha: number },
  ) {
    this.fade = { ...fade, anim: null };
  }

  /** Decomp FrontierScrCmd_22: loads a character's graphics (once per gfx). */
  loadCharacter(gfx: number): void {
    if (!this.tables.characters[gfx]) throw new Error(`frontier: no 2D character for ${gfx}`);
    this.loaded.add(gfx);
  }

  /** Decomp FrontierScrCmd_23 (ov104_0223D148). */
  unloadCharacter(gfx: number): void {
    this.loaded.delete(gfx);
  }

  /**
   * Decomp FrontierScrCmd_24 → ov104_0223D180: an actor at its table position (the foot; the object 8, 16 up-left),
   * facing `dir`, drawn when `visible`. The player's actor (`camera`) takes slot 31, which the camera follows.
   */
  addActor(localId: number, gfx: number, dir: number, x: number, y: number, visible: boolean, camera: boolean): void {
    if (!this.loaded.has(gfx)) throw new Error(`frontier: actor ${localId} uses ${gfx}, whose graphics are not loaded`);
    const sheet = this.tables.characters[gfx]!;
    const slot = camera ? CAMERA_SLOT : this.actors.findIndex((a) => !a);
    if (slot < 0) throw new Error('frontier: no free actor slot');
    if (this.actors[slot]) throw new Error(`frontier: actor slot ${slot} is taken`);
    const sequences = this.animationsOf(sheet);
    this.actors[slot] = new Actor(localId, gfx, sheet, sequences, x - ACTOR_OFFSET.x, y - ACTOR_OFFSET.y, dir, visible, sequences.length <= 5);
    if (camera) this.camera = { x: x - ACTOR_OFFSET.x - CAMERA.x, y: y - ACTOR_OFFSET.y - CAMERA.y };
  }

  /** Decomp FrontierScrCmd_25 (ov104_0223D200). */
  removeActor(localId: number): void {
    const i = this.actors.findIndex((a) => a?.localId === localId);
    if (i < 0) throw new Error(`frontier: no actor ${localId} to remove`);
    if (this.actors[i]!.task) throw new Error(`frontier: actor ${localId} is removed while it moves`);
    this.actors[i] = null;
  }

  private actor(localId: number): Actor {
    const a = this.actors.find((x) => x?.localId === localId);
    if (!a) throw new Error(`frontier: no actor ${localId}`);
    return a;
  }

  /** Decomp FrontierScrCmd_26: an actor's draw flag. */
  setVisible(localId: number, visible: boolean): void {
    this.actor(localId).visible = visible;
  }

  /** Decomp FrontierScrCmd_ApplyMovement: a movement task for the actor (one at a time). */
  applyMovement(localId: number, steps: Movement['steps']): void {
    const a = this.actor(localId);
    if (a.task) throw new Error(`frontier: actor ${localId} already moves`);
    a.task = { steps, index: 0, elapsed: 0, delay: 0, state: 0 };
    this.movements++;
  }

  /** Decomp FrontierScrCmd_2A: loads a frontier_obj sprite's resources. */
  loadSpriteResources(id: number): void {
    if (!this.tables.objects[String(id)]) throw new Error(`frontier: no frontier_obj sprite ${id}`);
    this.resources.add(id);
  }

  /** Decomp FrontierScrCmd_2B. */
  unloadSpriteResources(id: number): void {
    this.resources.delete(id);
  }

  /** Decomp FrontierScrCmd_2C → ov104_0223D2FC: a sprite in slot `slot` at x, y (room px), its draw and animate flags. */
  addSprite(slot: number, id: number, x: number, y: number, visible: boolean, animating: boolean): void {
    if (!this.resources.has(id)) throw new Error(`frontier: sprite ${id} without its resources (FrontierScrCmd_2A)`);
    if (slot < 0 || slot >= this.sprites.length || this.sprites[slot]) throw new Error(`frontier: sprite slot ${slot} is not free`);
    const sheet = this.tables.objects[String(id)]!;
    const anim = new Anim(this.animationsOf(sheet));
    anim.restart(0);
    this.sprites[slot] = { id, sheet, x, y, visible, animating, anim, tick: 0 };
  }

  /** Decomp FrontierScrCmd_2D. */
  removeSprite(slot: number): void {
    if (!this.sprites[slot]) throw new Error(`frontier: no sprite in slot ${slot}`);
    this.sprites[slot] = null;
  }

  private sprite(slot: number): ObjectSprite {
    const s = this.sprites[slot];
    if (!s) throw new Error(`frontier: no sprite in slot ${slot}`);
    return s;
  }

  /** Decomp FrontierScrCmd_2E. */
  setSpriteVisible(slot: number, visible: boolean): void {
    this.sprite(slot).visible = visible;
  }

  /** Decomp FrontierScrCmd_2F: the sprite mirrored left to right (the multi corridor's second door). */
  flipSprite(slot: number): void {
    this.sprite(slot).flip = true;
  }

  /** Decomp FrontierScrCmd_31: plays an animation (and turns animating on). */
  playSprite(slot: number, anim: number): void {
    const s = this.sprite(slot);
    s.anim.restart(anim);
    s.animating = true;
    s.tick = 0;
  }

  /** Decomp FrontierScrCmd_32. */
  stopSprite(slot: number): void {
    this.sprite(slot).animating = false;
  }

  /** Decomp FrontierScrCmd_33's wait: done when not animating, or its animation has ended. */
  spriteDone(slot: number): boolean {
    const s = this.sprite(slot);
    return !s.animating || !s.anim.playing;
  }

  /** Decomp FrontierScrCmd_FadeScreen (StartScreenFade): `steps × framesPerStep` ticks toward the colour or away. */
  startFade(out: boolean, ticks: number, color: 'black' | 'white'): void {
    if (this.fade.color !== color && this.fade.alpha > 0 && !out) this.fade.alpha = 1;
    this.fade.color = color;
    const to = out ? 1 : 0;
    this.fade.anim = { from: this.fade.alpha, to, ticks: Math.max(1, Math.round(ticks * Math.abs(to - this.fade.alpha))), elapsed: 0 };
  }

  fadeDone(): boolean {
    return this.fade.anim === null;
  }

  /** The screen's fade now (a new scene starts from it). */
  get screen(): { color: 'black' | 'white'; alpha: number } {
    return { color: this.fade.color, alpha: this.fade.alpha };
  }

  /** Decomp FrontierScrCmd_4C: the screen shakes by ±x, ±y, swapping every `every` + 1 frames, `count` + 1 times. */
  startShake(x: number, y: number, every: number, count: number): void {
    if (this.shakeTask) throw new Error('frontier: a shake starts while one runs');
    this.shakeTask = { x, y, frame: 0, every, left: count };
  }

  shakeDone(): boolean {
    return this.shakeTask === null;
  }

  /** Decomp FrontierScrCmd_4E: after `delay` frames, window 0 over `rect` (characters hidden in it), or none. */
  startWindow(rect: { x1: number; y1: number; x2: number; y2: number }, delay: number, on: boolean): void {
    if (this.windowTask) throw new Error('frontier: a window task starts while one runs');
    this.windowTask = { rect, delay, on };
  }

  windowDone(): boolean {
    return this.windowTask === null;
  }

  /** Decomp FrontierScrCmd_45: a party Pokémon's front sprite (resource `id`) centred at x, y. */
  showPokemon(id: number, view: NonNullable<FrontierView['pokemon']>): void {
    if (this.pokemon) throw new Error(`frontier: a Pokémon sprite (${this.pokemon.id}) is already shown`);
    this.pokemon = { id, view };
  }

  /** Decomp FrontierScrCmd_46. */
  hidePokemon(id: number): void {
    if (this.pokemon?.id !== id) throw new Error(`frontier: no Pokémon sprite ${id}`);
    this.pokemon = null;
  }

  /** One frame in the decomp's SysTask order (see the module comment). */
  step(): void {
    // Decomp UpdateCorridorFloorBG: BG2 one px further down a frame, back to 0 past 255.
    if (this.corridorFloor) this.fgScroll.y = this.fgScroll.y >= 255 ? 0 : this.fgScroll.y + 1;
    const shake = this.shakeTask;
    if (shake && ++shake.frame > shake.every) {
      shake.frame = 0;
      if (--shake.left < 0) this.shakeTask = null;
      else {
        shake.x = -shake.x;
        shake.y = -shake.y;
      }
    }
    const w = this.windowTask;
    if (w) {
      if (w.delay <= 0) {
        this.window = w.on ? w.rect : null;
        this.windowTask = null;
      } else w.delay--;
    }
    for (const a of this.actors) a?.step();
    this.stepMovements();
    for (const a of this.actors) a?.updateSprite();
    const followed = this.actors[CAMERA_SLOT];
    if (followed) this.camera = { x: followed.position.x - CAMERA.x, y: followed.position.y - CAMERA.y };
    for (const s of this.sprites) {
      if (!s?.animating) continue;
      s.anim.update(1);
      s.tick++;
    }
    const f = this.fade.anim;
    if (f) {
      f.elapsed++;
      this.fade.alpha = f.from + ((f.to - f.from) * f.elapsed) / f.ticks;
      if (f.elapsed >= f.ticks) {
        this.fade.alpha = f.to;
        this.fade.anim = null;
      }
    }
  }

  /** Decomp FrontierObject_DoAnimation for every actor that moves; a command it queues starts this frame (61000). */
  private stepMovements(): void {
    for (const a of this.actors) {
      const t = a?.task;
      if (!a || !t) continue;
      const step = t.steps[t.index];
      if (t.state === 0 && !step) {
        t.state = 2;
        continue;
      }
      if (t.state === 2) {
        if (!a.idle) continue;
        a.task = null;
        this.movements--;
        continue;
      }
      if (!a.idle) continue;
      const delay = DELAYS[step!.op];
      if (delay !== undefined) {
        if (++t.delay >= delay) {
          t.delay = 0;
          t.index++;
        }
        continue;
      }
      if (step!.op === 'fr_warp_in' || step!.op === 'fr_warp_out') {
        a.visible = step!.op === 'fr_warp_in';
        t.index++;
        continue;
      }
      const action = MOVEMENT_ACTIONS[step!.op];
      if (!action) throw new Error(`frontier: no 2D movement ${step!.op}`);
      a.start(action[0], action[1]);
      if (++t.elapsed >= step!.count) {
        t.elapsed = 0;
        t.index++;
      }
    }
  }

  view(): FrontierView {
    const actors: FrontierActorView[] = this.actors.flatMap((a) =>
      a ? [{ localId: a.localId, sheet: a.sheet, x: a.position.x, y: a.position.y, facing: DIRS[a.dir]!, anim: a.anim.seq, frame: a.anim.frame, visible: a.visible }] : [],
    );
    const objects: FrontierObjectView[] = this.sprites.flatMap((s, slot) => (s ? [{ slot, sheet: s.sheet, x: s.x, y: s.y, anim: s.anim.seq, frame: s.anim.frame, visible: s.visible, ...(s.flip ? { flip: true as const } : {}) }] : []));
    return {
      scene: this.id,
      bg: this.data.bg,
      fg: this.data.fg,
      shadow: this.tables.shadow,
      camera: { ...this.camera },
      actors,
      objects,
      fade: this.fade.alpha > 0 ? { color: this.fade.color, alpha: this.fade.alpha } : null,
      ...(this.fgScroll.x || this.fgScroll.y ? { fgScroll: { ...this.fgScroll } } : {}),
      ...(this.fgBelow ? { fgBelow: true as const } : {}),
      ...(this.data.fgFixed ? { fgFixed: true as const } : {}),
      ...(this.fgHidden ? { fgHidden: true as const } : {}),
      ...(this.shakeTask && (this.shakeTask.x || this.shakeTask.y) ? { shake: { x: this.shakeTask.x, y: this.shakeTask.y } } : {}),
      ...(this.window ? { window: { ...this.window } } : {}),
      ...(this.pokemon ? { pokemon: { ...this.pokemon.view } } : {}),
    };
  }
}
