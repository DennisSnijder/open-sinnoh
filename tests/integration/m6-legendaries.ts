/**
 * Legendary, roamer and form replays on the real ROM: each twice on seeds 1–3 with a save round trip, and the stand-ins it meets exactly its allowlist's.
 * - `sys-*` start constructed (setup lines on a new game).
 * - `m6-*` branch from a parent's chain anchor (checkpoints-anchors.ts `branchParent`): the story's CP anchors
 *   (cp21d, cp21f, cp23a, cp23b) or another branch, with setup lines only for the event flag and off-chain state.
 */
import { describe, expect, it } from 'vitest';
import { CountingStubLog, gameDriver, runReplay } from '@opensinnoh/game';
import { ROM } from '../rom.ts';
import { anchoredDriver, anchoredText, branchParent, chainAnchor, readReplay, storyGame } from './checkpoints-anchors.ts';

const ALL = [1, 2, 3];
/** The stand-ins each replay meets, by the seeds that meet them (none listed: none met). */
const STUBS: Record<string, Record<string, readonly number[]>> = {
  'sys-heatran-lost.replay': { 'anim:cry-mod:9': ALL },
  'm6-event-gracidea.replay': { 'clock:timed-events': ALL },
};

/** Each replay twice on seeds 1–3 (a branch from its parent's anchor), its save round-tripped, its stand-ins its allowlist's. */
export function describeM6(title: string, files: readonly string[]): void {
  describe.skipIf(!ROM)(`${title} (OPENSINNOH_NDS_ROM)`, () => {
    for (const file of files)
      for (const seed of ALL)
        it(`${file}: twice on seed ${seed}, save round trip`, async () => {
          const log = new CountingStubLog(() => {});
          const game = storyGame(seed, log);
          const parent = branchParent(file);
          const driver = parent ? anchoredDriver(gameDriver(game), await chainAnchor(parent, seed)) : gameDriver(game);
          const text = parent ? anchoredText(file, parent) : readReplay(file);
          const result = await runReplay(driver, text, { name: file, registries: game.registries, seed, repeat: true, resolve: (f) => ({ name: f, text: readReplay(f) }) });
          console.log(`${file} seed ${seed}: ${result.ticks} ticks, ${result.assertions} asserts; stubs ${log.report().map((s) => `${s.key}×${s.count}`).join(', ')}`);
          expect(result.error).toBeUndefined();
          expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
          const allowed = STUBS[file] ?? {};
          const listed = Object.keys(allowed).filter((k) => allowed[k]!.includes(seed)).sort();
          expect(log.report().map((s) => s.key).sort(), `${file} seed ${seed}: the stand-ins met`).toEqual(listed);
        }, 1_800_000);
  });
}
