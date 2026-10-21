import { fixtureAudio } from '../../../tests/fixtures/audio.ts';
import { describe, expect, it } from 'vitest';
import type { FollowerSprite, GameState, Registries } from '@opensinnoh/contracts';
import { f, mon, newState, registries, setup } from './testing.ts';
import { createWorld } from './world.ts';
import { FakeRunner } from './testing.ts';
import { followerSet, PARTY_FOLLOWER_LOCALID } from './party-follower.ts';

const set = (over: Partial<FollowerSprite> = {}): FollowerSprite => ({
  id: f('FOLLOWER_MOSSLET'),
  species: f('SPECIES_MOSSLET'),
  form: 0,
  sprite: f('SPRITE_HELPER'),
  size: 'small',
  animation: 'walk',
  ...over,
});

function regsWith(...sets: FollowerSprite[]): Registries {
  return { ...registries, followers: new Map(sets.map((s) => [s.id, s])) };
}

function withLead(state: GameState = newState(), ...species: string[]): GameState {
  state.party = (species.length ? species : ['SPECIES_MOSSLET']).map((s) => mon(s, 5));
  return state;
}

const petView = (g: ReturnType<typeof setup>) => g.world.view().actors.find((a) => a.localId === PARTY_FOLLOWER_LOCALID);

