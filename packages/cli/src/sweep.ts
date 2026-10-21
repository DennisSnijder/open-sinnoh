/**
 * `opensinnoh sweep <pack> [--ticks n] [--zones regex]`: the headless zone sweep. For every
 * playable zone: warp in (load a state placed on the zone's first warp tile, else its first coord
 * event or object, else the matrix centre), which runs the map scripts and spawns the objects, then
 * step a few ticks with no input. Then spawn at the arrival tile of every warp out of the zone (a load
 * of the target zone placed on the target warp) and check the tile is standable. Reports throws,
 * unknown ops (`cmd:` stubs), other stubs, spawned objects, warp arrivals and tick times per zone.
 * `UNUSED_*` zones and the two placeholders are reported, not swept.
 */
import type { Id, PackData } from '@opensinnoh/core';
import type { Facing, GameState, Registries, Zone } from '@opensinnoh/contracts';
import { cloneState, CountingStubLog, createGame } from '@opensinnoh/game';
import { BEHAVIOUR_PUSH_WARP, BEHAVIOUR_WARP_NORTH, INERT_UNKNOWN, MapGrid, gridOffset } from '@opensinnoh/world';
import type { Engine } from './engine.ts';

/**
 * Not part of the game. MAP_HEADER_UNKNOWN_578 is an unused Distortion World floor between B4F and B5F:
 * its init script selects the Distortion World, but tw_arc has no room for it (the DS could not load it either).
 * The Battle Tower's elevator is reached only inside a challenge: its onTransition reads the challenge's mode
 * (the DS would read through a null BattleTower); sys-tower-* replays load it.
 */
export const EXCLUDED_ZONE = /:MAP_HEADER_(UNUSED_.*|EVERYWHERE|NOTHING|UNKNOWN_578|BATTLE_TOWER_ELEVATOR)$/;
/** Load, but their behaviour is exempted: the Underground (scope pending). */
export const EXEMPT_ZONE = /:MAP_HEADER_UNDERGROUND$/;
export const SWEEP_TICKS = 30;

/**
 * Cuts reported as exemptions instead of unknowns: the gym
 * puzzles, and the Great Marsh tram and Safari init. The platform lift is not exempt; the
 * Distortion World is swept like any zone.
 */
export const M5_EXEMPTIONS: { kind: 'op' | 'behaviour'; match: RegExp; reason: string }[] = [
  { kind: 'op', match: /^init_persisted_map_features_for_(canalave|pastoria)_gym$|^press_pastoria_gym_button$|^move_hearthome_gym_dp_lift$/, reason: 'gym puzzles (M5)' },
  { kind: 'op', match: /great_marsh|safari_game/, reason: 'Great Marsh tram and Safari (M5)' },
  { kind: 'behaviour', match: /^DYNAMIC_HEIGHT_COLLISION$|^PASTORIA_GYM_/, reason: 'gym puzzles (M5)' },
];

export const m5Exemption = (kind: 'op' | 'behaviour', name: string) => M5_EXEMPTIONS.find((e) => e.kind === kind && e.match.test(name));

/**
 * A behaviour the decomp leaves unnamed (`UNKNOWN_x3E`). The ones in the world's `INERT_UNKNOWN` (no
 * decomp predicate or flag reads them, so they walk like NONE; docs/decisions.md) are a documented
 * exemption list, reported as inert, not as unnamed.
 */
const UNNAMED_BEHAVIOUR = /^UNKNOWN_x[0-9A-F]+$/;

/**
 * One warp out of a zone and its arrival. `ok`: the target warp tile is in the matrix and walkable; or
 * a door, whose south tile is walkable (the player walks out south, decomp ov5_021D453C); or another
 * blocked tile, whose next tile in the arrival facing is walkable (the world walks one step out; the
 * facing is the push direction of the source warp tile, any direction for a step-on warp). `dynamic`:
 * the target is the saved dynamic warp (elevators), not checked here. `unreachable`: a warp listed in
 * UNREACHABLE_WARPS, whose arrival is blocked on the ROM but which play cannot fire.
 */
export interface WarpArrival {
  index: number;
  to: Id | 'dynamic';
  toWarp: number;
  status: 'ok' | 'dynamic' | 'unreachable' | 'missing-warp' | 'out-of-bounds' | 'blocked' | 'door-exit-blocked' | 'load-error';
  /** The arrival tile in the target zone's matrix. */
  x?: number;
  z?: number;
  error?: string;
}

