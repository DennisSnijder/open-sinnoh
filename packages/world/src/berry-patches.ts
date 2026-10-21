/**
 * Berry patches in the field (decomp berry_patch_manager.c, berry_patch_graphics.c, berry_patch_effects.c): the soil
 * objects (OBJ_EVENT_GFX_BERRY_SOIL, their first data value the patch id) drawn as their plant (nothing while empty
 * or just planted, the sprout, then the berry's growing, blooming and fruit trees) with the soil's moisture model
 * under a plant; the patches the DS screen shows start growing (BerryPatches_UpdateGrowthStates); and the Sprayduck
 * task (BerryPatches_TaskMain). The DS tests visibility against its camera (GFXBoxTest); here the DS screen's
 * 16×12 tiles around the player stand in, so a wider view never changes what grows.
 */
import type { ActorView, BerryPatch, BerryTables, EffectView, Facing, ObjectEvent } from '@opensinnoh/contracts';
import { patchMoisture, waterBerryPatch } from '@opensinnoh/services';
import type { Id } from '@opensinnoh/core';

/** The DS screen around the player in tiles (256×192 px): 8 columns either side, 6 rows above and below. */
const SCREEN_HALF = { x: 8, z: 6 };
/** Decomp BerryPatches_TaskMain: 30 × 3 ticks without a step end the task. */
const WATERING_TIMEOUT = 30 * 3;
/** Effect keys of the soil models, past the field's own effect counter. */
const SOIL_EFFECT_KEY = 0x7f000000;

export interface PatchObject {
  localId: number;
  x: number;
  z: number;
  patch: number;
}

/** The soil objects of a zone's events with their patch ids (ObjectEvent.data[0]). */
export function soilObjects(tables: BerryTables, events: readonly ObjectEvent[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const ev of events) if (ev.sprite === tables.soil) out.set(ev.localId, ev.data[0]!);
  return out;
}

/** Decomp BerryPatchGraphics_GetGraphicsResourceID: nothing while empty or planted, the sprout, then the berry's trees. */
export function plantSprite(tables: BerryTables, p: BerryPatch): Id | null {
  if (p.stage === 'none' || p.stage === 'planted') return null;
  if (p.stage === 'sprouted') return tables.sprout;
  const b = tables.berries.find((x) => x.item === p.berry);
  if (!b) throw new Error(`berry patch: ${p.berry} has no tree sprites`);
  return b.sprites[p.stage];
}

/** The soil actor drawn as its plant (hidden while there is none). */
export function patchActorView(tables: BerryTables, view: ActorView, p: BerryPatch): ActorView {
  const sprite = plantSprite(tables, p);
  return sprite ? { ...view, sprite } : { ...view, visible: false };
}

/** Decomp BerryPatchMoistureEffect_Render: under a plant (any stage), the soil model of its moisture. */
export function soilEffect(tables: BerryTables, patchId: number, p: BerryPatch, view: ActorView): EffectView | null {
  if (p.stage === 'none' || !view.visible) return null;
  return { key: SOIL_EFFECT_KEY + patchId, effect: tables.moisture[patchMoisture(p)], cur: view.cur, prev: view.prev, tick: 0 };
}

/** A tile on the DS screen around the player (the stand-in for the DS camera's GFXBoxTest). */
export const onDsScreen = (x: number, z: number, player: { x: number; z: number }): boolean => Math.abs(x - player.x) <= SCREEN_HALF.x && Math.abs(z - player.z) <= SCREEN_HALF.z;

/** Decomp BerryPatches_UpdateGrowthStates: the patches on the DS screen around the player grow from now on. */
export function activateVisiblePatches(patches: BerryPatch[], objects: Iterable<PatchObject>, player: { x: number; z: number }): void {
  for (const o of objects) {
    if (!onDsScreen(o.x, o.z, player)) continue;
    const p = patches[o.patch];
    if (!p) throw new Error(`berry patch ${o.patch} does not exist (${patches.length} patches)`);
    p.growing = true;
  }
}

export interface WateringHost {
  patches: BerryPatch[];
  /** The soil object's patch id at a tile, null when no soil object stands there. */
  patchAt(x: number, z: number): number | null;
  /** Whether the player would collide stepping onto the tile (terrain or an object). */
  blocked(x: number, z: number): boolean;
  player(): { x: number; z: number };
  /** Starts the player's one-tile step; `stepping` is true until it ends. */
  step(dir: 'left' | 'right'): void;
  stepping(): boolean;
  face(dir: Facing): void;
}

/**
 * Decomp BerryPatches_TaskMain: water the patch faced (up or down), then wait for a side step: held left or right with
 * a patch in the row north of that tile (decomp BerryPatches_GetAdjacentObject reads z − 1 whichever way the player
 * faces) and the tile free steps there and waters again; held toward the other row, no patch beside, or the timeout
 * ends the task, facing the way it started.
 */
export class WateringTask {
  private phase: 'water' | 'input' | 'step' | 'done' = 'water';
  private timer = 0;

  constructor(
    private readonly host: WateringHost,
    readonly direction: 'up' | 'down',
  ) {}

  get done(): boolean {
    return this.phase === 'done';
  }

  step(held: readonly string[]): void {
    const h = this.host;
    if (this.phase === 'step') {
      if (h.stepping()) return;
      if (this.target() === null) return this.finish();
      this.phase = 'water';
    }
    if (this.phase === 'water') {
      const id = this.target();
      if (id !== null) waterBerryPatch(h.patches[id]!);
      this.timer = 0;
      this.phase = 'input';
    }
    if (this.phase !== 'input') return;
    const p = h.player();
    for (const dir of ['left', 'right'] as const) {
      if (!held.includes(dir)) continue;
      const nx = p.x + (dir === 'left' ? -1 : 1);
      if (h.patchAt(nx, p.z - 1) === null) return this.finish();
      if (!h.blocked(nx, p.z)) {
        h.step(dir);
        this.phase = 'step';
        return;
      }
      break;
    }
    if (!held.includes('left') && !held.includes('right')) {
      // Decomp: up from the lower row turns up first; the cleanup faces the task's way again either way.
      if (held.includes('up') && this.direction === 'down') return this.finish();
      if (held.includes('down') && this.direction === 'up') return this.finish();
    }
    if (++this.timer > WATERING_TIMEOUT) this.finish();
  }

  /** Decomp BerryPatches_GetTargetPatch: the patch above or below the player, by the task's direction. */
  private target(): number | null {
    const p = this.host.player();
    return this.host.patchAt(p.x, p.z + (this.direction === 'up' ? -1 : 1));
  }

  /** Decomp BERRY_WATERING_STATE_CLEANUP: the player faces the task's way. */
  private finish(): void {
    this.host.face(this.direction);
    this.phase = 'done';
  }
}