describe('party follower', () => {
  it('waits under the player after a map load and comes out on the tile they leave', () => {
    const g = setup(withLead(), { regs: regsWith(set()) });
    expect(g.state.partyFollower).toEqual({ x: 14, z: 16, facing: 'up', waiting: true });
    expect(petView(g)?.visible).toBe(false);
    g.hold(['up'], 8);
    expect(g.state.partyFollower).toEqual({ x: 14, z: 16, facing: 'up', waiting: false });
    expect(petView(g)).toMatchObject({ visible: true, sprite: f('SPRITE_HELPER') });
    g.hold(['up'], 8);
    // Walking behind: it moves into the tile the player left, in step with them.
    expect(g.state.partyFollower).toMatchObject({ x: 14, z: 15, facing: 'up' });
    g.hold(['right'], 8);
    expect(g.state.player).toMatchObject({ x: 15, z: 14 });
    expect(g.state.partyFollower).toMatchObject({ x: 14, z: 14, facing: 'up' });
    g.tick();
    expect(g.world.idle()).toBe(true);
  });

  it('never blocks the player: walking back into it swaps places', () => {
    const g = setup(withLead(), { regs: regsWith(set()) });
    g.hold(['up'], 16);
    g.tick();
    g.hold(['down'], 2 + 8);
    expect(g.state.player).toMatchObject({ x: 14, z: 15, facing: 'down' });
    expect(g.state.partyFollower).toMatchObject({ x: 14, z: 14 });
  });

  it('follows the lead that is not an egg and not fainted; none without a set', () => {
    const state = withLead(newState(), 'SPECIES_EMBERKIT', 'SPECIES_MOSSLET');
    const g = setup(state, { regs: regsWith(set()) });
    expect(g.state.partyFollower).toBeNull();
    g.state.party[0]!.hp = 0;
    g.tick();
    expect(g.state.partyFollower).toMatchObject({ x: 14, z: 16, waiting: true });
    g.state.party[1]!.isEgg = true;
    g.tick();
    expect(g.state.partyFollower).toBeNull();
    expect(petView(g)).toBeUndefined();
  });

  it('picks the female set for a female and the shiny sprite for a shiny', () => {
    const regs = regsWith(set(), set({ id: f('FOLLOWER_MOSSLET_F'), gender: 'female', sprite: f('SPRITE_GUIDE'), shiny: f('SPRITE_BOULDER') }));
    const m = mon('SPECIES_MOSSLET', 5);
    m.pid = 0; // MOSSLET's gender ratio 31 > (pid & 0xff): female
    expect(followerSet(regs, m)?.id).toBe(f('FOLLOWER_MOSSLET_F'));
    m.pid = 0xff;
    expect(followerSet(regs, m)?.id).toBe(f('FOLLOWER_MOSSLET'));
    m.form = 1;
    expect(followerSet(regs, m)).toBeNull();
  });

  it('takes the set loaded last for a species, form and gender, whatever its id (base, add-on, mod)', () => {
    const regs = regsWith(set(), set({ id: f('ADDON_MOSSLET'), sprite: f('SPRITE_GUIDE') }));
    expect(followerSet(regs, mon('SPECIES_MOSSLET', 5))?.sprite).toBe(f('SPRITE_GUIDE'));
  });

  it('is recalled while the option is off, with the story follower, on the bike, where the zone refuses it and in the Distortion World', () => {
    let on = true;
    const state = withLead();
    const scripts = new FakeRunner(state);
    state.vars[f('VAR_ROOM_INTRO')] = 1;
    const large = set({ size: 'large' });
    const regs = regsWith(large);
    const world = createWorld({ audio: fixtureAudio(regs, state), registries: regs, state, scripts, log: { stub: () => {} }, battleLog: () => {}, battles: { start: () => {}, done: () => null, blackOut: () => {} }, clock: () => state.gameTime.now, followers: () => on });
    const tick = () => {
      world.checkTriggers({ held: [], pressed: [], touch: null });
      world.step({ held: [], pressed: [], touch: null });
    };
    world.enter('arrival');
    tick();
    expect(state.partyFollower).toBeDefined();
    on = false;
    tick();
    expect(state.partyFollower).toBeNull();
    on = true;
    state.hasPartner = true;
    tick();
    expect(state.partyFollower).toBeNull();
    state.hasPartner = false;
    world.setPlayerState('cycle');
    tick();
    expect(state.partyFollower).toBeNull();
    world.setPlayerState('walk');
    tick();
    expect(state.partyFollower).toMatchObject({ waiting: true });
    // ROOM's follow mode: restrict refuses the large set, prevent refuses any.
    (regs.zones.get(f('ROOM')) as { follow?: string }).follow = 'height-restrict';
    tick();
    expect(state.partyFollower).toBeNull();
    (regs.zones.get(f('ROOM')) as { follow?: string }).follow = 'allow';
    tick();
    expect(state.partyFollower).toBeDefined();
    delete (regs.zones.get(f('ROOM')) as { follow?: string }).follow;
    // A Distortion World room refuses it whatever its follow mode: the player walks walls and ceilings and jumps
    // diagonally between them there, where no trail can follow (a save at rest put it back off the trail).
    const rooms = regs.distortionRooms;
    (regs as { distortionRooms: Registries['distortionRooms'] }).distortionRooms = new Map([[f('ROOM'), {} as never]]);
    tick();
    expect(state.partyFollower).toBeNull();
    (regs as { distortionRooms: Registries['distortionRooms'] }).distortionRooms = rooms;
    tick();
    expect(state.partyFollower).toBeDefined();
  });

  it('is saved where it stands and put back there by a load', () => {
    const regs = regsWith(set());
    const g = setup(withLead(), { regs });
    g.hold(['up'], 16);
    g.hold(['right'], 8);
    g.tick();
    const saved = structuredClone(g.state);
    expect(saved.partyFollower).toEqual({ x: 14, z: 14, facing: 'up', waiting: false });
    const again = setup(saved, { regs, entry: 'load' });
    expect(again.state.partyFollower).toEqual({ x: 14, z: 14, facing: 'up', waiting: false });
    expect(again.state.player).toMatchObject({ x: 15, z: 14 });
    again.hold(['right'], 8);
    expect(again.state.partyFollower).toMatchObject({ x: 15, z: 14, facing: 'right' });
  });

  it('changes nothing else: the same input plays the same with and without it, a load included (RNG too)', () => {
    const play = (regs: Registries) => {
      const g = setup(withLead(), { regs });
      g.hold(['up'], 16);
      g.hold(['right'], 8);
      g.hold(['down'], 10);
      g.tick();
      const again = setup(structuredClone(g.state), { regs, entry: 'load' });
      again.hold(['left'], 8);
      again.tick();
      const { partyFollower, ...rest } = again.state;
      return { partyFollower, rest };
    };
    const withPet = play(regsWith(set()));
    const without = play(registries);
    expect(withPet.partyFollower).not.toBeNull();
    expect(without.partyFollower).toBeNull();
    expect(withPet.rest).toEqual(without.rest);
  });

  it.each(['walk', 'loop'] as const)('a %s set holds its facing idle pose while the player stands still', (animation) => {
    const g = setup(withLead(), { regs: regsWith(set({ animation })) });
    g.hold(['up'], 16);
    g.hold([], 16);
    const a = petView(g)!;
    expect(a).toMatchObject({ visible: true, facing: 'up', anim: 'stand', animTick: 0 });
    g.hold([], 48);
    expect(petView(g)).toEqual(a);
    g.hold(['right'], 3);
    expect(petView(g)?.anim).toBe('walk');
  });

  it('is drawn offset by facing, away from the player, as HGSS draws followers', () => {
    const want = { large: { up: [0, 1], left: [10, 0], right: [-10, 0] }, small: { up: [0, 0], left: [2, 0], right: [-2, 0] } };
    for (const size of ['large', 'small'] as const) {
      for (const dir of ['up', 'left', 'right'] as const) {
        const g = setup(withLead(), { regs: regsWith(set({ size })) });
        g.hold([dir], 40);
        g.hold([], 16);
        expect(g.state.partyFollower?.facing).toBe(dir);
        const tile = (g.world as unknown as { pet: { actor: { cur: number[] } } }).pet.actor.cur;
        const v = petView(g)!;
        const [dx, dz] = want[size][dir];
        expect([v.cur[0] - tile[0]!, v.cur[2] - tile[2]!]).toEqual([dx, dz]);
        expect(v.prev).toEqual(v.cur);
      }
    }
  });

  it('jumps the ledge the player jumped, and waits under the player after a warp', () => {
    const g = setup(withLead(newState('ROUTE_W', 14, 12, 'down')), { regs: regsWith(set()) });
    g.hold(['down'], 8);
    expect(g.state.partyFollower).toMatchObject({ x: 14, z: 12, waiting: false });
    g.hold(['down'], 16);
    expect(g.state.player).toMatchObject({ x: 14, z: 15 });
    expect(g.state.partyFollower).toMatchObject({ x: 14, z: 13 });
    g.hold(['down'], 4);
    // Mid-jump over the ledge: above the ground.
    const pet = petView(g)!;
    expect(g.state.partyFollower).toMatchObject({ x: 14, z: 15 });
    expect(pet.cur[1]).toBeGreaterThan(0);
    g.hold([], 20);
    g.world.warp(f('ROUTE_W'), 23, 16, 'right');
    g.settle();
    expect(g.state.partyFollower).toEqual({ x: 23, z: 16, facing: 'right', waiting: true });
  });
});
