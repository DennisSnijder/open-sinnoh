/**
 * The systems replays and what each still waits for.
 *
 * A replay is `pending` while it needs a feature is not implemented yet. Each need has a probe that
 * says whether the feature works now; tests/integration/sys-replays.rom.test.ts fails when a pending
 * replay passes or when a need it lists is already implemented, so nothing stays pending silently.
 * Probes run headless against the Platinum pack: a VM op that is real (not a logged stand-in), a world
 * task that no longer throws, imported records, or a short replay that exercises the behaviour.
 */
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { Id } from '@opensinnoh/core';
import type { Game, ReplayResolver, ReplayResult } from '@opensinnoh/game';
import { STUBBED, implementedOps } from '@opensinnoh/vm';

export const REPLAY_DIR = import.meta.dirname;

/** `from` lines resolve against the naming replay's folder (parts chain inside `parts/`). */
export const resolveReplay: ReplayResolver = (file, base) => {
  // Names keep forward slashes on every OS (`chainedScreenshots: /^parts\//` matches them).
  const name = posix.join(base ? posix.dirname(base) : '', file);
  return { name, text: readFileSync(join(REPLAY_DIR, name), 'utf8') };
};

export interface ProbeContext {
  /** A fresh headless game on the Platinum pack (seed 1). */
  game(): Game;
  /** Runs a replay text on a fresh game (seed 1, once, no repeat). */
  run(text: string): Promise<ReplayResult>;
}

export interface Need {
  area: 'imports' | 'world' | 'script ops';
  what: string;
  /** True when the feature works now. */
  probe(ctx: ProbeContext): boolean | Promise<boolean>;
}

const realOp = (op: string) => () => implementedOps().includes(op) && !STUBBED.includes(op);

/** A world task (FieldHost member) that no longer throws "not implemented". */
const worldTask = (member: 'surfDone' | 'waterfallDone' | 'rockClimbDone' | 'elevatorDone' | 'shakeObjectDone') => (ctx: ProbeContext) => {
  try {
    ctx.game().world[member]();
    return true;
  } catch (e) {
    if (/not implemented/.test((e as Error).message)) return false;
    throw e;
  }
};

const fieldMoveRef = (move: string) => (ctx: ProbeContext) => [...ctx.game().registries.tileBehaviors.values()].some((b) => b.fieldMove?.move === `platinum:${move}`);
const interactRef = (behaviour: string) => (ctx: ProbeContext) => [...ctx.game().registries.tileBehaviors.values()].some((b) => b.name === behaviour && b.interact);

/** A short replay that passes once the behaviour works (a probe that cannot even start is an error). */
const passes = (text: string) => async (ctx: ProbeContext) => {
  const result = await ctx.run(text);
  if (!result.ok && /cannot parse|unknown (flag|var|item|zone|species)|does not allow the bike/.test(result.error!)) throw new Error(`probe replay is broken: ${result.error}`);
  return result.ok;
};

/** Loading the zone at x/z and idling 30 ticks logs no `movement-type:<n>` stub. */
const movementType = (n: number, zone: string, x: number, z: number) => (ctx: ProbeContext) => {
  const game = ctx.game();
  const state = structuredClone(game.state);
  state.player = { ...state.player, zone: `platinum:MAP_HEADER_${zone}` as Id, x, z };
  state.objects = [];
  game.load({ format: 'lantern-nds-save', version: 1, savedAt: 'probe', state }, 'arrival');
  game.advance(30);
  return !game.log.counts.has(`movement-type:${n}`);
};