export interface ZoneSweep {
  zone: Id;
  exempt: boolean;
  ok: boolean;
  error?: string;
  /** Where the player was placed, and from what. */
  spawn: { x: number; z: number; from: 'warp' | 'coord' | 'object' | 'centre' };
  /** Ops the VM does not know, hit while loading and stepping (`cmd:<op>` stubs), M5 exemptions excluded. */
  unknownOps: string[];
  /** Unknown ops that are M5 exemptions (M5_EXEMPTIONS). */
  exemptOps: string[];
  /** Movement types the world does not know (`movement-type:<n>` stubs), and movement actions it skips. */
  unknownMovementTypes: number[];
  unknownActions: string[];
  /** Walkable tiles per behaviour, for unnamed behaviours, inert unnamed ones and M5-exempt ones only. */
  behaviours: { unnamed: Record<string, number>; inert: Record<string, number>; exempt: Record<string, number> };
  /** Other stubs hit (key → count). */
  stubs: Record<string, number>;
  objects: { events: number; spawned: number };
  /** Every warp event of the zone, with where it lands. */
  warps: WarpArrival[];
  scriptRunning: boolean;
  /** Load (map scripts) and the slowest tick, in ms. */
  ms: { load: number; maxTick: number };
}

export interface SweepResult {
  pack: string;
  ticks: number;
  zones: { registry: number; swept: number; exempt: number; excluded: Id[] };
  ok: number;
  failed: number;
  withUnknownOps: number;
  /** Warp arrivals checked (non-dynamic), and those that are not standable or failed to load. */
  arrivals: { checked: number; dynamic: number; unreachable: number; bad: number };
  /** Unknown op → number of zones that hit it (M5 exemptions excluded). */
  unknownOps: Record<string, number>;
  /** Unknown movement type / skipped movement action → number of zones. */
  unknownMovementTypes: Record<string, number>;
  unknownActions: Record<string, number>;
  /** Unnamed walkable behaviour → walkable tiles over all swept zones (the inert ones are not counted here). */
  unnamedBehaviours: Record<string, number>;
  /** Unnamed behaviours the world treats as inert (`INERT_UNKNOWN`, a decision) → walkable tiles. */
  inertBehaviours: Record<string, number>;
  /** The M5 cuts met by the sweep: what, why, in how many zones (and walkable tiles for behaviours). */
  exemptions: { kind: 'zone' | 'op' | 'behaviour'; name: string; reason: string; zones: number; tiles?: number }[];
  /** Stub key → number of zones that hit it. */
  stubs: Record<string, number>;
  tickMs: { p50: number; p95: number; max: number };
  loadMs: { p50: number; p95: number; max: number };
  results: ZoneSweep[];
}

/**
 * `registries` places a Distortion World room in its shared space: its rooms have no ordinary events, so the player
 * stands on its first moving platform's tile, else its first object's (the Giratina and Turnback Cave rooms), else
 * the matrix centre (world `gridOffset`).
 */
export function spawnPoint(zone: Zone, matrix: { width: number; height: number }, registries?: Registries): ZoneSweep['spawn'] {
  const room = registries?.distortionRooms.get(zone.id);
  const dw = room?.movingPlatforms[0] ?? room?.objects[0];
  if (dw) return { x: dw.x, z: dw.z, from: 'object' };
  const w = zone.events.warps[0];
  if (w) return { x: w.x, z: w.z, from: 'warp' };
  const c = zone.events.coords[0];
  if (c) return { x: c.x, z: c.z, from: 'coord' };
  const o = zone.events.objects[0];
  if (o) return { x: o.x, z: o.z, from: 'object' };
  const off = registries ? gridOffset(registries, zone.id) : { x: 0, z: 0 };
  return { x: matrix.width * 16 + off.x, z: matrix.height * 16 + off.z, from: 'centre' };
}

/**
 * Warp events the player cannot step on in Platinum, so their (blocked) arrival is never used. Keyed
 * `<zone> <warp index>`; each is reported as `unreachable`, never silently passed.
 */
export const UNREACHABLE_WARPS: Record<string, string> = {
  'platinum:MAP_HEADER_ETERNA_CITY_DP_GYM 0': 'Diamond/Pearl leftover: the only way in is Eterna Gym warp 1, on a blocked tile',
};

