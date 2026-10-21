import { describe, expect, it } from 'vitest';
import type { FollowerTalk, GameState, InputFrame, Registries, ScriptRunner, World } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { followerTalk, friendshipMatches, moodMatches, selectInteraction, type Situation } from './follower-talk.ts';
import { loadGamePacks } from './packs.ts';
import { readPack } from '../test/packs.ts';

/** An original talk table: a sleepy rule, a happy rule (friendship ≥ 90) half the time, and one for anything. */
const TALK: FollowerTalk = {
  id: 'test:FOLLOWER_TALK' as Id,
  rules: [
    { interaction: 1, chance: 100, hp: 0, status: 8, friendship: 0, mood: 0, type: 0, behavior: 0, hiddenItems: 0, facing: 0 },
    { interaction: 2, chance: 50, hp: 0, status: 0, friendship: 9, mood: 0, type: 0, behavior: 0, hiddenItems: 0, facing: 0 },
    { interaction: 3, chance: 100, hp: 0, status: 0, friendship: 0, mood: 0, type: 0, behavior: 0, hiddenItems: 0, facing: 0 },
  ],
  interactions: [
    { id: 1, steps: [{ motion: 0, emote: 0, message: 1, cry: 0, wait: 0 }], mood: 0 },
    { id: 2, steps: [{ motion: 0, emote: 0, message: 2, cry: 0, wait: 0 }], mood: 10 },
    {
      id: 3,
      steps: [
        { motion: 1, emote: 2, message: 0, cry: 1, wait: 0 },
        { motion: 0, emote: 0, message: 3, cry: 0, wait: 4 },
      ],
      mood: 5,
    },
  ],
  motions: [{ id: 1, frames: [{ facing: 'left', ticks: 2, dx: 0, dy: 4, dz: 0, sound: true }, { facing: null, ticks: 2, dx: 0, dy: -4, dz: 0, sound: false }] }],
  messages: [
    { id: 1, text: '{var 0} is dozing.' },
    { id: 2, text: '{var 0} beams at {var 2}!' },
    { id: 3, text: '{var 0} looks around {var 3}.' },
  ],
  emotes: Array.from({ length: 14 }, (_, k) => `test:SPRITE_EMOTE_${k}` as Id),
  emoteFrames: [{ frame: 0, ticks: 0 }, { frame: 1, ticks: 2 }],
};

const base: Situation = { hp: 1, status: 1, types: [1], friendship: 70, mood: 0, behavior: 0, hiddenItems: 0, facing: 4 };

describe('follower talk (HGSS FollowMon_SelectInteraction)', () => {
  it('matches friendship and mood codes as HGSS does', () => {
    expect([1, 2, 9, 10].map((r) => friendshipMatches(r, 255))).toEqual([true, false, true, false]);
    expect([4, 5, 9, 10].map((r) => friendshipMatches(r, 70))).toEqual([false, true, false, false]);
    expect([5, 9, 10].map((r) => moodMatches(r, 0))).toEqual([true, true, false]);
    expect([6, 7, 8, 10].map((r) => moodMatches(r, -127))).toEqual([false, false, true, true]);
  });

  it('rolls each rule tried, then checks it; the first that passes picks the interaction', () => {
    const rolls = (...xs: number[]) => () => xs.shift()!;
    expect(selectInteraction(TALK, { ...base, status: 8 }, rolls(0))).toBe(1);
    // Friendship 120 matches rule 2, but a roll of 50 or more fails its chance.
    expect(selectInteraction(TALK, { ...base, friendship: 120 }, rolls(0, 49))).toBe(2);
    expect(selectInteraction(TALK, { ...base, friendship: 120 }, rolls(0, 50, 0))).toBe(3);
    expect(selectInteraction(TALK, base, rolls(0, 0, 99))).toBe(3);
    expect(() => selectInteraction({ ...TALK, rules: TALK.rules.slice(0, 1) }, base, rolls(0))).toThrow('no rule matched');
  });

  it('plays an interaction: the motion with its cry, the bubble, a message closed by A, a wait; then the mood changes', () => {
    const fixture = loadGamePacks([readPack('fixture')]).registries;
    const registries = { ...fixture, followerTalk: new Map([[TALK.id, TALK]]) } as Registries;
    const state = {
      party: [{ species: 'fixture:SPECIES_MOSSLET', form: 0, nickname: 'Moss', hp: 20, stats: { hp: 20 }, status: 'none', friendship: 70, isEgg: false, heldItem: null }],
      names: { player: 'Ari' },
      player: { zone: 'fixture:TOWN', x: 1, z: 1 },
      flags: {},
    } as unknown as GameState;
    const town = fixture.zones.get('fixture:TOWN' as Id)!.name;
    const poses: unknown[] = [];
    const bubbles: unknown[] = [];
    const notices: [unknown, string[]][] = [];
    const cries: string[] = [];
    let messageOpen = false;
    const world = {
      talkToFollower: () => ({ facing: 'down' as const, behavior: 0 }),
      followerTalkPose: (p: unknown) => void poses.push(p),
      followerBubble: (b: unknown) => void bubbles.push(b),
    } as unknown as World;
    const scripts = { notice: (t: unknown, s: string[]) => ((messageOpen = true), void notices.push([t, s])), running: () => messageOpen } as unknown as ScriptRunner;
    const talk = followerTalk({ registries, state: () => state, world: () => world, scripts: () => scripts, sound: { playSe: () => {}, playCry: (s) => void cries.push(s) }, rng: () => 99, ns: 'test', on: () => true });
    const a: InputFrame = { held: ['a'], pressed: ['a'], touch: null };
    expect(talk.tryStart({ ...a, pressed: [] })).toBe(false);
    expect(talk.tryStart(a)).toBe(true);
    talk.step();
    // The motion: offset and facing at once, the cry on its sound frame.
    expect(poses[0]).toEqual({ dx: 0, dy: 4, dz: 0, facing: 'left' });
    expect(cries).toEqual(['fixture:SPECIES_MOSSLET']);
    for (let i = 0; i < 4; i++) talk.step();
    expect(poses.slice(1)).toEqual([{ dx: 0, dy: 0, dz: 0, facing: 'left' }, { dx: 0, dy: 0, dz: 0, facing: 'down' }, null]);
    // Back on its tile: the bubble comes up (rising), and the second step's message prints with its slots
    // (nickname, species, player, location, item).
    talk.step();
    expect(bubbles.at(-1)).toMatchObject({ sprite: 'test:SPRITE_EMOTE_1', frame: 0, rise: 6 });
    expect(notices).toEqual([[{ markup: '{var 0} looks around {var 3}.' }, ['Moss', fixture.species.get('fixture:SPECIES_MOSSLET' as Id)!.name, 'Ari', town, '']]]);
    talk.step();
    expect(talk.active()).toBe(true);
    messageOpen = false;
    for (let i = 0; i < 30; i++) talk.step();
    expect(talk.active()).toBe(false);
    expect(talk.mood).toBe(5);
    // A step of the player moves the mood back one.
    talk.stepMood();
    state.player.x = 2;
    talk.stepMood();
    expect(talk.mood).toBe(4);
  });
});