export const NEEDS = {
  surfRefs: { area: 'imports', what: 'TileBehavior.fieldMove refs: water → MOVE_SURF', probe: fieldMoveRef('MOVE_SURF') },
  waterfallRefs: { area: 'imports', what: 'TileBehavior.fieldMove refs: WATERFALL → MOVE_WATERFALL', probe: fieldMoveRef('MOVE_WATERFALL') },
  rockClimbRefs: { area: 'imports', what: 'TileBehavior.fieldMove refs: ROCK_CLIMB_* → MOVE_ROCK_CLIMB', probe: fieldMoveRef('MOVE_ROCK_CLIMB') },
  rockyWallScript: { area: 'imports', what: 'TileBehavior.interact for ROCK_CLIMB_N_S (A on the wall, FIELD_MOVES 3)', probe: interactRef('ROCK_CLIMB_N_S') },
  useSurf: { area: 'script ops', what: 'op use_surf (starts FieldHost.surf, waits on surfDone)', probe: realOp('use_surf') },
  useWaterfall: { area: 'script ops', what: 'op use_waterfall', probe: realOp('use_waterfall') },
  useRockClimb: { area: 'script ops', what: 'op use_rock_climb', probe: realOp('use_rock_climb') },
  strengthFunc: { area: 'script ops', what: 'op do_strength_func (FLAG_STRENGTH_ACTIVE)', probe: realOp('do_strength_func') },
  defogFunc: { area: 'script ops', what: 'op do_defog_func (FLAG_DEFOG_ACTIVE) and 0C4 (weather CLEAR)', probe: realOp('do_defog_func') },
  flashFunc: { area: 'script ops', what: 'op do_flash_func (FLAG_FLASH_ACTIVE) and 0C3 (weather CLEAR)', probe: realOp('do_flash_func') },
  elevatorOps: { area: 'script ops', what: 'ops set_special_location and play_elevator_animation', probe: () => realOp('set_special_location')() && realOp('play_elevator_animation')() },
  surfTask: { area: 'world', what: 'world surf task (FieldHost.surf/surfDone), surfing movement and dismount', probe: worldTask('surfDone') },
  waterfallTask: { area: 'world', what: 'world waterfall task', probe: worldTask('waterfallDone') },
  rockClimbTask: { area: 'world', what: 'world rock climb task', probe: worldTask('rockClimbDone') },
  strengthPush: {
    area: 'world',
    what: 'native Strength push (reads FLAG_STRENGTH_ACTIVE, field_control.c)',
    probe: passes('set flag platinum:FLAG_STRENGTH_ACTIVE true\nwarp platinum:MAP_HEADER_OREBURGH_GATE_B1F 9 19 left\nuntil idle\n+0 press left\nuntil state objects[localId=3].x 7 120\n'),
  },
  ice: { area: 'world', what: 'ice slides (ICE)', probe: passes('warp platinum:MAP_HEADER_SNOWPOINT_TEMPLE_B3F 3 6 down\nuntil idle\n+0 press down\n+1 release down\nuntil idle\n+0 assert position platinum:MAP_HEADER_SNOWPOINT_TEMPLE_B3F 3 14\n') },
  slides: { area: 'world', what: 'Fuego Ironworks slides (SLIDE_*)', probe: passes('warp platinum:MAP_HEADER_FUEGO_IRONWORKS_BUILDING 16 14 up\nuntil idle\n+0 press up\n+1 release up\nuntil idle\n+0 assert position platinum:MAP_HEADER_FUEGO_IRONWORKS_BUILDING 16 5\n') },
  deepMud: { area: 'world', what: 'stuck in deep mud (MUD_DEEP)', probe: passes('warp platinum:MAP_HEADER_ROUTE_212_SOUTH 531 846 up\nuntil idle\n+0 press up\nuntil position 531 845\n+60 release up\nuntil idle\n+0 assert position platinum:MAP_HEADER_ROUTE_212_SOUTH 531 845\n') },
  deepSnow: { area: 'world', what: 'slow walk from SNOW_DEEPER (MapObject_GetDeepSnowMovementAction)', probe: passes('warp platinum:MAP_HEADER_ROUTE_216 298 402 down\nuntil idle\n+0 press down\nuntil position 298 404\n+8 assert position platinum:MAP_HEADER_ROUTE_216 298 404\n') },
  footprints: {
    area: 'world',
    what: 'footprints in FieldView.effects after walking in snow',
    probe: async (ctx) => {
      const game = ctx.game();
      const state = structuredClone(game.state);
      state.player = { ...state.player, zone: 'platinum:MAP_HEADER_ROUTE_216' as Id, x: 298, z: 400, facing: 'down' };
      state.objects = [];
      game.load({ format: 'lantern-nds-save', version: 1, savedAt: 'probe', state }, 'arrival');
      game.advance(20);
      game.press('down');
      game.advance(16);
      return game.world.view().effects.length > 0;
    },
  },
  yearlyWeather: {
    area: 'world',
    what: 'yearly weather resolved from the frozen date on map change (needs the yearly table)',
    probe: passes('date 2009-01-06\nwarp platinum:MAP_HEADER_ROUTE_212_SOUTH 517 845 down\nuntil idle\n+0 assert state weather "platinum:OVERWORLD_WEATHER_THUNDERSTORM"\n'),
  },
  bikeSlope: { area: 'world', what: 'bike slopes (speed >= 3 climbs, else pushed back)', probe: passes('player cycle 1\nwarp platinum:MAP_HEADER_ROUTE_207 306 720 up\nuntil idle\n+0 press up\n+60 release up\nuntil idle\n+0 assert position platinum:MAP_HEADER_ROUTE_207 306 720\n') },
  bikeRamp: { area: 'world', what: 'bike ramps (jump over BIKE_RAMP_*)', probe: passes('player cycle 1\nwarp platinum:MAP_HEADER_OREBURGH_GATE_B1F 28 13 left\nuntil idle\n+0 press left\nuntil position 26 13 60\n') },
  bikeGear: { area: 'world', what: 'B toggles the cycling gear (PlayerAvatar_TryCyclingGearChange)', probe: passes('player cycle 1\nwarp platinum:MAP_HEADER_ROUTE_207 306 724 up\nuntil idle\n+0 press b\n+1 release b\n+1 assert state cyclingGear 0\n') },
  flashClearing: { area: 'world', what: 'map-change rules: Flash/Defog kept in caves, cleared outside; DARK_FLASH/FOG maps CLEAR while active', probe: passes('set flag platinum:FLAG_FLASH_ACTIVE true\nwarp platinum:MAP_HEADER_WAYWARD_CAVE_1F 30 54 down\nuntil idle\n+0 press down\nuntil state player.zone "platinum:MAP_HEADER_ROUTE_206" 120\n+0 release down\nuntil idle\n+0 assert flag platinum:FLAG_FLASH_ACTIVE false\n') },
  walkLoops: { area: 'world', what: 'movement types 21–45 (walk loops)', probe: movementType(39, 'ROUTE_205_SOUTH', 219, 612) },
  disguises: { area: 'world', what: 'movement types 51–54 (disguises) and the reveal', probe: movementType(53, 'ROUTE_210_NORTH', 500, 522) },
  elevatorWorld: {
    area: 'world',
    what: 'elevators: the store elevator door, FieldHost.elevator and the dynamic warp to specialLocation',
    probe: async (ctx) => worldTask('elevatorDone')(ctx) && (await ctx.run('warp platinum:MAP_HEADER_VEILSTONE_STORE_1F 15 3 up\nuntil idle\n+0 press up\nuntil state player.zone "platinum:MAP_HEADER_VEILSTONE_STORE_ELEVATOR" 120\n')).ok,
  },
} satisfies Record<string, Need>;

