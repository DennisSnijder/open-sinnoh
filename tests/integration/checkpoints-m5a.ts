/**
 * M5a story checkpoints, headless (OPENSINNOH_NDS_ROM), from the chain anchor
 * (checkpoints-anchors.ts: CP4's end, played once per seed and cached):
 *
 * - checkpoints-m5a-<seed>[-end].rom.test.ts: each chunk replay twice from its parent's anchor (cp5 from CP4's
 *   end, cp6 from cp5's, …) on seed 1, 2 or 3, ending with a save round trip.
 * - checkpoints-m5a-late-<seed>[-shift-N].rom.test.ts: each chunk replay started 1, 2, 5 and 15 ticks late (the
 *   shift goes after the anchor's load, so it moves the chunk only; CP1–4's own late starts are
 *   checkpoints-late-*.rom.test.ts).
 * - checkpoints-m5a-branches[-<seed>].rom.test.ts: the branch replays (M5A_BRANCHES), one seed per file.
 * - checkpoints-m5a-anchor.rom.test.ts: the proof. The last chunk replay from a new game (opening → cp4 →
 *   … with `from`), twice, must save the anchor at its `+0 reload` and end in the anchored run's state.
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '@opensinnoh/contracts';
import { CountingStubLog, gameDriver, runReplay, type ReplayOptions, type ReplayResult } from '@opensinnoh/game';
import { ROM } from '../rom.ts';
import { anchoredDriver, anchoredText, branchParent, chainAnchor, chunkParent, M5A, M5B, M5C, M6, readReplay, storyGame, type Chunk } from './checkpoints-anchors.ts';

const SHIFTS = [1, 2, 5, 15];

/** The replay with `shift` idle ticks before its first timed line. */
function shifted(text: string, shift: number): string {
  if (!shift) return text;
  const lines = text.split('\n');
  const first = lines.findIndex((l) => /^(\+?\d+|until|advance|battle|grind)\s/.test(l.trim()));
  lines.splice(first, 0, `+${shift} release select  # shifted`);
  return lines.join('\n');
}

/** The partner of the first type 74/75 battle each chunk or branch replay screenshots (asserted at that screenshot). */
const PARTNERS: Record<string, string> = {
  'cp5.replay': 'platinum:TRAINER_DAWN_JUBILIFE_CITY_PIPLUP',
  'cp6.replay': 'platinum:TRAINER_CHERYL_ETERNA_FOREST',
  'cp8.replay': 'platinum:TRAINER_DAWN_VEILSTONE_CITY_PIPLUP',
  // Gender × starter (a girl with Turtwig): Lucas's Turtwig team.
  'm5-tag-jubilife-turtwig.replay': 'platinum:TRAINER_LUCAS_JUBILIFE_CITY_TURTWIG',
  'm5-eterna-forest-chimchar.replay': 'platinum:TRAINER_CHERYL_ETERNA_FOREST',
  'm5-tag-riley.replay': 'platinum:TRAINER_RILEY_IRON_ISLAND',
  'm5-spear-pillar-chimchar.replay': 'platinum:TRAINER_RIVAL_SPEAR_PILLAR_CHIMCHAR',
  'cp20.replay': 'platinum:TRAINER_RIVAL_FIGHT_AREA_PIPLUP',
};

const ALL = [1, 2, 3];
/**
 * The stand-ins each replay meets (no stub on the path except a listed allowlist): logged stubs, protocol
 * lines without a message and presentation stubs, by the seeds that meet them (a move animation only where a seed's
 * battles draw that move). docs/research/story-cp5-19.md "Stub allowlist" gives each one's reason. A run
 * that meets a stub not listed for its seed fails, and so does one that no longer meets a listed stub, so the list
 * stays honest.
 */
