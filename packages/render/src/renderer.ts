import { StoryScenes } from './story-scenes.ts';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { Ships, shipFade } from './ships.ts';
import { DistortionWarp, warpFade } from './distortion/warp.ts';
import { ceilingsFor, type Ceiling } from './ceilings.ts';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Id } from '@opensinnoh/core';
import type { Area, AssetRef, Camera as CameraRecord, DoorView, FieldRenderer, GameState, MountFieldRenderer, Prop, Registries, BillboardSprite, StubLog, TextureAnimation } from '@opensinnoh/contracts';
import { CHUNK_SIZE, MapGrid, gridOffset, type ActorView, type FieldView, type OpenSinnohWorld, type Vec3 } from '@opensinnoh/world';
import { AssetCache, disposeTree } from './assets.ts';
import { cardFoot, restCards } from './cards.ts';
import { billboardMaterial, billboardMatrix, slopeDepthLift, faceCameraNodes, nodeBillboard, reflectionMaterial } from './billboard.ts';
import { Composite, fieldOutputs } from './composite.ts';
import { cameraAllowed, enhancedVisuals, needsPost, type EnhancedConfig } from './enhanced/config.ts';
import { glowKind, type GlowKind } from './enhanced/light-sources.ts';
import type { EnhancedPipeline } from './enhanced/pipeline.ts';
import { FieldEffects } from './effects.ts';
import { FeatureModels } from './gyms/index.ts';
import { DISTORTION_FOG, DistortionProps, DistortionSky, distortionCamera } from './distortion/index.ts';
import { WeatherOverlay, weatherCameraScale } from './weather.ts';
import { capFlash, FlashLimiter } from './flash.ts';
import { billboardLight, dsVertexLight, lightAt, SHADOW_ALPHA_STEP, SHADOW_BY_PERIOD, SHADOW_SCALE_STEP, type LightTemplate } from './lighting.ts';
import { Materials, patternAt, withTranslucentParts } from './materials.ts';

/** The DS screen is 256×192. Wider screens show more world; narrower ones keep the DS width. */
const DS_ASPECT = 4 / 3;
/** One tile is 16 world units; door placements are matched to tiles. */
const TILE = 16;
/**
 * The DS anchors a character quad's bottom edge at the object position plus 6 units south (decomp
 * ov5_021EDEB4). Its depth is the DS quad's, no further back than the object's own position (billboard.ts).
 */
const BILLBOARD_ANCHOR_Z = 6;
const DEG = Math.PI / 180;
/** The player's local id in `ActorView` (decomp LOCALID_PLAYER). */
const LOCALID_PLAYER = 255;
/** Character shadow ellipse (world units, x by z) and opacity. */
const SHADOW_SIZE = [14, 8] as const;
const SHADOW_OPACITY = 0.4;
/**
 * The DS shadow model (fldeff `kage`, FIELD_EFFECT_SHADOW) under each character: offset (−0.5, 1) in
 * x/z, alpha and x/z scale by time of day (ov5_021F134C.c; `SHADOW_BY_PERIOD`). Not drawn on the tiles
 * where the DS hides it (map_object_move.c).
 */
const NO_SHADOW = /^(TALL_GRASS|VERY_TALL_GRASS|WATER_RIVER|WATER_SEA|WATERFALL|PUDDLE|SHALLOW_WATER|SNOW_.*|MUD.*|REFLECTIVE)$/;
/**
 * Reflections (FIELD_EFFECT_RENDERER_01, ov5_021F17B8.c): a character on, or just north of, a puddle, river or
 * reflective tile is mirrored by a camera-facing quad hanging from 7 units north of it and 12 units under the ground
 * (16 under river water), with an x-scale wobble of ±1/8 over 32 ticks on river water and splashing puddles. The
 * quad's own depth would put most of it behind a shallow water bed (Pastoria City's and Route 212's puddles lie 16
 * units deep) where the DS shows the whole reflection, so its fragments take the depth of a plane `REFLECTION_PLANE`
 * under the character's ground instead: the opaque ground in front hides it, and it shows through the water of the
 * reflective tiles down to their bed.
 */
const REFLECTS: Record<string, { wobble: boolean; depth: number }> = {
  PUDDLE: { wobble: true, depth: 12 },
  WATER_RIVER: { wobble: true, depth: 16 },
  REFLECTIVE: { wobble: false, depth: 12 },
  PUDDLE_NO_SPLASHING: { wobble: false, depth: 12 },
};
const REFLECTION_Z = -7;
/** How far under the character's ground the reflection's depth plane lies. */
const REFLECTION_PLANE = 1;
/**
 * The '!' emote (decomp ov5_021F5A10.c): drawn at the object position + (0, 32, 1), bouncing up by
 * these offsets on its first ticks (velocity 6, −2 per tick), then resting.
 */
const EMOTE_OFFSET: Vec3 = [0, 32, 1];
/** EmoteBubbleEffect_Update: the bubble 2 units over the object and 1 toward the camera (its quad's centre). */
const BUBBLE_OFFSET: Vec3 = [0, 2, 1];
const EMOTE_BOUNCE = [6, 10, 12, 12, 10, 6];
/** DS animation frames per second (joint animations play one frame per tick). */
const FRAME_RATE = 30;
/**
 * Chunks are built for the camera target's cell and its neighbours, and for the cell the target will
 * reach in this many ticks at its current speed (so a running or cycling player never sees a chunk
 * appear). Cells further than DROP_DISTANCE from both are disposed.
 */
const LOOKAHEAD_TICKS = 45;
const DROP_DISTANCE = 3;
/** Chunk builds in flight at once, nearest first (each build is a burst of main-thread work); the ones in view are not held back. */
const MAX_BUILDS = 2;
/**
 * A cell is in view when it comes within this far of the view's ground footprint (world units): a tall model just
 * past the footprint's edge still reaches into the view.
 */
const VIEW_MARGIN = 4 * TILE;

const lerp3 = (a: Vec3, b: Vec3, t: number): THREE.Vector3 => new THREE.Vector3(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);

function need<T>(map: ReadonlyMap<Id, T>, id: Id, what: string): T {
  const v = map.get(id);
  if (!v) throw new Error(`render: missing ${what} ${id}`);
  return v;
}

/**
 * Frame index for an animation at a tick; `run` falls back to `walk` for sprites without run frames.
 * A pose (`pose-<pose>-<facing>`, else `pose-<pose>`) plays once and holds its last frame.
 */
export function spriteFrame(sprite: BillboardSprite, anim: ActorView['anim'], facing: string, tick: number, pose?: string): number {
  if (pose) {
    const list = sprite.animations[`pose-${pose}-${facing}`] ?? sprite.animations[`pose-${pose}`];
    if (!list || list.length === 0) throw new Error(`render: sprite ${sprite.id} has no pose-${pose}`);
    let t = tick;
    for (const f of list) if ((t -= f.ticks) < 0) return f.frame;
    return list[list.length - 1]!.frame;
  }
  const list = sprite.animations[`${anim}-${facing}`] ?? (anim === 'run' ? sprite.animations[`walk-${facing}`] : undefined);
  if (!list || list.length === 0) throw new Error(`render: sprite ${sprite.id} has no ${anim}-${facing} animation`);
  const total = list.reduce((n, f) => n + f.ticks, 0);
  let t = tick % total;
  for (const f of list) {
    if ((t -= f.ticks) < 0) return f.frame;
  }
  throw new Error('unreachable');
}

/**
 * One key per actor of a view: `<localId>:<sprite>#<n>`, n counting earlier actors with that local id and
 * sprite. Local ids repeat: a clone object (decomp script 0xFFFF) keeps the local id of its source zone's
 * object, so a zone may list one next to a scripted object with the same id (Route 201: the Sandgem
 * signboard and Rowan are both 5; Twinleaf's guitarist and Route 201's arrow signpost are both 3, each
 * listed in both zones). The key does not depend on where the other object of the pair is in the list:
 * a zone connection reorders the list (the old zone's objects leave, the carried ones take their new
 * zone's keys), and a positional key handed each pair's drawable to the other, so both were rebuilt
 * and missing for a frame at every crossing.
 */
export function actorKeys(actors: readonly ActorView[]): string[] {
  const seen = new Map<string, number>();
  return actors.map((a) => {
    const id = `${a.localId}:${a.sprite}`;
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    return `${id}#${n}`;
  });
}

/** One object across zone connections (`ActorView.home`, local id and sprite); event objects only. */
function objectKey(v: ActorView): string {
  if (!v.home) throw new Error(`render: actor ${v.localId} (${v.sprite}) is not an event object`);
  return `${v.home}/${v.localId}:${v.sprite}`;
}

/** Height offset of the emote at `elapsed` ticks after it appeared. */
export function emoteBounce(elapsed: number): number {
  return EMOTE_BOUNCE[elapsed] ?? 0;
}

/** Camera position relative to its target for a preset (pitch about X, then yaw about Y). */
/**
 * Where the view's corner rays meet the ground plane through the camera target, relative to the target
 * (world units). A ray above the horizon, or one reaching past the far plane, stops at the far plane.
 */
function groundReach(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, rec: CameraRecord): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const probe = camera.clone();
  cameraOffset(rec, probe.position);
  probe.lookAt(0, 0, 0);
  if (rec.angle[2]) probe.rotateZ(rec.angle[2] * DEG);
  probe.updateMatrixWorld();
  const r = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const near = new THREE.Vector3(x, y, -1).unproject(probe);
    const far = new THREE.Vector3(x, y, 1).unproject(probe);
    const t = near.y > 0 && far.y < 0 ? near.y / (near.y - far.y) : 1;
    const p = near.lerp(far, t);
    r.minX = Math.min(r.minX, p.x);
    r.maxX = Math.max(r.maxX, p.x);
    r.minZ = Math.min(r.minZ, p.z);
    r.maxZ = Math.max(r.maxZ, p.z);
  }
  return r;
}

/** The camera's offset from its target; `zoom` is added to its distance (FieldView.cameraDistance: Fly's and Teleport's zoom). */
function cameraOffset(rec: CameraRecord, out: THREE.Vector3, zoom = 0): THREE.Vector3 {
  const pitch = rec.angle[0] * DEG;
  const distance = rec.distance + zoom;
  return out.set(0, -Math.sin(pitch) * distance, Math.cos(pitch) * distance).applyAxisAngle(new THREE.Vector3(0, 1, 0), rec.angle[1] * DEG);
}

/**
 * Rotation from view space to world space for a camera preset. The probe is a camera: three's `lookAt` points a
 * camera's -Z at the target (a plain Object3D's +Z), so a camera-facing normal is +Z in view space, as on the DS
 * (GBATEK "DS 3D Polygon Light Parameters": the camera looks down -Z).
 */
export function viewToWorld(rec: CameraRecord): THREE.Quaternion {
  const probe = new THREE.PerspectiveCamera();
  cameraOffset(rec, probe.position);
  probe.lookAt(0, 0, 0);
  if (rec.angle[2]) probe.rotateZ(rec.angle[2] * DEG);
  return probe.quaternion;
}

/**
 * A lit mesh's world-space normals and light mask (POLYGON_ATTR bits 0–3), kept on `mesh.userData.lit`
 * so the area light's next template can relight it (`relight`). `own`: the material's own colours, which
 * replace the template's (a model drawn without the global material colours: props, indoor land, the field effect
 * models).
 *
 * Unlit polygons never follow the template's colours on the field: their vertex colour is a COLOR command's or the
 * diffuse DIF_AMB sets (bit 15), and the global diffuse would replace that only on outdoor land, whose unlit
 * materials all send COLOR commands.
 */
interface Lit {
  mask: number;
  normals: Float32Array;
  own?: MaterialColors;
}

type MaterialColors = Pick<LightTemplate, 'diffuse' | 'ambient' | 'specular' | 'emission'>;

/** The template's lights with the lit mesh's material colours. */
function litTemplate(template: LightTemplate, lit: Lit): LightTemplate {
  return lit.own ? { ...template, ...lit.own } : template;
}

/**
 * DS lighting: vertex colours for a `Lit` mesh under an area light template, whose light vectors are in view space.
 * Replaces any colours (the DS NORMAL command does too).
 */
function vertexColors(lit: Lit, template: LightTemplate, viewToWorld: THREE.Quaternion, out: Float32Array<ArrayBufferLike> = new Float32Array(lit.normals.length)): Float32Array<ArrayBufferLike> {
  const colours = litTemplate(template, lit);
  const worldToView = viewToWorld.clone().invert();
  const n = new THREE.Vector3();
  const rgb: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < lit.normals.length; i += 3) {
    n.fromArray(lit.normals, i).normalize().applyQuaternion(worldToView);
    dsVertexLight([n.x, n.y, n.z], lit.mask, colours, rgb);
    out.set(rgb, i);
  }
  return out;
}

/**
 * Lights a lit material's geometry (vertex colours) and drops its normals, returning them in world space
 * for a relight (null for an unlit material). `world` places normals in world space for geometry that
 * stays in model space (animated or moving objects); null = the geometry is already in world space.
 * `own`: light with the material's own colours instead of the template's.
 */