const STEP: Record<Facing, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

const gridOf = (registries: Registries, zone: Zone) => {
  const matrix = registries.matrices.get(zone.matrix);
  if (!matrix) throw new Error(`sweep: ${zone.id} has no matrix ${zone.matrix}`);
  return new MapGrid(registries, matrix, gridOffset(registries, zone.id));
};

/** The facing a warp tile is taken in: doors and north mats north, push mats their direction; null = stepped on from any side. */
export function departureFacing(registries: Registries, zone: Zone, x: number, z: number): Facing | null {
  const b = gridOf(registries, zone).behaviour(x, z);
  if (b === 'DOOR' || BEHAVIOUR_WARP_NORTH.has(b)) return 'up';
  return BEHAVIOUR_PUSH_WARP[b] ?? null;
}

/** Is the arrival tile of a warp standable (see WarpArrival)? */
export function arrivalStatus(registries: Registries, zone: Zone, x: number, z: number, facing: Facing | null): WarpArrival['status'] {
  const grid = gridOf(registries, zone);
  if (grid.tile(x, z) === null) return 'out-of-bounds';
  if (grid.behaviour(x, z) === 'DOOR') return grid.blocked(x, z + 1) ? 'door-exit-blocked' : 'ok';
  if (!grid.blocked(x, z)) return 'ok';
  const exits = facing ? [facing] : (Object.keys(STEP) as Facing[]);
  return exits.some((f) => !grid.blocked(x + STEP[f][0], z + STEP[f][1])) ? 'ok' : 'blocked';
}

const percentile = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]! * 100) / 100;
};

