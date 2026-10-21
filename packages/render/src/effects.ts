import * as THREE from 'three';
import type { Id } from '@opensinnoh/core';
import type { BillboardSprite, EffectView, Facing, FieldEffect, Registries, StubLog, TextureAnimation, Vec3 } from '@opensinnoh/contracts';
import type { AssetCache } from './assets.ts';
import { splitRef } from './assets.ts';
import { billboardMaterial } from './billboard.ts';
import { fieldOutputs, type FieldOutput } from './composite.ts';
import { Materials } from './materials.ts';

/**
 * Field effects from `FieldView.effects` (decomp FIELD_EFFECT_RENDERER_*). The world gives each
 * effect's anchor (`EffectView.cur`: a tile centre at ground height, or the object it follows); the
 * renderer adds the DS draw offset of the effect (by `FieldEffect.name`, from the decomp renderers),
 * rotates the per-direction models by `facing`, and plays the effect's animation from `tick`.
 * Ground models (footprints, tracks, splashes, mounds) are lifted to sit just above the anchor; the berry soil keeps
 * its DS height.
 */

/** DS draw offsets (world units) by effect name prefix, from the decomp renderers. */
const OFFSETS: [RegExp, Vec3][] = [
  [/^(VERY_)?TALL_GRASS$/, [0, 0, 10]],
  [/^MUD_GRASS$/, [-0.5, 0, 5]],
  [/^(SHALLOW_WATER_RIPPLE|LANDING_DUST|REVEAL_SMOKE)$/, [0, 0, 8]],
  [/^PUDDLE_SPLASH$/, [0, 0, 1]],
  [/^FOOTPRINT_(SAND|SNOW)_|^TRACK_SAND_/, [0, 0, 1]],
  [/^TRACK_SNOW_/, [0, 0, -2]],
  // ov5_021F31B4: the Poké Radar's patches stand half the tall grass's offset south of the tile centre.
  [/^RADAR_GRASS_/, [0, 0, 1]],
];
/**
 * Flat models drawn at their own height over the anchor (the object position), as the DS draws them: the berry soil
 * (berry_patch_effects.c, 2 units up) lies over the plot the map draws 0.5 units over the ground, and at the lift of
 * the other ground models it would fight that plot for depth.
 */
const DS_HEIGHT = /^BERRY_PATCH_SOIL_/;
/** Models rotated by facing (DS: N 180°, S 0°, W 270°, E 90° about Y). */
const ROTATED = /^(SURF_BLOB|ROCK_CLIMB_MOUNT|WARP_ARROW)$/;
const YAW: Record<Facing, number> = { up: 180, down: 0, left: 270, right: 90 };
/** Footprints and tracks: opaque for 16 ticks, then alpha −2 (of 31) per tick (ov5_021F1CC8.c). */
const FADES = /^(FOOTPRINT|TRACK)_/;
/** Surf blob bob (surf_mount_renderer.c): 1 → 4 units and back at 0.25 per tick; drawn at y + bob − 1. */
export function surfBob(tick: number): number {
  const t = tick % 24;
  return (t < 12 ? 1 + t * 0.25 : 4 - (t - 12) * 0.25) - 1;
}

export function fadeAlpha(tick: number): number {
  return Math.max(0, Math.min(31, 31 - 2 * (tick - 16))) / 31;
}

/** Frame of an effect animation at `tick`: loops, or plays once and holds its last frame. */
export function effectFrame(list: readonly { frame: number; ticks: number }[], tick: number, loop: boolean): number {
  const total = list.reduce((n, f) => n + f.ticks, 0);
  let t = loop ? tick % total : tick;
  for (const f of list) if ((t -= f.ticks) < 0) return f.frame;
  return list[list.length - 1]!.frame;
}

interface Instance {
  effect: FieldEffect;
  object: THREE.Object3D;
  /** Billboard: its texture and record. */
  sprite?: { record: BillboardSprite; texture: THREE.Texture; anchorZ: { value: number } };
  /** Model: per-instance materials (fades, patterns), the pattern frames, and the lift to the ground. */
  materials: THREE.MeshBasicMaterial[];
  pattern?: { frames: { texture: THREE.Texture; ticks: number }[]; total: number; materials: THREE.MeshBasicMaterial[] };
  /** Model: its glTF joint clip (the destroy-obstacle animations), posed at the effect's tick. */
  joint?: { mixer: THREE.AnimationMixer; action: THREE.AnimationAction; ticks: number };
  lift: number;
}