const STUBS: Record<string, Record<string, readonly number[]>> = {
  'cp5.replay': {
    'render:hm-cut-in': ALL,
    'evolution:records': ALL,
    'anim:cry-mod:9': [1, 2],
  },
  'cp6.replay': {
    'render:hm-cut-in': ALL,
    'evolution:records': ALL,
    'anim:cry-mod:9': ALL,
    'anim:platinum:MOVE_SPITE': [1, 2],
    'battle:protocol:-curestatus|P|psn|[msg]': [1],
    'battle:protocol:-formechange|P|Cherrim-Sunshine|[msg]|[from] ability: Flower Gift': [1, 2],
  },
  'cp7.replay': {
    'render:hm-cut-in': ALL,
  },
  'cp8.replay': {
  },
  // M5b (docs/research/story-cp5-19.md §"Stub allowlist (M5b)").
  'cp9.replay': {
  },
  'cp10.replay': {
    'anim:platinum:MOVE_NIGHT_SHADE': [1, 3],
  },
  'cp11.replay': {
    'render:hm-cut-in': ALL, // Surf now uses the shared presenter; its graphic remains unrendered.
    'anim:platinum:MOVE_SURF': ALL,
    'stub:turn_on_pokedex_form_detection': ALL,
  },
  'cp12.replay': {
    'render:hm-cut-in': ALL, // Surf on the return across Route 218.
    'anim:platinum:MOVE_SURF': ALL,
  },
  'cp13.replay': {
    'anim:platinum:MOVE_SURF': ALL,
    'render:hm-cut-in': ALL,
  },
  'm5-cheryl-detach.replay': {},
  'm5-eterna-egg-declined.replay': { 'render:hm-cut-in': ALL },
  'm5-tag-jubilife-lost.replay': {},
  'm5-tag-jubilife-turtwig.replay': {},
  'm5-eterna-forest-chimchar.replay': {},
  'm5-route-207-lucas.replay': {},
  'm5-rival-209-chimchar.replay': {},
  // M5b branches.
  'm5-rival-pastoria-turtwig.replay': {},
  'm5-valor-lakefront-chimchar.replay': {},
  'm5-canalave-chimchar.replay': { 'anim:platinum:MOVE_SURF': ALL, 'stub:turn_on_pokedex_form_detection': ALL },
  'm5-library-lucas.replay': {},
  'm5-lake-verity-lucas.replay': { 'anim:cry-mod:9': ALL, 'anim:platinum:MOVE_SURF': ALL },
  'm5-lake-acuity-turtwig.replay': {},
  'm5-tag-riley.replay': { 'anim:platinum:MOVE_SURF': ALL },
  // M5c (docs/research/story-cp5-19.md §"Stub allowlist (M5c)").
  'cp14.replay': {
    'anim:platinum:MOVE_NIGHT_SHADE': [2],
    'anim:platinum:MOVE_SURF': ALL,
    'render:hm-cut-in': ALL,
  },
  'm5-galactic-hq-chimchar.replay': {},
  'm5-spear-pillar-chimchar.replay': {},
  'cp15-dw-cyrus.replay': {
    'anim:platinum:MOVE_EXTRASENSORY': ALL,
    'anim:platinum:MOVE_SURF': ALL,
    'battle:wild-flee': ALL,
    'render:hm-cut-in': ALL,
  },
  'cp15-giratina-room.replay': { 'anim:platinum:MOVE_SURF': ALL },
  'cp15.replay': {
    'battle:wild-flee': ALL,
    'render:hm-cut-in': ALL,
  },
  'm5-dw-cyrus-lost.replay': {},
  'm5-giratina-caught.replay': {},
  'm5-giratina-fled.replay': {},
  'cp16.replay': {
    'anim:platinum:MOVE_SURF': ALL,
    'battle:wild-flee': ALL,
  },
  'cp17.replay': {
    'anim:cry-mod:9': [1, 2],
    'anim:platinum:MOVE_SURF': ALL,
    'battle:wild-flee': ALL,
    'render:hm-cut-in': ALL,
  },
  'cp18.replay': {
    'anim:platinum:MOVE_SURF': ALL,
  },
  'cp19.replay': {
    'anim:platinum:MOVE_SURF': [1, 3],
  },
  // M6 (docs/research/story-cp20-24.md §"Stub allowlist").
  'cp20.replay': {
    'anim:platinum:MOVE_SURF': ALL,
    'battle:wild-flee': ALL,
    'render:hm-cut-in': ALL,
  },
  'cp21a.replay': {
    'anim:platinum:MOVE_EXTRASENSORY': [2],
    'anim:platinum:MOVE_SURF': ALL,
    'render:hm-cut-in': ALL,
  },
  'cp21b.replay': {
    'anim:platinum:MOVE_SURF': ALL,
    'render:hm-cut-in': ALL,
  },
  'cp21c.replay': {
    'anim:platinum:MOVE_SURF': ALL,
    'render:hm-cut-in': ALL,
  },
  'cp21d.replay': {
    'anim:platinum:MOVE_SURF': ALL,
    'render:hm-cut-in': ALL,
  },
  'cp21e.replay': {
    'anim:platinum:MOVE_SURF': ALL,
    'render:hm-cut-in': ALL,
  },
  'cp21f.replay': {
    'anim:platinum:MOVE_SURF': ALL,
    'render:hm-cut-in': ALL,
  },
  'cp22.replay': {
    'anim:platinum:MOVE_EXTRASENSORY': [3],
    'anim:platinum:MOVE_SURF': ALL,
    'battle:wild-flee': ALL,
    'render:hm-cut-in': ALL,
  },
  'cp23a.replay': {
    'anim:platinum:MOVE_SURF': ALL,
    'render:hm-cut-in': ALL,
  },
  'cp23b.replay': {
    'anim:platinum:MOVE_SURF': ALL,
    'battle:wild-flee': ALL,
    'render:hm-cut-in': ALL,
  },
  'cp24.replay': {
    'anim:platinum:MOVE_SURF': ALL,
    'battle:wild-flee': ALL,
    'render:hm-cut-in': ALL,
  },
};

