/**
 * Follower talk (OpenSinnoh option `followerTalk`, with the HGSS add-on's `followerTalk` record; HGSS
 * scr_seq_0163 and follow_mon_interaction.c): A on the following Pokémon. It turns to the player (the select sound),
 * then FollowMon_SelectInteraction scans the rules (a chance roll first, then the predicates) and
 * FollowMonInteraction_Run plays the interaction one step at a time: a motion (offsets and facings frame by frame, the
 * cry on its sound frames, then back), an emote bubble, a message in the field box closed by A or B, a wait.
 *
 * Mapped onto Platinum (contracts FollowerTalk): only HGSS's global rules; the situation is the lead's HP, status,
 * types, friendship, the follower's facing and tile, the zone's hidden items left, and the follower's mood. Mood is
 * HGSS's own state (−127…127): here it lives with the running game, not the save, so the talk changes nothing a save
 * holds: it starts neutral, each interaction adds its change, and each step of the player moves it one point back
 * toward 0. HGSS's friendship changes are left out (they would change friendship evolutions).
 */
import { dexOf, type CryMod, type FollowerTalk, type GameState, type InputFrame, type Registries, type ScriptRunner, type World } from '@opensinnoh/contracts';
import type { Id, Pokemon } from '@opensinnoh/core';

/** HGSS FollowMonSituation_ConvertType: its own code per type name. */
const TYPE_CODES: Record<string, number> = {
  TYPE_NORMAL: 1, TYPE_FIRE: 2, TYPE_WATER: 3, TYPE_ELECTRIC: 4, TYPE_GRASS: 5, TYPE_ICE: 6, TYPE_FIGHTING: 7, TYPE_POISON: 8, TYPE_GROUND: 9,
  TYPE_FLYING: 10, TYPE_PSYCHIC: 11, TYPE_BUG: 12, TYPE_ROCK: 13, TYPE_GHOST: 14, TYPE_DRAGON: 15, TYPE_DARK: 16, TYPE_STEEL: 17,
};
/** FollowMonSituation_SetMonCondition's status codes. */
const STATUS_CODES: Record<Pokemon['status'], number> = { none: 1, burn: 2, freeze: 3, paralysis: 4, poison: 5, toxic: 5, sleep: 8 };
/** FollowMonSituation_SetFacing: east 1, west 2, north 3, south 4. */
const FACING_CODES = { right: 1, left: 2, up: 3, down: 4 } as const;
/** The cries a step plays (SEQ_SE_END + 1: PlayCryEx mod 0; + 2: mod 11, the Pokédex's plain cry). */
const CRIES: Record<1 | 2, CryMod> = { 1: 'normal', 2: 'pokedex' };
/** EmoteBubbleEffect_Update: it rises with velocity 6, slowed by 2 a tick, until back at 0. */
const RISE = [6, 10, 12, 12, 10, 6];
/** After its frames the bubble stays 2 ticks. */
const BUBBLE_HOLD = 2;

type Talk = FollowerTalk;
type Interaction = Talk['interactions'][number];
type Step = Interaction['steps'][number];

export interface FollowerTalkDeps {
  registries: Registries;
  state(): GameState;
  world(): World;
  scripts(): ScriptRunner;
  sound: { playSe(seq: Id): void; playCry(species: Id, form?: number, mod?: CryMod): void };
  rng(): number;
  /** The base pack's namespace (its sounds). */
  ns: string;
  on(): boolean;
}

/** HGSS FollowMonRule_CheckFriendship. */
export function friendshipMatches(rule: number, f: number): boolean {
  return [f === 255, f >= 200 && f < 255, f >= 150 && f < 200, f >= 90 && f < 150, f >= 60 && f < 90, f >= 30 && f < 60, f >= 1 && f < 30, f === 0, f >= 90, f < 60][rule - 1] ?? false;
}

/** HGSS FollowMonRule_CheckMood. */
export function moodMatches(rule: number, m: number): boolean {
  return [m === 127, m >= 100 && m < 127, m >= 50 && m < 100, m >= 30 && m < 50, m > -30 && m < 30, m > -50 && m <= -30, m > -127 && m <= -50, m === -127, m >= 0, m <= -1][rule - 1] ?? false;
}

export interface Situation {
  hp: number;
  status: number;
  types: number[];
  friendship: number;
  mood: number;
  behavior: number;
  hiddenItems: number;
  facing: number;
}