/** DS frames per second: a joint clip plays one frame per tick. */
const FRAME_RATE = 30;

const lerp = (a: Vec3, b: Vec3, t: number) => new THREE.Vector3(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);

export class FieldEffects {
  private readonly live = new Map<number, Instance | null>();
  private generation = 0;
  /** Effects that could not be drawn, reported once. */
  private readonly reported = new Set<string>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly reg: Registries,
    private readonly assets: AssetCache,
    /** A lit, converted clone of a model (the renderer's model-object path). */
    private readonly model: (id: Id) => Promise<THREE.Object3D>,
    private readonly log: StubLog,
    private readonly failed: (what: string) => (e: unknown) => never,
  ) {}

  /** Instances still loading. */
  pending(): number {
    let n = 0;
    for (const v of this.live.values()) if (v === null) n++;
    return n;
  }

  clear(): void {
    this.generation++;
    for (const i of this.live.values()) if (i) this.remove(i);
    this.live.clear();
  }

  private remove(i: Instance): void {
    this.scene.remove(i.object);
    i.sprite?.texture.dispose();
    for (const m of i.materials) m.dispose();
  }

  /** `light`: the colour of a billboard under the area light (lighting.ts billboardLight); model effects are lit as meshes. */
  update(effects: readonly EffectView[], alpha: number, light: THREE.Color): void {
    const seen = new Set<number>();
    for (const e of effects) {
      seen.add(e.key);
      if (!this.live.has(e.key)) this.create(e);
      const inst = this.live.get(e.key);
      if (inst) this.place(inst, e, alpha);
      if (inst?.sprite) (inst.object as THREE.Sprite).material.color.copy(light);
    }
    for (const [key, inst] of this.live) {
      if (seen.has(key)) continue;
      if (inst) this.remove(inst);
      this.live.delete(key);
    }
  }

  private create(e: EffectView): void {
    const effect = this.reg.fieldEffects.get(e.effect);
    if (!effect) throw new Error(`render: missing fieldEffects ${e.effect}`);
    this.live.set(e.key, null);
    const generation = this.generation;
    const done = (inst: Instance) => {
      if (generation !== this.generation || !this.live.has(e.key)) return this.remove(inst);
      this.scene.add(inst.object);
      this.live.set(e.key, inst);
    };
    if (effect.sprite) void this.billboard(effect, effect.sprite).then(done, this.failed(`effect ${effect.id}`));
    else if (effect.model) void this.modelInstance(effect, effect.model).then(done, this.failed(`effect ${effect.id}`));
    else if (!this.reported.has(effect.id)) {
      this.reported.add(effect.id);
      this.log.stub('render:fldeff', `${effect.id} has neither a model nor a sprite`);
    }
  }

  private async billboard(effect: FieldEffect, spriteId: Id): Promise<Instance> {
    const record = this.reg.sprites.get(spriteId);
    if (!record || !('atlas' in record)) throw new Error(`render: effect sprite ${spriteId} is not a billboard`);
    const texture = (await this.assets.texture(record.atlas)).clone();
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    const { material, anchorZ } = billboardMaterial(texture);
    const object = new THREE.Sprite(fieldOutputs(material, { polygonId: 0, fog: true }));
    object.center.set(0.5, 0);
    object.scale.set(record.frameSize, record.frameSize, 1);
    return { effect, object, sprite: { record, texture, anchorZ }, materials: [], lift: 0 };
  }

  private async modelInstance(effect: FieldEffect, modelId: Id): Promise<Instance> {
    const object = await this.model(modelId);
    const box = new THREE.Box3().setFromObject(object);
    // Flat models are lifted to just above the anchor; models with volume (surf blob, mount) keep their DS height.
    const lift = box.max.y - box.min.y < 0.01 && !DS_HEIGHT.test(effect.name) ? 0.5 - box.min.y : 0;
    const materials: THREE.MeshBasicMaterial[] = [];
    object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const source = mesh.material as THREE.MeshBasicMaterial;
      const m = fieldOutputs(source.clone(), source.userData.fieldOutput as FieldOutput);
      if (FADES.test(effect.name)) m.transparent = true;
      mesh.material = m;
      materials.push(m);
    });
    const inst: Instance = { effect, object, materials, lift };
    const anim = Object.values(effect.animations ?? {})[0];
    // A clip names a texture animation, or a glTF joint clip; a joint clip plays the model's own pattern
    // (`Model.animations`) on the same tick (Rock Smash's dust).
    const textureAnim = anim && this.reg.textureAnimations.get(anim.clip as Id);
    const model = this.reg.models.get(modelId);
    if (!model) throw new Error(`render: missing models ${modelId}`);
    const { scene, animations } = await this.assets.model(model.gltf);
    if (anim && !textureAnim) {
      const clip = animations.find((c) => c.name === anim.clip);
      if (clip) {
        const mixer = new THREE.AnimationMixer(object);
        const action = mixer.clipAction(clip);
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
        inst.joint = { mixer, action, ticks: anim.ticks };
      }
    }
    const pattern = textureAnim ?? (inst.joint ? model.animations?.map((id) => this.reg.textureAnimations.get(id)).find((a) => a?.kind === 'frames') : undefined);
    if (pattern?.kind === 'frames') {
      // Only the materials binding the pattern's texture swap (the glTF's own materials name it).
      const names = new Set<string>();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && Materials.textureName(mesh.material as THREE.Material) === pattern.texture) names.add((mesh.material as THREE.Material).name);
      });
      inst.pattern = { ...(await this.patternFrames(modelId, pattern)), materials: materials.filter((m) => names.has(m.name)) };
    }
    return inst;
  }

  /** Pattern frames of a model effect: `<texture>~<k>__<palette>.png` next to its glTF. */
  private async patternFrames(modelId: Id, anim: Extract<TextureAnimation, { kind: 'frames' }>): Promise<{ frames: { texture: THREE.Texture; ticks: number }[]; total: number }> {
    const model = this.reg.models.get(modelId);
    if (!model) throw new Error(`render: missing models ${modelId}`);
    const { pack, path } = splitRef(model.gltf);
    const dir = path.slice(0, path.lastIndexOf('/'));
    const list = await this.assets.textureSet(`${pack}:${dir}`);
    const frames = await Promise.all(
      anim.frames.map(async (f) => {
        const name = [...list].find((n) => n.startsWith(`${f.texture}__`));
        if (!name) throw new Error(`render: ${model.gltf} lists no frame ${f.texture}`);
        return { texture: await this.assets.texture(`${pack}:${dir}/${name}.png`), ticks: f.ticks };
      }),
    );
    return { frames, total: frames.reduce((n, f) => n + f.ticks, 0) };
  }

  private place(inst: Instance, e: EffectView, alpha: number): void {
    const name = inst.effect.name;
    const p = lerp(e.prev, e.cur, alpha);
    const offset = OFFSETS.find(([re]) => re.test(name))?.[1];
    if (offset && !e.rotation) p.add(new THREE.Vector3(...offset));
    const use = e.anim ?? Object.keys(inst.effect.animations ?? {})[0];
    const clip = use ? inst.effect.animations?.[use] : undefined;
    if (inst.sprite) {
      const { record, texture, anchorZ } = inst.sprite;
      const list = (use && record.animations[use]) || record.animations['stand-down']!;
      const frame = effectFrame(list, e.tick, !!clip?.loop);
      const img = texture.image as { width: number; height: number };
      texture.repeat.set(record.frameSize / img.width, -1);
      texture.offset.set((frame * record.frameSize) / img.width, 1);
      inst.object.position.copy(p);
      anchorZ.value = p.z;
      return;
    }
    if (name === 'SURF_BLOB' && !e.rotation) p.y += surfBob(e.tick);
    inst.object.position.set(p.x, p.y + (e.rotation ? 0 : inst.lift), p.z);
    if (e.rotation) inst.object.rotation.set(...e.rotation.map(v => v * Math.PI / 180) as [number, number, number], 'ZYX');
    else if (ROTATED.test(name) && e.facing) inst.object.rotation.set(0, (YAW[e.facing] * Math.PI) / 180, 0);
    if (FADES.test(name)) for (const m of inst.materials) m.opacity = fadeAlpha(e.tick);
    if (inst.joint) {
      inst.joint.action.time = Math.min(e.tick, inst.joint.ticks - 1) / FRAME_RATE;
      inst.joint.mixer.update(0);
    }
    if (inst.pattern) {
      let t = Math.min(e.tick, inst.pattern.total - 1);
      const frame = inst.pattern.frames.find((f) => (t -= f.ticks) < 0) ?? inst.pattern.frames[inst.pattern.frames.length - 1]!;
      for (const m of inst.pattern.materials) {
        if (m.map && m.map !== frame.texture) {
          m.map = frame.texture;
          m.needsUpdate = true;
        }
      }
    }
  }
}