/** The stubs `log` met on `file`'s run on `seed` are exactly its allowlist's for that seed. */
function expectStubs(file: string, seed: number, log: CountingStubLog): void {
  const allowed = STUBS[file];
  if (!allowed) throw new Error(`${file}: no stub allowlist (STUBS)`);
  const met = log.report().map((s) => s.key).sort();
  const listed = Object.keys(allowed).filter((k) => allowed[k]!.includes(seed)).sort();
  expect(met, `${file} seed ${seed}: the stubs met are its allowlist's (unlisted: ${met.filter((k) => !listed.includes(k)).join(', ') || 'none'}; listed, not met: ${listed.filter((k) => !met.includes(k)).join(', ') || 'none'})`).toEqual(listed);
}

interface Played {
  result: ReplayResult;
  log: CountingStubLog;
  partner: string | undefined;
  state: GameState;
}

/** One chunk or branch replay from its parent's anchor (the replay it starts `from`) on `seed`. */
async function playAnchored(file: string, seed: number, shift: number, repeat: boolean): Promise<Played> {
  const parent = branchParent(file);
  if (!parent) throw new Error(`${file}: a chunk replay starts "from <replay>" and "+0 reload" (a branch may have setup lines instead)`);
  const save = await chainAnchor(parent, seed);
  const log = new CountingStubLog(() => {});
  const game = storyGame(seed, log);
  let partner: string | undefined;
  const options: ReplayOptions = {
    registries: game.registries,
    seed,
    name: file,
    repeat,
    resolve: (f) => ({ name: f, text: readReplay(f) }),
    beforeLine(line) {
      if (line.action.type === 'screenshot') partner ??= game.battleSetup()?.partner;
    },
  };
  const result = await runReplay(anchoredDriver(gameDriver(game), save), shifted(anchoredText(file, parent), shift), options);
  return { result, log, partner, state: structuredClone(game.state) };
}