export type NeedKey = keyof typeof NEEDS;

export interface SysReplay {
  file: string;
  /** Wild battles in the log at the end, per seed 1–3 (asserted on every seed); 'record' = not measured yet. */
  wild?: [number, number, number] | 'record';
  /** Needs not landed yet. */
  pending?: NeedKey[];
  /** Visual beats (screenshot lines) the browser spec checks by pixels. */
  visual?: boolean;
}

export const SYS_REPLAYS: SysReplay[] = [
  { file: 'sys-rock-smash.replay', wild: [65, 66, 69] },
  { file: 'sys-cut.replay' },
  { file: 'sys-strength.replay' },
  { file: 'sys-surf.replay', wild: [0, 1, 1], visual: true },
  { file: 'sys-waterfall.replay' },
  { file: 'sys-rock-climb.replay' },
  { file: 'sys-ice.replay' },
  { file: 'sys-mud-snow.replay' },
  { file: 'sys-bike.replay' },
  { file: 'sys-fog-defog.replay', visual: true },
  { file: 'sys-flash.replay', visual: true },
  { file: 'sys-weather.replay', visual: true },
  { file: 'sys-elevator.replay' },
  { file: 'sys-movement.replay' },
  // gym puzzles: every trainer battle real, asserted in the battle log.
  { file: 'sys-gym-eterna.replay', visual: true },
  { file: 'sys-gym-hearthome.replay', visual: true },
  { file: 'sys-gym-veilstone.replay', visual: true },
  // Following Pokémon (docs/decisions.md): the party follower's walk and rules.
  { file: 'sys-follower-walk.replay' },
  { file: 'sys-follower-rules.replay' },
  // gym puzzles.
  { file: 'sys-gym-pastoria.replay', visual: true },
  { file: 'sys-gym-canalave.replay', visual: true },
  { file: 'sys-gym-snowpoint.replay', visual: true },
  // scenes.
  { file: 'sys-boat.replay', visual: true },
  { file: 'sys-explosion.replay' },
];

