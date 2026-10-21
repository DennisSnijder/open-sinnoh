import type { FeatureModelView, PastoriaGymTables } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { gymTables, slotOf, type FeatureHost, type MapFeature } from './feature.ts';

/**
 * Pastoria Gym's water and buttons (decomp src/overlay008/gym_features.c PastoriaGym_*;
 * docs/research/gym-puzzles.md). The saved button (`MapFeatures` pastoria-gym `pressedButton`) sets the water
 * prop and one dynamic height plate over the gym to 0, 32 or 64; H/M/L ground lets the player in only at the
 * matching height. A coord event's `press_pastoria_gym_button` finds the button prop under the player and
 * runs the press: the three button groups' pattern animations play once (the pressed one down, the others
 * up), then the water moves one unit a tick and the plate takes the new height at the end.
 */

/** PASTORIA_*_BUTTON_PRESSED. */
const ORANGE = 0;
const GREEN = 1;
const BLUE = 2;
/** PASTORIA_WATER_HEIGHT_LOW / _MIDDLE / _HIGH (MAP_OBJECT_TILE_SIZE × 0, 2, 4), by pressed button. */
const WATER_HEIGHT = [0, 32, 64] as const;
/** PastoriaGym_DynamicMapFeaturesInit: the water prop's spot and the plate (1, 2) sized 25 × 38 tiles. */
const WATER_AT = { x: 256, z: 256 };
const PLATE = { x: 1, z: 2, width: 25, depth: 38 };
/** The decomp's group order (PASTORIA_BLUE/GREEN/ORANGE_BUTTON_GROUP) is the order the tables name them. */
const COLOURS = ['orange', 'green', 'blue'] as const;

/** One button group's MapPropAnimation: the frame (0 … frames − 1), its direction, and whether it still plays. */
interface Group {
  prop: Id;
  frames: number;
  frame: number;
  reversed: boolean;
  looping: boolean;
}

export class PastoriaGym implements MapFeature {
  private readonly t: PastoriaGymTables;
  /** The water prop's height; the plate keeps its own until the task ends (DynamicTerrainHeightManager_SetHeight). */
  private waterY: number;
  private plateY: number;
  /** By pressed-button value (ORANGE, GREEN, BLUE). */
  private readonly groups: Group[];
  private task: { pressed: number; state: number } | null = null;

  constructor(private readonly h: FeatureHost) {
    this.t = gymTables(h.reg).pastoria;
    const pressed = this.pressed;
    this.waterY = this.plateY = WATER_HEIGHT[pressed]!;
    // Each group's animation is paused on its last frame: the pressed button down, the others up (reversed).
    this.groups = COLOURS.map((c, i) => {
      const prop = this.t.buttons[c];
      const frames = this.clipFrames(prop);
      const reversed = i !== pressed;
      return { prop, frames, frame: reversed ? 0 : frames - 1, reversed, looping: false };
    });
  }

  private get pressed(): number {
    const b = slotOf(this.h.state, 'pastoria-gym').pressedButton;
    if (b !== ORANGE && b !== GREEN && b !== BLUE) throw new Error(`world: Pastoria Gym pressed button ${b}`);
    return b;
  }

  /** NNS_G3dAnmObjGetNumFrame of the button's pattern animation (its model's one `frames` texture animation). */
  private clipFrames(prop: Id): number {
    const model = this.h.reg.props.get(prop)?.model;
    const anims = (model && this.h.reg.models.get(model)?.animations) ?? [];
    const clips = anims.map((id) => this.h.reg.textureAnimations.get(id)).filter((a) => a?.kind === 'frames');
    if (clips.length !== 1) throw new Error(`world: Pastoria Gym button ${prop} has ${clips.length} pattern animations, not 1`);
    const clip = clips[0]!;
    if (clip.kind !== 'frames') throw new Error('unreachable');
    return clip.frames.reduce((n, f) => n + f.ticks, 0);
  }

  /** DynamicTerrainHeightManager plate 0: the plate's height on a tile inside it. */
  plate(tx: number, tz: number): number | null {
    return tx >= PLATE.x && tx < PLATE.x + PLATE.width && tz >= PLATE.z && tz < PLATE.z + PLATE.depth ? this.plateY : null;
  }

