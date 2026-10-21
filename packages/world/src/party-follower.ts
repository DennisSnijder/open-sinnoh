/**
 * The party follower (docs/research/following-pokemon.md; docs/decisions.md): the first party Pokémon that
 * is not an egg and not fainted walks behind the player, drawn from its `followers` set. It is separate from
 * the story's follower (the `MOVEMENT_TYPE_FOLLOW_PLAYER` object: the rival, Cheryl), which owns the slot
 * while it walks along; the party follower is then recalled.
 *
 * It queues the tiles the player leaves and walks into them in order, at the player's speed (a step faster
 * while it has two to catch up, as HGSS's FollowMon_GetFasterMovement promotes), and jumps the two tiles of
 * a ledge. It is recalled (removed) while the option is off, the player cycles or surfs, an HM ride runs,
 * the zone's follow mode refuses its set, the player is in the Distortion World, or the lead has none. It comes back waiting: hidden under the
 * player until their next step, then shown on the tile they left (HGSS FollowMon_HideUntilStep). A map load
 * recreates it so, except a loaded save, which puts it back where it stood (`GameState.partyFollower`).
 * A player moved off its trail (a script setting the position) recalls it the same way.
 *
 * Our policy (not HGSS's, where the follower is a map object): it is drawn only. It never blocks the player,
 * other objects or trainer sight, starts no script and keeps nothing busy, so the game plays the same with
 * and without it. Talking to it is a later phase.
 */
import { monGender, isShiny, type Id, type Pokemon } from '@opensinnoh/core';
import { dexOf, type ActorView, type FollowerSprite, type GameState, type Registries, type Zone } from '@opensinnoh/contracts';
import { WALK_NORMAL_TICKS } from './movement.ts';
import { createActor, jump, walk, type Actor } from './npc.ts';

/** The party follower's ActorView.localId: outside the u8 range of event objects. */
export const PARTY_FOLLOWER_LOCALID = 0x100;

/** HGSS FollowMonBillboard_AddFacingOffset (world units, x and z by facing): the 64×64 billboard, and the rest. */
const LARGE_OFFSET: Record<Actor['facing'], [number, number]> = { up: [0, 1], down: [0, -1], left: [10, 0], right: [-10, 0] };
const SMALL_OFFSET: Record<Actor['facing'], [number, number]> = { up: [0, 0], down: [0, 0], left: [2, 0], right: [-2, 0] };

/** Catch-up: the next faster walk for a step's length in ticks (slow → normal → fast → faster). */
const FASTER: Record<number, number> = { 32: 16, 16: 8, 8: 4, 7: 4, 6: 3, 4: 2, 3: 2, 2: 1, 1: 1 };

export interface PartyFollowerHost {
  reg: Registries;
  state: GameState;
  hero(): Actor;
  zone(): Zone;
  /** The following Pokémon option. */
  enabled(): boolean;
  walkInPlace(): boolean;
  /** The story follower owns the slot (`GameState.hasPartner` or a follow-player object). */
  storyPartner(): boolean;
  /** An HM ride (Surf mount and dismount, Waterfall, Rock Climb) is running. */
  riding(): boolean;
}

const indexes = new WeakMap<Registries, Map<string, FollowerSprite>>();

/** `followers` by species, form and gender: the last record loaded wins (contracts FollowerSprite). */
function followerIndex(reg: Registries): Map<string, FollowerSprite> {
  let index = indexes.get(reg);
  if (!index) {
    index = new Map();
    for (const set of reg.followers.values()) index.set(`${set.species}#${set.form}#${set.gender ?? 'any'}`, set);
    indexes.set(reg, index);
  }
  return index;
}

/** The follower set of a Pokémon: a female set for a female, else the set for any gender; exact form only. */
export function followerSet(reg: Registries, mon: Pokemon): FollowerSprite | null {
  const index = followerIndex(reg);
  const female = monGender(dexOf(reg), mon) === 'female' ? index.get(`${mon.species}#${mon.form}#female`) : undefined;
  return female ?? index.get(`${mon.species}#${mon.form}#any`) ?? null;
}

/** The lead that follows: the first party Pokémon that is not an egg and not fainted (HGSS: the first alive). */
export function followerLead(state: GameState): Pokemon | null {
  return state.party.find((m) => !m.isEgg && m.hp > 0) ?? null;
}

export class PartyFollower {
  actor: Actor | null = null;
  /** While it talks (follower talk): its drawn offset from its tile, in world units, and the bubble over it. */
  talk: { dx: number; dy: number; dz: number } | null = null;
  bubble: NonNullable<ActorView['bubble']> | null = null;
  private set: FollowerSprite | null = null;
  /** Hidden under the player until their next step. */
  private waiting = false;
  /** The player's tile at the last update; the tiles they left since, still to walk into. */
  private heroTile: [number, number] = [0, 0];
  private trail: [number, number][] = [];
  /** Ticks since it appeared (the `loop` animation). */
  private age = 0;

  constructor(private readonly h: PartyFollowerHost) {}

  /** The set and sprite that should be out now, or null when none may follow. */
  private wanted(): { set: FollowerSprite; sprite: Id } | null {
    const s = this.h.state;
    if (!this.h.enabled() || s.playerState !== 'walk' || this.h.storyPartner() || this.h.riding()) return null;
    const lead = followerLead(s);
    const set = lead && followerSet(this.h.reg, lead);
    if (!lead || !set) return null;
    // Our policy: none in the Distortion World, whose walls, ceilings and diagonal jumps no trail can follow.
    if (this.h.reg.distortionRooms.has(this.h.zone().id)) return null;
    const mode = this.h.zone().follow ?? 'allow';
    if (mode === 'prevent' || (mode === 'height-restrict' && set.size === 'large')) return null;
    return { set, sprite: isShiny(lead.otId, lead.pid) ? (set.shiny ?? set.sprite) : set.sprite };
  }