function lightMesh(material: THREE.Material, geometry: THREE.BufferGeometry, world: THREE.Matrix4 | null, template: LightTemplate, view: THREE.Quaternion, own = false): Lit | null {
  const ex = (material.userData.lantern ?? {}) as { lit?: boolean; lights?: number } & Partial<MaterialColors>;
  let lit: Lit | null = null;
  if (ex.lit && geometry.attributes.normal) {
    let normals: Float32Array;
    if (!world) normals = Float32Array.from(geometry.attributes.normal.array);
    else {
      const probe = geometry.clone().applyMatrix4(world);
      normals = Float32Array.from(probe.attributes.normal!.array);
      probe.dispose();
    }
    lit = { mask: ex.lights ?? 0, normals };
    if (own) {
      if (!ex.diffuse || !ex.ambient || !ex.specular || !ex.emission) throw new Error(`render: lit material ${material.name} has no material colours`);
      lit.own = { diffuse: ex.diffuse, ambient: ex.ambient, specular: ex.specular, emission: ex.emission };
    }
  }
  if (lit) geometry.setAttribute('color', new THREE.BufferAttribute(vertexColors(lit, template, view), 3));
  geometry.deleteAttribute('normal');
  return lit;
}

/**
 * A copy of a lit object that shares its meshes' geometry, and so their vertex colours: relighting `root` recolours
 * every copy. The copies carry no `Lit` of their own (Object3D.clone copies userData through JSON, which would turn
 * the stored normals into plain objects), so a scene relight leaves them to `root`'s.
 */
export function sharedLightClone(root: THREE.Object3D): THREE.Object3D {
  const copy = root.clone();
  copy.traverse((o) => delete o.userData.lit);
  return copy;
}

/** Recomputes the vertex colours of every lit mesh under `root` for another template. */
function relight(root: THREE.Object3D, template: LightTemplate, view: THREE.Quaternion): void {
  root.traverse((o) => {
    const lit = o.userData.lit as Lit | undefined;
    if (!lit) return;
    const color = (o as THREE.Mesh).geometry.getAttribute('color') as THREE.BufferAttribute;
    vertexColors(lit, template, view, color.array as Float32Array);
    color.needsUpdate = true;
  });
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}

function singleMaterial(mesh: THREE.Mesh, what: string): THREE.Material {
  const sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (sources.length !== 1) throw new Error(`render: ${what} mesh ${mesh.name} uses multi-material groups`);
  return sources[0]!;
}

function setMap(material: THREE.MeshBasicMaterial, map: THREE.Texture | null): void {
  if (material.map === map) return;
  material.map = map;
  material.needsUpdate = true;
}

/** A door clip: poses the door at a frame (0..ticks-1, fractional between ticks). */
interface DoorClip {
  ticks: number;
  pose(frame: number): void;
}

/** A door prop (or a PC: `pc-on`/`pc-off`): kept out of the merged chunk geometry so its joints (or its pattern texture) can change. */
interface Door {
  tileX: number;
  tileZ: number;
  clips: Partial<Record<DoorView['anim'], DoorClip>>;
  playing: DoorClip | null;
  /** Back to the closed rest pose. */
  rest(): void;
}

/**
 * The elevator lights prop (`Prop.animations['elevator-up' | 'elevator-down']`): its own copies of the
 * materials the scroll names, offset while `FieldView.elevatorLights` plays and at rest otherwise.
 */
interface ElevatorLights {
  clips: Record<'up' | 'down', Extract<TextureAnimation, { kind: 'scroll' }>>;
  materials: THREE.MeshBasicMaterial[];
}

/** A prop playing its loop clips (DS BCA0 prop loops) from map load, on the simulation clock. */
interface LoopingProp {
  mixer: THREE.AnimationMixer;
  actions: { action: THREE.AnimationAction; ticks: number }[];
}

/**
 * The Pokémon Center machine's balls (decomp FieldTask_PlayHealingAnimation_Pokecenter: the mini ball prop
 * loaded at the machine's position + HEALING_MACHINE_ANIMATION_POKEBALL_OFFSETS), hidden until
 * `FieldView.healMachine` places them, and the machine's screen. Both play their `flash` one-shot at
 * `FieldView.healMachine.frame`.
 */
const HEAL_BALL_OFFSETS: Vec3[] = [-1, 0, 1].flatMap((z) => [-1, 1].map((x): Vec3 => [x * 4.5, 12, z * 4.5]));
interface HealPart { root: THREE.Object3D; ball: boolean; pose(frame: number | undefined): void }

interface ChunkEntry {
  cell: number;
  group: THREE.Group | null;
  doors: Door[];
  loops: LoopingProp[];
  healBalls: HealPart[];
  elevators: ElevatorLights[];
  cancelled: boolean;
  started: boolean;
}

interface BillboardActor {
  kind: 'billboard';
  sprite: Id;
  record: BillboardSprite;
  object: THREE.Sprite;
  texture: THREE.Texture;
  /** World z of the anchor (billboard.ts billboardDepth). */
  anchorZ: { value: number };
  /** Where the depth plane's anchor moves on a slope under the angled camera (billboard.ts slopeDepthLift). */
  depthLift: { value: THREE.Vector3 };
  /** 1: the quad's own depth (a turned sprite on a Distortion World wall or ceiling; billboard.ts). */
  plain: { value: number };
  paletteDarkness: { value: number };
  ceilingY: { value: number };
  ceilingMin: { value: THREE.Vector3 };
  ceilingMax: { value: THREE.Vector3 };
  shadow: THREE.Object3D;
  reflection: THREE.Sprite;
}

interface ModelActor {
  kind: 'model';
  sprite: Id;
  object: THREE.Object3D;
}

type ActorDraw = BillboardActor | ModelActor;

