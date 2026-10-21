import { Prng, type Id } from '@opensinnoh/core';
import type { EffectView, Facing, FeatureModelView, FeaturesView, HearthomeGymRoom, HearthomeGymTables } from '@opensinnoh/contracts';
import { DELTA, OPPOSITE } from '../movement.ts';
import type { Actor } from '../npc.ts';
import { lineDistance } from '../trainers.ts';
import { tileCentre } from '../tiles.ts';
import { FEATURE_EFFECT_KEYS, gymTables, slotOf, type FeatureHost, type FeatureOf, type MapFeature } from './feature.ts';

/**
 * Hearthome Gym's dark trainer rooms (decomp src/overlay008/gym_features.c HearthomeGym_*; docs/research/
 * gym-puzzles.md). On the first build after the room's onTransition cleared the slot, one exit door is
 * drawn as correct and a clue tile is picked from the room's mask (rejecting tiles with an object); the
 * clue shows the correct door's symbol. Every other door leads back to the entrance's warp 1, arriving
 * facing south. The room is fogged (density 109, 119 in room two, 91 after the Relic Badge), the player
 * wears the gym avatar, and an unbeaten trainer within two tiles in front of the player starts a battle
 * whatever the trainer's facing. After a battle the trainer wanders 2×2 around where it stands.
 *
 * The DS draws the door with its Mersenne Twister (MTRNG_Next); we use the game's main stream
 * (`GameState.rng`), so the choice is seeded and saved like every other roll (an explicit choice, not the
 * DS's stream).
 */

/** HEARTHOME_DOOR_ID_EXIT: no correct door (a room without a puzzle). */
const DOOR_EXIT = 8;
/** HearthomeGym_InitFog: densities, GX_FOGSLOPE_0x0020, RGB 1/31, alpha 1. */
const FOG_DENSITY = { room1: 109, room2: 119, relic: 91 };
const FOG_SLOPE = 10;
/** The player's own light reaches 2 tiles (trainer->unk_08 = 2); field_control's player-facing check also looks 2 tiles. */
const PLAYER_SIGHT = 2;
/** TRAINER_TYPE_NORMAL. */
const TRAINER_TYPE_NORMAL = 1;
/** MOVEMENT_TYPE_WANDER_AROUND and the wander range after a battle (HearthomeGym_SetTrainerPostBattleMovement). */
const WANDER_AROUND = 3;
const AFTER_BATTLE_RANGE = 2;
/** ov5_021F4CEC: the clue is drawn 3 units into the floor and 4 units north of its tile centre. */
const CLUE_OFFSET = { y: -3, z: -4 };
/** DIR_NORTH, SOUTH, WEST, EAST: the light tables' order. */
const DIRS: Facing[] = ['up', 'down', 'left', 'right'];
/** ov5_021F4974: the beam is drawn 16 units above its position. */
const LIGHT_Y = 16;
const FX = 4096;
const TILE_FX = 16 * FX;

export class HearthomeGym implements MapFeature {
  private readonly t: HearthomeGymTables;
  private readonly room: HearthomeGymRoom | null;
  private readonly fog: NonNullable<FeaturesView['fog']>;

  constructor(private readonly h: FeatureHost) {
    this.t = gymTables(h.reg).hearthome;
    const slot = slotOf(h.state, 'hearthome-gym');
    const zone = h.zone().id;
    this.room = this.t.rooms.find((r) => r.zone === zone) ?? null;
    const density = h.state.badges.includes(this.t.relicBadge) ? FOG_DENSITY.relic : this.room === this.t.rooms[1] ? FOG_DENSITY.room2 : FOG_DENSITY.room1;
    this.fog = { slope: FOG_SLOPE, offset: 0, color: [1 / 31, 1 / 31, 1 / 31], alpha: 1, densities: Array.from({ length: 32 }, () => density) };
    h.setPlayerSprite(this.t.playerSprite[h.state.gender]);
    if (!slot.initialized) {
      slot.initialized = true;
      slot.correctDoor = DOOR_EXIT;
      if (this.room) this.roll(this.room, slot);
    }
    if (slot.correctDoor !== DOOR_EXIT) {
      if (!this.room) throw new Error(`world: Hearthome Gym door ${slot.correctDoor} saved in ${zone}, which is no trainer room`);
      const warps = h.warps();
      for (const door of this.room.doors) {
        if (door.door === slot.correctDoor) continue;
        const w = warps.find((x) => x.x === door.x && x.z === door.z);
        if (!w) throw new Error(`world: ${zone} has no warp at door ${door.door} (${door.x}, ${door.z})`);
        w.toZone = this.t.entrance;
        w.toWarp = 1;
      }
    }
  }