export function sweepZones(packs: readonly PackData[], engine: Engine, options: { ticks?: number; zones?: RegExp; now?: () => number } = {}): SweepResult {
  const ticks = options.ticks ?? SWEEP_TICKS;
  const now = options.now ?? (() => performance.now());
  const log = new CountingStubLog(() => {});
  const game = createGame({ packs, ...engine, seed: 1, log, now: () => '1970-01-01T00:00:00.000Z' });
  const base: GameState = cloneState(game.state);
  const all = [...game.registries.zones.keys()];
  const excluded = all.filter((id) => EXCLUDED_ZONE.test(id));
  const zones = all.filter((id) => !EXCLUDED_ZONE.test(id) && (!options.zones || options.zones.test(id)));
  const results: ZoneSweep[] = [];
  const tickTimes: number[] = [];
  for (const id of zones) {
    const zone = game.registries.zones.get(id)!;
    const spawn = spawnPoint(zone, game.registries.matrices.get(zone.matrix)!, game.registries);
    const before = new Map(log.counts);
    const r: ZoneSweep = {
      zone: id,
      exempt: EXEMPT_ZONE.test(id),
      ok: true,
      spawn,
      unknownOps: [],
      exemptOps: [],
      unknownMovementTypes: [],
      unknownActions: [],
      behaviours: walkableBehaviours(game.registries, zone),
      stubs: {},
      objects: { events: zone.events.objects.length, spawned: 0 },
      warps: [],
      scriptRunning: false,
      ms: { load: 0, maxTick: 0 },
    };
    try {
      const state = cloneState(base);
      state.player = { zone: id, x: spawn.x, z: spawn.z, y: 0, facing: 'down' };
      const t0 = now();
      game.load({ format: 'lantern-nds-save', version: 1, savedAt: '1970-01-01T00:00:00.000Z', state }, 'arrival');
      r.ms.load = now() - t0;
      r.objects.spawned = game.state.objects.length;
      for (let i = 0; i < ticks; i++) {
        const t = now();
        game.tick();
        const dt = now() - t;
        tickTimes.push(dt);
        r.ms.maxTick = Math.max(r.ms.maxTick, dt);
      }
      r.scriptRunning = game.scripts.running();
    } catch (e) {
      r.ok = false;
      r.error = (e as Error).message;
    }
    zone.events.warps.forEach((w, index) => {
      const a: WarpArrival = { index, to: w.toZone, toWarp: w.toWarp, status: 'ok' };
      r.warps.push(a);
      if (w.toZone === 'dynamic') return void (a.status = 'dynamic');
      if (UNREACHABLE_WARPS[`${id} ${index}`]) return void (a.status = 'unreachable');
      const target = game.registries.zones.get(w.toZone);
      if (!target) throw new Error(`sweep: ${id} warp ${index} targets unknown zone ${w.toZone}`);
      const dest = target.events.warps[w.toWarp];
      if (!dest) return void (a.status = 'missing-warp');
      a.x = dest.x;
      a.z = dest.z;
      const facing = departureFacing(game.registries, zone, w.x, w.z);
      a.status = arrivalStatus(game.registries, target, dest.x, dest.z, facing);
      if (a.status !== 'ok') return;
      try {
        const state = cloneState(base);
        state.player = { zone: target.id, x: dest.x, z: dest.z, y: 0, facing: facing ?? 'down' };
        game.load({ format: 'lantern-nds-save', version: 1, savedAt: '1970-01-01T00:00:00.000Z', state }, 'arrival');
      } catch (e) {
        a.status = 'load-error';
        a.error = (e as Error).message;
      }
    });
    for (const [key, n] of log.counts) {
      const d = n - (before.get(key) ?? 0);
      if (d <= 0) continue;
      if (key.startsWith('cmd:')) (m5Exemption('op', key.slice(4)) ? r.exemptOps : r.unknownOps).push(key.slice(4));
      else if (key.startsWith('movement-type:')) r.unknownMovementTypes.push(Number(key.slice('movement-type:'.length)));
      else if (key.startsWith('movement:')) r.unknownActions.push(key.slice('movement:'.length));
      else r.stubs[key] = d;
    }
    r.ms.load = Math.round(r.ms.load * 100) / 100;
    r.ms.maxTick = Math.round(r.ms.maxTick * 100) / 100;
    results.push(r);
  }
  const tally = (pick: (r: ZoneSweep) => string[]) => {
    const out: Record<string, number> = {};
    for (const r of results) for (const k of pick(r)) out[k] = (out[k] ?? 0) + 1;
    return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  };
  const loads = results.filter((r) => r.ok).map((r) => r.ms.load);
  return {
    pack: game.loadOrder.map((p) => p.id).join('+'),
    ticks,
    zones: { registry: all.length, swept: results.length, exempt: results.filter((r) => r.exempt).length, excluded },
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    withUnknownOps: results.filter((r) => r.unknownOps.length).length,
    arrivals: {
      checked: results.reduce((n, r) => n + r.warps.filter((w) => w.status !== 'dynamic' && w.status !== 'unreachable').length, 0),
      dynamic: results.reduce((n, r) => n + r.warps.filter((w) => w.status === 'dynamic').length, 0),
      unreachable: results.reduce((n, r) => n + r.warps.filter((w) => w.status === 'unreachable').length, 0),
      bad: badArrivals(results).length,
    },
    unknownOps: tally((r) => r.unknownOps),
    unknownMovementTypes: tally((r) => r.unknownMovementTypes.map(String)),
    unknownActions: tally((r) => r.unknownActions),
    unnamedBehaviours: sumTiles(results, 'unnamed'),
    inertBehaviours: sumTiles(results, 'inert'),
    exemptions: exemptions(results),
    stubs: tally((r) => Object.keys(r.stubs)),
    tickMs: { p50: percentile(tickTimes, 0.5), p95: percentile(tickTimes, 0.95), max: percentile(tickTimes, 1) },
    loadMs: { p50: percentile(loads, 0.5), p95: percentile(loads, 0.95), max: percentile(loads, 1) },
    results,
  };
}

/** Walkable tiles of the zone (its own matrix cells) per behaviour, for unnamed and M5-exempt behaviours. */
function walkableBehaviours(registries: Registries, zone: Zone): ZoneSweep['behaviours'] {
  const out: ZoneSweep['behaviours'] = { unnamed: {}, inert: {}, exempt: {} };
  const matrix = registries.matrices.get(zone.matrix)!;
  const names = new Map([...registries.tileBehaviors.values()].map((b) => [b.sourceIndex, b.name]));
  matrix.chunks.forEach((id, cell) => {
    if (!id || (matrix.zones && matrix.zones[cell] !== zone.id)) return;
    for (const t of registries.chunks.get(id)!.tiles) {
      if (t & 0x8000) continue;
      const name = names.get(t & 0xff) ?? `UNKNOWN_x${(t & 0xff).toString(16).toUpperCase()}`;
      const bucket = INERT_UNKNOWN.has(name) ? out.inert : UNNAMED_BEHAVIOUR.test(name) ? out.unnamed : m5Exemption('behaviour', name) ? out.exempt : null;
      if (bucket) bucket[name] = (bucket[name] ?? 0) + 1;
    }
  });
  return out;
}

