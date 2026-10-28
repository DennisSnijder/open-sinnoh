/** Strict schemas for every registry in contracts `records.ts` (the pack boundary). */
import { VILLA_FURNITURE_COUNT, DW_PLATFORM_FLAGS, DW_PROP_KINDS, DW_PUZZLE_FLAGS, DW_SUPPORT_KINDS, GAME_RECORDS, parseTextMarkup, REGISTRIES, SEALS, TRAINER_SCORE_MAX, type RegistryName } from '@opensinnoh/contracts';
import { STATS, type RegistryRecord } from '@opensinnoh/core';
import { arr, bool, collectRefs, dict, id, int, lit, nullable, num, obj, opt, ref, str, tagged, tuple, union, validate, type RefUse, type Schema } from './schema.ts';

const facing = lit('up', 'down', 'left', 'right');
const sourceIndex = opt(int(0));
const vec3 = tuple(num, num, num);
const label = ref('labels');
const creditsRow = obj(
  { count: int(0, 16), speed: int(0), start: tuple(int(), int(), int()), spacing: tuple(int(), int(), int()) },
  v => v.count && (!v.speed || (v.spacing as number[])[0]! <= 0) ? 'credits: a populated row needs positive speed and x spacing' : undefined,
);
const creditsRows = tuple(creditsRow, creditsRow);
const titleModel = obj({
  model: ref('models'),
  clip: opt(str()),
  scroll: opt(arr(obj({ material: str(), frames: int(1), translateS: union(num, arr(num)), translateT: union(num, arr(num)) }))),
  camera: obj({ position: vec3, target: vec3, fovY: num, near: num, far: num }),
  lights: arr(obj({ direction: vec3, color: tuple(num, num, num) })),
});
const shipTrack = union(num, arr(num));
const shipScene = obj({
  loop: opt(bool),
  visibility: opt(arr(arr(bool))),
  model: ref('models'), clip: str(), frames: int(1),
  camera: obj({ position: vec3, target: vec3, fovY: num, near: num, far: num }),
  srt: arr(obj({ name: opt(str()), frames: int(1), materials: arr(obj({ material: str(), scaleS: shipTrack, scaleT: shipTrack, rotation: tuple(num, num), rotationFrames: opt(arr(tuple(num, num))), translateS: shipTrack, translateT: shipTrack })) })),
  colors: arr(obj({ name: opt(str()), frames: int(1), materials: arr(obj({ material: str(), diffuse: shipTrack, ambient: shipTrack, specular: shipTrack, emission: shipTrack, alpha: shipTrack })) })),
  patterns: arr(obj({ frames: int(1), materials: arr(obj({ material: str(), keys: arr(obj({ frame: int(0), image: ref('assets') })) })) })),
});
const color = str(/^#[0-9a-f]{6}$/);
const curve = { in: int(0, 255), out: int(0, 255) };
const tile = obj({ x: int(0), z: int(0) });
const bits = arr(lit(0, 1));
/** contracts `GymTables` (0.26.0): the sizes the gym code indexes are checked. */
const gyms = obj(
  {
    eterna: obj({
      zone: ref('zones'),
      clockVar: ref('vars'),
      message: ref('texts'),
      times: arr(obj({ hour: int(0, 11), minute: int(0, 59) })),
      jumps: arr(nullable(obj({ x: int(0), z: int(0), northSouth: bool }))),
      clock: arr(bits),
      fountains: arr(bits),
      hourRotations: arr(int(0, 0xffff)),
      hands: nullable(obj({ hour: ref('props'), minute: ref('props') })),
      fountain: nullable(obj({ loop: ref('fieldEffects'), drain: ref('fieldEffects') })),
    }),
    veilstone: obj({
      zone: ref('zones'),
      bags: arr(tile),
      stacks: arr(tile),
      track: arr(int(0, 5)),
      cameraDistance: obj({ up: int(0), down: int(0), left: int(0), right: int(0) }),
      effects: nullable(obj({ bag: dict(str(/^(still|move)-[nswe]$/), ref('fieldEffects')), stack: ref('fieldEffects'), toppled: ref('fieldEffects') })),
    }),
    hearthome: obj({
      rooms: arr(
        obj({
          zone: ref('zones'),
          firstDoor: int(0, 7),
          doorCount: int(1, 8),
          offsetX: int(0),
          offsetZ: int(0),
          width: int(1),
          depth: int(1),
          clueMask: arr(lit(0, 1)),
          doors: arr(obj({ door: int(0, 7), x: int(0), z: int(0) })),
        }),
      ),
      entrance: ref('zones'),
      relicBadge: id,
      playerSprite: obj({ male: ref('sprites'), female: ref('sprites') }),
      effects: nullable(obj({ symbols: arr(ref('fieldEffects')), light: ref('models') })),
      light: obj({ rotations: arr(vec3), scales: arr(arr(vec3)), offsets: arr(arr(vec3)) }),
    }),
    sunyshore: opt(arr(obj({
      gears: arr(obj({ prop: ref('props'), x: int(0, 31), y: int(0), z: int(0, 31), initialRotation: int(0, 3), clockwise: bool, vertical: bool })),
      rectangles: arr(obj({ x: int(0), z: int(0), width: int(1), depth: int(1) })),
      collisions: arr(arr(int(0))),
    }))),
    pastoria: obj({ buttons: obj({ blue: ref('props'), green: ref('props'), orange: ref('props') }), water: ref('props') }),
    canalave: obj({
      platforms: arr(obj({ prop: ref('props'), axis: lit('x', 'y', 'z'), a: tuple(int(0, 31), int(0, 30), int(0, 31)), b: tuple(int(0, 31), int(0, 30), int(0, 31)), floorA: int(0, 3), floorB: int(0, 3) })),
      startInB: arr(bool),
      collision: arr(bits),
      floors: tuple(ref('props'), ref('props'), ref('props')),
    }),
  },
  (v) => {
    const e = v.eterna as { times: unknown[]; jumps: unknown[]; clock: unknown[][]; fountains: unknown[][]; hourRotations: unknown[] };
    const states = e.times.length;
    if (states !== 5 || e.jumps.length !== states || e.clock.length !== states || e.fountains.length !== states) return 'eterna: 5 clock states in every table';
    if (e.clock.some((m) => m.length !== 169) || e.fountains.some((m) => m.length !== 21) || e.hourRotations.length !== 12) return 'eterna: mask or rotation sizes';
    if ((v.veilstone as { track: unknown[] }).track.length !== 32 * 32) return 'veilstone: the track is 32×32';
    const c = v.canalave as { platforms: unknown[]; startInB: unknown[]; collision: unknown[][] };
    if (c.platforms.length !== 24 || c.startInB.length !== 24 || c.collision.length !== 4 || c.collision.some((m) => m.length !== 32 * 32)) return 'canalave: 24 platforms and 4 floors of 32×32';
    for (const r of (v.hearthome as { rooms: { width: number; depth: number; clueMask: unknown[]; doors: unknown[]; doorCount: number }[] }).rooms) {
      if (r.clueMask.length !== r.width * r.depth) return 'hearthome: a clue mask is not width × depth';
      if (r.doors.length !== r.doorCount) return 'hearthome: a room lists another number of doors';
    }
    const light = (v.hearthome as { light: { rotations: unknown[]; scales: unknown[][]; offsets: unknown[][] } }).light;
    if (light.rotations.length !== 4 || [light.scales, light.offsets].some((t) => t.length !== 4 || t.some((d) => d.length !== 6))) return 'hearthome: the light tables are 4 facings (× 6 lengths)';
    return undefined;
  },
);
const ui2dEmitter = obj({
  emission: int(0, 9),
  drawType: int(0, 4),
  aspect: num,
  dbbScale: num,
  scaleAnimDir: int(0, 2),
  circleAxis: int(0, 3),
  axis: vec3,
  position: vec3,
  count: num,
  radius: num,
  velPos: num,
  velAxis: num,
  scale: num,
  color,
  alpha: int(0, 31),
  startDelay: int(0),
  life: int(0),
  particleLife: int(0),
  interval: int(1, 255),
  air: int(0, 1023),
  texture: int(0),
  hideParent: bool,
  scaleAnim: opt(obj({ start: num, mid: num, end: num, ...curve })),
  colorAnim: opt(obj({ start: color, end: color, in: int(0, 255), peak: int(0, 255), out: int(0, 255), interpolate: bool })),
  alphaAnim: opt(obj({ start: int(0, 31), mid: int(0, 31), end: int(0, 31), ...curve })),
  child: opt(obj({ life: int(0), texture: int(0), color: nullable(color), scaleRatio: int(0, 255), velocityRatio: int(0, 255), endScale: nullable(num), fade: bool, count: int(0, 255), delay: int(0, 255), every: int(0, 255) })),
});
const ui2dAnimation = obj({
  mode: lit('forward', 'loop', 'pingpong', 'pingpong-loop'),
  loopStart: int(0),
  frames: arr(obj({ cell: int(0), ticks: int(0), dx: opt(num), dy: opt(num), scaleX: opt(num), scaleY: opt(num), rotation: opt(num) })),
});
const pokemonFace = obj({ y: int(0), yOffset: int(), opaque: opt(str()) });
const pokemonSpriteForm = obj({
  name: opt(str()),
  atlas: ref('assets'),
  shinyAtlas: ref('assets'),
  front: pokemonFace,
  back: pokemonFace,
  frontFemale: opt(pokemonFace),
  backFemale: opt(pokemonFace),
  icon: ref('assets'),
});
const pokemonSpriteAnim = obj({
  frames: arr(obj({ frame: int(0, 1), ticks: int(0), dx: int(), dy: int() })),
  animation: int(0),
  startDelay: int(0),
  cryDelay: int(0),
});
const ivec3 = tuple(int(), int(), int());
const particleEmitter = obj({
  flags: int(0, 0xffffffff),
  basePos: ivec3,
  count: int(),
  radius: int(),
  length: int(),
  axis: ivec3,
  color: int(0, 0xffff),
  velPos: int(),
  velAxis: int(),
  scale: int(),
  aspect: int(),
  startDelay: int(0),
  minRotation: int(),
  maxRotation: int(),
  initAngle: int(0),
  emitterLife: int(0),
  particleLife: int(0),
  attenuation: tuple(int(0, 255), int(0, 255), int(0, 255)),
  interval: int(0, 255),
  alpha: int(0, 255),
  air: int(0, 255),
  texture: int(0, 255),
  loopFrames: int(0, 255),
  dbbScale: int(),
  tileS: int(0, 3),
  tileT: int(0, 3),
  scaleDir: int(0, 7),
  faceEmitter: bool,
  flipS: bool,
  flipT: bool,
  polygonX: int(),
  polygonY: int(),
  scaleAnim: opt(obj({ start: int(), mid: int(), end: int(), in: int(0, 255), out: int(0, 255), loop: bool })),
  colorAnim: opt(obj({ start: int(0, 0xffff), end: int(0, 0xffff), in: int(0, 255), peak: int(0, 255), out: int(0, 255), randomStart: bool, loop: bool, interpolate: bool })),
  alphaAnim: opt(obj({ start: int(0, 31), mid: int(0, 31), end: int(0, 31), in: int(0, 255), out: int(0, 255), random: int(0, 255), loop: bool })),
  texAnim: opt(obj({ textures: arr(int(0, 255)), step: int(0, 255), randomStart: bool, loop: bool })),
  child: opt(
    obj({
      flags: int(0, 0xffff),
      randomVel: int(),
      endScale: int(),
      life: int(0),
      velRatio: int(0, 255),
      scaleRatio: int(0, 255),
      color: int(0, 0xffff),
      count: int(0, 255),
      delay: int(0, 255),
      interval: int(0, 255),
      texture: int(0, 255),
      tileS: int(0, 3),
      tileT: int(0, 3),
      flipS: bool,
      flipT: bool,
      faceEmitter: bool,
    }),
  ),
  gravity: opt(ivec3),
  random: opt(obj({ magnitude: ivec3, interval: int(0) })),
  magnet: opt(obj({ target: ivec3, force: int() })),
  spin: opt(obj({ angle: int(0, 0xffff), axis: int(0) })),
  collision: opt(obj({ y: int(), elasticity: int(), type: int(0, 3) })),
  convergence: opt(obj({ target: ivec3, force: int() })),
});
const battlePlatform = obj({ day: ref('ui2d'), twilight: ref('ui2d'), night: ref('ui2d'), x: int(), y: int(), start: tuple(int(), int()) });

const zone = obj({
  id,
  sourceIndex,
  name: str(),
  matrix: ref('matrices'),
  area: ref('areas'),
  camera: ref('cameras'),
  mapType: lit('town', 'city', 'route', 'outdoors', 'indoors', 'cave', 'other'),
  weather: ref('weathers'),
  music: obj({ day: nullable(ref('sequences')), night: nullable(ref('sequences')) }),
  noFishing: opt(bool),
  feebas: opt(obj({ species: ref('species'), tiles: arr(int(0, 0xffff)) })),
  flags: obj({ bike: bool, running: bool, escapeRope: bool, fly: bool }),
  encounters: opt(ref('encounters')),
  battleBackground: opt(ref('battleBackgrounds')),
  blackOut: opt(obj({ spawn: int(1), x: int(0), z: int(0), label })),
  firstArrival: opt(ref('flags')),
  mapScripts: obj({
    onLoad: opt(label),
    onTransition: opt(label),
    onResume: opt(label),
    onFrame: arr(obj({ var: ref('vars'), value: int(), label })),
  }),
  events: obj({
    bgs: arr(obj({ label, kind: lit('interact', 'sign', 'hidden-item', 'other'), sourceType: opt(int(0)), x: int(), z: int(), y: num, facing: lit('up', 'down', 'left', 'right', 'horizontal', 'vertical', 'any'), hiddenItem: opt(obj({ flag: ref('flags'), range: int(0, 2), item: ref('items'), quantity: int(1, 255) })) })),
    objects: arr(
      obj({
        localId: int(0, 0xff),
        sprite: union(ref('sprites'), obj({ var: ref('vars') })),
        movementType: int(0),
        trainerType: int(0),
        hideFlag: opt(ref('flags')),
        label: opt(label),
        facing,
        data: tuple(int(), int(), int()),
        range: obj({ x: int(-1), z: int(-1) }),
        trainer: opt(obj({ id: ref('trainers'), battler: int(0, 1) })),
        cloneOf: opt(ref('zones')),
        cloneLocalId: opt(int(0, 0xff)),
        x: int(),
        z: int(),
        y: num,
      }),
    ),
    warps: arr(obj({ x: int(), z: int(), toZone: union(lit('dynamic'), ref('zones')), toWarp: int(0) })),
    coords: arr(obj({ label, x: int(), z: int(), width: int(1), length: int(1), y: num, var: ref('vars'), value: int() })),
  }),
  mapPopup: opt(obj({ label: int(0), window: ref('ui2d'), onWarp: bool })),
  follow: opt(lit('prevent', 'height-restrict', 'allow')),
  mapEvolution: opt(lit('LEVEL_MAGNETIC_FIELD', 'LEVEL_MOSS_ROCK', 'LEVEL_ICE_ROCK')),
});

const cells = (v: Record<string, unknown>) => (v.width as number) * (v.height as number);
const matrix = obj(
  {
    id,
    sourceIndex,
    width: int(1),
    height: int(1),
    chunks: arr(nullable(ref('chunks'))),
    zones: opt(arr(nullable(ref('zones')))),
    altitudes: opt(arr(int())),
    variants: opt(arr(obj({ matrix: ref('matrices'), when: arr(obj({ var: ref('vars'), value: int(), equals: bool })) }))),
  },
  (v) => {
    for (const k of ['chunks', 'zones', 'altitudes']) {
      const a = v[k] as unknown[] | undefined;
      if (a && a.length !== cells(v)) return `${k} has ${a.length} cells, expected width*height = ${cells(v)}`;
    }
    return undefined;
  },
);

const chunk = obj(
  {
    id,
    sourceIndex,
    tiles: arr(int(0, 0xffff)),
    model: ref('models'),
    props: arr(obj({ prop: ref('props'), position: vec3, rotation: vec3, scale: vec3 })),
    terrain: obj({
      points: arr(tuple(num, num)),
      normals: arr(vec3),
      constants: arr(num),
      plates: arr(obj({ p1: int(0), p2: int(0), normal: int(0), constant: int(0) })),
      strips: arr(obj({ z: num, count: int(0), start: int(0) })),
      accessList: arr(int(0)),
    }),
  },
  (v) => ((v.tiles as unknown[]).length === 1024 ? undefined : `tiles has ${(v.tiles as unknown[]).length} entries, expected 1024`),
);

const DIRS = ['up', 'down', 'left', 'right'];
const sprite = obj(
  {
    id,
    sourceIndex,
    atlas: ref('assets'),
    frameSize: int(1),
    frameCount: int(1),
    animations: dict(str(), arr(obj({ frame: int(0), ticks: int(1) }))),
  },
  (v) => {
    const anims = v.animations as Record<string, { frame: number }[]>;
    for (const d of DIRS) for (const k of [`stand-${d}`, `walk-${d}`]) if (!anims[k]) return `animations.${k} is required`;
    for (const [k, frames] of Object.entries(anims)) {
      const bad = frames.find((f) => f.frame >= (v.frameCount as number));
      if (bad) return `animations.${k} uses frame ${bad.frame}, but frameCount is ${v.frameCount as number}`;
    }
    return undefined;
  },
);

/** Model object (signposts, mailboxes): a Model id, or null while not converted. */
const modelSprite = obj({ id, sourceIndex, model: nullable(ref('models')) });

/** Billboard sprites have an atlas; anything else is a model object (contracts `Sprite`). */
const schemaFor = (registry: RegistryName, record: RegistryRecord): Schema =>
  registry === 'sprites' && !('atlas' in record) ? modelSprite : RECORD_SCHEMAS[registry];

const rgb = tuple(num, num, num);
const templateFields = {
  lights: arr(nullable(obj({ color: rgb, direction: vec3 }))),
  diffuse: rgb,
  ambient: rgb,
  specular: rgb,
  emission: rgb,
};
/** contracts `LightTemplate`: 4 lights, colours 0..1. */
const templateCheck = (v: Record<string, unknown>): string | undefined => {
  const lights = v.lights as ({ color: number[] } | null)[];
  if (lights.length !== 4) return `lights has ${lights.length} entries, expected 4`;
  const colours: [string, number[]][] = [...lights.flatMap((l, i) => (l ? [[`lights[${i}].color`, l.color] as [string, number[]]] : [])), ...['diffuse', 'ambient', 'specular', 'emission'].map((k) => [k, v[k] as number[]] as [string, number[]])];
  const bad = colours.find(([, c]) => c.some((x) => x < 0 || x > 1));
  return bad ? `${bad[0]} has a component outside 0..1` : undefined;
};
const DAY_SECONDS = 24 * 3600;
const light = obj(
  {
    id,
    sourceIndex,
    ...templateFields,
    schedule: opt(arr(obj({ until: int(0, DAY_SECONDS), ...templateFields }, templateCheck))),
    indoor: opt(bool),
  },
  (v) => {
    const schedule = v.schedule as { until: number }[] | undefined;
    if (schedule && (!schedule.length || schedule.at(-1)!.until !== DAY_SECONDS || schedule.some((t, i) => i > 0 && t.until < schedule[i - 1]!.until))) {
      return `schedule must be non-empty, in order and end at ${DAY_SECONDS} (midnight)`;
    }
    return templateCheck(v);
  },
);

const perFrame = union(arr(num), num);

/** Prop and field-effect clips by use (contracts `PropAnimation`). */
const clips = dict(str(), obj({ clip: str(), ticks: int(1), loop: opt(bool) }));

const WEATHER_PARTS = ['particles', 'fog', 'light', 'darkness', 'yearly', 'layer'];
const weather = obj(
  {
    id,
    sourceIndex,
    name: str(/^[A-Za-z0-9_]+$/),
    particles: opt(
      obj({
        kind: lit('rain', 'heavy-rain', 'thunder', 'snow', 'heavy-snow', 'blizzard', 'ash', 'sand', 'hail', 'spirits', 'diamond-dust'),
        count: int(1),
        sprites: obj(
          { image: ref('assets'), cells: arr(obj({ x: int(0), y: int(0), w: int(1), h: int(1), ox: int(), oy: int() })), frames: arr(int(0)) },
          (v) => {
            const bad = (v.frames as number[]).find((f) => f >= (v.cells as unknown[]).length);
            return bad === undefined ? undefined : `sprites.frames names cell ${bad} of ${(v.cells as unknown[]).length}`;
          },
        ),
        spawner: obj({ load: tuple(int(1), int(0)), steady: tuple(int(1), int(0)), prewarm: tuple(int(1), int(1), int(0)) }),
      }),
    ),
    fog: opt(obj({ slope: int(0, 10), offset: int(0, 0x7fff), color: rgb, alpha: int(0, 31), densities: arr(int(0, 127)) }, (v) => ((v.densities as unknown[]).length === 32 ? undefined : `fog.densities has ${(v.densities as unknown[]).length} entries, expected 32`))),
    light: opt(ref('lights')),
    darkness: opt(obj({ radius: num })),
    yearly: opt(arr(ref('weathers'))),
    layer: opt(obj({ image: ref('assets'), scroll: tuple(int(), int()), alpha: num, under: opt(bool) }, (v) => ((v.alpha as number) > 0 && (v.alpha as number) <= 1 ? undefined : `layer.alpha ${String(v.alpha)} is not in (0, 1]`))),
    fade: opt(
      obj({
        particles: opt(obj({ in: arr(num), out: arr(num) })),
        fog: opt(obj({ in: int(1), out: int(1) })),
        layer: opt(union(lit('steady'), obj({ in: int(1), out: int(1) }))),
        overlaps: opt(arr(ref('weathers'))),
      }),
    ),
    pending: opt(arr(lit(...WEATHER_PARTS))),
  },
  (v) => {
    const yearly = v.yearly as unknown[] | undefined;
    if (yearly && yearly.length !== 366) return `yearly has ${yearly.length} entries, expected 366`;
    const both = ((v.pending as string[] | undefined) ?? []).find((k) => v[k] !== undefined);
    return both ? `${both} is listed in pending but present` : undefined;
  },
);

const fieldEffect = obj(
  { id, sourceIndex, name: str(/^[A-Za-z0-9_]+$/), model: opt(ref('models')), sprite: opt(ref('sprites')), animations: opt(clips) },
  (v) => (v.model !== undefined && v.sprite !== undefined ? 'a field effect has a model or a sprite, not both' : undefined),
);

/** Slot counts of the decomp encounter tables (land 12, surf and each rod 5); a rate of 0 means no slots. */
export const ENCOUNTER_SLOTS = { land: 12, water: 5 } as const;
const slot = obj({ species: ref('species'), minLevel: int(1, 100), maxLevel: int(1, 100) }, (v) =>
  (v.minLevel as number) <= (v.maxLevel as number) ? undefined : `minLevel ${v.minLevel as number} > maxLevel ${v.maxLevel as number}`,
);
const rod = obj({ rate: int(0, 255), slots: arr(slot) });
const encounterTable = obj(
  {
    id,
    sourceIndex,
    landRate: int(0, 255),
    land: arr(slot),
    surfRate: int(0, 255),
    surf: arr(slot),
    oldRod: rod,
    goodRod: rod,
    superRod: rod,
    variants: dict(str(/^[a-z][a-zA-Z0-9]*$/), arr(obj({ slot: int(0), species: ref('species') }))),
  },
  (v) => {
    const groups: [string, number, unknown[], number][] = [
      ['land', v.landRate as number, v.land as unknown[], ENCOUNTER_SLOTS.land],
      ['surf', v.surfRate as number, v.surf as unknown[], ENCOUNTER_SLOTS.water],
      ...(['oldRod', 'goodRod', 'superRod'] as const).map((k): [string, number, unknown[], number] => {
        const r = v[k] as { rate: number; slots: unknown[] };
        return [`${k}.slots`, r.rate, r.slots, ENCOUNTER_SLOTS.water];
      }),
    ];
    for (const [name, rate, slots, n] of groups) {
      const want = rate ? n : 0;
      if (slots.length !== want) return `${name} has ${slots.length} slots, expected ${want} (rate ${rate})`;
    }
    return undefined;
  },
);

// --- Pokémon data (contracts 0.9) ---
const stats = obj(Object.fromEntries(STATS.map((s) => [s, int(0, 255)])));
const evolution = obj({ method: str(/^[A-Z][A-Z0-9_]*$/), target: ref('species'), level: opt(int(0, 100)), item: opt(ref('items')), move: opt(ref('moves')), species: opt(ref('species')), beauty: opt(int(0, 255)) });
const speciesStatsFields = {
  baseStats: stats,
  types: tuple(ref('types'), ref('types')),
  catchRate: int(0, 255),
  baseExp: int(0, 255),
  evYield: obj(Object.fromEntries(STATS.map((s) => [s, int(0, 3)]))),
  heldItems: obj({ common: nullable(ref('items')), rare: nullable(ref('items')) }),
  genderRatio: int(0, 255),
  hatchCycles: int(0, 255),
  baseFriendship: int(0, 255),
  growthRate: ref('growthRates'),
  eggGroups: tuple(id, id),
  abilities: tuple(nullable(ref('abilities')), nullable(ref('abilities'))),
  safariFleeRate: int(0, 255),
  learnset: arr(obj({ level: int(0, 100), move: ref('moves') })),
  tms: arr(ref('items')),
  tutorMoves: opt(arr(ref('moves'))),
};
const dexSize = obj({ trainerScale: int(1), trainerY: int(), pokemonScale: int(1), pokemonY: int() });
const dexSizes = obj({ male: dexSize, female: dexSize });
const dexArea = obj({ fields: arr(int(0)), dungeons: arr(int(0)) });
const speciesDex = obj({
  category: ref('texts'),
  description: ref('texts'),
  heightText: ref('texts'),
  weightText: ref('texts'),
  height: int(0),
  weight: int(0),
  shape: int(0, 13),
  footprint: nullable(ref('assets')),
  size: dexSizes,
  area: obj({ morning: dexArea, day: dexArea, night: dexArea, special: dexArea, specialNational: dexArea }),
  forms: opt(arr(obj({ form: int(1), heightText: ref('texts'), weightText: ref('texts'), height: int(0), weight: int(0), size: dexSizes }))),
});
const pokedexMap = obj({
  image: ref('ui2d'),
  origin: tuple(int(), int()),
  dungeonOrigin: tuple(int(), int()),
  cell: int(1),
  columns: int(1),
  rows: int(1),
  fields: arr(obj({ x: int(0), y: int(0), width: int(1), height: int(1), cells: arr(int(0, 1)) })),
  dungeons: arr(obj({ x: int(0), y: int(0), coronet: bool })),
  hidden: arr(obj({ var: ref('vars'), value: int(), overlay: ref('ui2d'), dungeons: arr(int(0)) })),
});
const townMap = obj({
  screen: ref('ui2d'),
  cursor: ref('ui2d'),
  player: obj({ male: ref('ui2d'), female: ref('ui2d') }),
  blocks: tuple(ref('ui2d'), ref('ui2d'), ref('ui2d'), ref('ui2d'), ref('ui2d')),
  matrix: ref('matrices'),
  everywhere: ref('zones'),
  names: arr(obj({ x: int(0, 29), z: int(0, 29), zone: ref('zones') })),
  cells: arr(obj({ x: int(0, 29), z: int(0, 29), hidden: int(0, 15) })),
  hidden: arr(obj({ var: ref('vars'), value: int(), patch: ref('ui2d'), x: int(0, 255), y: int(0, 191) })),
  flyToWhere: ref('texts'),
  locations: arr(obj({ zone: ref('zones'), flag: ref('flags'), shape: int(0, 6), palette: int(0, 1), sprite: tuple(int(0), int(0)), cell: opt(tuple(int(0, 29), int(0, 29))), spawn: int(1) })),
});
const species = obj({
  id,
  sourceIndex,
  name: str(),
  starterSlot: opt(int(0, 2)),
  regionalDex: opt(int(1)),
  dex: opt(speciesDex),
  footprintType: opt(obj({ type: int(0, 5), hasPrint: bool })),
  ...speciesStatsFields,
  evolutions: arr(evolution),
  eggMoves: arr(ref('moves')),
  eggSpecies: ref('species'),
  forms: opt(arr(obj({ form: int(1), name: str(), ...speciesStatsFields }))),
});
const move = obj({
  id,
  sourceIndex,
  name: str(),
  type: ref('types'),
  category: lit('physical', 'special', 'status'),
  power: int(0, 255),
  accuracy: int(0, 100),
  pp: int(0, 64),
  priority: int(-7, 7),
  effect: id,
  effectChance: int(0, 100),
  target: str(/^[A-Z][A-Z0-9_]*$/),
  flags: arr(str(/^[A-Z][A-Z0-9_]*$/)),
  contest: obj({ effect: int(0), type: int(0) }),
  description: ref('texts'),
});
const item = obj({
  id,
  sourceIndex,
  name: str(),
  plural: ref('texts'),
  description: ref('texts'),
  icon: ref('assets'),
  pocket: str(),
  price: int(0),
  holdEffect: str(/^[A-Z][A-Z0-9_]*$/),
  holdParam: int(0, 255),
  pluckEffect: int(0, 255),
  fling: obj({ effect: int(0, 255), power: int(0, 255) }),
  naturalGift: opt(obj({ power: int(1, 255), type: ref('types') })),
  preventToss: bool,
  canRegister: bool,
  battlePocket: int(0, 31),
  fieldUse: int(0, 255),
  battleUse: int(0, 255),
  partyUse: opt(
    obj({
      flags: arr(str(/^[a-zA-Z]+$/)),
      stages: dict(lit('attack', 'defense', 'spAttack', 'spDefense', 'speed', 'accuracy', 'crit'), int(1, 15)),
      evs: dict(lit(...STATS), int(-128, 127)),
      hp: int(0, 255),
      pp: int(0, 255),
      friendship: tuple(int(-128, 127), int(-128, 127), int(-128, 127)),
    }),
  ),
  tm: opt(ref('moves')),
});
const trainerMon = obj({
  species: ref('species'),
  form: opt(int(1)),
  level: int(1, 100),
  ivs: union(int(0, 31), obj(Object.fromEntries(STATS.map((s) => [s, int(0, 31)])))),
  pid: int(0, 0xffffffff),
  otId: int(0, 0xffffffff),
  moves: opt(arr(ref('moves'))),
  item: opt(ref('items')),
  ballSeal: int(0, 0xffff),
});
const instrumentRegion = obj(
  {
    low: int(0, 127),
    high: int(0, 127),
    type: lit('pcm', 'psg', 'noise'),
    archive: opt(int(0, 3)),
    wave: opt(int(0)),
    duty: opt(int(0, 7)),
    baseKey: int(0, 127),
    attack: int(0, 127),
    decay: int(0, 127),
    sustain: int(0, 127),
    release: int(0, 127),
    pan: int(0, 127),
  },
  (v) => {
    if ((v.low as number) > (v.high as number)) return `low key ${v.low as number} is above high key ${v.high as number}`;
    if (v.type === 'pcm' && (v.archive === undefined || v.wave === undefined)) return 'a pcm region needs archive and wave';
    if (v.type === 'psg' && v.duty === undefined) return 'a psg region needs duty';
    return undefined;
  },
);
const pocket = obj({ name: str(/^[a-z][a-z0-9_]*$/), size: int(1), max: int(1), sorted: bool });

/** contracts `distortion.ts` (0.27.18): the Distortion World's rooms and shared tables. */
const dwTile = obj({ x: int(), y: int(), z: int() });
const dwBox = obj({ x: int(), y: int(), z: int(), sizeX: int(0), sizeY: int(0), sizeZ: int(0) });
const dwProp = lit(...DW_PROP_KINDS);
const dwKind = lit(...DW_SUPPORT_KINDS);
const dwCondition = obj({ kind: lit('none', 'boulder-puzzle-false', 'boulder-puzzle-true', 'progress-eq', 'progress-leq', 'progress-geq', 'manual-add-only', 'giratina-shadow', 'cyrus-appearance'), value: int() });
const dwPlatformFlag = int(0, DW_PLATFORM_FLAGS - 1);
const dwPuzzleFlag = int(0, DW_PUZZLE_FLAGS - 1);
const dwCascade = (kind: string) => obj({ kind: lit(kind), axis: int(0), direction: int(0), finishingFix: dwTile, finalOffset: dwTile, mapLoadOffset: dwTile, step: dwTile });
const bare = (kind: string) => obj({ kind: lit(kind) });
const dwCommand = tagged('kind', {
  'set-map-object-animation': obj({ kind: lit('set-map-object-animation'), localId: int(0, 0xffff), action: str(/^[a-z0-9][a-z0-9_]*$/) }),
  'move-platform': obj({ kind: lit('move-platform'), platform: int(0), movePlayer: bool, finalOffset: dwTile, step: dwTile }),
  'add-map-object': obj({ kind: lit('add-map-object'), zone: ref('zones'), localId: int(0, 0xffff) }),
  'delete-map-object': obj({ kind: lit('delete-map-object'), localId: int(0, 0xffff) }),
  'cascade-up': dwCascade('cascade-up'),
  'cascade-down': dwCascade('cascade-down'),
  'start-script': obj({ kind: lit('start-script'), label }),
  'set-progress': obj({ kind: lit('set-progress'), progress: int(0) }),
  'show-giratina-shadow': obj({ kind: lit('show-giratina-shadow'), x: int(), y: int(), z: int(), rotation: int(), sound: int(0), scale: dwTile, step: dwTile, steps: int(0) }),
  'set-giratina-animation-flag': obj({ kind: lit('set-giratina-animation-flag'), animation: int(0) }),
  'set-puzzle-flag': obj({ kind: lit('set-puzzle-flag'), flag: dwPuzzleFlag }),
  'clear-puzzle-flag': obj({ kind: lit('clear-puzzle-flag'), flag: dwPuzzleFlag }),
  'play-giratina-arrival': bare('play-giratina-arrival'),
  'show-uxie-boulder-tutorial': bare('show-uxie-boulder-tutorial'),
  'show-azelf-boulder-tutorial': bare('show-azelf-boulder-tutorial'),
  'show-mesprit-boulder-tutorial': bare('show-mesprit-boulder-tutorial'),
  'show-giratina-room-platforms': bare('show-giratina-room-platforms'),
  'hide-giratina-room-platforms': bare('hide-giratina-room-platforms'),
});
/** 0.29.0: the berry patches' tables and the in-game trades (contracts records.ts BerryTables, NpcTrade). */
const berryTables = obj({
  berries: arr(obj({ item: ref('items'), stageHours: int(1, 255), drain: int(0, 255), baseYield: int(0, 255), sprites: obj({ growing: ref('sprites'), blooming: ref('sprites'), fruit: ref('sprites') }), flavors: tuple(int(0, 255), int(0, 255), int(0, 255), int(0, 255), int(0, 255)), smoothness: int(0, 255) })),
  patches: arr(obj({ item: ref('items'), yield: int(0, 0xffff) })),
  mulches: tuple(ref('items'), ref('items'), ref('items'), ref('items')),
  soil: ref('sprites'),
  sprout: ref('sprites'),
  moisture: tuple(ref('fieldEffects'), ref('fieldEffects'), ref('fieldEffects')),
  sprayduck: obj({ male: ref('sprites'), female: ref('sprites') }),
  searcher: opt(arr(obj({ x: int(0, 255), y: int(0, 255) }))),
}, (v) => (v.searcher && (v.searcher as unknown[]).length !== (v.patches as unknown[]).length ? 'berries.searcher must have a spot per patch' : undefined));
/** 0.31.0: the special encounters' tables (contracts records.ts SpecialEncounterTables). */
const specialEncounterTables = obj({
  honeyTrees: obj({ zones: arr(ref('zones')), prop: ref('props'), tables: arr(arr(ref('species'))), label }, (v) =>
    (v.zones as unknown[]).length !== 21 ? 'honeyTrees.zones must have the 21 trees' : (v.tables as unknown[][]).length !== 3 || (v.tables as unknown[][]).some((t) => t.length !== 6) ? 'honeyTrees.tables must be 3 tables of 6 species' : undefined),
  swarms: arr(ref('zones')),
  trophyGarden: obj({ zone: ref('zones'), species: arr(ref('species')) }),
  pokeRadar: obj({ labels: obj({ noCharge: label, quiet: label }), bgm: ref('sequences'), effects: obj({ soft: ref('fieldEffects'), hard: ref('fieldEffects'), shiny: ref('fieldEffects') }) }),
  sweetScent: obj({ labels: obj({ faded: label, nothing: label }), sound: ref('sequences') }),
}, (v) => ((v.swarms as unknown[]).length !== 22 ? 'swarms must have the 22 swarm zones' : (v.trophyGarden as { species: unknown[] }).species.length !== 16 ? 'trophyGarden.species must have 16 species' : undefined));
/** contracts `FrontierTables` (0.34.0; 0.37.0 the Factory's and the Hall's). */
const frontierSet = obj({ species: ref('species'), form: int(0, 31), moves: arr(ref('moves')), evFlags: int(0, 63), nature: ref('natures'), item: nullable(ref('items')) });
const factoryPool = obj({ trainerMax: int(0), setMin: int(0), setMax: int(0), ivs: int(0, 31), upgradable: bool });
const frontierRoom = nullable(obj({ sheet: ref('ui2d'), width: int(256, 512), height: int(256, 512) }));
const castleRental = obj({ item: ref('items'), cp: int(0, 0xffff) });
const frontierTables = obj({
  scenes: arr(nullable(obj({ entry: str(/^[a-z][a-z0-9_-]*:[A-Za-z0-9_]+\/0$/), textBank: ref('textBanks'), bgm: nullable(ref('sequences')), bg: frontierRoom, fg: frontierRoom, setup: bool, fgFixed: opt(bool) }))),
  trainers: arr(obj({ class: id, className: ref('texts'), name: ref('texts'), sets: arr(int(0)) })),
  sets: arr(frontierSet),
  trainerMessages: ref('textBanks'),
  tower: obj({
    ranges: arr(tuple(int(0), int(0))),
    bossRanges: arr(tuple(int(0), int(0))),
    palmer: tuple(int(0), int(0)),
    partners: int(0),
    reservedItems: arr(ref('items')),
    battlePoints: arr(int(0, 255)),
    palmerBattlePoints: int(0, 255),
    classObjects: arr(obj({ class: id, gfx: int(0, 0xffff) })),
    defaultObject: int(0, 0xffff),
  }, (v) => ((v.ranges as unknown[]).length !== 8 || (v.bossRanges as unknown[]).length !== 8 || (v.battlePoints as unknown[]).length !== 8 ? 'frontier.tower: the ranges and BP need a row per room 0–7' : undefined)),
  factory: obj({
    opponentRanges: arr(tuple(int(0), int(0), int(0), int(0))),
    level50Pools: arr(factoryPool),
    openOpponentPools: arr(factoryPool),
    openPlayerPools: arr(factoryPool),
    tradeUpgrades: arr(int(0)),
    battlePoints: arr(int(0, 255)),
    thorton: tuple(int(0), int(0)),
    art: nullable(obj({ wheel: arr(ref('ui2d')), conveyor: ref('ui2d'), selection: ref('ui2d'), noScreens: ref('ui2d'), summary: ref('ui2d'), sprites: ref('ui2d'), unpicked: ref('ui2d') })),
  }, (v) => ((v.opponentRanges as unknown[]).length !== 8 || (v.battlePoints as unknown[]).length !== 9 ? 'frontier.factory: 8 opponent ranges and 9 BP rows' : undefined)),
  hall: obj({
    sets: arr(frontierSet),
    opponents: arr(ref('species')),
    opponentTypes: arr(tuple(ref('types'), ref('types'))),
    rankRanges: arr(tuple(int(1), int(1))),
    groupRanges: arr(tuple(int(1), int(1))),
    ivs: arr(int(0, 31)),
    trainerClasses: arr(id),
    classesByRank: arr(arr(id)),
    classesByCell: arr(arr(id)),
    grid: arr(str(/^(summary|[a-z][a-z0-9_-]*:TYPE_[A-Z]+)$/)),
    battlePoints: arr(int(0, 255)),
    milestones: arr(obj({ record: int(1), bp: int(0) })),
    argenta: tuple(int(0), int(0)),
    art: nullable(obj({ board: obj({ normal: ref('ui2d'), selected: ref('ui2d'), unselectable: ref('ui2d') }), cursor: ref('ui2d') })),
  }, (v) => {
    const h = v as { sets: unknown[]; opponents: unknown[]; opponentTypes: unknown[]; rankRanges: unknown[]; ivs: unknown[]; classesByRank: unknown[]; classesByCell: unknown[]; grid: unknown[]; battlePoints: unknown[] };
    if (h.opponents.length !== h.opponentTypes.length || h.sets.length !== h.opponents.length + 1) return 'frontier.hall: an opponent and its types per set after set 0';
    if (h.rankRanges.length !== 10 || h.ivs.length !== 10 || h.classesByRank.length !== 10) return 'frontier.hall: rank ranges, IVs and classes for ranks 0–9';
    return h.classesByCell.length !== 18 || h.grid.length !== 20 || h.battlePoints.length !== 19 ? 'frontier.hall: 18 cells of classes, a 20-cell grid, 19 BP rows' : undefined;
  }),
  castle: obj({
    opponentRanges: arr(tuple(int(0), int(0), int(0), int(0))),
    battlePoints: arr(int(0, 255)),
    darach: tuple(int(0), int(0)),
    items: arr(castleRental),
    berries: arr(castleRental),
    itemsByRank: arr(int(0)),
    berriesByRank: arr(int(0)),
    healCosts: arr(int(0, 0xffff)),
    rankUpCosts: arr(arr(int(0, 0xffff))),
    art: nullable(obj({ self: obj({ main: ref('ui2d'), items: ref('ui2d'), summary: ref('ui2d'), moves: ref('ui2d') }), opponent: obj({ main: ref('ui2d'), summary: ref('ui2d'), moves: ref('ui2d') }), sprites: ref('ui2d'), emblems: arr(ref('ui2d')) })),
  }, (v) => {
    const c = v as { opponentRanges: unknown[]; battlePoints: unknown[]; items: unknown[]; berries: unknown[]; itemsByRank: number[]; berriesByRank: number[]; healCosts: unknown[]; rankUpCosts: unknown[][] };
    if (c.opponentRanges.length !== 8 || c.battlePoints.length !== 9) return 'frontier.castle: 8 opponent ranges and 9 BP rows';
    if (c.itemsByRank.length !== 3 || c.berriesByRank.length !== 3 || c.itemsByRank.some((n) => n > c.items.length) || c.berriesByRank.some((n) => n > c.berries.length)) return 'frontier.castle: a rental count per rank 1–3, within the lists';
    return c.healCosts.length !== 3 || c.rankUpCosts.length !== 3 || c.rankUpCosts.some((r) => r.length !== 3) ? 'frontier.castle: 3 heal costs and 3 × 3 rank-up costs' : undefined;
  }),
  arcade: obj({
    opponentRanges: arr(tuple(int(0), int(0), int(0), int(0))),
    battlePoints: arr(int(0, 255)),
    dahlia: tuple(int(0), int(0)),
    rouletteSpeeds: arr(obj({ round: int(0, 255), speed: int(0, 7) })),
    cursorTicks: arr(int(0, 255)),
    effectsByRound: arr(int(0, 127)),
    effectsByBattle: arr(int(0, 127)),
    categoryWeights: arr(arr(int(0, 100))),
    categoryThresholds: arr(int(0, 255)),
    performance: obj({ status: arr(int(0, 255)), fainted: arr(int(0, 255)), turns: arr(obj({ turns: int(0, 255), score: int(0, 255) })) }),
    itemPools: arr(arr(ref('items'))),
    berryPools: arr(arr(ref('items'))),
    art: nullable(obj({ initial: ref('ui2d'), roulette: ref('ui2d'), sprites: ref('ui2d'), button: ref('ui2d'), screens: arr(ref('ui2d')) })),
  }, (v) => {
    const a = v as { opponentRanges: unknown[]; battlePoints: unknown[]; cursorTicks: unknown[]; effectsByRound: unknown[]; effectsByBattle: unknown[]; categoryWeights: number[][]; categoryThresholds: unknown[]; itemPools: unknown[]; berryPools: unknown[]; art: { screens: unknown[] } | null };
    if (a.opponentRanges.length !== 8 || a.battlePoints.length !== 9) return 'frontier.arcade: 8 opponent ranges and 9 BP rows';
    if (a.cursorTicks.length !== 8 || a.effectsByRound.length !== 32 || a.effectsByBattle.length !== 7) return 'frontier.arcade: 8 speeds, 32 effects, 7 battle-gated effects';
    if (a.categoryWeights.length !== a.categoryThresholds.length + 1 || a.categoryWeights.some((w) => w.length !== 4 || w.reduce((x, y) => x + y, 0) !== 100)) return 'frontier.arcade: a tier per threshold and one more, each 4 weights of 100';
    if (a.itemPools.length !== 3 || a.berryPools.length !== 3) return 'frontier.arcade: 3 item and 3 berry pools';
    return a.art && a.art.screens.length !== 32 ? 'frontier.arcade.art: a screen per effect' : undefined;
  }),
  characters: dict(str(/^\d+$/), ref('ui2d')),
  objects: dict(str(/^\d+$/), ref('ui2d')),
  shadow: ref('ui2d'),
  effects: opt(
    obj({
      brains: obj(Object.fromEntries(['tower', 'factory', 'castle', 'hall', 'arcade'].map((f) => [f, obj({ banner: arr(ref('ui2d')), mugshot: ref('ui2d'), name: ref('texts') })]))),
      vs: ref('ui2d'),
      nameColors: obj({ fg: str(/^#[0-9a-f]{6}$/), shadow: str(/^#[0-9a-f]{6}$/) }),
      factoryDoorLights: arr(ref('ui2d')),
      hallLights: ref('ui2d'),
    }),
  ),
  recordsArt: opt(ref('ui2d')),
  banlist: arr(ref('species')),
  prices: arr(obj({ item: ref('items'), bp: int(1, 0xffff) })),
  judgeMessages: arr(ref('texts')),
}, (v) => {
  const t = v as { trainers: { sets: number[] }[]; sets: unknown[]; judgeMessages: unknown[] };
  if (t.trainers.some((x) => x.sets.some((s) => s >= t.sets.length))) return 'frontier.trainers name a set past frontier.sets';
  return t.judgeMessages.length !== 6 ? 'frontier.judgeMessages must have a message per stat' : undefined;
});
/** 0.33.0: the Underground's tables (contracts underground.ts UndergroundTables). */
const spherePrice = obj({ sphere: int(0, 6), min: int(0, 255), max: int(0, 255) }, (v) => ((v.min as number) > (v.max as number) ? 'a sphere price runs backwards' : undefined));
const undergroundTables = obj({
  zone: ref('zones'),
  miningObjects: arr(obj({
    id: int(1, 66),
    weights: tuple(int(0, 0xffff), int(0, 0xffff), int(0, 0xffff), int(0, 0xffff)),
    width: int(1, 13),
    height: int(1, 10),
    shape: nullable(str()),
    sprite: int(0, 0xffff),
    palette: int(0, 0xffff),
  }, (v) => (v.shape !== null && (v.shape as string).length !== (v.width as number) * (v.height as number) ? 'a mining shape must have width × height cells' : undefined))),
  treasureItems: arr(ref('items')),
  fossils: arr(obj({ item: ref('items'), species: ref('species') })),
  trapPrices: arr(spherePrice),
  treasurePrices: arr(spherePrice),
  goods: arr(obj({ price: spherePrice, natDex: bool, width: int(0, 3), depth: int(0, 3), collision: arr(int(0, 1)), interact: int(0, 255), prop: nullable(ref('props')) }, (v) => ((v.collision as unknown[]).length !== 9 ? 'a good\'s collision mask must be 3 × 3' : undefined))),
  vendors: arr(obj({ kind: lit('goods', 'traps', 'treasures'), x: int(0, 0xffff), z: int(0, 0xffff) })),
  spawnTraps: arr(int(1, 32)),
  flags: obj({ entered: ref('flags'), digging: ref('flags'), sphereAcquired: ref('flags') }),
  vars: obj({ fossilsUnearthed: ref('vars'), spiritomb: ref('vars') }),
  sparkle: ref('fieldEffects'),
  // 0.37.0: traps and the secret base.
  traps: obj({
    smoke: arr(arr(int(0, 0xffff))),
    bigSmoke: arr(int(0, 0xffff)),
    marks: arr(ref('fieldEffects')),
    hole: ref('fieldEffects'),
    // 0.45.0: the '!' and OK over a trapped player.
    emotes: obj({ exclamation: ref('fieldEffects'), ok: ref('fieldEffects') }),
    vars: obj({ trapsSet: ref('vars') }),
  }, (v) => ([...(v.smoke as unknown[][]), v.bigSmoke as unknown[]].some((p) => p.length !== 32 * 24) ? 'a smoke pattern must have 32 × 24 tiles' : (v.marks as unknown[]).length !== 32 ? 'traps.marks must have the 32 trap ids' : undefined)),
  base: obj({ cursor: nullable(ref('models')), flags: obj({ created: ref('flags'), decorated: ref('flags') }) }),
}, (v) => ((v.goods as unknown[]).length !== 139 ? 'goods must have the 139 goods' : (v.treasureItems as unknown[]).length !== 49 ? 'treasureItems must have the 49 treasures' : (v.trapPrices as unknown[]).length !== 34 ? 'trapPrices must have the 34 traps' : (v.treasurePrices as unknown[]).length !== 60 ? 'treasurePrices must have the 60 mining ids' : undefined));
/** 0.37.0: the Game Corner's tables (contracts slots.ts SlotTables); sizes and ranges the slot model indexes are checked. */
const pct = int(0, 100);
const byMode = (row: Schema) => arr(row);
const slotTables = obj({
  modes: arr(int(0, 5)),
  reels: arr(arr(int(0, 5))),
  payouts: arr(int(0, 0xffff)),
  bonusPayouts: arr(int(0, 0xffff)),
  winChance: byMode(pct),
  winFlags: byMode(arr(pct)),
  hintChance: byMode(pct),
  standbySmall: byMode(pct),
  standbyFlags: byMode(arr(pct)),
  bonusTypes: byMode(arr(obj({ chance: pct, type: int(0, 5), class: int(0, 2) }))),
  continueStart: arr(pct),
  clefairyKinds: byMode(arr(arr(obj({ chance: pct, kind: int(0, 2) })))),
  redMoon: byMode(pct),
  blueMoon: byMode(pct),
  continueDrop: byMode(arr(pct)),
  endTells: byMode(arr(obj({ min: pct, a: pct, b: pct }))),
  bonusOrders: arr(obj({ buttons: arr(lit('y', 'b', 'a')), clefairy: arr(int(5, 7)) })),
  lightShow: arr(obj({ mask: int(0, 0x7f), from: num, to: num, step: num })),
  stopButtons: arr(obj({ x: int(0, 31), y: int(0, 23) })),
  linePalettes: arr(int(0, 15)),
  lineFlash: arr(arr(obj({ x: num, y: num }))),
  messageWindow: obj({ x: int(0, 31), y: int(0, 23), width: int(1, 32), height: int(1, 24) }),
  prizes: arr(obj({ item: ref('items'), price: int(0, 0xffff) })),
  messages: arr(ref('texts')),
  streakVar: ref('vars'),
}, (v) => {
  const t = v as unknown as import('@opensinnoh/contracts').SlotTables;
  if (t.modes.length !== 12) return 'slots.modes must have the 12 machines';
  if (t.reels.length !== 3 || t.reels.some((r) => r.length !== 21)) return 'slots.reels must be 3 strips of 21';
  if (t.payouts.length !== 6 || t.bonusPayouts.length !== 6 || t.continueStart.length !== 6) return 'slots payouts and continue chances are by symbol or type (6)';
  const modes = [t.winChance, t.winFlags, t.hintChance, t.standbySmall, t.standbyFlags, t.bonusTypes, t.clefairyKinds, t.redMoon, t.blueMoon, t.continueDrop, t.endTells];
  if (modes.some((m) => m.length !== 6)) return 'slots tables by mode must have the 6 modes';
  if (t.winFlags.some((r) => r.length !== 7) || t.standbyFlags.some((r) => r.length !== 4) || t.continueDrop.some((r) => r.length !== 2)) return 'slots flag tables have 7, 4 and 2 columns';
  if (t.bonusTypes.some((r) => r.length !== 6) || t.clefairyKinds.some((m) => m.length !== 3 || m.some((c) => c.length !== 3)) || t.endTells.some((r) => r.length !== 9 || r.at(-1)!.min !== 0)) return 'slots bonus tables: 6 types, 3 × 3 Clefairy kinds, 9 tells ending at 0';
  if (t.bonusOrders.length !== 6 || t.bonusOrders.some((o) => new Set(o.buttons).size !== 3 || o.clefairy.length !== 3)) return 'slots.bonusOrders must be the 6 stop orders';
  if (t.stopButtons.length !== 3 || t.linePalettes.length !== 5 || t.lineFlash.length !== 5 || t.lineFlash.some((l) => l.length !== 3)) return 'slots presentation tables: 3 stop buttons, 5 lines × 3 reels';
  if (!t.lightShow.length || t.lightShow.at(-1)!.mask !== 0x40) return 'slots.lightShow must end with its restart';
  if (t.messages.length !== 3) return 'slots.messages must be the 3 slot messages';
  return undefined;
});
const npcTrade = obj({
  species: ref('species'),
  requested: ref('species'),
  pid: int(0, 0xffffffff),
  otId: int(0, 0xffffffff),
  otName: str(),
  otGender: lit('male', 'female'),
  nickname: str(),
  ivs: obj(Object.fromEntries(STATS.map((s) => [s, int(0, 31)]))),
  heldItem: nullable(ref('items')),
  language: int(1, 8),
  condition: obj({ cool: int(0, 255), beauty: int(0, 255), cute: int(0, 255), smart: int(0, 255), tough: int(0, 255) }),
});
const distortionWorld = obj(
  {
    warp: opt(shipScene),
    elevatorPaths: arr(obj({ next: nullable(int(0)), finalOffset: dwTile, changeMapsOffset: dwTile, step: dwTile, setFlag: nullable(dwPlatformFlag), clearFlag: nullable(dwPlatformFlag) })),
    cascadeUp: arr(dwCommand),
    cascadeDown: arr(dwCommand),
    props: obj(Object.fromEntries(DW_PROP_KINDS.map((k) => [k, obj({ model: ref('models'), offset: tuple(num, num, num), clip: nullable(obj({ name: str(), frames: int(1) })) })]))),
    sky: obj({ background: ref('assets'), clouds: arr(obj({ image: ref('assets'), originX: int(0), originY: int(0) })) }),
    playerSprite: obj({ male: ref('sprites'), female: ref('sprites') }),
    playerSurfSprite: obj({ male: ref('sprites'), female: ref('sprites') }),
  },
  (v) => {
    const paths = v.elevatorPaths as { next: number | null }[];
    const bad = paths.findIndex((p, i) => p.next !== null && (p.next === i || p.next >= paths.length));
    return bad >= 0 ? `elevator path ${bad} continues into ${paths[bad]!.next}` : undefined;
  },
);
const distortionRoom = obj(
  {
    id: ref('zones'),
    offset: obj({ x: int(), altitude: int(), z: int() }),
    previous: nullable(ref('zones')),
    next: nullable(ref('zones')),
    supports: arr(
      obj({ kind: dwKind, box: dwBox, vertical: int(1), horizontal: int(1), cells: arr(int(0, 0xffff)) }, (v) =>
        (v.cells as unknown[]).length === (v.vertical as number) * (v.horizontal as number) ? undefined : 'cells must hold vertical × horizontal entries',
      ),
    ),
    jumps: arr(obj({ facing, box: dwBox, displacement: dwTile, spriteRotation: int(), steps: int(1), axis: lit('x', 'y', 'z'), inverted: bool, finalFacing: facing, to: union(dwKind, lit('land')), support: nullable(int(0)) })),
    cameraRows: arr(obj({ box: dwBox, facing, angle: dwTile, steps: int(0) })),
    ghosts: nullable(
      obj({
        visible: int(0, 0xffffff),
        props: arr(obj({ group: int(0, 23), prop: dwProp, x: int(), y: int(), z: int() })),
        triggers: arr(obj({ group: int(0, 23), facing, show: bool, box: dwBox })),
      }),
    ),
    movingPlatforms: arr(obj({ index: int(0), x: int(), y: int(), z: int(), elevator: nullable(obj({ path: int(0), direction: lit('up', 'down', 'none') })), destination: int(0), prop: dwProp, flag: nullable(dwPlatformFlag) })),
    events: arr(obj({ x: int(), y: int(), z: int(), when: dwCondition, commands: arr(dwCommand) })),
    props: arr(obj({ prop: dwProp, x: int(), y: int(), z: int(), when: dwCondition })),
    objects: arr(
      obj({
        localId: int(0, 0xffff),
        sprite: ref('sprites'),
        movementType: int(0),
        trainerType: int(0),
        hideFlag: opt(ref('flags')),
        label: opt(label),
        facing,
        data: tuple(int(), int(), int()),
        range: obj({ x: int(-1), z: int(-1) }),
        x: int(),
        z: int(),
        y: num,
        when: dwCondition,
        rotation: nullable(int()),
      }),
    ),
  },
  (v) => {
    const supports = v.supports as { kind: string }[];
    const jump = (v.jumps as { to: string; support: number | null }[]).find((j) => (j.to === 'land' ? j.support !== null : supports[j.support ?? -1]?.kind !== j.to));
    return jump ? `a jump lands on ${jump.to} support ${jump.support} (${supports.length} supports)` : undefined;
  },
);

export const RECORD_SCHEMAS: Record<RegistryName, Schema> = {
  zones: zone,
  matrices: matrix,
  chunks: chunk,
  areas: obj({ id, sourceIndex, light: ref('lights'), mapTextures: opt(ref('assets')), propTextures: opt(ref('assets')) }),
  lights: light,
  weathers: weather,
  fieldEffects: fieldEffect,
  encounters: encounterTable,
  tileBehaviors: obj({
    id,
    sourceIndex: int(0, 0xff),
    name: str(/^[A-Za-z0-9_]+$/),
    interact: opt(obj({ label, facing: lit('up', 'down', 'left', 'right', 'any') })),
    fieldMove: opt(obj({ move: id, label })),
  }),
  props: obj({ id, sourceIndex, model: ref('models'), animations: opt(clips), doorSounds: opt(obj({ open: int(0), close: int(0) })) }),
  models: obj({ id, gltf: ref('assets'), animations: opt(arr(ref('textureAnimations'))) }),
  textureAnimations: tagged('kind', {
    frames: obj({ id, kind: lit('frames'), texture: str(), frames: arr(obj({ texture: str(), ticks: int(1) })) }),
    scroll: obj({ id, kind: lit('scroll'), material: str(), frames: int(1), translateS: perFrame, translateT: perFrame }),
  }),
  cameras: obj({ id, sourceIndex, distance: num, angle: vec3, projection: lit('perspective', 'orthographic'), fovY: num, near: num, far: num }),
  sprites: sprite,
  followers: obj({
    id,
    species: ref('species'),
    form: int(0),
    gender: opt(lit('female')),
    sprite: ref('sprites'),
    shiny: opt(ref('sprites')),
    size: lit('small', 'large'),
    animation: lit('walk', 'loop'),
  }),
  followerTalk: obj({
    id,
    rules: arr(obj({ interaction: int(1), chance: int(0, 100), hp: int(0, 5), status: int(0, 8), friendship: int(0, 10), mood: int(0, 10), type: int(0, 17), behavior: int(0, 255), hiddenItems: int(0, 7), facing: int(0, 4) })),
    interactions: arr(obj({ id: int(1), steps: arr(obj({ motion: int(0), emote: int(0, 14), message: int(0), cry: lit(0, 1, 2), wait: int(0, 255) })), mood: int(-127, 127) })),
    motions: arr(obj({ id: int(1), frames: arr(obj({ facing: nullable(facing), ticks: int(0, 255), dx: int(-128, 127), dy: int(-128, 127), dz: int(-128, 127), sound: bool })) })),
    messages: arr(obj({ id: int(0), text: str() })),
    emotes: arr(ref('sprites')),
    emoteFrames: arr(obj({ frame: int(0), ticks: int(0, 255) })),
  }),
  movements: obj({ id, steps: arr(obj({ op: str(/^[a-z0-9][a-z0-9_]*$/), count: int(1) })) }),
  texts: obj({ id, text: str() }, (v) => {
    try {
      parseTextMarkup(v.text as string);
      return undefined;
    } catch (e) {
      return (e as Error).message;
    }
  }),
  textBanks: obj({ id, sourceIndex, messages: arr(ref('texts')) }),
  flags: obj({ id, sourceIndex, initial: bool, scope: lit('saved', 'map') }),
  vars: obj({ id, sourceIndex, initial: int(0, 0xffff), scope: lit('saved', 'map', 'temp') }),
  species,
  moves: move,
  abilities: obj({ id, sourceIndex, name: str(), description: ref('texts') }),
  types: obj({ id, sourceIndex, name: str(), matchups: arr(obj({ type: ref('types'), multiplier: lit(0, 5, 20), foresight: bool })) }),
  natures: obj({ id, sourceIndex, name: str(), up: nullable(lit(...STATS)), down: nullable(lit(...STATS)) }),
  growthRates: obj({ id, sourceIndex, exp: arr(int(0)) }, (v) => {
    const exp = v.exp as number[];
    if (exp.length !== 101) return `exp has ${exp.length} levels, expected 101 (0..100)`;
    return exp.some((e, i) => i > 0 && e < exp[i - 1]!) ? 'exp must not decrease' : undefined;
  }),
  items: item,
  marts: obj({ id, sourceIndex, items: arr(obj({ item: ref('items'), minBadges: int(0) })) }),
  trainers: obj({
    rematches: opt(arr(nullable(ref('trainers')))),
    id,
    sourceIndex,
    name: str(),
    class: id,
    gender: lit('male', 'female', 'none'),
    double: bool,
    party: arr(trainerMon),
    items: arr(ref('items')),
    ai: int(0),
    classPrize: int(0, 255),
    encounterBgm: opt(ref('sequences')),
    className: ref('texts'),
    messages: dict(str(/^[a-z][a-zA-Z0-9]*$/), ref('texts')),
  }, (v) => {
    const row = v.rematches as (string | null)[] | undefined;
    return row && (row.length < 1 || row.length > 6 || row[0] !== v.id || row.at(-1) === null) ? 'rematches must have 1–6 tiers, begin with this trainer and end with a populated tier' : undefined;
  }),
  fonts: obj(
    { id, atlas: ref('assets'), cellWidth: int(1), cellHeight: int(1), chars: str(), widths: arr(int(0)) },
    (v) => ([...(v.chars as string)].length === (v.widths as unknown[]).length ? undefined : 'widths must have one entry per char'),
  ),
  newGame: obj({
    sizeIntervals: opt(arr(obj({ base: int(0), divisor: int(1), start: int(0, 65535) }))),
    id,
    zone: ref('zones'),
    x: int(),
    z: int(),
    facing,
    money: int(0),
    label: opt(label),
    names: obj({ player: str(), rival: str() }),
    gender: lit('male', 'female'),
    language: opt(int(1, 8)),
    playerSprite: obj({ male: ref('sprites'), female: ref('sprites') }),
    playerHealSprite: opt(obj({ male: ref('sprites'), female: ref('sprites') })),
    playerVsSeekerSprite: opt(obj({ male: ref('sprites'), female: ref('sprites') })),
    playerCycleSprite: obj({ male: ref('sprites'), female: ref('sprites') }),
    playerSurfSprite: obj({ male: ref('sprites'), female: ref('sprites') }),
    platformLiftProps: opt(obj({ ironIsland: ref('props'), pokemonLeague: ref('props') })),
    containment: opt(obj({ prop: ref('props'), loopFrames: int(1), openingFrames: int(1) })),
    spearPillar: opt(obj({ models: dict(str(), shipScene), backgrounds: dict(str(), ref('assets')), messages: arr(ref('texts')) })),
    boat: opt(obj({ ship: ref('props'), bridges: tuple(ref('props'), ref('props')), cinematicFrames: arr(int(1)), snowpointShip: opt(ref('props')), scenes: opt(arr(shipScene)) })),
    messageFont: ref('fonts'),
    unownFont: opt(ref('fonts')),
    trainerApproach: opt(label),
    exclamationSprite: opt(ref('sprites')),
    doubleExclamationSprite: opt(ref('sprites')),
    pockets: arr(pocket),
    boxNames: arr(ref('texts')),
    pokeBall: ref('items'),
    premierBall: opt(ref('items')),
    healMachine: opt(obj({ machine: ref('props'), ball: ref('props'), hallOfFame: opt(ref('props')), screen: opt(ref('props')) })),
    creditsRide: opt(obj({ models: tuple(...Array.from({ length: 7 }, () => ref('models'))), rows: tuple(creditsRows, creditsRows, creditsRows), nightTrees: arr(int(0, 1)) })),
    pokedexMap: opt(pokedexMap),
    townMap: opt(townMap),
    flyDestinations: opt(arr(obj({ zone: ref('zones'), x: int(0), z: int(0) }))),
    pokedexUnknown: opt(obj({ category: ref('texts'), height: ref('texts'), weight: ref('texts') })),
    repelWoreOff: label,
    hatchEgg: label,
    ribbons: opt(arr(obj({ name: ref('texts'), description: ref('texts') }))),
    credits: opt(arr(obj({ text: ref('texts'), y: int(0, 0xffff), centered: bool }))),
    gameRecords: obj(
      { scoreIncrements: arr(int(0, TRAINER_SCORE_MAX)), highLimit: arr(bool) },
      (v) =>
        (v.highLimit as unknown[]).length !== GAME_RECORDS.count ? `highLimit has ${(v.highLimit as unknown[]).length} records (${GAME_RECORDS.count})`
        : (v.scoreIncrements as unknown[]).length !== GAME_RECORDS.scoreEvents ? `scoreIncrements has ${(v.scoreIncrements as unknown[]).length} events (${GAME_RECORDS.scoreEvents})`
        : undefined,
    ),
    gyms: opt(gyms),
    distortionWorld: opt(distortionWorld),
    berries: opt(berryTables),
    specialEncounters: opt(specialEncounterTables),
    frontier: opt(frontierTables),
    underground: opt(undergroundTables),
    moveTutors: opt(obj({ shards: tuple(ref('items'), ref('items'), ref('items'), ref('items')), moves: arr(obj({ move: ref('moves'), cost: tuple(int(0, 255), int(0, 255), int(0, 255), int(0, 255)), location: int(0, 2) })) })),
    npcTrades: opt(arr(npcTrade)),
    greatMarsh: opt(obj({
      zones: arr(ref('zones')),
      flag: ref('flags'),
      daily: obj({ regional: arr(ref('species')), national: arr(ref('species')) }),
      lookout: arr(obj({ x: int(0, 0xffff), z: int(0, 0xffff) })),
      labels: obj({ outOfSteps: label, outOfBalls: label, outOfBallsBattle: label, retire: label, noRoom: label }),
      tram: opt(ref('props')),
    }, (v) => ((v.zones as unknown[]).length !== 6 ? 'greatMarsh.zones must have the 6 areas' : (v.daily as { regional: unknown[]; national: unknown[] }).regional.length !== 32 || (v.daily as { national: unknown[] }).national.length !== 32 ? 'greatMarsh.daily tables must have 32 species' : undefined))),
    contestHallFlag: opt(ref('flags')),
    slots: opt(slotTables),
    // 0.35.0: the Super Contests' tables (contracts ContestTables).
    contests: opt(obj({
      opponents: arr(obj({
        species: ref('species'),
        moves: arr(ref('moves')),
        nickname: ref('texts'),
        trainerName: ref('texts'),
        condition: obj({ cool: int(0, 255), beauty: int(0, 255), cute: int(0, 255), smart: int(0, 255), tough: int(0, 255), sheen: int(0, 255) }),
        rank: int(0, 3),
        types: arr(int(0, 4)),
        practice: bool,
        single: bool,
        pool: int(0, 3),
        gender: lit('male', 'female'),
        aiLevel: int(0, 3),
        gfx: int(0, 0xffff),
        trainerClass: int(0, 0xffff),
        fame: int(0, 255),
        dressUps: arr(int(0)),
      })),
      judges: arr(obj({ name: ref('texts'), rank: int(0, 3), roles: arr(int(0, 3)) })),
      dressUps: arr(obj({ accessories: arr(obj({ accessory: int(0, 99), x: int(0, 255), y: int(0, 255), priority: int(-128, 127) })), monPriority: int(-128, 127), backdrop: int(0, 17) })),
      themes: arr(arr(int(0, 255))),
      playerGfx: obj({ male: int(0, 0xffff), female: int(0, 0xffff) }),
      playerSprite: obj({ male: ref('sprites'), female: ref('sprites') }),
      // 0.36.2: the acting round's tables (contracts ContestActingTables).
      acting: opt(obj({
        effects: arr(obj({
          description: arr(ref('texts')),
          appeal: int(-128, 127),
          class: int(3, 6),
          announce: bool,
          messages: arr(nullable(obj({ text: ref('texts'), args: int(0, 28) }))),
        })),
        typeMatch: arr(arr(int(-10, 10))),
        messages: arr(obj({ text: ref('texts'), args: int(0, 28), instant: opt(bool) })),
        rules: arr(obj({ slot: int(1, 4), condition: int(1, 28), target: int(0, 255), judges: int(0, 3), weights: arr(int(-0x8000, 0x7fff)) })),
        buttonPalettes: arr(arr(int(0, 0xffff))),
      }, (v) => ((v.effects as unknown[]).length !== 24 ? 'contests.acting.effects must have the 24 effects' : (v.typeMatch as unknown[]).length !== 5 ? 'contests.acting.typeMatch must be 5 × 5' : undefined))),
      // 0.35.2: the Dance Competition's tables (contracts ContestDanceTables).
      dance: obj({
        songs: arr(obj({ sequence: ref('sequences'), bpm: int(1, 0xffff), measures: int(1, 255), moves: int(1, 8), leadIn: int(0, 255), gap: int(0, 255), windows: arr(int(0, 255)) }, (v) => ((v.windows as unknown[]).length !== 4 ? 'a dance song has 4 grading windows' : undefined))),
        choice: arr(arr(obj({ song: int(0), variant: int(0) }))),
        variants: arr(obj({ tilemap: int(0, 0xffff), beats: int(1, 255), tiles: int(1, 32) })),
        aiJitter: arr(int(0, 255)),
        aiRepeat: arr(int(0, 100)),
        stage: arr(obj({ x: int(-0x8000, 0x7fff), y: int(-0x8000, 0x7fff), z: int(-0x8000, 0x7fff) })),
        grades: arr(obj({ x: int(-0x8000, 0x7fff), y: int(-0x8000, 0x7fff) })),
        noteRows: arr(int(0, 255)),
        tints: arr(obj({ color: int(0, 0x7fff), level: int(0, 16) })),
        shades: arr(int(0, 16)),
        buttons: arr(obj({ x: int(0, 255), y: int(0, 255), w: int(1, 256), h: int(1, 256) })),
      }, (v) => {
        const d = v as { songs: unknown[]; variants: unknown[]; choice: { song: number; variant: number }[][]; aiJitter: unknown[]; aiRepeat: unknown[]; stage: unknown[]; grades: unknown[]; noteRows: unknown[]; tints: unknown[]; buttons: unknown[] };
        if (d.choice.length !== 4 || d.choice.some((r) => r.length !== 5)) return 'contests.dance.choice is 4 ranks × 5 types';
        if (d.choice.flat().some((c) => c.song >= d.songs.length || c.variant >= d.variants.length)) return 'contests.dance.choice names a song or variant it lacks';
        if ([d.aiJitter, d.aiRepeat, d.stage, d.grades, d.noteRows, d.buttons].some((a) => a.length !== 4)) return 'contests.dance has 4 AI levels, ranks, stage places and buttons';
        if (d.tints.length !== 6) return 'contests.dance.tints has 6 tints';
        return undefined;
      }),
      // 0.35.1: the accessories' pictures (sizes and masks) for the visual round.
      accessories: arr(obj({ width: lit(16, 32, 64), height: lit(16, 32, 64), mask: str() })),
    }, (v) => ((v.themes as unknown[]).length !== 12 ? 'contests.themes must have the 12 themes' : (v.accessories as unknown[]).length !== 100 ? 'contests.accessories must have the 100 accessories' : undefined))),
    // The seal tables (contracts SealTables): a row per seal id 0–80, the seal marts, the NPC trainers' capsules, the send-out delays.
    seals: opt(obj({
      types: arr(obj({ sheet: int(0, 0xffff), name: int(0, 255), particle: int(0, 255), alphabet: bool, price: int(0, 0xffff), description: int(0, 255) })),
      marts: arr(arr(int(1, SEALS.count))),
      trainerCapsules: arr(arr(obj({ seal: int(1, SEALS.count), x: int(0, 255), y: int(0, 255) }))),
      delays: arr(int(0, 255)),
      ballOpen: arr(obj({ particle: int(0, 255), emitters: int(1, 20) })),
    }, (v) => {
      if ((v.types as unknown[]).length !== SEALS.count + 1) return `seals.types must have ${SEALS.count + 1} rows`;
      return (v.trainerCapsules as unknown[][]).some((c) => c.length > SEALS.perCapsule) ? `a capsule holds at most ${SEALS.perCapsule} seals` : undefined;
    })),
    // 0.31.0: Amity Square (contracts AmitySquareTables): pools of ten accessories, the gifts' items then accessories.
    amitySquare: opt(obj({
      stepVar: ref('vars'),
      finds: arr(obj({ species: arr(ref('species')), accessories: arr(int(0, 99)) }, (v) => ((v.accessories as unknown[]).length !== 10 ? 'an Amity Square pool has 10 accessories' : undefined))),
      gifts: arr(int(0, 0xffff)),
      itemGifts: int(0, 0xffff),
    }, (v) => ((v.finds as unknown[]).length ? undefined : 'amitySquare.finds is empty'))),
    // 0.37.0: the Villa (contracts VillaTables): the 20 pieces, their placements and the visitor odds.
    villa: opt(obj({
      zone: ref('zones'),
      resortArea: ref('zones'),
      furniture: arr(obj({ flag: ref('flags'), prop: ref('props'), label: ref('labels') })),
      rows: arr(obj({ type: int(0, VILLA_FURNITURE_COUNT - 1), collision: bool, position: tuple(num, num, num), box: obj({ left: int(0, 0xff), top: int(0, 0xff), right: int(0, 0xff), bottom: int(0, 0xff) }) })),
      tvType: int(0, VILLA_FURNITURE_COUNT - 1),
      visitors: obj({ chances: tuple(int(0, 100), int(0, 100), int(0, 100)), counts: tuple(int(1, 255), int(1, 255), int(1, 255)), visitorVar: ref('vars'), messageVar: ref('vars'), insideFlag: ref('flags'), outsideFlag: ref('flags') }),
    }, (v) => ((v.furniture as unknown[]).length !== VILLA_FURNITURE_COUNT ? `villa.furniture must have the ${VILLA_FURNITURE_COUNT} pieces` : undefined))),
    // 0.37.0: the journal (contracts JournalTables).
    journal: opt(obj({
      flag: ref('flags'),
      gyms: arr(obj({ trainer: ref('trainers'), zone: ref('zones'), badge: id })),
      buildings: arr(obj({ label: int(0, 0xffff), exited: bool })),
      caveDeparted: arr(int(0, 0xffff)),
      eliteFour: arr(ref('trainers')),
      champion: arr(ref('trainers')),
      home: ref('zones'),
      lab: ref('zones'),
      rivalClass: id,
      banks: obj({ entries: ref('textBanks'), months: ref('textBanks'), gyms: ref('textBanks'), locations: ref('textBanks'), times: ref('textBanks') }),
      pageTurn: arr(arr(int(0, 0xff))),
      art: opt(obj({ male: ref('ui2d'), female: ref('ui2d') })),
      martExcluded: obj({ label: int(0, 0xffff), zones: arr(ref('zones')) }),
    }, (v) => ((v.pageTurn as number[][]).length !== 9 || (v.pageTurn as number[][]).some((r) => r.length !== 32) ? 'journal.pageTurn must be 9 steps of 32 columns' : undefined))),
    // 0.41.0: the TV schedule (contracts TvTables): 96 quarter hours × 7 days of programmes 1–9, the 9 programmes.
    tv: opt(obj({
      schedule: arr(arr(int(1, 9))),
      programs: arr(obj({ type: int(1, 5), segments: arr(int(1, 26)) })),
    }, (v) => ((v.schedule as number[][]).length !== 96 || (v.schedule as number[][]).some((d) => d.length !== 7) || (v.programs as unknown[]).length !== 9 ? 'tv must have 96 × 7 slots and 9 programmes' : undefined))),
    // 0.37.0: the diplomas' documents and texts.
    diploma: opt(obj({ sinnoh: ref('ui2d'), national: ref('ui2d'), texts: obj({ player: ref('texts'), sinnoh: ref('texts'), national: ref('texts'), credit: ref('texts') }) })),
    // 0.44.0: the start menu's objective (contracts ObjectiveTables); every step needs a check.
    objectives: opt(obj({
      title: ref('texts'),
      explore: ref('texts'),
      steps: arr(obj({
        text: ref('texts'),
        done: arr(tagged('kind', {
          flag: obj({ kind: lit('flag'), flag: ref('flags') }),
          var: obj({ kind: lit('var'), var: ref('vars'), atLeast: int(0, 0xffff) }),
          badge: obj({ kind: lit('badge'), badge: id }),
        })),
        // 0.48.0: the zone of the Town Map fly location it leads to.
        to: opt(ref('zones')),
      }, (v) => ((v.done as unknown[]).length === 0 ? 'an objective step needs a check' : undefined))),
    })),
  }, (v) => {
    const pieces = v.sizeIntervals as { start: number }[] | undefined;
    return pieces && (pieces.length !== 16 || pieces[0]!.start !== 0 || pieces.some((p, i) => i > 0 && p.start <= pieces[i - 1]!.start)) ? 'sizeIntervals must have 16 increasing intervals beginning at zero' : undefined;
  }),
  titleScreens: obj({
    id,
    model: opt(titleModel),
    background: opt(titleModel),
  }),
  ui2d: obj(
    {
      id,
      atlas: ref('assets'),
      cells: arr(obj({ x: int(0), y: int(0), w: int(0), h: int(0), ox: int(), oy: int() })),
      names: opt(arr(str())),
      animations: opt(arr(ui2dAnimation)),
      nineSlice: opt(tuple(int(0), int(0), int(0), int(0))),
      textColors: opt(arr(obj({ fg: str(/^#[0-9a-f]{6}$/), shadow: str(/^#[0-9a-f]{6}$/) }))),
      emitters: opt(arr(ui2dEmitter)),
    },
    (v) => {
      const cells = (v.cells as unknown[]).length;
      const badTexture = ((v.emitters ?? []) as { texture: number; child?: { texture: number } }[]).find((e) => e.texture >= cells || (e.child && e.child.texture >= cells));
      if (badTexture) return `an emitter names texture ${badTexture.texture} of ${cells}`;
      if (v.names && (v.names as unknown[]).length !== cells) return 'names must have one entry per cell';
      if (v.textColors && (v.textColors as unknown[]).length !== cells) return 'textColors must have one entry per cell';
      const bad = ((v.animations ?? []) as { frames: { cell: number }[] }[]).flatMap((a) => a.frames).find((f) => f.cell >= cells);
      return bad ? `an animation frame names cell ${bad.cell} of ${cells}` : undefined;
    },
  ),
  pokemonSprites: obj({ id, sourceIndex, forms: arr(pokemonSpriteForm), front: pokemonSpriteAnim, back: pokemonSpriteAnim, yOffset: int(), shadow: obj({ x: int(), size: int(0, 3) }) }),
  trainerSprites: obj({ id, sourceIndex, front: ref('ui2d'), back: opt(ref('ui2d')) }),
  battleBackgrounds: obj({ id, sourceIndex, day: ref('assets'), twilight: ref('assets'), night: ref('assets') }),
  battleTerrains: obj({ id, sourceIndex, player: battlePlatform, enemy: battlePlatform }),
  sequences: obj({
    id,
    sourceIndex,
    data: ref('assets'),
    bank: ref('soundBanks'),
    volume: int(0, 127),
    channelPriority: int(0, 255),
    playerPriority: int(0, 255),
    player: ref('soundPlayers'),
    frames: nullable(int(0)),
  }),
  soundBanks: obj(
    { id, sourceIndex, waveArchives: arr(nullable(ref('waveArchives'))), instruments: arr(nullable(arr(instrumentRegion))) },
    (v) => {
      if ((v.waveArchives as unknown[]).length > 4) return 'a bank has at most 4 wave archives';
      const slots = v.waveArchives as (string | null)[];
      for (const regions of v.instruments as ({ archive?: number }[] | null)[])
        for (const r of regions ?? []) if (r.archive !== undefined && !slots[r.archive]) return `an instrument plays wave archive slot ${r.archive}, which the bank does not fill`;
      return undefined;
    },
  ),
  waveArchives: obj({ id, sourceIndex, data: ref('assets') }),
  soundPlayers: obj({ id, sourceIndex: int(0), maxSequences: int(0, 255), channels: int(0, 0xffff) }),
  cries: obj({
    id: ref('species'),
    sequence: ref('sequences'),
    bank: ref('soundBanks'),
    frames: int(0),
    forms: opt(dict(str(/^[0-9]+$/), obj({ bank: ref('soundBanks'), frames: int(0) }))),
  }),
  battleAnimations: obj({ id, move: opt(ref('moves')), common: opt(str(/^[a-z0-9_]+$/)), sourceIndex: int(0), code: arr(int(-0x80000000, 0x7fffffff)) }),
  particleSystems: obj(
    { id, sourceIndex: int(0), archive: opt(lit('ball', 'frontier')), textures: ref('ui2d'), textureParams: arr(int(0)), emitters: arr(particleEmitter) },
    (v) => {
      const n = (v.textureParams as unknown[]).length;
      const bad = (v.emitters as { texture: number; texAnim?: { textures: number[] }; child?: { texture: number } }[]).find((e) => e.texture >= n || e.child?.texture !== undefined && e.child.texture >= n || e.texAnim?.textures.some((t) => t >= n));
      return bad ? `an emitter names a texture past the ${n} textures` : undefined;
    },
  ),
  distortionRooms: distortionRoom,
  battleAnimData: obj({ id, positions: arr(arr(arr(ivec3))), axes: arr(arr(arr(ivec3))), backgrounds: arr(ref('ui2d')), statChange: arr(ref('ui2d')) }),
  aiScripts: obj(
    {
      id,
      code: arr(int(-0x80000000, 0x7fffffff)),
      flags: arr(obj({ name: str(/^AI_FLAG_[A-Z0-9_]+$/), entry: int(0) })),
      noDamageCalcEffects: arr(int(0)),
      altPowerEffects: arr(int(0)),
      weightToPower: arr(tuple(int(0), int(0))),
      battleEffects: arr(str()),
      holdEffects: arr(str()),
    },
    (v) => {
      const n = (v.code as unknown[]).length;
      const bad = (v.flags as { name: string; entry: number }[]).find((f) => f.entry >= n);
      if (bad) return `${bad.name} enters at word ${bad.entry} of ${n}`;
      return (v.flags as unknown[]).length === 32 ? undefined : 'flags must list the 32 AI flag bits';
    },
  ),
};

/** RecordValidator for core `loadPacks`: unknown registries and bad records throw (loadPacks prefixes registry and id). */
export function validateRecord(registry: string, record: RegistryRecord): void {
  if (!(REGISTRIES as readonly string[]).includes(registry)) throw new Error(`unknown registry "${registry}" (known: ${REGISTRIES.join(', ')})`);
  validate(schemaFor(registry as RegistryName, record), record);
}

export function recordRefs(registry: RegistryName, record: RegistryRecord): RefUse[] {
  return collectRefs(schemaFor(registry, record), record);
}