  /**
   * A map load: recreated under the player (waiting), or for a loaded save where it stood when that is
   * the player's tile or next to it. Call once the player stands on the arrival tile.
   */
  reset(saved: GameState['partyFollower'] | null): void {
    const hero = this.h.hero();
    this.actor = null;
    this.trail = [];
    this.heroTile = [hero.x, hero.z];
    const want = this.wanted();
    if (!want) return;
    const near = saved && Math.abs(saved.x - hero.x) + Math.abs(saved.z - hero.z) <= 1;
    if (saved && near) this.create(want, saved.x, saved.z, saved.facing, saved.waiting);
    else this.create(want, hero.x, hero.z, hero.facing, true);
  }

  private create(want: { set: FollowerSprite; sprite: Id }, x: number, z: number, facing: Actor['facing'], waiting: boolean): void {
    const hero = this.h.hero();
    const a = createActor(PARTY_FOLLOWER_LOCALID, want.sprite, x, z, hero.y, facing, 0, hero.zone);
    a.persistent = true;
    a.visible = !waiting;
    this.actor = a;
    this.set = want.set;
    this.waiting = waiting;
    this.age = 0;
  }

  /** Once a tick, after the player's movement started and before motions advance. */
  update(): void {
    const hero = this.h.hero();
    const from = this.heroTile;
    const moved = hero.x !== from[0] || hero.z !== from[1];
    this.heroTile = [hero.x, hero.z];
    const want = this.wanted();
    if (!want) {
      this.actor = null;
      this.trail = [];
      return;
    }
    if (!this.actor) return this.create(want, hero.x, hero.z, hero.facing, true);
    const a = this.actor;
    // A lead change (or a shiny, form or gender change) redraws it in place.
    a.sprite = want.sprite;
    this.set = want.set;
    this.age++;
    if (moved) {
      if (this.waiting) {
        // Released: it comes out on the tile the player left.
        this.waiting = false;
        a.visible = true;
        a.motion = null;
        a.x = from[0];
        a.z = from[1];
        a.facing = hero.facing;
      } else this.trail.push(from);
    }
    if (!a.motion && this.trail.length) this.stepTo(this.trail.shift()!);
  }

  private stepTo([tx, tz]: [number, number]): void {
    const a = this.actor!;
    const hero = this.h.hero();
    const dx = tx - a.x;
    const dz = tz - a.z;
    const distance = Math.abs(dx) + Math.abs(dz);
    if (distance === 0) return;
    const dir = dx > 0 ? 'right' : dx < 0 ? 'left' : dz > 0 ? 'down' : 'up';
    if (distance === 1) {
      const m = hero.motion;
      const ticks = m?.kind === 'walk' && !m.jump && FASTER[m.ticks] ? m.ticks : WALK_NORMAL_TICKS;
      walk(a, dir, this.trail.length ? FASTER[ticks]! : ticks, m?.anim === 'run' ? 'run' : 'walk', 'type');
      return;
    }
    // The two tiles of a ledge the player jumped.
    if (distance === 2 && (dx === 0 || dz === 0)) return jump(a, dir, 'type');
    // Off its trail (the player was set somewhere): recalled under the player.
    this.trail = [];
    a.motion = null;
    a.x = hero.x;
    a.z = hero.z;
    a.visible = false;
    this.waiting = true;
  }

  /**
   * Its drawing over the actor's view: the frames (idle poses are explicit: HGSS stand sequences also contain
   * both walking frames) and HGSS's draw offset by facing (FollowMonBillboard_AddFacingOffset): a large set
   * (the 64×64 billboard) is drawn a unit further behind its tile facing up or down and 10 units further
   * aside facing left or right; a small one 2 units aside facing left or right. Facing left moves it right,
   * and so on: away from the player it walks after.
   */
  drawView(v: ActorView): ActorView {
    const a = this.actor!;
    const anim: Partial<Pick<ActorView, 'anim' | 'animTick'>> = !a.motion
      ? this.h.walkInPlace() ? { anim: 'walk', animTick: this.age } : { anim: 'stand', animTick: 0 }
      : this.set?.animation === 'loop' ? { anim: 'walk', animTick: this.age } : {};
    const [dx, dz] = (this.set?.size === 'large' ? LARGE_OFFSET : SMALL_OFFSET)[a.facing];
    const t = this.talk ?? { dx: 0, dy: 0, dz: 0 };
    // A talk's offsets apply at once, as the DS sets the position (no interpolation from the tile).
    const shift = (p: ActorView['cur']): ActorView['cur'] => [p[0] + dx + t.dx, p[1] + t.dy, p[2] + dz + t.dz];
    const cur = shift(v.cur);
    return { ...v, ...anim, cur, prev: this.talk ? cur : shift(v.prev), ...(this.bubble ? { bubble: this.bubble } : {}) };
  }

  saved(): NonNullable<GameState['partyFollower']> | null {
    const a = this.actor;
    return a ? { x: a.x, z: a.z, facing: a.facing, waiting: this.waiting } : null;
  }
}
