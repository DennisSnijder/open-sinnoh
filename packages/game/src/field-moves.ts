/**
 * Field moves used from the party menu (decomp field_move_tasks.c). `usableMoves` ports
 * FieldMoves_SetUsableMoves: the object the player faces (Strength boulder, Rock Smash rock, Cut tree),
 * the facing tile's behaviour (its `TileBehavior.fieldMove`: Surf, Waterfall, Rock Climb by axis) and the
 * weather (FOG → Defog, DARK_FLASH → Flash). Each move then has its FieldMoves_Check* (badge, player
 * state, partner) and its `FIELD_MOVES` 8–15 menu script, started with the party slot in VAR_0x8000 and,
 * for the object moves, the object as VAR_LAST_TALKED.
 *
 * Fly, Teleport, Dig and Sweet Scent (FieldMoves_CheckFly, _CheckTeleport, _CheckDig, _CheckSweetScent) are field
 * tasks, not scripts: `taskMoveCheck`, `flyDestination`, `teleportDestination` and `digDestination` below; the game
 * hands them to the world (Sweet Scent's task is the world's: the cut-in, then the scent). Chatter runs SCRIPT_ID(RECORD_CHATOT_CRY, 0) with the slot, like the FIELD_MOVES scripts.
 * Softboiled and Milk Drink never leave the party menu (PartyMenu_StartFieldMoveHPTransfer, packages/menus). Not
 * checked yet: Surf from an elevated bridge (PlayerAvatar_CanUseSurf; the world has no bridge layer yet) and
 * the link rooms.
 */
import type { Id } from '@opensinnoh/core';
import { loadedMatrix, newGameRecord, type Facing, type GameState, type Registries } from '@opensinnoh/contracts';

/** Why a move cannot be used now (decomp enum FieldMoveError). */
export type FieldMoveError = 'location' | 'badge' | 'partner' | 'state';

interface FieldMoveSpec {
  /** Move name without the namespace (`MOVE_CUT`); the move id is `<ns>:<name>`. */
  move: string;
  /** Required badge (`BADGE_ID_*`), none for Flash. */
  badge?: string;
  /** The FIELD_MOVES menu script (SCRIPT_ID(FIELD_MOVES, 8..15)). */
  label: string;
  /** The facing object is passed to the script (Cut, Rock Smash, Strength). */
  object?: string;
  /** The error while surfing (checked after the badge, before the usable bit). */
  surfing?: FieldMoveError;
  /** Refused with a partner (checked last). */
  partner?: boolean;
}

/** In decomp enum FieldMoveList order (the party menu lists a Pokémon's moves in its own move order). */
const FIELD_MOVES: readonly FieldMoveSpec[] = [
  { move: 'MOVE_CUT', badge: 'BADGE_ID_FOREST', label: 'FieldMoves_UseCutFromMenu', object: 'OBJ_EVENT_GFX_CUT_TREE' },
  { move: 'MOVE_SURF', badge: 'BADGE_ID_FEN', label: 'FieldMoves_UseSurfFromMenu', surfing: 'state', partner: true },
  { move: 'MOVE_STRENGTH', badge: 'BADGE_ID_MINE', label: 'FieldMoves_UseStrengthFromMenu', object: 'OBJ_EVENT_GFX_STRENGTH_BOULDER' },
  { move: 'MOVE_DEFOG', badge: 'BADGE_ID_RELIC', label: 'FieldMoves_UseDefogFromMenu' },
  { move: 'MOVE_ROCK_SMASH', badge: 'BADGE_ID_COAL', label: 'FieldMoves_UseRockSmashFromMenu', object: 'OBJ_EVENT_GFX_ROCK_SMASH', surfing: 'location' },
  { move: 'MOVE_WATERFALL', badge: 'BADGE_ID_BEACON', label: 'FieldMoves_UseWaterfallFromMenu' },
  { move: 'MOVE_ROCK_CLIMB', badge: 'BADGE_ID_ICICLE', label: 'FieldMoves_UseRockClimbFromMenu', partner: true },
  { move: 'MOVE_FLASH', label: 'FieldMoves_UseFlashFromMenu' },
  // FieldMoves_CheckChatter: anywhere but the Distortion World (usable bit below); FieldMoves_ChatterTask's script.
  { move: 'MOVE_CHATTER', label: 'RecordChatotCry_Chatter' },
];