const stubs = (log: CountingStubLog) => log.report().map((s) => `${s.key}×${s.count}`).join(', ');

/** Each replay of `chunk` twice from its anchor on `seed`, with a save round trip at its end. */
export function describeChunk(chunk: Chunk, seed: 1 | 2 | 3, files: readonly string[] = chunk.replays): void {
  describe.skipIf(!ROM)(`${chunk.name} checkpoints from the chain anchor, seed ${seed} (OPENSINNOH_NDS_ROM)`, () => {
    for (const file of files) {
      it(`${file} passes, twice from the ${branchParent(file)} anchor on seed ${seed}, and round-trips its save`, async () => {
        const t0 = Date.now();
        const { result, log, partner } = await playAnchored(file, seed, 0, true);
        console.log(`${file} seed ${seed}: ${result.ticks} ticks, ${result.assertions} asserts, ${Date.now() - t0} ms, round trip ${JSON.stringify(result.roundTrip)}; stubs ${stubs(log)}`);
        expect(result.error).toBeUndefined();
        expect(result.ok).toBe(true);
        expect(result.determinism).toBe('identical');
        expect(result.roundTrip).toBe('identical');
        if (PARTNERS[file]) expect(partner).toBe(PARTNERS[file]);
        expectStubs(file, seed, log);
      }, 1_800_000);
    }
  });
}

/** Each replay of `chunk` from its anchor on `seed`, started 1/2/5/15 ticks late. */
export function describeChunkLate(chunk: Chunk, seed: 1 | 2 | 3, shifts: readonly number[] = SHIFTS): void {
  describe.skipIf(!ROM)(`${chunk.name} checkpoints started late, seed ${seed} (OPENSINNOH_NDS_ROM)`, () => {
    for (const file of chunk.replays) {
      it(`${file} passes from the ${branchParent(file)} anchor started ${shifts.join('/')} ticks late`, async () => {
        const failures: string[] = [];
        for (const shift of shifts) {
          const { result } = await playAnchored(file, seed, shift, false);
          if (!result.ok) failures.push(`seed ${seed} +${shift}: ${result.error!.split('\n')[0]}`);
        }
        expect(failures).toEqual([]);
      }, 3_600_000);
    }
  });
}

/**
 * The anchor proof (§3.1): the chunk's last replay from a new game on seed 1, twice (determinism). Its chain
 * saves at each replay's `+0 reload` exactly the anchor of the replay before (CP4's end, cp5's, …: the anchors
 * built one replay at a time), and it ends in the state its anchored run ends in.
 */