/** The renderer's own '!' (packs without an exclamation sprite): a white card with a red mark. */
function drawnExclamation(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(2, 0, 12, 16);
  g.fillStyle = '#d02020';
  g.fillRect(6, 2, 4, 8);
  g.fillRect(6, 12, 4, 2);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/**
 * Test switches (`window.openSinnohRenderDebug`). `spritesOnly` leaves the map chunks (models, props,
 * doors) and the shadows and reflections out of the frame, so a browser test can tell what the map
 * covers or marks on a character.
 */
export interface RenderDebug {
  spritesOnly: boolean;
  /** Texture animations (ids) held at their first frame, so a test can tell what one animation changes. */
  heldTextureAnimations: string[];
  /** Edge marking on (default); off lets a test find the edge pixels. */
  edges: boolean;
  /** Draws the field's polygon ID buffer (red = ID / 63) instead of the picture. */
  polygonIds: boolean;
  /** The weather's 2D layers over the field (default); off lets a test find the particle pixels. */
  weather: boolean;
  /**
   * Perf runs: each frame waits for the GPU (a one-pixel read) before `RenderStats.renderMs` times it, and the field's
   * GPU time is measured with a timer query where the browser has one (`RenderStats.gpuMs`).
   */
  syncTiming: boolean;
}

/** Frame timings and scene sizes, for perf runs (`window.openSinnohRenderStats`). */
export interface RenderStats {
  frames: number;
  /** Milliseconds per `render` call, most recent last (at most 2048). */
  renderMs: number[];
  /** GPU milliseconds per field frame while `RenderDebug.syncTiming` is on (EXT_disjoint_timer_query_webgl2), most recent last. */
  gpuMs: number[];
  chunks: number;
  chunkBuilds: number;
  /** Door props in built chunks, and those posed by `FieldView.doors` this frame. */
  doors: number;
  doorsPosed: number;
  geometries: number;
  textures: number;
  cachedModels: number;
  /**
   * The actors drawn in the last frame: key (`actorKeys`), sprite, position, `visible` from the view, the
   * drawable's scene object uuid (a rebuilt drawable gets a new one; null while it loads), `kind` (a live
   * actor, or a departed or preview object: `FieldView.departed`, `.previews`), whether it is on screen,
   * and the atlas frame actually drawn (billboards only).
   */
  actors: { key: string; sprite: Id; at: Vec3; visible: boolean; object: string | null; kind: 'live' | 'departed' | 'preview'; onScreen: boolean; frame?: number }[];
  /** The enhanced visuals drawn in the last frame (enhanced/config.ts), null for the DS look (or while their chunk loads). */
  enhanced: EnhancedConfig | null;
  /**
   * The enhanced visuals' last field frame: whether the angled camera drew it, the lamp glows in the scene and the
   * post chain's quality (enhanced/pipeline.ts `quality`); null for the DS look.
   */
  enhancedFrame: { angled: boolean; lamps: number; quality: 'full' | 'phone' } | null;
  /** The weathers on screen in their fades (render/weather.ts): phase, live particles, and the fog's farthest density. */
  weather: { id: Id; phase: 'in' | 'steady' | 'out'; particles: number; fog: number | null }[];
}

/**
 * One WebGLRenderer per canvas, kept across remounts (a load or a reset mounts a new Field on the same canvas).
 * three.js keeps module-level placeholder textures that every renderer subscribes a dispose listener to, and
 * those are never disposed: each disposed renderer stayed reachable through them with all its programs and GL
 * state (heap and GL objects grew with every load). A kept renderer also reuses its compiled programs.
 */
const renderers = new WeakMap<HTMLCanvasElement, THREE.WebGLRenderer>();
function rendererFor(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  let r = renderers.get(canvas);
  if (!r) {
    r = new THREE.WebGLRenderer({ canvas, antialias: false });
    renderers.set(canvas, r);
  }
  return r;
}

class Field implements FieldRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly chunks = new Map<number, ChunkEntry>();
  /** The cells the view shows (`wantedCells` priority 0): `loading()` waits for these chunks, not the ones around them. */
  private viewCells = new Set<number>();
  /** Drawables by actor key (`actorKeys`): local ids repeat, so they cannot key the drawables alone. */
  private readonly actors = new Map<string, ActorDraw>();
  private readonly emotes = new Map<string, { object: THREE.Sprite; start: number; double: boolean }>();
  /** Emote bubbles (`ActorView.bubble`, follower talk) by actor key, and their atlases by sprite (null while loading). */
  private readonly bubbles = new Map<string, THREE.Sprite>();
  private readonly bubbleAtlases = new Map<Id, THREE.Texture | null>();
  /** The camera's view this frame, for `onScreen`. */
  private readonly frustum = new THREE.Frustum();
  /** Departed and preview objects drawn by `drawActors`, by `objectKey`; their drawables are `ghost:<object>` in `actors`. */
  private readonly ghosts = new Map<string, { view: ActorView; kind: 'departed' | 'preview' }>();
  /** The live actors' keys by `objectKey` in the last frame: where a departed object's drawable is. */
  private readonly lastLive = new Map<string, string>();
  /** The zone connection whose `FieldView.departed` was handled. */
  private crossing = 0;
  /** The first frame of a map load: previews appear on screen with the rest of the scene. */
  private fresh = true;
  private readonly pendingSprites = new Set<string>();
  /** Sprites already reported as not drawn (model objects without a model, missing poses). */
  private readonly undrawn = new Set<string>();
  private readonly fadeScene = new THREE.Scene();
  private readonly fadeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly fadeMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false });
  /** Reduce flashing (flash.ts): the story scenes' white brightness and the field's white fades are eased and capped. */
  private readonly storyFlash = new FlashLimiter();
  private readonly fadeFlash = new FlashLimiter();
  private exclamation: { texture: THREE.Texture; size: number } | null = null;
  /** The '!!' (`NewGame.doubleExclamationSprite`); null without one (the '!' is drawn instead). */
  private doubleExclamation: { texture: THREE.Texture; size: number } | null = null;
  private exclamationPending = true;
  /**
   * Character shadow: a translucent dark ellipse on the ground under the feet, offset like the DS draws
   * its shadow model (x −0.5, z +1; decomp ov5_021F134C.c). The DS shadow model itself is not imported yet.
   */
  private readonly shadowGeometry = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2).scale(SHADOW_SIZE[0] / 2, 1, SHADOW_SIZE[1] / 2);
  private readonly shadowMaterial = fieldOutputs(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: SHADOW_OPACITY, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }), { polygonId: 0, fog: true });
  /** The DS shadow model, once loaded (packs without FIELD_EFFECT_SHADOW keep the ellipse). */
  private shadowModel: THREE.Object3D | null = null;
  private shadowPending = false;
  private readonly materials: Materials;
  /** Texture animations by model (`Model.animations`). */
  private readonly modelAnimations = new Map<Id, TextureAnimation[]>();
  private readonly composite = new Composite();
  private readonly weather: WeatherOverlay;
  private readonly effects: FieldEffects;
  /** Models the map's dynamic features place (gyms/). */
  private readonly featureModels: FeatureModels;
  /** Props the world draws itself (`FieldView.props`: the boat's ship and bridges). */
  private readonly worldProps: FeatureModels;
  private readonly ships: Ships;
  private readonly dwWarp: DistortionWarp;
  /**
   * The Distortion World (distortion/): its sky and props, made on the first frame in a room, and the floor below
   * the current one, drawn whole at its offset (decomp inactive floor).
   */
  private dwSky: DistortionSky | null = null;
  private dwProps: DistortionProps | null = null;
  /** The player sprite's roll this frame (degrees; the map object rotator), 0 outside the Distortion World. */
  private playerRoll = 0;
  private readonly floors = new Map<Id, { groups: THREE.Group[]; pending: number; cancelled: boolean }>();
  private readonly stories: StoryScenes;
  private grid: MapGrid | null = null;
  /** Device pixels per DS pixel. */
  private dsPixel = 1;
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = new THREE.PerspectiveCamera();
  private cameraRecord: CameraRecord | null = null;
  private aspect = DS_ASPECT;
  /** The view's height in DS px (192 when the DS view just fits; more when zoomed out or on a narrow screen). */
  private viewHeight = 192;
  /** How far the view reaches on the ground from the camera target (world units, x and z), for chunk loading. */
  private reach = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  /** The DS camera's own reach and FOV (`applyProjection`); the enhanced camera reaches farther. */
  private baseReach = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  private dsFov = 0;
  /**
   * Enhanced visuals (enhanced/; prototype): the lazy pipeline once a config (`enhancedVisuals`) turns an effect on,
   * and the config it draws with. Null: the DS look, untouched.
   */
  private enhanced: EnhancedPipeline | null = null;
  private enhancedConfig: EnhancedConfig | null = null;
  private enhancedLoading = false;
  /** The enhanced camera replaced the DS camera's projection last frame. */
  private enhancedCamera = false;
  private glows: { key: string; list: THREE.Mesh[] } = { key: '', list: [] };
  /** `RenderDebug.syncTiming`'s GPU timer queries in flight (null: the browser has no timer query). */
  private gpuQueries: { ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null; pending: WebGLQuery[] } | null = null;
  private matrix: Id | null = null;
  /**
   * The area chunks bind to, fixed at each map load: the DS loads area data (textures, props, lights)
   * when a map is entered and keeps it while the player walks across zone borders.
   */
  private area: Area | null = null;
  /**
   * The area light template in use (decomp AreaLightManager's active template, by the clock): every lit
   * mesh is lit with it; `lightKey` (light id and schedule index) changes when the clock passes its end.
   */
  private lightTemplate: LightTemplate = { lights: [], diffuse: [0, 0, 0], ambient: [0, 0, 0], specular: [0, 0, 0], emission: [0, 0, 0] };
  private lightKey = '';
  /** The colour billboards take under `lightTemplate` (lighting.ts billboardLight). */
  private readonly billboardColor = new THREE.Color(1, 1, 1);
  /** The shadow's eased look (alpha of 31, x/z scale) and the tick it was last stepped at (-1: snap). */
  private shadowLook: { alpha: number; x: number; z: number; tick: number } = { ...SHADOW_BY_PERIOD.day, tick: -1 };
  private loads = -1;
  /** The zone's platform lift prop, drawn at `FieldView.platformLift` (null while loading or absent). */
  private lift: { prop: Id; loads: number; root: THREE.Object3D | null } | null = null;
  private builds = 0;
  /** A chunk build that threw: `loading()` rethrows it, so a broken scene fails instead of loading forever. */
  private failure: Error | null = null;
  private disposed = false;
  readonly debug: RenderDebug = { spritesOnly: false, heldTextureAnimations: [], edges: true, polygonIds: false, weather: true, syncTiming: false };
  readonly stats: RenderStats = { frames: 0, renderMs: [], gpuMs: [], enhanced: null, enhancedFrame: null, chunks: 0, chunkBuilds: 0, doors: 0, doorsPosed: 0, geometries: 0, textures: 0, cachedModels: 0, actors: [], weather: [] };

  constructor(
    canvas: HTMLCanvasElement,
    private readonly world: OpenSinnohWorld,
    private readonly reg: Registries,
    private readonly state: GameState,
    private readonly assets: AssetCache,
    private readonly log: StubLog,
  ) {
    this.renderer = rendererFor(canvas);
    // DS colour maths happens on display values: textures, vertex colours and lighting are not gamma-decoded.
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 1);
    const byId = new Map([...reg.textureAnimations.values()].map((a) => [a.id, a]));
    const owned = new Set<Id>();
    // Door pattern clips (a clip naming a texture animation) play only through their door, never by texture name.
    for (const p of reg.props.values()) for (const a of Object.values(p.animations ?? {})) if (byId.has(a.clip as Id)) owned.add(a.clip as Id);
    for (const m of reg.models.values())
      if (m.animations)
        this.modelAnimations.set(
          m.id,
          m.animations.map((id) => {
            owned.add(id);
            return need(byId, id, 'textureAnimation');
          }),
        );
    // Animations no model lists apply by texture name everywhere (Platinum map frame swaps).
    this.materials = new Materials(assets, [...byId.values()].filter((a) => !owned.has(a.id)), log);
    this.effects = new FieldEffects(this.scene, reg, assets, (id) => this.modelObject(id, true), log, (what) => this.failed(what));
    this.featureModels = new FeatureModels(this.scene, (prop) => this.loadLift(prop, this.area!), (id) => this.modelObject(id), (what) => this.failed(what));
    this.worldProps = new FeatureModels(this.scene, (prop) => this.loadLift(prop, this.area!), (id) => this.modelObject(id), (what) => this.failed(what));
    this.ships = new Ships(reg, assets, this.failed('ship cinematics'));
    this.dwWarp = new DistortionWarp(reg, assets, this.failed('DW warp'));
    this.stories = new StoryScenes(reg, assets, this.failed('story scenes'));
    this.weather = new WeatherOverlay((ref) => assets.texture(ref), (what) => this.failed(what));
    this.fadeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fadeMaterial));
    void this.loadExclamation().catch(this.failed('the exclamation sprite'));
  }

  /** The texture animations a map feature poses (`FeaturesView.propPoses`): each prop's model's own, at the pose's tick. */
  private posedAnimations(poses: { prop: Id; tick: number }[] | undefined): Map<Id, number> {
    const out = new Map<Id, number>();
    for (const { prop, tick } of poses ?? []) {
      const model = need(this.reg.props, prop, 'prop').model;
      for (const a of this.modelAnimations.get(model) ?? []) out.set(a.id, tick);
    }
    return out;
  }

  /** A rejection handler for a scene load: kept for `loading()` to rethrow, and rethrown here (unhandled = reported). */
  private failed(what: string): (e: unknown) => never {
    return (e) => {
      this.failure ??= new Error(`render: ${what} failed to load: ${(e as Error).message}`, { cause: e });
      throw e;
    };
  }

  private async loadExclamation(): Promise<void> {
    const ng = [...this.reg.newGame.values()][0];
    const load = async (id: Id) => {
      const record = need(this.reg.sprites, id, 'sprite');
      if (!('atlas' in record)) throw new Error(`render: exclamation sprite ${id} is not a billboard`);
      const texture = (await this.assets.texture(record.atlas)).clone();
      this.frameUv(texture, record, spriteFrame(record, 'stand', 'down', 0));
      return { texture, size: record.frameSize };
    };
    this.exclamation = ng?.exclamationSprite ? await load(ng.exclamationSprite) : { texture: drawnExclamation(), size: 16 };
    if (ng?.doubleExclamationSprite) this.doubleExclamation = await load(ng.doubleExclamationSprite);
    this.exclamationPending = false;
  }

  private async loadShadow(): Promise<void> {
    const effect = [...this.reg.fieldEffects.values()].find((e) => e.name === 'SHADOW');
    if (!effect?.model) return;
    this.shadowPending = true;
    const object = await this.modelObject(effect.model, true);
    const box = new THREE.Box3().setFromObject(object);
    object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const source = mesh.material as THREE.MeshBasicMaterial;
      const m = fieldOutputs(source.clone(), source.userData.fieldOutput);
      m.opacity = this.shadowLook.alpha / 31;
      m.transparent = true;
      m.depthWrite = false;
      m.polygonOffset = true;
      m.polygonOffsetFactor = -1;
      m.polygonOffsetUnits = -4;
      mesh.material = m;
      // Flat model: lift its plane to just above the ground.
      mesh.position.y += 0.25 - box.min.y;
    });
    this.shadowModel = object;
    this.shadowPending = false;
  }

  /** Behaviour name of the tile under a world position (outside the matrix: NONE). */
  private behaviourAt(x: number, z: number): string {
    return this.grid ? this.grid.behaviour(Math.floor(x / TILE), Math.floor(z / TILE)) : 'NONE';
  }

  // ---------- map geometry ----------

  /** Chunk model + props, merged per material in chunk-local coordinates; doors stay separate objects. */
  private async buildChunk(chunkId: Id, area: Area, view: THREE.Quaternion, origin: THREE.Vector3, own: Area | null): Promise<{ group: THREE.Group; doors: Door[]; loops: LoopingProp[]; healBalls: HealPart[]; elevators: ElevatorLights[] }> {
    const chunk = need(this.reg.chunks, chunkId, 'chunk');
    const template = this.lightTemplate;
    const lightKey = this.lightKey;
    const parts: { geometry: THREE.BufferGeometry; material: THREE.Material; lit: Lit | null; glow: GlowKind | null }[] = [];
    // Texture cards (cards.ts) slide over the ground only under a perspective camera.
    const cards: { geometry: THREE.BufferGeometry; foot: THREE.Vector3 }[] = [];
    const camera = this.cameraRecord!;
    const viewDirection = cameraOffset(camera, new THREE.Vector3()).negate().normalize();
    const out = new THREE.Group();
    const doors: Door[] = [];
    const loops: LoopingProp[] = [];
    const healBalls: HealPart[] = [];
    const elevators: ElevatorLights[] = [];
    // Enhanced visuals' night glows (enhanced/): the light-source parts, found only with a config on, so the DS path
    // does no work. By the source material's name: one converted material can serve a light and a roof that share a
    // texture (Materials.convert keys by texture), and only the light glows.
    const glowing = !!enhancedVisuals();
    const machine = [...this.reg.newGame.values()][0]?.healMachine;
    const lifts = [...this.reg.newGame.values()][0]?.platformLiftProps;
    const boat = [...this.reg.newGame.values()][0]?.boat;
    // Platform lifts and the boat's props are drawn by the world's view (they move).
    const containment = [...this.reg.newGame.values()][0]?.containment;
    // The honey trees too: they shake (FieldView.props).
    const honeyTree = [...this.reg.newGame.values()][0]?.specialEncounters?.honeyTrees.prop;
    const liftProps = new Set<Id>([...(honeyTree ? [honeyTree] : []), ...(containment ? [containment.prop] : []),...(lifts ? [lifts.ironIsland, lifts.pokemonLeague] : []), ...(boat ? [boat.ship, ...boat.bridges, ...(boat.snowpointShip ? [boat.snowpointShip] : [])] : [])]);
    // The land takes the template's material colours outdoors (AreaLight_UseGlobalModelAttributes), its own indoors;
    // props always keep their own (map_prop.c draws them without NNS_G3dMdlUseGlb*).
    const indoor = need(this.reg.lights, area.light, 'light').indoor === true;
    const lit = (mesh: THREE.Mesh, geometry: THREE.BufferGeometry, world: THREE.Matrix4 | null, ownColours: boolean) => lightMesh(singleMaterial(mesh, 'model'), geometry, world, template, view, ownColours);
    /** Lit prop meshes keep their normals for a relight (`Lit`). */
    const litMesh = (mesh: THREE.Mesh, geometry: THREE.BufferGeometry) => {
      const l = lit(mesh, geometry, mesh.matrixWorld, true);
      if (l) mesh.userData.lit = l;
    };
    const add = async (modelId: Id, set: AssetRef | undefined, placement: THREE.Matrix4, once: boolean, ownColours: boolean, ownSet?: AssetRef) => {
      const ref = need(this.reg.models, modelId, 'model').gltf;
      const { scene: root } = await this.assets.model(ref);
      root.updateMatrixWorld(true);
      const meshes = meshesOf(root);
      for (const mesh of meshes) {
        const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        const material = await this.materials.convert(singleMaterial(mesh, modelId), set, 'color' in geometry.attributes, this.modelAnimations.get(modelId), ownSet);
        geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(placement, mesh.matrixWorld));
        const glow = glowing ? glowKind(singleMaterial(mesh, modelId).name) : null;
        // A card is a whole prop model; one quad of a larger model belongs to that model's shape.
        const foot = camera.projection === 'perspective' && meshes.length === 1 ? cardFoot(geometry, material) : null;
        if (foot) cards.push({ geometry, foot });
        const l = lit(mesh, geometry, null, ownColours);
        parts.push({ geometry, material, lit: l, glow });
      }
      if (once) this.assets.copied(ref);
    };
    /** A prop drawn as its own object (doors, looping props): joints can move. */
    const animatedProp = async (prop: Prop, set: AssetRef | undefined, placement: THREE.Matrix4) => {
      const { scene, animations } = await this.assets.model(need(this.reg.models, prop.model, 'model').gltf);
      const root = scene.clone(true);
      placement.decompose(root.position, root.quaternion, root.scale);
      root.updateMatrixWorld(true);
      const meshes: { mesh: THREE.Mesh; src: THREE.Material }[] = [];
      for (const mesh of meshesOf(root)) {
        const src = singleMaterial(mesh, prop.model);
        const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        litMesh(mesh, geometry);
        mesh.geometry = geometry;
        mesh.material = await this.materials.convert(src, set, 'color' in geometry.attributes, this.modelAnimations.get(prop.model));
        meshes.push({ mesh, src });
      }
      withTranslucentParts(root);
      out.add(root);
      return { root, animations, meshes, mixer: new THREE.AnimationMixer(root) };
    };
    const addLooping = async (prop: Prop, set: AssetRef | undefined, placement: THREE.Matrix4) => {
      const { animations, mixer } = await animatedProp(prop, set, placement);
      const actions = Object.values(prop.animations!)
        .filter((a) => a.loop)
        .map((a) => {
          const c = animations.find((x) => x.name === a.clip);
          if (!c) throw new Error(`render: prop ${prop.id} glTF has no clip ${a.clip}`);
          const action = mixer.clipAction(c);
          action.play();
          return { action, ticks: a.ticks };
        });
      loops.push({ mixer, actions });
    };
    const addDoor = async (prop: Prop, set: AssetRef | undefined, placement: THREE.Matrix4, position: THREE.Vector3) => {
      const { mixer, animations, meshes } = await animatedProp(prop, set, placement);
      const rests: (() => void)[] = [() => mixer.stopAllAction()];
      // Pattern clips swap the texture on this door's own copies of the materials that bind it.
      const patternTargets = new Map<string, { material: THREE.MeshBasicMaterial; src: THREE.Material }[]>();
      const targetsOf = (texture: string) => {
        let list = patternTargets.get(texture);
        if (list) return list;
        list = meshes
          .filter(({ src }) => Materials.textureName(src) === texture)
          .map(({ mesh, src }) => {
            const shared = mesh.material as THREE.MeshBasicMaterial;
            const material = fieldOutputs(shared.clone(), shared.userData.fieldOutput);
            mesh.material = material;
            rests.push(() => setMap(material, shared.map));
            return { material, src };
          });
        if (!list.length) throw new Error(`render: door ${prop.id} has no material binding its pattern texture ${texture}`);
        patternTargets.set(texture, list);
        return list;
      };
      const clip = async (use: DoorView['anim']): Promise<DoorClip> => {
        const a = prop.animations![use];
        if (!a) throw new Error(`render: door ${prop.id} has no ${use} animation`);
        const anim = this.reg.textureAnimations.get(a.clip as Id);
        if (anim) {
          if (anim.kind !== 'frames') throw new Error(`render: door ${prop.id} clip ${a.clip} is not a frames animation`);
          const targets = await Promise.all(targetsOf(anim.texture).map(async (t) => ({ material: t.material, frames: await this.materials.patternTextures(t.src, set, anim) })));
          return { ticks: a.ticks, pose: (frame) => targets.forEach((t) => setMap(t.material, t.frames[patternAt(anim.frames, Math.floor(frame))]!)) };
        }
        const c = animations.find((x) => x.name === a.clip);
        if (!c) throw new Error(`render: door ${prop.id} glTF has no clip ${a.clip}`);
        const action = mixer.clipAction(c);
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        return {
          ticks: a.ticks,
          pose: (frame) => {
            action.play();
            action.time = frame / FRAME_RATE;
            mixer.update(0);
          },
        };
      };
      doors.push({
        tileX: Math.floor((origin.x + position.x) / TILE),
        tileZ: Math.floor((origin.z + position.z) / TILE),
        clips: prop.animations!['pc-on'] ? { 'pc-on': await clip('pc-on'), 'pc-off': await clip('pc-off') } : { open: await clip('open'), close: await clip('close') },
        playing: null,
        rest: () => rests.forEach((r) => r()),
      });
    };
    const addElevatorLights = async (prop: Prop, set: AssetRef | undefined, placement: THREE.Matrix4) => {
      const { meshes } = await animatedProp(prop, set, placement);
      const clip = (use: 'elevator-up' | 'elevator-down') => {
        const id = prop.animations![use]?.clip;
        const anim = id === undefined ? undefined : this.reg.textureAnimations.get(id as Id);
        if (anim?.kind !== 'scroll') throw new Error(`render: elevator lights ${prop.id} ${use} is not a scroll animation`);
        return anim;
      };
      const clips = { up: clip('elevator-up'), down: clip('elevator-down') };
      const materials = meshes
        .filter(({ src }) => src.name === clips.up.material || src.name === clips.down.material)
        .map(({ mesh }) => {
          const shared = mesh.material as THREE.MeshBasicMaterial;
          const material = fieldOutputs(shared.clone(), shared.userData.fieldOutput);
          material.map = shared.map?.clone() ?? null;
          mesh.material = material;
          return material;
        });
      if (!materials.length) throw new Error(`render: elevator lights ${prop.id} have no material ${clips.up.material}`);
      elevators.push({ clips, materials });
    };
    /** A healing machine part with its `flash` one-shot pattern, blended against the resting texture (capFlash). */
    const addHealPattern = async (prop: Prop, set: AssetRef | undefined, placement: THREE.Matrix4, ball: boolean): Promise<HealPart> => {
      const { root, meshes } = await animatedProp(prop, set, placement);
      const clip = prop.animations?.flash;
      const anim = clip && this.reg.textureAnimations.get(clip.clip as Id);
      if (!clip || !anim || anim.kind !== 'frames') throw new Error(`render: healing machine part ${prop.id} has no flash pattern`);
      const targets = await Promise.all(meshes.filter(({ src }) => Materials.textureName(src) === anim.texture).map(async ({ mesh, src }) => {
        const shared = mesh.material as THREE.MeshBasicMaterial;
        const material = fieldOutputs(shared.clone(), shared.userData.fieldOutput);
        const amount = { value: 1 };
        const before = material.onBeforeCompile.bind(material);
        material.onBeforeCompile = (shader, renderer) => {
          before(shader, renderer);
          shader.uniforms.healRest = { value: shared.map };
          shader.uniforms.healAmount = amount;
          shader.fragmentShader = 'uniform sampler2D healRest;\nuniform float healAmount;\n' + shader.fragmentShader.replace('#include <map_fragment>', `
            #ifdef USE_MAP
            vec4 resting = texture2D(healRest, vMapUv);
            vec4 flashing = texture2D(map, vMapUv);
            diffuseColor *= mix(resting, flashing, healAmount);
            #endif
          `);
        };
        material.customProgramCacheKey = () => 'field-healing-pattern';
        mesh.material = material;
        return { material, rest: shared.map, amount, frames: await this.materials.patternTextures(src, set, anim) };
      }));
      if (!targets.length) throw new Error(`render: healing machine part ${prop.id} does not bind ${anim.texture}`);
      const part: HealPart = { root, ball, pose: (frame) => {
        for (const t of targets) {
          t.amount.value = capFlash(1);
          setMap(t.material, frame === undefined ? t.rest : t.frames[patternAt(anim.frames, Math.min(frame, clip.ticks - 1))]!);
        }
      } };
      healBalls.push(part);
      return part;
    };
    // Load the prop models and their materials together first (cached by ref and key): one after another,
    // each pays several frames of fetch and decode. The build below then runs in placement order.
    const warm = async (modelId: Id) => {
      const { scene } = await this.assets.model(need(this.reg.models, modelId, 'model').gltf);
      await Promise.all(meshesOf(scene).map((mesh) => this.materials.convert(singleMaterial(mesh, modelId), area.propTextures, 'color' in mesh.geometry.attributes, this.modelAnimations.get(modelId))));
    };
    const propModels = new Set<Id>();
    for (const p of chunk.props) {
      const prop = need(this.reg.props, p.prop, 'prop');
      if (liftProps.has(prop.id)) continue;
      propModels.add(prop.model);
      if (machine && (prop.id === machine.machine || prop.id === machine.hallOfFame)) propModels.add(need(this.reg.props, machine.ball, 'prop').model);
    }
    // The land binds the loaded area's map textures, then its own zone's area's (Materials.setTexture).
    await Promise.all([add(chunk.model, area.mapTextures, new THREE.Matrix4(), true, indoor, own?.mapTextures), ...[...propModels].map(warm)]);
    for (const p of chunk.props) {
      const position = new THREE.Vector3(...p.position);
      const placement = new THREE.Matrix4().compose(position, new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rotation[0] * DEG, p.rotation[1] * DEG, p.rotation[2] * DEG)), new THREE.Vector3(...p.scale));
      const prop = need(this.reg.props, p.prop, 'prop');
      // Platform lifts move: drawn on their own at FieldView.platformLift (updateLift).
      if (liftProps.has(prop.id)) continue;
      if (prop.animations?.open || prop.animations?.['pc-on']) await addDoor(prop, area.propTextures, placement, position);
      else if (prop.animations?.['elevator-up']) await addElevatorLights(prop, area.propTextures, placement);
      else if (machine?.screen === prop.id) await addHealPattern(prop, area.propTextures, placement, false);
      else if (prop.animations && Object.values(prop.animations).some((a) => a.loop)) await addLooping(prop, area.propTextures, placement);
      else await add(prop.model, area.propTextures, placement, false, true);
      // The Pokémon Center's machine, or the Hall of Fame's (the same balls and offsets, decomp hall_of_fame.c).
      if (machine && (prop.id === machine.machine || prop.id === machine.hallOfFame)) {
        const ball = need(this.reg.props, machine.ball, 'prop');
        for (const offset of HEAL_BALL_OFFSETS) {
          const at = new THREE.Matrix4().compose(position.clone().add(new THREE.Vector3(...offset)), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
          (await addHealPattern(ball, area.propTextures, at, true)).root.visible = false;
        }
      }
    }
    // Texture cards rest their art on the map (cards.ts), on any other static geometry of the chunk.
    const cardGeometries = new Set(cards.map((c) => c.geometry));
    const { rested, unrested } = restCards(cards, parts.map((p) => p.geometry).filter((g) => !cardGeometries.has(g)), viewDirection);
    for (const foot of unrested) this.reportOnce(`card:${chunkId}`, 'render:card', `chunk ${chunkId}: a texture card at ${foot.toArray().map(Math.round).join(',')} has no map surface beyond it (drawn as placed)`);
    out.userData.cardFeet = rested;
    // One mesh per material, attribute set, light mask and glow; a lit mesh keeps its parts' normals in order.
    const groups = new Map<string, { material: THREE.Material; geometries: THREE.BufferGeometry[]; lits: Lit[]; glow: GlowKind | null }>();
    for (const { geometry, material, lit: l, glow } of parts) {
      const key = `${material.uuid}|${Object.keys(geometry.attributes).sort().join(',')}|${l ? `${l.mask}|${JSON.stringify(l.own ?? null)}` : '-'}|${glow ?? '-'}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { material, geometries: [], lits: [], glow }));
      g.geometries.push(geometry);
      if (l) g.lits.push(l);
    }
    for (const { material, geometries, lits, glow } of groups.values()) {
      const merged = geometries.length === 1 ? geometries[0]! : mergeGeometries(geometries);
      if (!merged) throw new Error(`render: could not merge chunk ${chunkId} geometry for ${material.name}`);
      for (const g of geometries) if (g !== merged) g.dispose();
      const mesh = new THREE.Mesh(merged, material);
      if (glow) mesh.userData.glow = glow;
      if (lits.length) {
        const normals = new Float32Array(lits.reduce((n, l) => n + l.normals.length, 0));
        lits.reduce((at, l) => (normals.set(l.normals, at), at + l.normals.length), 0);
        const { mask, own } = lits[0]!;
        mesh.userData.lit = { mask, normals, ...(own ? { own } : {}) } satisfies Lit;
      }
      out.add(mesh);
    }
    withTranslucentParts(out);
    out.userData.lightKey = lightKey;
    if (glowing) out.userData.glows = out.children.filter((m): m is THREE.Mesh => m instanceof THREE.Mesh && !!m.userData.glow);
    return { group: out, doors, loops, healBalls, elevators };
  }

  private clearChunks(): void {
    for (const c of this.chunks.values()) this.dropChunk(c);
    this.chunks.clear();
    for (const zone of [...this.floors.keys()]) this.dropFloor(zone);
  }

  /**
   * The Distortion World's other floors (`DistortionView.floors` past the first): every chunk of each, built once
   * at its floor's offset with the current area's textures and light (the DS loads the inactive floor whole).
   */
  private updateFloors(floors: NonNullable<FieldView['distortion']>['floors']): void {
    const want = new Set(floors.slice(1).map((f) => f.zone));
    for (const zone of [...this.floors.keys()]) if (!want.has(zone)) this.dropFloor(zone);
    for (const f of floors.slice(1)) {
      if (this.floors.has(f.zone)) continue;
      const matrix = need(this.reg.matrices, f.matrix, 'matrix');
      const entry: { groups: THREE.Group[]; pending: number; cancelled: boolean } = { groups: [], pending: 0, cancelled: false };
      this.floors.set(f.zone, entry);
      matrix.chunks.forEach((chunk, cell) => {
        if (!chunk) return;
        const mx = cell % matrix.width;
        const mz = Math.floor(cell / matrix.width);
        const origin = new THREE.Vector3(mx * CHUNK_SIZE + CHUNK_SIZE / 2 + f.offset[0], (matrix.altitudes?.[cell] ?? 0) * 8 + f.offset[1], mz * CHUNK_SIZE + CHUNK_SIZE / 2 + f.offset[2]);
        entry.pending++;
        void this.buildChunk(chunk, this.area!, this.viewToWorld(), origin, null)
          .then(({ group }) => {
            if (entry.cancelled || this.disposed) return;
            group.position.copy(origin);
            entry.groups.push(group);
            this.scene.add(group);
          })
          .catch(this.failed(`floor chunk ${chunk}`))
          .finally(() => entry.pending--);
      });
    }
  }

  private dropFloor(zone: Id): void {
    const entry = this.floors.get(zone)!;
    entry.cancelled = true;
    for (const g of entry.groups) {
      this.scene.remove(g);
      g.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    this.floors.delete(zone);
  }

  private dropChunk(entry: ChunkEntry): void {
    entry.cancelled = true;
    if (!entry.group) return;
    this.scene.remove(entry.group);
    entry.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    for (const d of entry.doors) d.rest();
    for (const l of entry.loops) l.mixer.stopAllAction();
  }

  /**
   * Cells to keep: around the camera target and where it will be in LOOKAHEAD_TICKS, each the 3×3 or the
   * cells the view reaches on the ground (`reach`), whichever is larger. Priority 0 for the cells in view now (within
   * VIEW_MARGIN of the footprint around the target), else the distance from the target's cell.
   */
  private wantedCells(view: FieldView, target: THREE.Vector3, width: number, height: number): Map<number, number> {
    const velocity = new THREE.Vector3(...view.camera.cur).sub(new THREE.Vector3(...view.camera.prev));
    const ahead = target.clone().addScaledVector(velocity, LOOKAHEAD_TICKS);
    const cx = Math.floor(target.x / CHUNK_SIZE);
    const cz = Math.floor(target.z / CHUNK_SIZE);
    const r = this.reach;
    const inView = (mx: number, mz: number) =>
      (mx + 1) * CHUNK_SIZE > target.x + r.minX - VIEW_MARGIN && mx * CHUNK_SIZE < target.x + r.maxX + VIEW_MARGIN && (mz + 1) * CHUNK_SIZE > target.z + r.minZ - VIEW_MARGIN && mz * CHUNK_SIZE < target.z + r.maxZ + VIEW_MARGIN;
    const wanted = new Map<number, number>();
    for (const at of [target, ahead]) {
      const px = Math.floor(at.x / CHUNK_SIZE);
      const pz = Math.floor(at.z / CHUNK_SIZE);
      const x0 = Math.min(px - 1, Math.floor((at.x + r.minX) / CHUNK_SIZE));
      const x1 = Math.max(px + 1, Math.floor((at.x + r.maxX) / CHUNK_SIZE));
      const z0 = Math.min(pz - 1, Math.floor((at.z + r.minZ) / CHUNK_SIZE));
      const z1 = Math.max(pz + 1, Math.floor((at.z + r.maxZ) / CHUNK_SIZE));
      for (let mz = z0; mz <= z1; mz++) {
        for (let mx = x0; mx <= x1; mx++) {
          if (mx < 0 || mz < 0 || mx >= width || mz >= height) continue;
          const cell = mx + mz * width;
          // The visible ones build first.
          const d = inView(mx, mz) ? 0 : Math.max(Math.abs(mx - cx), Math.abs(mz - cz));
          wanted.set(cell, Math.min(wanted.get(cell) ?? Infinity, d));
        }
      }
    }
    return wanted;
  }

  /** Builds the wanted chunks (nearest first, MAX_BUILDS at a time) and drops far ones. */
  private updateChunks(view: FieldView, world: THREE.Vector3): void {
    const matrix = need(this.reg.matrices, view.matrix, 'matrix');
    // A Distortion World room's land stands at its offset in the shared space (FieldView.distortion).
    const offset = new THREE.Vector3(...(view.distortion?.floors[0]?.offset ?? [0, 0, 0]));
    const target = world.clone().sub(offset);
    // The area of the last map load, not the zone under the camera (FieldView.area).
    const area = need(this.reg.areas, view.area, 'area');
    const wanted = this.wantedCells(view, target, matrix.width, matrix.height);
    this.viewCells = new Set([...wanted].filter(([, d]) => d === 0).map(([cell]) => cell));
    const cx = Math.floor(target.x / CHUNK_SIZE);
    const cz = Math.floor(target.z / CHUNK_SIZE);
    for (const [cell, entry] of this.chunks) {
      const mx = cell % matrix.width;
      const mz = Math.floor(cell / matrix.width);
      if (!wanted.has(cell) && Math.max(Math.abs(mx - cx), Math.abs(mz - cz)) >= DROP_DISTANCE) {
        this.dropChunk(entry);
        this.chunks.delete(cell);
      }
    }
    for (const [cell] of [...wanted].sort((a, b) => a[1] - b[1])) {
      if (!matrix.chunks[cell] || this.chunks.has(cell)) continue;
      this.chunks.set(cell, { cell, group: null, doors: [], loops: [], healBalls: [], elevators: [], cancelled: false, started: false });
    }
    const queued = [...this.chunks.values()].filter((c) => !c.started && !c.cancelled).sort((a, b) => (wanted.get(a.cell) ?? 9) - (wanted.get(b.cell) ?? 9));
    for (const entry of queued) {
      // The chunks in view build at once (they are missing from the view now); the others MAX_BUILDS at a time.
      if (this.builds >= MAX_BUILDS && !this.viewCells.has(entry.cell)) break;
      const cell = entry.cell;
      const mx = cell % matrix.width;
      const mz = Math.floor(cell / matrix.width);
      const origin = new THREE.Vector3(mx * CHUNK_SIZE + CHUNK_SIZE / 2, (matrix.altitudes?.[cell] ?? 0) * 8, mz * CHUNK_SIZE + CHUNK_SIZE / 2).add(offset);
      entry.started = true;
      this.builds++;
      const cellZone = matrix.zones?.[cell];
      const own = cellZone ? need(this.reg.areas, need(this.reg.zones, cellZone, 'zone').area, 'area') : null;
      void this.buildChunk(matrix.chunks[cell]!, area, this.viewToWorld(), origin, own)
        .then(({ group, doors, loops, healBalls, elevators }) => {
          this.stats.chunkBuilds++;
          if (entry.cancelled || this.disposed) {
            group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
            return;
          }
          group.position.copy(origin);
          // Built under a template the clock has since passed: light it with the current one.
          if (group.userData.lightKey !== this.lightKey) relight(group, this.lightTemplate, this.viewToWorld());
          entry.group = group;
          entry.doors = doors;
          entry.loops = loops;
          entry.healBalls = healBalls;
          entry.elevators = elevators;
          this.scene.add(group);
        })
        .catch(this.failed(`chunk ${matrix.chunks[cell]}`))
        .finally(() => this.builds--);
    }
  }

  /**
   * The platform lift (decomp platform_lift.c moves the map prop): one object per map load, lit with the
   * area's light, placed at the world's lift position every frame.
   */
  private updateLift(view: FieldView): void {
    const want = view.platformLift;
    if (this.lift && (!want || this.lift.prop !== want.prop || this.lift.loads !== view.loads)) {
      if (this.lift.root) this.scene.remove(this.lift.root);
      this.lift = null;
    }
    if (!want) return;
    if (!this.lift) {
      const entry: { prop: Id; loads: number; root: THREE.Object3D | null } = { prop: want.prop, loads: view.loads, root: null };
      this.lift = entry;
      void this.loadLift(want.prop, need(this.reg.areas, view.area, 'area'))
        .then((root) => {
          if (this.lift !== entry || this.disposed) return;
          entry.root = root;
          this.scene.add(root);
        })
        .catch(this.failed(`platform lift ${want.prop}`));
    }
    this.lift.root?.position.set(...want.position);
  }

  private async loadLift(propId: Id, area: Area): Promise<THREE.Object3D> {
    const prop = need(this.reg.props, propId, 'prop');
    const template = this.lightTemplate;
    const { scene, animations } = await this.assets.model(need(this.reg.models, prop.model, 'model').gltf);
    const root = cloneSkeleton(scene);
    // Joint clips a view may pose (FeatureModelView.clip).
    root.userData.animations = animations;
    root.updateMatrixWorld(true);
    for (const mesh of meshesOf(root)) {
      const src = singleMaterial(mesh, prop.model);
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      // A prop: its own material colours (map_prop.c).
      const lit = lightMesh(src, geometry, mesh.matrixWorld, template, this.viewToWorld(), true);
      if (lit) mesh.userData.lit = lit;
      mesh.geometry = geometry;
      mesh.material = await this.materials.convert(src, area.propTextures, 'color' in geometry.attributes, this.modelAnimations.get(prop.model));
    }
    withTranslucentParts(root);
    return root;
  }

  /** Poses door props from the world's door list (closed at rest when not listed). */
  private updateDoors(doors: readonly DoorView[], alpha: number): void {
    this.stats.doors = 0;
    this.stats.doorsPosed = 0;
    for (const chunk of this.chunks.values()) {
      for (const door of chunk.doors) {
        this.stats.doors++;
        const want = doors.find((d) => d.z === door.tileZ && Math.abs(d.x - door.tileX) <= 1 && door.clips[d.anim]);
        if (!want) {
          if (door.playing) {
            door.rest();
            door.playing = null;
          }
          continue;
        }
        this.stats.doorsPosed++;
        const clip = door.clips[want.anim]!;
        if (door.playing !== clip) {
          door.rest();
          door.playing = clip;
        }
        clip.pose(Math.max(0, Math.min(want.tick - 1 + alpha, clip.ticks - 1)));
      }
    }
  }

  /** The elevator lights play the view's direction at its frame (frames loop), or rest at no offset. */
  private updateElevators(lights: FieldView['elevatorLights']): void {
    for (const chunk of this.chunks.values())
      for (const e of chunk.elevators) {
        const anim = lights ? e.clips[lights.direction] : null;
        const i = lights && anim ? lights.tick % anim.frames : 0;
        const at = (v: number[] | number) => (typeof v === 'number' ? v : v[i]!);
        for (const m of e.materials) m.map?.offset.set(anim ? at(anim.translateS) : 0, anim ? at(anim.translateT) : 0);
      }
  }

  /** Looping props follow the simulation clock (one DS frame per tick), interpolated. */
  private updateLoops(alpha: number): void {
    const t = this.state.tick + alpha;
    for (const chunk of this.chunks.values())
      for (const l of chunk.loops) {
        for (const { action, ticks } of l.actions) action.time = (t % ticks) / FRAME_RATE;
        l.mixer.update(0);
      }
  }

  // ---------- characters ----------

  private removeActor(a: ActorDraw): void {
    if (a.kind === 'billboard') {
      this.scene.remove(a.object, a.shadow, a.reflection);
      a.texture.dispose();
      a.object.material.dispose();
      a.reflection.material.map?.dispose();
      a.reflection.material.dispose();
    } else {
      this.scene.remove(a.object);
      a.object.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
  }

  private clearActors(): void {
    for (const a of this.actors.values()) this.removeActor(a);
    this.actors.clear();
    this.ghosts.clear();
    this.lastLive.clear();
    this.fresh = true;
    for (const e of this.emotes.values()) this.scene.remove(e.object);
    this.emotes.clear();
    for (const b of this.bubbles.values()) this.scene.remove(b);
    this.bubbles.clear();
  }

  private reportOnce(key: string, stub: string, detail: string): void {
    if (this.undrawn.has(key)) return;
    this.undrawn.add(key);
    this.log.stub(stub, detail);
  }

  /** The drawable for an actor, or null while it loads (or when its sprite has nothing to draw). */
  private actorDraw(v: ActorView, id: string): ActorDraw | null {
    // The key names the sprite (actorKeys): a sprite change is a new drawable.
    const have = this.actors.get(id);
    if (have) return have;
    const record = need(this.reg.sprites, v.sprite, 'sprite');
    if (!('atlas' in record) && record.model === null) {
      // Model objects with no converted model still collide in the world. Once per sprite: this runs every frame.
      this.reportOnce(v.sprite, 'render:model-object', `model object has no model (${v.sprite})`);
      return null;
    }
    const key = `${id}|${v.sprite}|${this.loads}`;
    if (this.pendingSprites.has(key)) return null;
    this.pendingSprites.add(key);
    const loads = this.loads;
    const done = (draw: ActorDraw) => {
      this.pendingSprites.delete(key);
      // A stand-in's drawable may have taken the key meanwhile (drawActors).
      if (this.disposed || loads !== this.loads || this.actors.has(id)) return this.removeActor(draw);
      this.actors.set(id, draw);
    };
    if ('atlas' in record) {
      void this.assets.texture(record.atlas).then((atlas) => {
        const texture = atlas.clone();
        texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
        const { material, anchorZ, depthLift, plain, paletteDarkness, ceilingY, ceilingMin, ceilingMax } = billboardMaterial(texture);
        const object = new THREE.Sprite(fieldOutputs(material, { polygonId: 0, fog: true }));
        object.center.set(0.5, 0);
        const shadow = new THREE.Group();
        // Its own texture: the same frame, flipped vertically.
        const mirrored = texture.clone();
        const mirror = reflectionMaterial(mirrored);
        const reflection = new THREE.Sprite(fieldOutputs(mirror.material, { polygonId: 0, fog: true }));
        reflection.userData.groundY = mirror.groundY;
        reflection.center.set(0.5, 1);
        // Before the translucent map polygons (water drawn over it).
        reflection.renderOrder = -1;
        this.scene.add(object, shadow, reflection);
        done({ kind: 'billboard', sprite: v.sprite, record, object, texture, anchorZ, depthLift, plain, paletteDarkness, ceilingY, ceilingMin, ceilingMax, shadow, reflection });
      }, this.failed(`sprite ${v.sprite}`));
    } else {
      void this.modelObject(record.model!).then((object) => {
        this.scene.add(object);
        done({ kind: 'model', sprite: v.sprite, object });
      }, this.failed(`model object ${v.sprite}`));
    }
    return null;
  }

  /** A model object with its glTF's clips (`userData.animations`), for joint-animated Distortion World props. */
  private async animatedModel(modelId: Id): Promise<THREE.Object3D> {
    const root = await this.modelObject(modelId);
    root.userData.animations = (await this.assets.model(need(this.reg.models, modelId, 'model').gltf)).animations;
    return root;
  }

  /**
   * A model object (signpost, mailbox): the glTF with DS materials, lit like the map under the area light.
   * `own`: lit with its materials' own colours under the area light's lights, as the DS draws the field
   * effect models (Simple3D models that keep their material colours: surf blob, footprints, splashes).
   */
  private async modelObject(modelId: Id, own = false): Promise<THREE.Object3D> {
    const { scene } = await this.assets.model(need(this.reg.models, modelId, 'model').gltf);
    const root = scene.clone(true);
    root.updateMatrixWorld(true);
    const template = this.lightTemplate;
    const view = this.viewToWorld();
    for (const mesh of meshesOf(root)) {
      const src = singleMaterial(mesh, modelId);
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      // A billboard node's normals turn with it to the camera (G3D SBC BB: lit in view space by its local normals).
      let node: THREE.Object3D | null = mesh;
      while (node && !nodeBillboard(node)) node = node.parent;
      const world = node ? billboardMatrix(mesh.matrixWorld, nodeBillboard(node)!, view) : mesh.matrixWorld;
      const lit = lightMesh(src, geometry, world, template, view, own);
      if (lit) mesh.userData.lit = lit;
      mesh.geometry = geometry;
      mesh.material = await this.materials.convert(src, undefined, 'color' in geometry.attributes);
    }
    withTranslucentParts(root);
    faceCameraNodes(root);
    return root;
  }

  /** Points a sprite texture at one atlas frame (atlases are one row or a grid of frameSize squares). */
  private frameUv(texture: THREE.Texture, record: BillboardSprite, frame: number): void {
    const img = texture.image as { width: number; height: number };
    const size = record.frameSize;
    const cols = Math.floor(img.width / size);
    // flipY is off (glTF convention), so v runs top-down in the atlas: flip with a negative repeat.
    texture.repeat.set(size / img.width, -size / img.height);
    texture.offset.set(((frame % cols) * size) / img.width, ((Math.floor(frame / cols) + 1) * size) / img.height);
  }

  /** Places a camera-facing quad whose bottom edge sits at `anchor` (world). */
  private placeBillboard(object: THREE.Sprite, anchor: THREE.Vector3, size: number): void {
    object.position.copy(anchor);
    object.scale.set(size, size, 1);
  }

  /** The sprite's bounds (a sphere around it, generous) meet the camera's view. */
  private onScreen(v: ActorView): boolean {
    const record = need(this.reg.sprites, v.sprite, 'sprite');
    const size = 'atlas' in record ? record.frameSize : 2 * TILE;
    return this.frustum.intersectsSphere(new THREE.Sphere(new THREE.Vector3(v.cur[0], v.cur[1] + size / 2, v.cur[2]), size));
  }

  /**
   * Live actors, then the stand-ins a view bigger than the DS's needs at zone connections (the DS shows
   * 16×12 tiles, and its neighbouring zone's objects there are clones, so it never sees one deleted or
   * spawned). Stand-ins are drawn only, keyed `ghost:<object>` in `actors`:
   * - departed (`FieldView.departed`): an object the connection deleted while on screen keeps its
   *   drawable, frozen as it was, until it is off screen;
   * - preview (`FieldView.previews`): a neighbouring zone's object, drawn before it spawns. One appears
   *   only off screen (or with the scene, on a map load), so none pops in.
   * When the object is live again (it spawned, or the player crossed back), the live actor takes over
   * the stand-in's drawable. A departed object that is a preview too stays where it was until it and
   * its event tile are both off screen.
   */
  private drawActors(view: FieldView, alpha: number): void {
    this.camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    const live = new Set<string>();
    const keys = actorKeys(view.actors);
    const drawn: RenderStats['actors'] = [];
    if (view.departed && view.departed.crossing !== this.crossing) {
      this.crossing = view.departed.crossing;
      for (const v of view.departed.actors) {
        const from = this.lastLive.get(objectKey(v));
        const draw = from === undefined ? undefined : this.actors.get(from);
        if (!draw) continue;
        // Off its key either way: a new zone's object may take the key (actorKeys).
        this.actors.delete(from!);
        if (!v.visible || !this.onScreen(v)) {
          this.removeActor(draw);
          continue;
        }
        this.actors.set(`ghost:${objectKey(v)}`, draw);
        this.ghosts.set(objectKey(v), { view: { ...v, prev: v.cur, emote: false }, kind: 'departed' });
      }
    }
    this.lastLive.clear();
    for (const [i, v] of view.actors.entries()) {
      const id = keys[i]!;
      live.add(id);
      if (v.home) {
        const object = objectKey(v);
        this.lastLive.set(object, id);
        if (this.ghosts.delete(object)) {
          const ghost = this.actors.get(`ghost:${object}`);
          this.actors.delete(`ghost:${object}`);
          if (ghost && this.actors.has(id)) this.removeActor(ghost);
          else if (ghost) this.actors.set(id, ghost);
        }
      }
      this.drawEmote(v, id, lerp3(v.prev, v.cur, alpha));
      this.drawBubble(v, id, lerp3(v.prev, v.cur, alpha));
      drawn.push(this.drawActor(v, id, alpha, 'live'));
    }
    const previews = new Set<string>();
    for (const v of view.previews) {
      const object = objectKey(v);
      previews.add(object);
      const ghost = this.ghosts.get(object);
      if (ghost) {
        if (!this.onScreen(ghost.view) && !this.onScreen(v)) this.ghosts.set(object, { view: v, kind: 'preview' });
      } else if (this.fresh || !this.onScreen(v)) this.ghosts.set(object, { view: v, kind: 'preview' });
    }
    for (const [object, ghost] of this.ghosts) {
      if (!previews.has(object) && !this.onScreen(ghost.view)) {
        this.ghosts.delete(object);
        continue;
      }
      live.add(`ghost:${object}`);
      drawn.push(this.drawActor(ghost.view, `ghost:${object}`, alpha, ghost.kind));
    }
    this.fresh = false;
    for (const [id, a] of this.actors) {
      if (!live.has(id)) {
        this.removeActor(a);
        this.actors.delete(id);
      }
    }
    for (const [id, e] of this.emotes) {
      if (!live.has(id)) {
        this.scene.remove(e.object);
        this.emotes.delete(id);
      }
    }
    for (const [id, b] of this.bubbles) {
      if (!live.has(id)) {
        this.scene.remove(b);
        this.bubbles.delete(id);
      }
    }
    this.stats.actors = drawn;
  }

  /** Places an actor's drawable (built on first use) for this frame. */
  private drawActor(v: ActorView, id: string, alpha: number, kind: RenderStats['actors'][number]['kind']): RenderStats['actors'][number] {
    const a = this.actorDraw(v, id);
    const stats: RenderStats['actors'][number] = { key: id, sprite: v.sprite, at: v.cur, visible: v.visible, object: a?.object.uuid ?? null, kind, onScreen: this.onScreen(v) };
    if (!a) return stats;
    const p = lerp3(v.prev, v.cur, alpha);
    a.object.visible = v.visible;
    if (a.kind === 'model') {
      a.object.position.copy(p);
      return stats;
    }
    // The Distortion World turns the player's sprite as it changes surfaces (DistWorldMapObjectRotator).
    const roll = v.localId === LOCALID_PLAYER && v.home === undefined ? this.playerRoll : (v.roll ?? 0);
    a.object.material.rotation = roll * DEG;
    a.paletteDarkness.value = v.paletteDarkness ?? 0;
    a.object.material.color.copy(this.billboardColor);
    a.reflection.material.color.copy(this.billboardColor);
    // A turned sprite stands on a wall or the ceiling: no upright plane is behind it, so it keeps the quad's depth.
    a.plain.value = ((roll % 360) + 360) % 360 === 0 ? 0 : 1;
    // The sprite sinks into mud and deep snow (ActorView.sink); its shadow and reflection stay on the ground.
    this.placeBillboard(a.object, p.clone().setZ(p.z + BILLBOARD_ANCHOR_Z).setY(p.y - (v.sink ?? 0)), a.record.frameSize);
    a.anchorZ.value = p.z + BILLBOARD_ANCHOR_Z;
    // The angled camera looks down less steeply than a stair rises: the steps above a character on a stair down to
    // the north hide its lower half (or all of it), where the DS camera shows it whole.
    if (this.enhancedCamera) {
      const anchor = new THREE.Vector3(p.x, p.y, a.anchorZ.value);
      const toCamera = this.camera.position.clone().sub(anchor).normalize();
      const heights: number[] = [];
      const heightsAt = (x: number, z: number, y: number) => {
        heights.length = 0;
        if (this.grid!.blocked(Math.floor(x / TILE), Math.floor(z / TILE))) return heights;
        heights.push(this.grid!.heightAt(x, z, y));
        for (const chunk of this.chunks.values()) if (chunk.group) ceilingsFor(chunk.group).heightsAt(x, z, heights);
        return heights;
      };
      a.depthLift.value.copy(slopeDepthLift(anchor, toCamera, p.y, heightsAt));
    } else a.depthLift.value.set(0, 0, 0);
    let ceiling: Ceiling | null = null;
    // Include the sprite's width: a hat can extend under a deck before the feet reach it. The frame's outer
    // half tile on each side is margin, not the character: sampled there, the raised floor in the Hearthome
    // east gate's doorway capped the whole sprites of the Route 209 blockade standing on its threshold ramp.
    const reach = Math.max(0, a.record.frameSize / 2 - TILE / 2);
    for (let dx = -reach; dx <= reach; dx += TILE / 2) {
      const x = p.x + dx, z = a.anchorZ.value;
      // The floor of an adjacent raised landing or stair is not an overhead deck.
      const ground = Math.max(p.y, this.grid!.heightAt(x, z, p.y));
      // The actor's own tile is one it stands on, even with the collision bit (the bedroom stair well's tiles):
      // otherwise the stair's own steps, a few units above its feet, cap it like a deck and hide it.
      const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE);
      const walkable = (tx === Math.floor(p.x / TILE) && tz === Math.floor(p.z / TILE)) || !this.grid!.blocked(tx, tz);
      for (const chunk of this.chunks.values()) {
        if (!chunk.group) continue;
        const candidate = ceilingsFor(chunk.group).above(x, ground, z, walkable);
        if (candidate && (!ceiling || candidate.height < ceiling.height)) ceiling = candidate;
      }
    }
    // An inset keeps the depth off the deck, including the orthographic camera’s last pixel row.
    a.ceilingY.value = ceiling ? ceiling.height - 4 : 1e9;
    if (ceiling) {
      a.ceilingMin.value.copy(ceiling.bounds.min);
      a.ceilingMax.value.copy(ceiling.bounds.max);
    }

    this.drawShadow(a, v, p);
    let frame: number;
    if (v.pose && !a.record.animations[`pose-${v.pose}-${v.facing}`] && !a.record.animations[`pose-${v.pose}`]) {
      this.reportOnce(`${v.sprite}|${v.pose}`, 'render:pose', `sprite ${v.sprite} has no pose-${v.pose} (drawn standing)`);
      frame = spriteFrame(a.record, 'stand', v.facing, 0);
    } else frame = spriteFrame(a.record, v.anim, v.facing, v.animTick, v.pose);
    stats.frame = frame;
    this.frameUv(a.texture, a.record, frame);
    this.drawReflection(a, v, p);
    return stats;
  }

  private drawShadow(a: BillboardActor, v: ActorView, p: THREE.Vector3): void {
    const want = this.shadowModel ? 'model' : 'ellipse';
    if (a.shadow.userData.kind !== want) {
      a.shadow.clear();
      a.shadow.add(this.shadowModel ? sharedLightClone(this.shadowModel) : new THREE.Mesh(this.shadowGeometry, this.shadowMaterial));
      a.shadow.userData.kind = want;
    }
    a.shadow.visible = v.visible && !this.debug.spritesOnly && !NO_SHADOW.test(this.behaviourAt(p.x, p.z));
    if (want === 'model') a.shadow.position.set(p.x - 0.5, p.y, p.z + 1);
    else a.shadow.position.set(p.x - 0.5, p.y + 0.25, p.z + 1);
    // The ellipse is sized for the day look; the model takes the look's scale itself.
    const look = this.shadowLook;
    if (want === 'model') a.shadow.scale.set(look.x, 1, look.z);
    else a.shadow.scale.set(look.x / SHADOW_BY_PERIOD.day.x, 1, look.z / SHADOW_BY_PERIOD.day.z);
  }

  private drawReflection(a: BillboardActor, v: ActorView, p: THREE.Vector3): void {
    const here = this.behaviourAt(p.x, p.z);
    const reflects = REFLECTS[here] ?? REFLECTS[this.behaviourAt(p.x, p.z + TILE)];
    a.reflection.visible = v.visible && !this.debug.spritesOnly && reflects !== undefined;
    if (!reflects) return;
    const t = this.state.tick % 32;
    const sx = reflects.wobble ? 0.875 + (t < 16 ? t : 32 - t) / 64 : 1;
    a.reflection.position.set(p.x, p.y - reflects.depth, p.z + REFLECTION_Z);
    (a.reflection.userData.groundY as { value: number }).value = p.y - REFLECTION_PLANE;
    a.reflection.scale.set(a.record.frameSize * sx, a.record.frameSize, 1);
    const map = a.reflection.material.map!;
    map.repeat.set(a.texture.repeat.x, -a.texture.repeat.y);
    map.offset.set(a.texture.offset.x, a.texture.offset.y + a.texture.repeat.y);
  }

  /** The '!' (or the '!!' for `emoteDouble`) over an actor while `emote` is set, bouncing in on its first ticks. */
  private drawEmote(v: ActorView, id: string, p: THREE.Vector3): void {
    let e = this.emotes.get(id);
    const double = !!v.emoteDouble && this.doubleExclamation !== null;
    if (e && (!v.emote || !v.visible || e.double !== double)) {
      this.scene.remove(e.object);
      this.emotes.delete(id);
      e = undefined;
    }
    if (!v.emote || !v.visible || !this.exclamation) return;
    const art = double ? this.doubleExclamation! : this.exclamation;
    if (!e) {
      const object = new THREE.Sprite(fieldOutputs(new THREE.SpriteMaterial({ map: art.texture, alphaTest: 0.5, depthTest: false }), { polygonId: 0, fog: true }));
      object.center.set(0.5, 0);
      object.renderOrder = 10;
      this.scene.add(object);
      this.emotes.set(id, (e = { object, start: this.state.tick, double }));
    }
    const anchor = p.clone().add(new THREE.Vector3(EMOTE_OFFSET[0], EMOTE_OFFSET[1] + emoteBounce(this.state.tick - e.start), EMOTE_OFFSET[2]));
    this.placeBillboard(e.object, anchor, art.size);
  }

  /**
   * HGSS's emote bubble over an actor (`ActorView.bubble`; EmoteBubbleEffect_Update): the frame of its two-frame
   * atlas over the actor's head, plus its rise. Drawn like the '!' (over the field).
   */
  private drawBubble(v: ActorView, id: string, p: THREE.Vector3): void {
    let b = this.bubbles.get(id);
    const want = v.visible ? v.bubble : undefined;
    if (!want) {
      if (b) {
        this.scene.remove(b);
        this.bubbles.delete(id);
      }
      return;
    }
    const record = need(this.reg.sprites, want.sprite, 'sprite');
    if (!('atlas' in record)) throw new Error(`render: bubble sprite ${want.sprite} is not a billboard`);
    if (!this.bubbleAtlases.has(want.sprite)) {
      this.bubbleAtlases.set(want.sprite, null);
      void this.assets.texture(record.atlas).then((t) => this.bubbleAtlases.set(want.sprite, t), this.failed(`the bubble ${want.sprite}`));
    }
    const atlas = this.bubbleAtlases.get(want.sprite);
    if (!atlas) return;
    if (!b) {
      b = new THREE.Sprite(fieldOutputs(new THREE.SpriteMaterial({ map: atlas.clone(), alphaTest: 0.5, depthTest: false }), { polygonId: 0, fog: true }));
      b.center.set(0.5, 0);
      b.renderOrder = 10;
      this.scene.add(b);
      this.bubbles.set(id, b);
    }
    const map = b.material.map!;
    if (map.image !== atlas.image) {
      b.material.map = atlas.clone();
      b.material.needsUpdate = true;
    }
    this.frameUv(b.material.map!, record, want.frame);
    // HGSS places its 32-unit quad 2 units up and 1 toward the camera, over the 3D follower's head; over our flat
    // billboard it sits from five eighths of the actor's height up (20 of a 32-unit sprite), plus its rise.
    const actor = need(this.reg.sprites, v.sprite, 'sprite');
    const height = 'atlas' in actor ? actor.frameSize : TILE * 2;
    this.placeBillboard(b, p.clone().add(new THREE.Vector3(BUBBLE_OFFSET[0], BUBBLE_OFFSET[1] + (height * 5) / 8 - 2 + want.rise, BUBBLE_OFFSET[2])), record.frameSize);
  }

  // ---------- camera ----------

  private setCamera(rec: CameraRecord): void {
    if (this.cameraRecord?.id === rec.id) return;
    this.cameraRecord = rec;
    this.camera = rec.projection === 'perspective' ? new THREE.PerspectiveCamera() : new THREE.OrthographicCamera();
    this.camera.near = rec.near;
    this.camera.far = rec.far;
    this.applyProjection();
  }

  /**
   * The DS camera's framing, widened to the view: the DS's 192 rows span its FOV, so a view `viewHeight`
   * DS px high spans `viewHeight / 192` times its tangent (same centre, same DS px size at the target).
   */
  private applyProjection(): void {
    const rec = this.cameraRecord;
    if (!rec) return;
    const tanV = Math.tan((rec.fovY / 2) * DEG) * (this.viewHeight / 192);
    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.fov = (2 * Math.atan(tanV)) / DEG;
      this.camera.aspect = this.aspect;
    } else {
      const h = tanV * rec.distance;
      const w = h * this.aspect;
      Object.assign(this.camera, { left: -w, right: w, top: h, bottom: -h });
    }
    this.camera.updateProjectionMatrix();
    this.baseReach = this.reach = groundReach(this.camera, rec);
    if (this.camera instanceof THREE.PerspectiveCamera) this.dsFov = this.camera.fov;
  }

  /** Follows the enhanced config: loads the pipeline on first use, drops it (and its camera) when it is off. */
  private syncEnhanced(): void {
    const config = enhancedVisuals();
    if (config === this.enhancedConfig) return;
    const before = this.enhancedConfig;
    this.enhancedConfig = config;
    // The DS camera again: rebuilt from its record on this frame.
    if (before && before.camera !== 'off' && (config?.camera ?? 'off') === 'off') {
      this.cameraRecord = null;
      this.enhancedCamera = false;
    }
    this.reach = this.baseReach;
    // Night glows read the chunks' light sources, found only while a config is on: build the chunks again.
    if (config?.lamps && !before?.lamps) this.clearChunks();
    if (!config) {
      this.enhanced?.dispose();
      this.enhanced = null;
      for (const a of this.actors.values()) if (a.kind === 'billboard') a.shadow.rotation.y = 0;
      return;
    }
    if (this.enhanced) return this.enhanced.setConfig(config);
    if (this.enhancedLoading) return;
    this.enhancedLoading = true;
    void import('./enhanced/pipeline.ts')
      .then(({ EnhancedPipeline }) => {
        this.enhancedLoading = false;
        const now = enhancedVisuals();
        if (this.disposed || !now) return;
        this.enhanced = new EnhancedPipeline(this.renderer, now);
        this.enhancedConfig = now;
        const buffer = this.renderer.getDrawingBufferSize(new THREE.Vector2());
        this.enhanced.setSize(buffer.x, buffer.y);
      })
      .catch(this.failed('enhanced visuals'));
  }

  /** The light-source meshes of the built chunks, for the enhanced night glows (the same list while the chunks stay). */
  private glowList(): THREE.Mesh[] {
    const groups = [...this.chunks.values()].flatMap((c) => (c.group?.userData.glows ? [c.group] : []));
    const key = groups.map((g) => g.uuid).join();
    if (key !== this.glows.key) this.glows = { key, list: groups.flatMap((g) => g.userData.glows as THREE.Mesh[]) };
    return this.glows.list;
  }

  /**
   * The clock's effects on the scene: the area light template (switched, not blended, when the clock
   * passes a template's end: every lit mesh is relit) and the shadow look, which snaps on a map load and
   * otherwise eases toward its period (ov5_021F1424).
   */
  private updateClock(view: FieldView): void {
    const light = need(this.reg.lights, this.area!.light, 'light');
    const { template, index } = lightAt(light, view.clock.seconds);
    const key = `${light.id}#${index}`;
    if (key !== this.lightKey) {
      const relit = this.lightKey !== '';
      this.lightKey = key;
      this.lightTemplate = template;
      this.billboardColor.setRGB(...billboardLight(template));
      if (relit) {
        relight(this.scene, template, this.viewToWorld());
        // The shadow model is not in the scene; its clones under the actors share its geometry (sharedLightClone).
        if (this.shadowModel) relight(this.shadowModel, template, this.viewToWorld());
      }
    }
    const want = SHADOW_BY_PERIOD[view.clock.period];
    const look = this.shadowLook;
    const tick = this.state.tick;
    const steps = look.tick < 0 ? Infinity : Math.max(0, tick - look.tick);
    const toward = (from: number, to: number, step: number) => (from < to ? Math.min(to, from + step * steps) : Math.max(to, from - step * steps));
    look.alpha = toward(look.alpha, want.alpha, SHADOW_ALPHA_STEP);
    look.x = toward(look.x, want.x, SHADOW_SCALE_STEP);
    look.z = toward(look.z, want.z, SHADOW_SCALE_STEP);
    look.tick = tick;
    this.shadowMaterial.opacity = SHADOW_OPACITY * (look.alpha / SHADOW_BY_PERIOD.day.alpha);
    this.shadowModel?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.opacity = look.alpha / 31;
    });
  }

  /** Rotation from view space to world space for the current camera preset (it only translates in the field). */
  private viewToWorld(): THREE.Quaternion {
    return viewToWorld(this.cameraRecord!);
  }

  private placeCamera(target: THREE.Vector3, zoom = 0): void {
    const rec = this.cameraRecord!;
    cameraOffset(rec, this.camera.position, zoom).add(target);
    this.camera.lookAt(target);
    if (rec.angle[2]) this.camera.rotateZ(rec.angle[2] * DEG);
    this.cameraTarget.copy(target);
  }

  /** The camera's last target (the ground plane the touch picks on: ov5_GetPositionFromTouchCoordinates). */
  private readonly cameraTarget = new THREE.Vector3();

  // ---------- FieldRenderer ----------

  tileAt(x: number, y: number): { x: number; z: number } | null {
    if (!this.cameraRecord) return null;
    const el = this.renderer.domElement;
    const ndc = new THREE.Vector2((x / el.clientWidth) * 2 - 1, 1 - (y / el.clientHeight) * 2);
    this.camera.updateMatrixWorld();
    const near = new THREE.Vector3(ndc.x, ndc.y, -1).unproject(this.camera);
    const far = new THREE.Vector3(ndc.x, ndc.y, 1).unproject(this.camera);
    const h = this.cameraTarget.y;
    if ((near.y - h) * (far.y - h) > 0) return null;
    const p = near.lerp(far, (near.y - h) / (near.y - far.y));
    const tx = Math.floor(p.x / TILE);
    const tz = Math.floor(p.z / TILE);
    return tx < 0 || tz < 0 ? null : { x: tx, z: tz };
  }

  screenOf(x: number, z: number): { x: number; y: number } | null {
    if (!this.cameraRecord) return null;
    const el = this.renderer.domElement;
    this.camera.updateMatrixWorld();
    const p = new THREE.Vector3(x * TILE + TILE / 2, this.cameraTarget.y, z * TILE + TILE / 2).project(this.camera);
    return { x: ((p.x + 1) / 2) * el.clientWidth, y: ((1 - p.y) / 2) * el.clientHeight };
  }

  render(alpha: number): void {
    // A chunk, sprite or model that failed to load stops rendering loudly instead of leaving holes.
    if (this.failure) throw this.failure;
    const t0 = performance.now();
    this.syncEnhanced();
    const view = this.world.view();
    if (view.matrix !== this.matrix) {
      this.clearChunks();
      this.matrix = view.matrix;
    }
    const zone = need(this.reg.zones, view.zone, 'zone');
    if (view.loads !== this.loads) {
      this.clearActors();
      this.loads = view.loads;
      const area = need(this.reg.areas, view.area, 'area');
      if (this.area && this.area.id !== area.id) this.clearChunks();
      this.area = area;
      // A map load sets the shadow look at once (the effect's init); a new area's light is picked below.
      this.shadowLook.tick = -1;
      this.effects.clear();
      this.enhanced?.reset();
      this.grid = new MapGrid(this.reg, need(this.reg.matrices, view.matrix, 'matrix'), gridOffset(this.reg, view.zone));
      if (!this.shadowModel && !this.shadowPending && [...this.reg.fieldEffects.values()].some((e) => e.name === 'SHADOW')) void this.loadShadow().catch(this.failed('the shadow model'));
    }
    if (this.grid?.matrix.id !== view.matrix) this.grid = new MapGrid(this.reg, need(this.reg.matrices, view.matrix, 'matrix'), gridOffset(this.reg, view.zone));
    const dw = view.distortion;
    if (dw) {
      // The Distortion World's own camera (its angles move every tick: only a new record id rebuilds the camera).
      const rec = distortionCamera(dw, zone.id.endsWith(':MAP_HEADER_DISTORTION_WORLD_GIRATINA_ROOM'), alpha);
      if (this.cameraRecord?.id === rec.id) this.cameraRecord = rec;
      else this.setCamera(rec);
      const tables = [...this.reg.newGame.values()][0]?.distortionWorld;
      if (!tables) throw new Error('render: a Distortion World room without NewGame.distortionWorld');
      this.dwSky ??= new DistortionSky(tables.sky, (ref) => this.assets.texture(ref), (what) => this.failed(what));
      const r = dw.roll;
      this.playerRoll = r.prev + ((((r.cur - r.prev + 540) % 360) - 180) * alpha);
      this.dwProps ??= new DistortionProps(this.scene, tables, (id) => this.animatedModel(id), (what) => this.failed(what));
    } else {
      // The Vista Lighthouse binoculars' own camera replaces the zone's while it is up.
      this.setCamera(view.viewCamera?.camera ?? need(this.reg.cameras, zone.camera, 'camera'));
      this.playerRoll = 0;
    }
    this.updateClock(view);
    if (view.storyScene?.kind === 'dw-warp') {
      const pass = this.dwWarp.pose(view.storyScene.tick, this.aspect);
      if (!pass) return;
      this.composite.configure(null, true);
      this.composite.clear(this.renderer);
      this.renderer.render(pass.scene, pass.camera);
      this.renderer.setRenderTarget(null);
      this.renderer.clear();
      this.composite.draw(this.renderer);
      this.fadeMaterial.color.set(0x000000);
      this.fadeMaterial.opacity = warpFade(view.storyScene.tick);
      this.renderer.render(this.fadeScene, this.fadeCamera);
      return;
    }
    if (view.storyScene?.kind === 'spear-app') {
      const pass = this.stories.pose(view.storyScene, this.aspect, this.lightTemplate);
      if (!pass) return;
      this.composite.configure(null, true);
      this.composite.clear(this.renderer);
      this.renderer.render(pass.scene, pass.camera);
      this.renderer.setRenderTarget(null);
      this.renderer.clear();
      this.composite.draw(this.renderer);
      this.stories.feedback(this.renderer, view.storyScene);
      const white = view.storyScene.brightness >= 0;
      this.fadeMaterial.color.set(white ? 0xffffff : 0x000000);
      this.fadeMaterial.opacity = this.storyFlash.fade(white ? 'white' : 'black', Math.abs(view.storyScene.brightness) / 16);
      this.renderer.render(this.fadeScene, this.fadeCamera);
      return;
    }
    if (view.shipScene) {
      const pass = this.ships.pose(view.shipScene, this.aspect, this.lightTemplate);
      if (!pass) return;
      this.composite.configure(null, true);
      this.composite.clear(this.renderer);
      this.renderer.render(pass.scene, pass.camera);
      this.renderer.setRenderTarget(null);
      this.renderer.clear();
      this.composite.draw(this.renderer);
      this.fadeMaterial.color.set(0x000000);
      this.fadeMaterial.opacity = shipFade(view.shipScene.tick, view.shipScene.frames);
      this.renderer.render(this.fadeScene, this.fadeCamera);
      return;
    }
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    let query: WebGLQuery | null = null;
    if (this.debug.syncTiming) {
      this.gpuQueries ??= { ext: gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null, pending: [] };
      if (this.gpuQueries.ext) {
        query = gl.createQuery()!;
        gl.beginQuery(this.gpuQueries.ext.TIME_ELAPSED_EXT, query);
      }
    }
    const target = view.viewCamera ? new THREE.Vector3(...view.viewCamera.target) : lerp3(view.camera.prev, view.camera.cur, alpha);
    this.updateChunks(view, target);
    this.updateFloors(dw?.floors ?? []);
    this.dwProps?.update(dw?.props ?? [], view.loads, alpha);
    this.updateDoors(view.doors ?? [], alpha);
    this.updateLoops(alpha);
    this.updateElevators(view.elevatorLights);
    this.updateLift(view);
    this.featureModels.update(view.features, view.loads, alpha);
    this.worldProps.update(view.props ? { models: view.props } : undefined, view.loads, alpha);
    const balls = view.healMachine?.balls ?? 0;
    for (const chunk of this.chunks.values()) {
      let i = 0;
      for (const part of chunk.healBalls) {
        if (part.ball) part.root.visible = i++ < balls;
        part.pose(view.healMachine?.frame);
      }
    }
    const aim = target.clone().add(new THREE.Vector3(...view.cameraOffset));
    this.placeCamera(aim, view.cameraDistance ?? 0);
    // Enhanced visuals stay out of the Distortion World (its own camera and sky) and the binoculars' view.
    const enhanced = dw || view.viewCamera ? null : this.enhanced;
    if (enhanced) {
      const velocity = new THREE.Vector3(...view.camera.cur).sub(new THREE.Vector3(...view.camera.prev));
      const r = enhanced.placeCamera(this.camera, this.cameraRecord!, aim, velocity, this.dsFov, view.cameraDistance ?? 0, cameraAllowed(zone));
      // Back to the DS camera (a cave, a building, the switch off): its own projection and far plane again.
      if (!r && this.enhancedCamera) {
        this.camera.far = this.cameraRecord!.far;
        this.applyProjection();
      }
      this.enhancedCamera = !!r;
      const b = this.baseReach;
      this.reach = r ? { minX: Math.min(b.minX, r.minX), maxX: Math.max(b.maxX, r.maxX), minZ: Math.min(b.minZ, r.minZ), maxZ: Math.max(b.maxZ, r.maxZ) } : b;
    }
    this.drawActors(view, alpha);
    if (enhanced) enhanced.stretchShadows([...this.actors.values()].flatMap((a) => (a.kind === 'billboard' ? [a.shadow] : [])), view.clock.seconds, zone);
    this.effects.update(view.effects, alpha, this.billboardColor, this.camera);
    this.materials.animate(this.state.tick, this.debug.heldTextureAnimations, this.posedAnimations(view.features?.propPoses));
    const weather = need(this.reg.weathers, view.weather, 'weather');
    if (weather.pending?.length) this.reportOnce(`weather:${weather.id}`, 'render:weather', `${weather.id}: ${weather.pending.join(', ')} not decoded`);
    // A map feature's fog (Hearthome Gym's FogManager) replaces the weather's.
    // The Distortion World's fog (InitFog) fades the far field into its sky; its edges are dark gray (InitEdgeColors).
    // The weather tasks move their particles with the camera target (ov5_021D7028).
    const rec = this.cameraRecord!;
    this.weather.update(weather, view.darkness, view.lightning ?? 0, this.state.tick, view.loads, { x: aim.x, z: aim.z, ...weatherCameraScale(rec.fovY, rec.distance + (view.cameraDistance ?? 0)) });
    this.stats.weather = this.weather.stats();
    if (dw) this.composite.configure(DISTORTION_FOG, false, { edges: this.debug.edges, ids: this.debug.polygonIds }, true);
    // A weather BG behind the field (CLEAR_8, CLEAR_13) shows through its clear rear plane.
    else this.composite.configure(view.features?.fog ?? this.weather.fog(), zone.mapType !== 'outdoors' && zone.mapType !== 'town', { edges: this.debug.edges, ids: this.debug.polygonIds }, this.weather.under());
    // The angled camera's fog reads linear view depth; at the target it is the DS camera's (composite.ts LinearFog).
    if (enhanced && this.enhancedCamera) {
      const depth = -aim.clone().applyMatrix4(this.camera.matrixWorldInverse).z;
      this.composite.linearFog({ near: this.camera.near, far: this.camera.far, dsNear: rec.near, dsFar: rec.far, shift: rec.distance + (view.cameraDistance ?? 0) - depth });
    }

    // The 3D field into colour + polygon ID/fog flag + depth, then edge marking and fog to the screen,
    // then the 2D layers (weather, darkness) and the fade.
    for (const c of this.chunks.values()) if (c.group) c.group.visible = !this.debug.spritesOnly;
    this.composite.clear(this.renderer);
    this.renderer.render(this.scene, this.camera);
    // Enhanced post: the composite goes to the pipeline's buffer, which draws it to the screen with its effects.
    const post = enhanced && needsPost(this.enhancedConfig!) ? enhanced : null;
    if (post) post.begin();
    else this.renderer.setRenderTarget(null);
    this.renderer.clear();
    if (dw) this.dwSky!.draw(this.renderer, dw.sky, this.viewHeight * this.aspect, this.viewHeight);
    else if (this.weather.under()) this.weather.drawUnder(this.renderer);
    this.composite.draw(this.renderer);
    if (view.storyScene?.kind === 'spear-field') {
      const pass = this.stories.pose(view.storyScene, this.aspect, this.lightTemplate);
      if (pass) this.renderer.render(pass.scene, this.camera);
    }
    if (post) {
      const player = view.actors.find((a) => a.localId === 255);
      post.finish({
        camera: this.camera,
        depth: this.composite.target.depthTexture!,
        seconds: view.clock.seconds,
        zone,
        weather: this.weather.active(),
        fog: !!(view.features?.fog ?? this.weather.fog()),
        player: player ? lerp3(player.prev, player.cur, alpha) : null,
        target: aim,
        glows: this.enhancedConfig!.lamps ? this.glowList() : [],
      });
    }
    if (this.weather.active() && this.debug.weather) this.weather.draw(this.renderer);
    if (view.storyScene?.kind === 'spear-field' && view.storyScene.brightness !== 0) {
      const white = view.storyScene.brightness > 0;
      this.fadeMaterial.color.set(white ? 0xffffff : 0x000000);
      this.fadeMaterial.opacity = this.storyFlash.fade(white ? 'white' : 'black', Math.abs(view.storyScene.brightness) / 16);
      this.renderer.render(this.fadeScene, this.fadeCamera);
    } else this.storyFlash.apply(0);
    // Sweet Scent's pink over the field (FieldView.tint).
    if (view.tint) {
      this.fadeMaterial.color.setRGB(...view.tint.color, THREE.SRGBColorSpace);
      this.fadeMaterial.opacity = view.tint.alpha;
      this.renderer.render(this.fadeScene, this.fadeCamera);
    }
    const fade = this.world.fadeState();
    if (fade) {
      this.fadeMaterial.color.set(fade.color === 'black' ? 0x000000 : 0xffffff);
      this.fadeMaterial.opacity = this.fadeFlash.fade(fade.color === 'black' ? 'black' : 'white', fade.alpha);
      this.renderer.render(this.fadeScene, this.fadeCamera);
    } else this.fadeFlash.apply(0);
    if (query) {
      const q = this.gpuQueries!;
      gl.endQuery(q.ext!.TIME_ELAPSED_EXT);
      q.pending.push(query);
      while (q.pending.length && gl.getQueryParameter(q.pending[0]!, gl.QUERY_RESULT_AVAILABLE)) {
        const done = q.pending.shift()!;
        if (!gl.getParameter(q.ext!.GPU_DISJOINT_EXT)) this.stats.gpuMs.push(Number(gl.getQueryParameter(done, gl.QUERY_RESULT)) / 1e6);
        gl.deleteQuery(done);
      }
      if (this.stats.gpuMs.length > 2048) this.stats.gpuMs.shift();
    }
    if (this.debug.syncTiming) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    const s = this.stats;
    s.frames++;
    s.renderMs.push(performance.now() - t0);
    if (s.renderMs.length > 2048) s.renderMs.shift();
    s.chunks = [...this.chunks.values()].filter((c) => c.group).length;
    s.geometries = this.renderer.info.memory.geometries;
    s.textures = this.renderer.info.memory.textures;
    s.cachedModels = this.assets.sizes().models;
    s.enhanced = this.enhanced ? this.enhancedConfig : null;
    s.enhancedFrame = enhanced ? { angled: this.enhancedCamera, lamps: this.enhancedConfig!.lamps ? this.glowList().length : 0, quality: enhanced.quality } : null;
  }

  loading(): boolean {
    if (this.failure) throw this.failure;
    // Not yet rebuilt for the world's current map load (e.g. freshly mounted, or a warp just happened).
    const view = this.world.view();
    if (this.loads !== view.loads) return true;
    if (view.shipScene && !this.ships.ready()) return true;
    if (view.storyScene?.kind === 'dw-warp' && !this.dwWarp.ready()) return true;
    if (view.storyScene && view.storyScene.kind !== 'dw-warp' && !this.stories.ready()) return true;
    if (this.pendingSprites.size > 0 || this.exclamationPending || this.shadowPending || this.effects.pending() > 0 || this.weather.loading()) return true;
    if (this.lift && !this.lift.root) return true;
    if (this.featureModels.loading() || this.worldProps.loading()) return true;
    if (this.dwSky?.loading() || this.dwProps?.loading()) return true;
    for (const f of this.floors.values()) if (f.pending > 0) return true;
    // The chunks in view; the ones around them may still build (they come into view only as the camera moves).
    for (const c of this.chunks.values()) if (!c.group && !c.cancelled && this.viewCells.has(c.cell)) return true;
    return false;
  }

  /**
   * `scale` is CSS px per DS px (the zoom); without it the DS view just fits (wide screens keep the DS
   * height, narrow ones the DS width). Either way the view is centred on the DS camera's target.
   */
  resize(width: number, height: number, pixelRatio: number, scale = Math.min(width / 256, height / 192)): void {
    if (!(scale > 0)) throw new Error(`render: bad view scale ${scale}`);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.aspect = width / height;
    this.viewHeight = height / scale;
    this.applyProjection();
    const buffer = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.dsPixel = buffer.y / this.viewHeight;
    this.composite.setSize(buffer.x, buffer.y, this.dsPixel);
    this.enhanced?.setSize(buffer.x, buffer.y);
    this.weather.setSize(buffer.x / this.dsPixel, buffer.y / this.dsPixel);
  }

  dispose(): void {
    this.disposed = true;
    this.clearChunks();
    this.clearActors();
    this.effects.clear();
    this.ships.dispose();
    this.dwWarp.dispose();
    this.stories.dispose();
    this.composite.dispose();
    this.enhanced?.dispose();
    this.weather.dispose();
    disposeTree(this.scene);
    disposeTree(this.fadeScene);
    if (this.shadowModel) disposeTree(this.shadowModel);
    this.shadowGeometry.dispose();
    this.shadowMaterial.dispose();
    this.assets.dispose();
    // The canvas's renderer stays for the next Field (`rendererFor`); only this Field's scene lists go.
    this.renderer.renderLists.dispose();
  }
}

export const mountFieldRenderer: MountFieldRenderer = async (canvas, deps) => {
  const world = deps.world as OpenSinnohWorld;
  if (typeof world.view !== 'function') throw new Error('render: the world has no view() (needs @opensinnoh/world)');
  const field = new Field(canvas, world, deps.registries, deps.state, new AssetCache(deps.assets), deps.log);
  field.resize(canvas.clientWidth || 256, canvas.clientHeight || 192, globalThis.devicePixelRatio ?? 1);
  // Perf runs read frame timings and scene sizes here (the latest mounted renderer).
  (globalThis as { openSinnohRenderStats?: RenderStats }).openSinnohRenderStats = field.stats;
  (globalThis as { openSinnohRenderDebug?: RenderDebug }).openSinnohRenderDebug = field.debug;
  return field;
};