/** HGSS FollowMonRule_Matches over the predicates a global rule uses; the chance roll comes first, for every rule tried. */
export function selectInteraction(talk: Talk, s: Situation, roll: () => number): number {
  for (const r of talk.rules) {
    if (roll() % 100 >= r.chance) continue;
    if (r.hp && r.hp !== s.hp) continue;
    if (r.status && (r.status === 7 ? ![2, 3, 4, 5, 8].includes(s.status) : r.status !== s.status)) continue;
    if (r.type && !s.types.includes(r.type)) continue;
    if (r.behavior && r.behavior !== s.behavior) continue;
    if (r.mood && !moodMatches(r.mood, s.mood)) continue;
    if (r.friendship && !friendshipMatches(r.friendship, s.friendship)) continue;
    if (r.hiddenItems && (r.hiddenItems === 4 ? s.hiddenItems < 4 : r.hiddenItems !== s.hiddenItems)) continue;
    if (r.facing && r.facing !== s.facing) continue;
    return r.interaction;
  }
  // HGSS asserts here: its rules end with ones that match anything.
  throw new Error('follower talk: no rule matched');
}

export function followerTalk(d: FollowerTalkDeps) {
  let mood = 0;
  let tile: string | null = null;
  /** The interaction running (FollowMonInteraction), or null. */
  let run: {
    talk: Talk;
    mon: Pokemon;
    interaction: Interaction;
    step: number;
    state: 'start' | 'motion' | 'message' | 'wait';
    motion: { frames: Talk['motions'][number]['frames']; frame: number; tick: number; dx: number; dy: number; dz: number; facing: GameState['player']['facing'] } | null;
    savedFacing: GameState['player']['facing'];
    waited: number;
  } | null = null;
  /** The bubble over the follower: its sprite, the ticks since it appeared. */
  let bubble: { sprite: Id; tick: number; frames: Talk['emoteFrames'] } | null = null;

  const record = (): Talk | null => [...d.registries.followerTalk.values()].at(-1) ?? null;
  const lead = (s: GameState) => s.party.find((m) => !m.isEgg && m.hp > 0) ?? null;

  const hiddenItems = (s: GameState): number => {
    const zone = d.registries.zones.get(s.player.zone)!;
    return zone.events.bgs.filter((b) => b.hiddenItem && !(s.flags[b.hiddenItem.flag] ?? d.registries.flags.get(b.hiddenItem.flag)?.initial ?? false)).length;
  };

  const slots = (s: GameState, mon: Pokemon): string[] => {
    const species = d.registries.species.get(mon.species)!.name;
    return [mon.nickname ?? species, species, s.names.player, d.registries.zones.get(s.player.zone)!.name, mon.heldItem ? d.registries.items.get(mon.heldItem)!.name : ''];
  };

  /** The bubble's frame and rise this tick (EmoteBubbleEffect_Update, EmoteBubbleAnim_Advance), or null once it is gone. */
  const stepBubble = () => {
    if (!bubble) return;
    const t = bubble.tick++;
    let frame = 0;
    let rise = 0;
    if (t < RISE.length) rise = RISE[t]!;
    else {
      let at = t - RISE.length;
      let i = 0;
      // Each frame shows for its sequence value as ticks (the start values used as durations); then 2 ticks held.
      for (; i < bubble.frames.length; i++) {
        const ticks = Math.max(1, bubble.frames[i]!.ticks);
        if (at < ticks) break;
        at -= ticks;
      }
      if (i >= bubble.frames.length && at >= BUBBLE_HOLD) {
        bubble = null;
        d.world().followerBubble(null);
        return;
      }
      frame = bubble.frames[Math.min(i, bubble.frames.length - 1)]!.frame;
    }
    d.world().followerBubble({ sprite: bubble.sprite, frame, rise });
  };

  const playSe = (name: string) => {
    const seq = `${d.ns}:${name}` as Id;
    if (d.registries.sequences.has(seq)) d.sound.playSe(seq);
  };

  /** One step of FollowMonInteraction_Run's states 0–4 in one tick, as the DS falls through them. */
  const startStep = (): void => {
    const r = run!;
    const step: Step | undefined = r.interaction.steps[r.step];
    if (!step) return finish();
    if (step.motion) {
      const motion = r.talk.motions.find((m) => m.id === step.motion);
      if (!motion) throw new Error(`follower talk: no motion ${step.motion}`);
      r.motion = { frames: motion.frames, frame: 0, tick: 0, dx: 0, dy: 0, dz: 0, facing: r.savedFacing };
      r.state = 'motion';
      return;
    }
    afterMotion(step);
  };
  const afterMotion = (step: Step): void => {
    const r = run!;
    if (step.emote) {
      bubble = { sprite: r.talk.emotes[step.emote - 1]!, tick: 0, frames: r.talk.emoteFrames };
      playSe('SEQ_SE_DP_DECIDE');
    }
    if (step.message) {
      const text = r.talk.messages.find((m) => m.id === step.message);
      if (!text) throw new Error(`follower talk: no message ${step.message}`);
      d.scripts().notice({ markup: text.text }, slots(d.state(), r.mon));
      r.state = 'message';
      return;
    }
    afterMessage(step);
  };
  const afterMessage = (step: Step): void => {
    const r = run!;
    if (step.wait) {
      r.waited = 0;
      r.state = 'wait';
      return;
    }
    r.step++;
    r.state = 'start';
    startStep();
  };
  const finish = (): void => {
    const r = run!;
    mood = Math.max(-127, Math.min(127, mood + r.interaction.mood));
    run = null;
  };

  /** FollowMonInteraction_RunMovement, a tick: each frame applies its offset, cry and facing at its start. */
  const stepMotion = (): void => {
    const r = run!;
    const m = r.motion!;
    const step = r.interaction.steps[r.step]!;
    if (m.frame >= m.frames.length) {
      // Back on its tile, facing as before the motion (FollowMonInteraction_RunMovement state 4).
      d.world().followerTalkPose({ dx: 0, dy: 0, dz: 0, facing: r.savedFacing });
      d.world().followerTalkPose(null);
      r.motion = null;
      return afterMotion(step);
    }
    const f = m.frames[m.frame]!;
    if (m.tick === 0) {
      m.dx += f.dx;
      // FollowMonMovement_ApplyOffset: Diglett and Dugtrio keep their height.
      if (!/:SPECIES_(DIGLETT|DUGTRIO)$/.test(r.mon.species)) m.dy += f.dy;
      m.dz += f.dz;
      if (f.sound && step.cry) d.sound.playCry(r.mon.species, r.mon.form, CRIES[step.cry]);
      if (f.facing) m.facing = f.facing;
      d.world().followerTalkPose({ dx: m.dx, dy: m.dy, dz: m.dz, facing: m.facing });
    }
    if (++m.tick >= f.ticks) {
      m.frame++;
      m.tick = 0;
    }
  };

  return {
    /** A talk is running: the field takes no input, and nothing is saved. */
    active: () => run !== null || bubble !== null,
    /**
     * A on the idle field: when the option is on, the add-on is loaded and the player faces the follower, the talk
     * starts (true: the frame is taken).
     */
    tryStart(frame: InputFrame): boolean {
      if (!frame.pressed.includes('a') || !d.on()) return false;
      const talk = record();
      const s = d.state();
      const mon = lead(s);
      if (!talk || !mon) return false;
      const follower = d.world().talkToFollower();
      if (!follower) return false;
      playSe('SEQ_SE_DP_SELECT');
      const types = [...new Set(dexOf(d.registries).form(mon.species, mon.form).types)].map((t) => TYPE_CODES[t.slice(t.indexOf(':') + 1)] ?? 0);
      const hp = Math.floor((mon.hp * 100) / mon.stats.hp);
      const situation: Situation = {
        hp: hp === 100 ? 1 : hp >= 75 ? 2 : hp >= 50 ? 3 : hp >= 25 ? 4 : 5,
        status: STATUS_CODES[mon.status],
        types,
        friendship: mon.friendship,
        mood,
        behavior: follower.behavior,
        hiddenItems: hiddenItems(s),
        facing: FACING_CODES[follower.facing],
      };
      const id = selectInteraction(talk, situation, d.rng);
      const interaction = talk.interactions.find((i) => i.id === id);
      if (!interaction) throw new Error(`follower talk: no interaction ${id}`);
      run = { talk, mon, interaction, step: 0, state: 'start', motion: null, savedFacing: follower.facing, waited: 0 };
      startStep();
      return true;
    },
    /** One tick while active. */
    step(): void {
      stepBubble();
      const r = run;
      if (!r) return;
      if (r.state === 'motion') stepMotion();
      else if (r.state === 'message') {
        if (d.scripts().running()) return;
        afterMessage(r.interaction.steps[r.step]!);
      } else if (r.state === 'wait') {
        if (r.waited >= r.interaction.steps[r.step]!.wait) {
          r.step++;
          r.state = 'start';
          startStep();
        } else r.waited++;
      }
    },
    /** Each tick of the field: a step of the player moves the mood one point back toward neutral. */
    stepMood(): void {
      const p = d.state().player;
      const here = `${p.zone}:${p.x}:${p.z}`;
      if (tile !== null && here !== tile && mood !== 0) mood -= Math.sign(mood);
      tile = here;
    },
    get mood() {
      return mood;
    },
  };
}