export function describeAnchorProof(chunk: Chunk): void {
  describe.skipIf(!ROM)(`${chunk.name} chain anchor proof (OPENSINNOH_NDS_ROM)`, () => {
    it(`${chunk.replays.at(-1)} from a new game, twice, saves every anchor of the chain at its reloads and ends as the anchored run`, async () => {
      const file = chunk.replays.at(-1)!;
      const seed = 1;
      const game = storyGame(seed);
      const driver = gameDriver(game);
      // A run's saves are the chunk replays' `+0 reload` lines in chain order (then the runner's round trip).
      const runs: string[][] = [];
      const save = () => {
        const json = driver.save() as string;
        runs.at(-1)!.push(json);
        return json;
      };
      const t0 = Date.now();
      const result = await runReplay(
        { ...driver, reset: (s) => (runs.push([]), driver.reset(s)), save },
        readReplay(file),
        { registries: game.registries, seed, name: file, resolve: (f) => ({ name: f, text: readReplay(f) }) },
      );
      console.log(`${file} from a new game, seed ${seed}: ${result.ticks} ticks, ${Date.now() - t0} ms (twice)`);
      expect(result.error).toBeUndefined();
      expect(result.determinism).toBe('identical');
      const fromScratch = structuredClone(game.state);
      // Replays that stage their start with setup lines (cp15's set team) save no anchor at a reload: only the others.
      const reloading = chunk.replays.filter((f) => chunkParent(f));
      const parents = reloading.map((f) => chunkParent(f)!);
      const anchors = await Promise.all(parents.map((p) => chainAnchor(p, seed)));
      // The chain's earlier chunk replays (cp5…cp8 before M5b) reload first, and a replay may also reload mid-way
      // (cp15's saves at rest in the Distortion World): each anchor is one of the run's saves, in chain order.
      for (const run of runs.slice(0, 2)) {
        let from = 0;
        for (const [i, anchor] of anchors.entries()) {
          const at = run.indexOf(anchor, from);
          expect(at, `a save after the previous anchor's, at ${reloading[i]}'s reload, is the ${parents[i]} anchor`).toBeGreaterThanOrEqual(0);
          from = at + 1;
        }
      }
      const anchored = await playAnchored(file, seed, 0, false);
      expect(anchored.result.error).toBeUndefined();
      expect(JSON.stringify(anchored.state)).toBe(JSON.stringify(fromScratch));
    }, 3_600_000);
  });
}

/**
 * M5a branch replays: each from its parent's anchor, like the chunk's replays; the last four use
 * another starter or gender, one per chunk replay (cp5…cp8).
 */
export const M5A_BRANCHES = [
  'm5-cheryl-detach.replay',
  'm5-eterna-egg-declined.replay',
  'm5-tag-jubilife-lost.replay',
  'm5-tag-jubilife-turtwig.replay',
  'm5-eterna-forest-chimchar.replay',
  'm5-route-207-lucas.replay',
  'm5-rival-209-chimchar.replay',
];

/**
 * M5b branch replays: one per chunk replay (cp9…cp13) with another starter or gender, each staged
 * from its parent's anchor; cp11 has two (the way in with Barry, and the library). Then the optional Riley tag.
 */
export const M5B_BRANCHES = [
  'm5-rival-pastoria-turtwig.replay',
  'm5-valor-lakefront-chimchar.replay',
  'm5-canalave-chimchar.replay',
  'm5-library-lucas.replay',
  'm5-lake-verity-lucas.replay',
  'm5-lake-acuity-turtwig.replay',
  'm5-tag-riley.replay',
];

/**
 * M5c branch replays, each with another starter and gender: cp14's end staged from the cp13 anchor,
 * and cp15's Spear Pillar (Barry's partner party by the starter) staged from the cp14 anchor.
 */
export const M5C_BRANCHES = ['m5-galactic-hq-chimchar.replay', 'm5-spear-pillar-chimchar.replay'];

/** Each branch replay twice from its parent's anchor on seeds 1–3, with a save round trip. */
export function describeBranches(files: readonly string[], chunk = 'M5a', seeds: readonly number[] = [1, 2, 3]): void {
  describe.skipIf(!ROM)(`${chunk} branches from the chain anchors (OPENSINNOH_NDS_ROM)`, () => {
    for (const file of files) {
      for (const seed of seeds) {
        it(`${file} passes, twice from the ${branchParent(file)} anchor on seed ${seed}, and round-trips its save`, async () => {
          const { result, log, partner } = await playAnchored(file, seed, 0, true);
          console.log(`${file} seed ${seed}: ${result.ticks} ticks, ${result.assertions} asserts; stubs ${stubs(log)}`);
          expect(result.error).toBeUndefined();
          expect(result.determinism).toBe('identical');
          expect(result.roundTrip).toBe('identical');
          if (PARTNERS[file]) expect(partner).toBe(PARTNERS[file]);
          expectStubs(file, seed, log);
        }, 1_800_000);
      }
    }
  });
}

export { M5A, M5B, M5C, M6 };