export const readReplay = (file: string) => readFileSync(join(REPLAY_DIR, file), 'utf8');

/**
 * Pixel checks for the visual beats (browser, desktop; tests/browser/sys.rom.spec.ts). Each loads the
 * spot twice from the same state, once with the effect and once without, and compares the frames. A
 * pending check must still show no difference; once it does, the spec fails until `pending` is dropped.
 */
export interface VisualCheck {
  name: string;
  zone: string;
  x: number;
  z: number;
  facing: 'up' | 'down' | 'left' | 'right';
  /** Story state for the spot (so no map script runs over the check). */
  story?: { vars?: Record<string, number>; flags?: Record<string, boolean> };
  /** The state with the effect and without it. */
  with: { weather?: string; playerState?: 'surf' };
  without: { weather?: string; playerState?: 'walk' };
  /** weather: the frames differ; fog: they differ and the fogged one has less contrast; darkness: the dark one is mostly black; surf-blob: a surf effect is in FieldView.effects and the player's surroundings (screen centre) differ. */
  measure: 'weather' | 'fog' | 'darkness' | 'surf-blob';
  pending?: string;
}

const WEATHER_SPOTS = [
  ['blizzard', 'ROUTE_217', 299, 308, 'BLIZZARD'],
  ['rain', 'ROUTE_215', 670, 597, 'RAINING'],
  ['sandstorm', 'ROUTE_228', 775, 330, 'SANDSTORM'],
  ['ashfall', 'STARK_MOUNTAIN_OUTSIDE', 749, 232, 'SLOW_ASHFALL'],
  ['eterna-forest', 'ETERNA_FOREST', 27, 85, '23'],
  ['cloudy', 'ROUTE_215', 670, 597, 'CLOUDY'],
] as const;

export const VISUAL_CHECKS: VisualCheck[] = [
  ...WEATHER_SPOTS.map(([name, zone, x, z, w]): VisualCheck => ({
    name: `weather-${name}`,
    zone,
    x,
    z,
    facing: 'down',
    with: { weather: `OVERWORLD_WEATHER_${w}` },
    without: { weather: 'OVERWORLD_WEATHER_CLEAR' },
    measure: 'weather',
  })),
  { name: 'fog', zone: 'ROUTE_210_NORTH', x: 498, z: 522, facing: 'down', with: { weather: 'OVERWORLD_WEATHER_FOG' }, without: { weather: 'OVERWORLD_WEATHER_CLEAR' }, measure: 'fog' },
  { name: 'flash-darkness', zone: 'WAYWARD_CAVE_1F', x: 30, z: 54, facing: 'down', with: { weather: 'OVERWORLD_WEATHER_DARK_FLASH' }, without: { weather: 'OVERWORLD_WEATHER_CLEAR' }, measure: 'darkness' },
  {
    name: 'surf-blob',
    zone: 'LAKE_VERITY',
    x: 49,
    z: 36,
    facing: 'left',
    story: { vars: { 'platinum:VAR_LAKE_VERITY_PROF_ROWAN_STATE': 1 }, flags: { 'platinum:FLAG_HIDE_LAKE_VERITY_TEAM_GALACTIC': true } }, with: { playerState: 'surf' },
    without: { playerState: 'walk' },
    measure: 'surf-blob',
  },
];