  /** PastoriaGym_DynamicMapFeaturesCheckCollision: H/M/L ground only at the player's height 0/32/64. */
  blocks(x: number, z: number): boolean {
    const y = this.h.hero().y;
    const b = this.h.behaviour(x, z);
    if (b === 'PASTORIA_GYM_H_GROUND') return y !== WATER_HEIGHT[ORANGE];
    if (b === 'PASTORIA_GYM_M_GROUND') return y !== WATER_HEIGHT[GREEN];
    if (b === 'PASTORIA_GYM_L_GROUND') return y !== WATER_HEIGHT[BLUE];
    return false;
  }

  /**
   * PastoriaGym_PressButton: the button prop whose placement is on the player's tile (a 1×1 hitbox); none,
   * nothing happens. The slot is written at once, before the task runs.
   */
  press(): void {
    if (this.task) throw new Error('world: press_pastoria_gym_button while the water moves');
    const p = this.h.hero();
    const at = this.h.propsAt(p.x, p.z);
    const i = this.groups.findIndex((g) => at.includes(g.prop));
    if (i < 0) return;
    slotOf(this.h.state, 'pastoria-gym').pressedButton = i;
    this.task = { pressed: i, state: 0 };
  }

  done(): boolean {
    return this.task === null;
  }

  busy(): boolean {
    return this.task !== null;
  }

  /**
   * One frame: the press task (PastoriaGym_PressOrange/Green/BlueButton) runs first, then the prop animations
   * advance (FieldTask_Run before the field map's MapPropAnimationManager_AdvanceAnimations).
   */
  step(): void {
    const k = this.task;
    if (k) this.stepTask(k);
    for (const g of this.groups) this.advance(g);
  }

  private stepTask(k: { pressed: number; state: number }): void {
    const target = WATER_HEIGHT[k.pressed]!;
    switch (k.state) {
      case 0:
        this.startAnimations(k.pressed);
        k.state = 1;
        return;
      case 1: {
        if (this.groups.some((g) => g.looping)) return;
        if (k.pressed === GREEN) {
          // The green task picks a direction once the buttons are done (and ends at once when already middle).
          if (this.waterY === target) {
            this.task = null;
            return;
          }
          if (this.waterY !== WATER_HEIGHT[ORANGE] && this.waterY !== WATER_HEIGHT[BLUE]) throw new Error(`world: Pastoria Gym water at ${this.waterY}`);
          k.state = 2;
          return;
        }
        this.moveWater(target, k, 2);
        return;
      }
      case 2:
        if (k.pressed === GREEN) {
          this.moveWater(target, k, 3);
          return;
        }
        this.h.sound.stop(1626);
        this.plateY = target;
        k.state = 3;
        return;
      case 3:
        if (k.pressed === GREEN) {
          this.h.sound.stop(1626);
          this.plateY = target;
          k.state = 4;
          return;
        }
        this.task = null;
        return;
      case 4:
        this.task = null;
        return;
      default:
        throw new Error(`world: Pastoria Gym task in state ${k.state}`);
    }
  }

  /** One unit a tick toward the target; on reaching it, the next state. */
  private moveWater(target: number, k: { state: number }, next: number): void {
    this.waterY += target > this.waterY ? 1 : -1;
    if (this.waterY === target) k.state = next;
  }

  /** PastoriaGym_UpdateButtonAnimations: each group from its first frame, the pressed one forward, the others reversed. */
  private startAnimations(pressed: number): void {
    this.h.sound.play(1626);
    this.groups.forEach((g, i) => {
      g.reversed = i !== pressed;
      g.frame = g.reversed ? g.frames - 1 : 0;
      g.looping = true;
    });
  }

  /** MapPropAnimation_AdvanceFrame with loop count 1: it stops once on its last frame (frame 0 when reversed). */
  private advance(g: Group): void {
    if (!g.looping) return;
    if (!g.reversed) g.frame = g.frame + 1 === g.frames ? 0 : g.frame + 1;
    else g.frame = g.frame <= 0 ? g.frames - 1 : g.frame - 1;
    if (g.reversed ? g.frame === 0 : g.frame >= g.frames - 1) g.looping = false;
  }

  view(): ReturnType<MapFeature['view']> {
    const models: FeatureModelView[] = [{ key: 'pastoria-water', prop: this.t.water, position: [WATER_AT.x, this.waterY, WATER_AT.z], rotation: [0, 0, 0] }];
    return { effects: [], features: { models, propPoses: this.groups.map((g) => ({ prop: g.prop, tick: g.frame })) } };
  }

  /** Test probe: the water prop's and the plate's heights and each group's frame (orange, green, blue). */
  probe(): { water: number; plate: number; frames: number[] } {
    return { water: this.waterY, plate: this.plateY, frames: this.groups.map((g) => g.frame) };
  }
}