function sumTiles(results: readonly ZoneSweep[], kind: 'unnamed' | 'inert' | 'exempt'): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of results) for (const [k, n] of Object.entries(r.behaviours[kind])) out[k] = (out[k] ?? 0) + n;
  return out;
}

function exemptions(results: readonly ZoneSweep[]): SweepResult['exemptions'] {
  const out: SweepResult['exemptions'] = [];
  const zones = results.filter((r) => r.exempt).map((r) => r.zone);
  if (zones.length) out.push({ kind: 'zone', name: zones.join(' '), reason: 'Underground (scope pending) and Distortion World (M5): loaded, behaviour exempt', zones: zones.length });
  const ops = new Map<string, number>();
  for (const r of results) for (const op of r.exemptOps) ops.set(op, (ops.get(op) ?? 0) + 1);
  for (const [op, n] of [...ops].sort()) out.push({ kind: 'op', name: op, reason: m5Exemption('op', op)!.reason, zones: n });
  for (const [name, tiles] of Object.entries(sumTiles(results, 'exempt')).sort()) {
    out.push({ kind: 'behaviour', name, reason: m5Exemption('behaviour', name)!.reason, zones: results.filter((r) => r.behaviours.exempt[name]).length, tiles });
  }
  return out;
}

/** `zone warp N → target (x,z): status` for every arrival that is not standable or failed to load. */
export function badArrivals(results: readonly ZoneSweep[]): string[] {
  return results.flatMap((r) => r.warps.filter((w) => !['ok', 'dynamic', 'unreachable'].includes(w.status)).map((w) => `${r.zone} warp ${w.index} → ${w.to} warp ${w.toWarp} (${w.x},${w.z}): ${w.status}${w.error ? ` ${w.error}` : ''}`));
}

const list = (m: Record<string, number>) => (Object.keys(m).length ? Object.entries(m).map(([k, n]) => `${k} ${n}`).join(', ') : 'none');

export function sweepSummary(r: SweepResult): string {
  const errors = new Map<string, number>();
  for (const z of r.results) if (z.error) errors.set(z.error.replace(/\d+/g, 'N'), (errors.get(z.error.replace(/\d+/g, 'N')) ?? 0) + 1);
  const topErrors = [...errors].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([e, n]) => `\n    ${n}× ${e}`).join('');
  const topOps = Object.entries(r.unknownOps).slice(0, 12).map(([op, n]) => `${op} ${n}`).join(', ');
  return [
    `${r.pack}: swept ${r.zones.swept}/${r.zones.registry} zones (${r.zones.excluded.length} excluded, ${r.zones.exempt} exempt), ${r.ticks} ticks each`,
    `  loaded without a throw: ${r.ok}; failed: ${r.failed}${topErrors}`,
    `  warp arrivals: ${r.arrivals.checked} checked, ${r.arrivals.dynamic} dynamic and ${r.arrivals.unreachable} unreachable (not checked), ${r.arrivals.bad} not standable${badArrivals(r.results).slice(0, 8).map((l) => `\n    ${l}`).join('')}`,
    `  zones hitting unknown ops: ${r.withUnknownOps} (${Object.keys(r.unknownOps).length} distinct)${topOps ? `: ${topOps}` : ''}`,
    `  unknown movement types: ${list(r.unknownMovementTypes)}; skipped movement actions: ${list(r.unknownActions)}; unnamed walkable behaviours (tiles): ${list(r.unnamedBehaviours)}; inert by decision (tiles): ${list(r.inertBehaviours)}`,
    `  M5 exemptions: ${r.exemptions.length ? r.exemptions.map((e) => `\n    ${e.kind} ${e.kind === 'zone' ? `×${e.zones}` : e.name} (${e.reason}; ${e.zones} zones${e.tiles !== undefined ? `, ${e.tiles} tiles` : ''})`).join('') : 'none'}`,
    `  tick ms p50 ${r.tickMs.p50}, p95 ${r.tickMs.p95}, max ${r.tickMs.max}; load ms p50 ${r.loadMs.p50}, p95 ${r.loadMs.p95}, max ${r.loadMs.max}`,
  ].join('\n');
}