const DELTA: Record<Facing, readonly [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

const split = (id: Id) => {
  const i = id.indexOf(':');
  return { ns: id.slice(0, i), name: id.slice(i + 1) };
};

/**
 * The tile behaviour name at a tile of the player's zone matrix as loaded for `state` (Matrix.variants; null outside it
 * or on an empty cell). A Distortion World room's tiles are in its shared space: its matrix starts at the room's offset.
 */
export function behaviourAt(registries: Registries, state: GameState, zone: Id, x: number, z: number): string | null {
  const matrix = loadedMatrix(registries.matrices, registries.matrices.get(registries.zones.get(zone)!.matrix)!, (id) => state.vars[id] ?? registries.vars.get(id)!.initial);
  const room = registries.distortionRooms.get(zone);
  if (room) {
    x -= room.offset.x;
    z -= room.offset.z;
  }
  const cx = Math.floor(x / 32);
  const cz = Math.floor(z / 32);
  if (x < 0 || z < 0 || cx >= matrix.width || cz >= matrix.height) return null;
  const chunkId = matrix.chunks[cx + cz * matrix.width];
  if (!chunkId) return null;
  const tile = registries.chunks.get(chunkId)!.tiles[(x % 32) + (z % 32) * 32]!;
  return behaviourRecord(registries, tile & 0xff)?.name ?? null;
}

function behaviourRecord(registries: Registries, sourceIndex: number) {
  for (const b of registries.tileBehaviors.values()) if (b.sourceIndex === sourceIndex) return b;
  return undefined;
}

/** What FieldMoves_SetUsableMoves found: the usable move names and the facing object, if any. */
export interface FieldMoveContext {
  usable: Set<string>;
  object: { localId: number } | null;
}

export function fieldMoveContext(registries: Registries, state: GameState): FieldMoveContext {
  const usable = new Set<string>();
  const p = state.player;
  let [fx, fz] = [p.x + DELTA[p.facing][0], p.z + DELTA[p.facing][1]];
  // sub_0203C9D4: across a table, the object behind it.
  if (behaviourAt(registries, state, p.zone, fx, fz) === 'TABLE') [fx, fz] = [fx + DELTA[p.facing][0], fz + DELTA[p.facing][1]];
  // In the Distortion World the floor below lists objects on the same x/z: the one at the player's height.
  const dw = registries.distortionRooms.has(p.zone);
  const o = state.objects.find((obj) => obj.x === fx && obj.z === fz && (!dw || Math.trunc(obj.y / 16) === Math.trunc(p.y / 16)));
  let object: FieldMoveContext['object'] = null;
  if (o) {
    object = { localId: o.localId };
    const sprite = objectSprite(registries, state, o.zone, o.localId);
    const spec = sprite && FIELD_MOVES.find((m) => m.object === split(sprite).name);
    if (spec) usable.add(spec.move);
  }
  const [nx, nz] = [p.x + DELTA[p.facing][0], p.z + DELTA[p.facing][1]];
  const next = behaviourAt(registries, state, p.zone, nx, nz);
  const fieldMove = next === null ? undefined : [...registries.tileBehaviors.values()].find((b) => b.name === next)?.fieldMove;
  if (fieldMove) {
    const move = split(fieldMove.move).name;
    // PlayerAvatar_CanUseRockClimb: ROCK_CLIMB_N_S only facing north/south, ROCK_CLIMB_E_W east/west.
    const axisOk = move !== 'MOVE_ROCK_CLIMB' || (next!.endsWith('_N_S') ? p.facing === 'up' || p.facing === 'down' : p.facing === 'left' || p.facing === 'right');
    if (axisOk) usable.add(move);
  }
  const weather = registries.weathers.get(state.weather)?.name;
  if (weather === 'FOG') usable.add('MOVE_DEFOG');
  if (weather === 'DARK_FLASH') usable.add('MOVE_FLASH');
  if (!dw) usable.add('MOVE_CHATTER');
  return { usable, object };
}

/**
 * The object's sprite from its zone's event (null for an object with no event there, e.g. a follower); a Distortion
 * World room's objects are its own records.
 */
function objectSprite(registries: Registries, state: GameState, zone: Id, localId: number): Id | null {
  const ev = (registries.distortionRooms.get(zone)?.objects ?? registries.zones.get(zone)!.events.objects).find((e) => e.localId === localId);
  if (!ev) return null;
  if (typeof ev.sprite === 'string') return ev.sprite;
  const value = state.vars[ev.sprite.var] ?? registries.vars.get(ev.sprite.var)!.initial;
  for (const s of registries.sprites.values()) if (s.sourceIndex === value) return s.id;
  throw new Error(`field moves: object ${localId} sprite var ${ev.sprite.var} = ${value} names no sprite`);
}

/** Decomp FLAG_SAFARI_GAME_ACTIVE and FLAG_IN_PAL_PARK (PlayerInSafariZoneOrPalPark). */
const FLAG_SAFARI_GAME_ACTIVE = 2407;
const FLAG_IN_PAL_PARK = 2425;

function systemFlag(registries: Registries, state: GameState, index: number): boolean {
  for (const f of registries.flags.values()) if (f.sourceIndex === index) return state.flags[f.id] ?? f.initial;
  throw new Error(`field moves: no flag with sourceIndex ${index}`);
}

/**
 * FieldMoves_CheckFly and FieldMoves_CheckTeleport (no link rooms here): Fly needs the Cobble Badge, a map header that
 * allows it, no partner, and neither a Safari Game nor Pal Park; Teleport the same without the badge, and not in a
 * town or city (MapHeader_IsTeleportAllowed). `unsupported`: the packs lack the Town Map or the fly destinations.
 */
export function flyCheck(registries: Registries, state: GameState, move: 'MOVE_FLY' | 'MOVE_TELEPORT', ns: string): FieldMoveError | 'unsupported' | null {
  const game = newGameRecord(registries);
  if (!game.flyDestinations || (move === 'MOVE_FLY' && !game.townMap)) return 'unsupported';
  if (move === 'MOVE_FLY' && !state.badges.includes(`${ns}:BADGE_ID_COBBLE` as Id)) return 'badge';
  const zone = registries.zones.get(state.player.zone)!;
  if (!zone.flags.fly || (move === 'MOVE_TELEPORT' && zone.mapType === 'town')) return 'location';
  if (state.hasPartner) return 'partner';
  if (systemFlag(registries, state, FLAG_SAFARI_GAME_ACTIVE) || systemFlag(registries, state, FLAG_IN_PAL_PARK)) return 'location';
  return null;
}

/**
 * FieldMoves_CheckDig: a cave whose map header allows an Escape Rope (MapHeader_IsCave, MapHeader_IsEscapeRopeAllowed),
 * and no partner. FieldMoves_CheckSweetScent: anywhere but Pal Park.
 */
function digCheck(registries: Registries, state: GameState): FieldMoveError | null {
  const zone = registries.zones.get(state.player.zone)!;
  if (zone.mapType !== 'cave' || !zone.flags.escapeRope) return 'location';
  return state.hasPartner ? 'partner' : null;
}

/** The task moves' checks (Fly, Teleport, Dig, Sweet Scent); `unsupported` when the packs lack what the move needs. */
export function taskMoveCheck(registries: Registries, state: GameState, move: Id): FieldMoveError | 'unsupported' | null {
  const { ns, name } = split(move);
  if (name === 'MOVE_FLY' || name === 'MOVE_TELEPORT') return flyCheck(registries, state, name, ns);
  if (name === 'MOVE_DIG') return digCheck(registries, state);
  // FieldMoves_CheckSweetScent: refused only in the link rooms and Pal Park, which are not here; `unsupported` in packs without the Sweet Scent tables.
  if (name === 'MOVE_SWEET_SCENT') return newGameRecord(registries).specialEncounters ? null : 'unsupported';
  throw new Error(`${move} is not a field task move`);
}

/** Where Dig lands (FieldWarp ChangeMap: the exit location, FieldOverworldState_GetExitLocation), as the Escape Rope. */
export function digDestination(state: GameState): { zone: Id; x: number; z: number; facing: Facing } {
  const exit = state.escapeLocation;
  if (!exit) throw new Error('Dig: no exit location recorded');
  return exit;
}

/** Where Fly to the Town Map's location `location` lands (its spawn's fly position, Location_InitFly). */
export function flyDestination(registries: Registries, location: number): { zone: Id; x: number; z: number } {
  const game = newGameRecord(registries);
  const loc = game.townMap?.locations[location];
  if (!loc) throw new Error(`Fly: no Town Map location ${location}`);
  const dest = game.flyDestinations?.[loc.spawn - 1];
  if (!dest) throw new Error(`Fly: no fly destination for spawn ${loc.spawn}`);
  return dest;
}

/**
 * Where Teleport lands (FieldWarp ChangeMap: Location_InitFly of the blackout spawn): outside the Pokémon Center last
 * entered (`GameState.blackOut`), else at the default spawn's fly position.
 */
export function teleportDestination(registries: Registries, state: GameState): { zone: Id; x: number; z: number } {
  const zone = state.blackOut ? registries.zones.get(state.blackOut) : [...registries.zones.values()].find((z) => z.blackOut?.spawn === 1);
  if (!zone?.blackOut) throw new Error(`Teleport: no blackout spawn (${state.blackOut ?? 'the default spawn 1'})`);
  const dest = newGameRecord(registries).flyDestinations?.[zone.blackOut.spawn - 1];
  if (!dest) throw new Error(`Teleport: no fly destination for spawn ${zone.blackOut.spawn}`);
  return dest;
}

/** FieldMoves_Check<Move>: null when the move can be used now. */
export function checkFieldMove(spec: FieldMoveSpec, ns: string, state: GameState, ctx: FieldMoveContext): FieldMoveError | null {
  if (spec.badge && !state.badges.includes(`${ns}:${spec.badge}` as Id)) return 'badge';
  if (spec.surfing && state.playerState === 'surf') return spec.surfing;
  if (!ctx.usable.has(spec.move)) return 'location';
  if (spec.partner && state.hasPartner) return 'partner';
  return null;
}

export function fieldMoveSpec(move: Id): FieldMoveSpec | undefined {
  return FIELD_MOVES.find((m) => m.move === split(move).name);
}

const TASK_MOVES = new Set(['MOVE_FLY', 'MOVE_TELEPORT', 'MOVE_DIG', 'MOVE_SWEET_SCENT']);
/** Fly, Teleport, Dig or Sweet Scent: a field task, not a FIELD_MOVES script. */
export const isTaskMove = (move: Id): boolean => TASK_MOVES.has(split(move).name);

/** The party's field moves that can be used now, in party order and each Pokémon's move order. */
export function usableFieldMoves(registries: Registries, state: GameState): { slot: number; move: Id }[] {
  const ctx = fieldMoveContext(registries, state);
  const out: { slot: number; move: Id }[] = [];
  state.party.forEach((mon, slot) => {
    if (mon.isEgg) return;
    for (const move of mon.moves) {
      const { ns, name } = split(move);
      if (TASK_MOVES.has(name)) {
        if (taskMoveCheck(registries, state, move) === null) out.push({ slot, move });
        continue;
      }
      const spec = fieldMoveSpec(move);
      if (spec && checkFieldMove(spec, ns, state, ctx) === null) out.push({ slot, move });
    }
  });
  return out;
}

/** The script start for `useFieldMove`; throws (with the decomp error kind) when the move is not usable. */
export function fieldMoveStart(registries: Registries, state: GameState, slot: number, move: Id) {
  const mon = state.party[slot];
  if (!mon) throw new Error(`no Pokémon in party slot ${slot}`);
  if (mon.isEgg) throw new Error(`party slot ${slot} is an egg`);
  if (!mon.moves.includes(move)) throw new Error(`party slot ${slot} (${mon.species}) does not know ${move}`);
  const spec = fieldMoveSpec(move);
  if (!spec) throw new Error(`${move} is not a field move run by a script (Fly, Teleport, Dig and Sweet Scent are field tasks)`);
  const { ns } = split(move);
  const ctx = fieldMoveContext(registries, state);
  const error = checkFieldMove(spec, ns, state, ctx);
  if (error) throw new Error(`${move} cannot be used here (${error})`);
  return {
    label: `${ns}:${spec.label}` as Id,
    zone: state.player.zone,
    source: 'field-move' as const,
    params: [slot],
    ...(spec.object && ctx.object ? { lastTalked: ctx.object.localId } : {}),
  };
}

/**
 * Why a party Pokémon's field move cannot be used now (the party menu's message), or null.
 * `unsupported`: a field move from the party menu that the game does not run (Softboiled and Milk Drink stay in the
 * party menu), or one the packs lack the data for.
 */
export function fieldMoveError(registries: Registries, state: GameState, slot: number, move: Id): FieldMoveError | 'unsupported' | null {
  const mon = state.party[slot];
  if (!mon?.moves.includes(move)) throw new Error(`party slot ${slot} does not know ${move}`);
  if (TASK_MOVES.has(split(move).name)) return taskMoveCheck(registries, state, move);
  const spec = fieldMoveSpec(move);
  if (!spec) return 'unsupported';
  return checkFieldMove(spec, split(move).ns, state, fieldMoveContext(registries, state));
}