  /** The door and clue draw (MTRNG_Next % n each time): a clue tile in the mask, not under an object. */
  private roll(room: HearthomeGymRoom, slot: FeatureOf<'hearthome-gym'>): void {
    const prng = Prng.from(this.h.state.rng);
    slot.correctDoor = (prng.next() % room.doorCount) + room.firstDoor;
    do {
      do {
        slot.clueX = prng.next() % room.width;
        slot.clueZ = prng.next() % room.depth;
      } while (room.clueMask[slot.clueZ * room.width + slot.clueX] === 1);
      slot.clueX += room.offsetX;
      slot.clueZ += room.offsetZ;
    } while (this.h.occupant(slot.clueX, slot.clueZ));
    this.h.state.rng = prng.save();
    if (this.h.blocked(slot.clueX, slot.clueZ)) throw new Error(`world: Hearthome Gym clue on blocked tile ${slot.clueX},${slot.clueZ} (the decomp asserts it is clear)`);
  }

  /** HearthomeGym_CheckIfEnteredIncorrectDoor: entering a wrong door north arrives facing south. */
  doorFacing(x: number, z: number, facing: Facing): Facing {
    const slot = slotOf(this.h.state, 'hearthome-gym');
    if (facing !== 'up' || slot.correctDoor === DOOR_EXIT || !this.room) return facing;
    return this.room.doors.some((d) => d.x === x && d.z === z && d.door === slot.correctDoor) ? facing : 'down';
  }

  /**
   * HearthomeGym_CheckIfPlayerSeesTrainer: the first unbeaten trainer (object order) standing 1–2 tiles in
   * front of the player with a clear path; it approaches facing the player.
   */
  playerSight(): { trainer: Actor; distance: number; dir: Facing } | null {
    const p = this.h.hero();
    const dir = OPPOSITE[p.facing];
    for (const t of this.h.objects()) {
      if (!this.h.undefeatedTrainer(t)) continue;
      const distance = lineDistance({ ...t, sight: PLAYER_SIGHT } as Actor, p, dir);
      if (distance === null || this.h.sightBlocked(t, dir, distance)) continue;
      return { trainer: t, distance, dir };
    }
    return null;
  }

  /** HearthomeGym_SetTrainerPostBattleMovement: wander 2×2 around where the trainer stands. */
  trainerAfterBattle(trainer: Actor): boolean {
    trainer.range = { x: AFTER_BATTLE_RANGE, z: AFTER_BATTLE_RANGE };
    this.h.switchMovementType(trainer, WANDER_AROUND);
    if (trainer.type) {
      trainer.type.originX = trainer.x;
      trainer.type.originZ = trainer.z;
    }
    return true;
  }

  step(): void {}

  busy(): boolean {
    return false;
  }

