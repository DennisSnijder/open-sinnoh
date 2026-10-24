/**
 * The Dance Competition on the ROM (docs/research/contests.md §6): the imported song table and its sequences, the beat
 * clock against the sound engine playing each song, a dancer who copies every step perfectly on each rank, and the
 * practice dance as a replay (twice on seeds 1–3 with the save round trip).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readSdat, sdatSource, SoundEngine } from '@opensinnoh/audio';
import { setupPokemon, SOUND_FRAME_CYCLES, type ContestDanceRoundView, type InputFrame, type NewGame } from '@opensinnoh/contracts';
import type { Button, Id } from '@opensinnoh/core';
import { CountingStubLog, createGame } from '@opensinnoh/game';
import { createWorld } from '@opensinnoh/world';
import { createScriptRunner } from '@opensinnoh/vm';
import { createBattle } from '@opensinnoh/battle';
import { createApp, createContestRound } from '@opensinnoh/menus';
import { NitroFs } from '@opensinnoh/nds';
import { contestRandom, contestTables, newContest, npcOutfit } from '@opensinnoh/services';
import { CONTEST_DANCE_SOUNDS, CONTEST_DANCE_TEXTS } from '../../packages/menus/src/contest/dance.ts';
import { danceTiming, sequencerTicks, snap } from '../../packages/menus/src/contest/dance-rules.ts';
import { romSlice } from '../rom.ts';
import { poffinReplay } from './poffin-replays.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const P = (s: string) => `platinum:${s}` as Id;
const game = (seed = 1) => createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, createBattle, createApp, seed, log: new CountingStubLog(() => {}), now: () => '2009-03-22T12:00:00Z' });
const dance = () => (romSlice().pack.registries.newGame as unknown as NewGame[])[0]!.contests!.dance;

describe.skipIf(!ROM)('the Dance Competition (OPENSINNOH_NDS_ROM)', () => {
  it('imports the songs, the song per rank and type, the variants and the AI tables from overlay 17', () => {
    const d = dance();
    expect(d.songs.map((s) => s.sequence)).toEqual(['SEQ_CO_KASHI', 'SEQ_CO_TAKUMA', 'SEQ_PL_MTKAKKO', 'SEQ_PL_MTUTSUK', 'SEQ_PL_MTKAWA', 'SEQ_PL_MTKASHI', 'SEQ_PL_MTTAKMA'].map(P));
    expect(d.songs.map((s) => s.bpm)).toEqual([120, 120, 100, 60, 150, 132, 140]);
    expect(d.songs[0]).toMatchObject({ measures: 2, moves: 3, leadIn: 4, gap: 4, windows: [2, 2, 3, 3] });
    expect(d.choice[0]!.map((c) => c.song)).toEqual([0, 0, 0, 0, 0]);
    expect(d.choice[2]!.map((c) => [c.song, c.variant])).toEqual([[2, 1], [3, 1], [4, 0], [5, 0], [6, 0]]);
    expect(d.variants).toEqual([{ tilemap: 14, beats: 16, tiles: 32 }, { tilemap: 15, beats: 12, tiles: 30 }]);
    expect(d.stage[0]).toEqual({ x: 128, y: 96, z: -512 });
    expect(d.buttons[0]).toEqual({ x: 88, y: 0, w: 80, h: 80 });
    const g = game();
    for (const s of d.songs) expect(g.registries.sequences.get(s.sequence)!.frames, s.sequence).toBeGreaterThan(0);
    for (const n of CONTEST_DANCE_SOUNDS) expect(g.registries.sequences.has(P(n)), n).toBe(true);
    for (const n of CONTEST_DANCE_TEXTS) expect(g.registries.texts.has(P(n)), n).toBe(true);
  });

  it('the beat clock follows each song as the sound engine plays it: its tempo is the table BPM from the first tick', () => {
    const sdat = readSdat(new NitroFs(new Uint8Array(readFileSync(ROM!))).file('/data/sound/pl_sound_data.sdat'));
    const g = game();
    for (const s of dance().songs) {
      const engine = new SoundEngine(sdatSource(sdat), null);
      engine.start('bgm', String(g.registries.sequences.get(s.sequence)!.sourceIndex));
      let frames = 0;
      for (let tick = 0; tick <= 1800; tick++) {
        const want = Math.floor((tick * 33513982) / (30 * SOUND_FRAME_CYCLES));
        for (; frames < want; frames++) engine.frame();
        expect(engine.ticks('bgm'), `${s.sequence} at tick ${tick}`).toBe(sequencerTicks(tick, s.bpm));
      }
    }
  });

  it('a dancer who leads on the beats and copies every step on the half-beat scores the most there is, on every rank', () => {
    for (const [rank, type] of [[0, 0], [1, 2], [2, 0], [2, 3], [3, 4]] as const) {
      const g = game();
      g.state.party.push(setupPokemon(g.state, g.registries, 0, P('SPECIES_STARAVIA'), 20, [P('MOVE_WING_ATTACK'), P('MOVE_QUICK_ATTACK')]));
      const session = newContest(g.state, g.registries, { mode: 'official', rank, type, competition: 2, partySlot: 0, seed: 7 });
      session.scores = { condition: [10, 10, 10, 10], dressUp: [0, 0, 0, 0], dance: null, acting: null };
      // The visual round's outfits: the player's photo (a White Fluff on the head), the NPCs' records for the theme.
      session.dressUp = { accessories: [{ accessory: 0, x: 120, y: 90, priority: 1 }], monPriority: 0, backdrop: 4 };
      const round = createContestRound('dance', { session, registries: g.registries, state: g.state, host: {} as never, log: g.log, rng: () => contestRandom(session) });
      const dancers = (round.view() as ContestDanceRoundView).dancers;
      expect(dancers.find((d) => d.player)!.accessories.map((a) => a.accessory)).toEqual([0]);
      for (const d of dancers.filter((x) => !x.player)) expect(d.accessories.length).toBe(npcOutfit(contestTables(g.registries), session.entrants[d.id]!.opponent!, session.theme).accessories.length);
      expect(dancers.some((d) => !d.player && d.accessories.length)).toBe(true);
      const r = round as unknown as { measure: { round: number; state: number; start: number } | null; clock: { frame: number } | null; log: { entries: { k: number; code: number }[] } };
      const pick = dance().choice[rank]![type]!;
      const t = danceTiming(dance().songs[pick.song]!, dance(), pick.variant);
      const idle: InputFrame = { held: [], pressed: [], touch: null };
      const dirs: Button[] = ['up', 'down', 'left', 'right'];
      let out = null;
      let last = -100;
      let lead = 0;
      let prev = 0;
      for (let tick = 0; tick < 6000 && !out; tick++) {
        const v = round.view() as ContestDanceRoundView;
        let pressed: Button[] = v.message && tick % 4 === 0 ? ['a'] : [];
        const m = r.measure;
        if (m && m.state === 2 && r.clock && !v.message) {
          const at = (r.clock.frame - m.start) >>> 0;
          if (at < prev) lead = 0;
          prev = at;
          const s = snap(at, t.beat);
          // As lead: on each beat at least 15 ticks (the press animation) after the last; as backup: on each logged step's copy.
          if (m.round === 3 && at < t.measure / 2 && s.d === 0 && s.k % 2 === 0 && s.k > 0 && tick - last >= 15 && lead < t.moves) {
            pressed = [dirs[lead++ % 4]!];
            last = tick;
          }
          if (m.round < 3) for (const e of r.log.entries) if (s.d === 0 && s.k === e.k + t.halfBeats / 2) pressed = [dirs[e.code - 1]!];
        }
        out = round.step({ ...idle, pressed, held: pressed });
      }
      expect(out?.kind, `rank ${rank} type ${type}`).toBe('dance');
      expect((out as { points: number[] }).points[0], `rank ${rank} type ${type}`).toBe(4 * t.measures * t.moves * 2);
    }
  });

  poffinReplay('sys-contest-practice-dance');
});