  view(): ReturnType<MapFeature['view']> {
    const slot = slotOf(this.h.state, 'hearthome-gym');
    const effects: EffectView[] = [];
    const symbol = slot.correctDoor !== DOOR_EXIT ? this.t.effects?.symbols[slot.correctDoor] : undefined;
    if (symbol) {
      const wx = tileCentre(slot.clueX);
      const wz = tileCentre(slot.clueZ);
      const at: [number, number, number] = [wx, this.h.heightAt(wx, wz, 0) + CLUE_OFFSET.y, wz + CLUE_OFFSET.z];
      effects.push({ key: FEATURE_EFFECT_KEYS, effect: symbol, cur: at, prev: at, tick: 0 });
    }
    const models: FeatureModelView[] = [];
    const light = this.t.effects?.light;
    if (light) {
      // HearthomeGym_InitTrainers: the player's light reaches 2 tiles, a trainer's its sight.
      models.push(this.beam(light, this.h.hero(), PLAYER_SIGHT));
      for (const t of this.lit()) models.push(this.beam(light, t, t.sight));
    }
    return { effects, features: { models, fog: this.fog } };
  }

  /**
   * One object's light beam (ov5_021F4908, every update): its facing's rotation; at full reach the scale and
   * offset of its range, else, cut short by a blocked tile or an object (ov5_021F4AB4), interpolated in tenths
   * of a tile between the table's lengths from where the beam hits (ov5_021F4B6C, in fx32 as the DS).
   */
  private beam(model: Id, a: Actor, range: number): FeatureModelView {
    const l = this.t.light;
    const d = DIRS.indexOf(a.facing);
    if (range >= l.scales[d]!.length) throw new Error(`world: Hearthome Gym light of object ${a.localId} reaches ${range} tiles; the tables hold ${l.scales[d]!.length}`);
    const [dx, dz] = DELTA[a.facing];
    let x = a.x;
    let z = a.z;
    let reach = 0;
    let hit: readonly number[] | null = null;
    for (; reach < range; reach++) {
      x += dx;
      z += dz;
      const terrain = this.h.blocked(x, z);
      const other = this.h.occupant(x, z);
      if (terrain || (other && other !== a)) {
        // Only an object in the way: the beam ends at that object's position; else at the tile.
        hit = !terrain && other ? other.cur : [tileCentre(x), 0, tileCentre(z)];
        break;
      }
    }
    let scale = l.scales[d]![range]!;
    let offset = l.offsets[d]![range]!;
    if (hit) [scale, offset] = cutBeam(l, d, range, a.cur, hit);
    const at = (p: readonly number[]): [number, number, number] => [p[0]! + offset[0], p[1]! + offset[1] + LIGHT_Y, p[2]! + offset[2]];
    return { key: `hearthome-light-${a.localId}`, model, position: at(a.cur), prev: at(a.prev), rotation: l.rotations[d]!, scale, light: true };
  }

  /** Trainers that carry a light (HearthomeGym_InitTrainers: NORMAL with a sight range). */
  lit(): Actor[] {
    return [...this.h.objects()].filter((a) => a.trainerType === TRAINER_TYPE_NORMAL && a.sight !== 0);
  }
}

/** ov5_021F4B6C: the scale and offset of a beam cut short at `hit` (positions in world units, worked in fx32). */
export function cutBeam(l: HearthomeGymTables['light'], d: number, range: number, pos: readonly number[], hit: readonly number[]): [[number, number, number], [number, number, number]] {
  const fx = (v: number) => Math.round(v * FX);
  const along = [fx(pos[2]!) - fx(hit[2]!), fx(hit[2]!) - fx(pos[2]!), fx(pos[0]!) - fx(hit[0]!), fx(hit[0]!) - fx(pos[0]!)][d]!;
  const near = Math.max(Math.min(Math.abs(Math.trunc(along / TILE_FX)), range) - 1, 0);
  const rest = along % TILE_FX;
  const far = Math.min(Math.max(near + Math.sign(rest), 0), range);
  const tenths = Math.abs(Math.trunc(rest / Math.trunc(TILE_FX / 10)));
  const lerp = (t: [number, number, number][]): [number, number, number] => {
    const [a, b] = [t[near]!.map(fx), t[far]!.map(fx)];
    return [0, 1, 2].map((k) => (a[k]! + Math.trunc((b[k]! - a[k]!) / 10) * tenths) / FX) as [number, number, number];
  };
  return [lerp(l.scales[d]!), lerp(l.offsets[d]!)];
}
