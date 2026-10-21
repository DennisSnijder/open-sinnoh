/**
 * Checkpoints 2–4, headless (OPENSINNOH_NDS_ROM): each replay chains from the previous one with `from`
 * (cp2 ← opening, cp3 ← cp2, cp4 ← cp3) and carries its own asserts.
 *
 * - The checkpoint files run each chain twice from seed 1, 2 or 3
 *   (determinism), ending with a save round trip. One file per checkpoint and seed.
 * - checkpoints-late-*.rom.test.ts: robustness. The replays wait on the game (`until …`, `advance text`),
 *   not on recorded timing, so the chain must also pass with every replay in it started 1, 2, 5 or 15
 *   ticks late, on seeds 1–3 (other wanderer streams and wild encounters). One file per seed and shift.
 *
 * The late starts run the cp4 chain only. It plays opening → cp2 → cp3 → cp4 in one run with every
 * replay shifted, asserting each replay's lines, so a cp2 or cp3 chain with the same seed and shift is
 * exactly its prefix (the game is deterministic; checkpoints.rom.test.ts proves it): running those too
 * re-ran the same ticks. The test checks that cp4 still chains through all of them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PackData } from '@opensinnoh/core';
import { CountingStubLog, createGame, gameDriver, runReplay, type ReplayResolver } from '@opensinnoh/game';
import { createBattle } from '@opensinnoh/battle';
import { createApp } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { ROM, romSlice } from '../rom.ts';

const dir = join(import.meta.dirname, '../rom-replays');
const read = (file: string) => readFileSync(join(dir, file), 'utf8');
export const CHECKPOINTS = ['cp2', 'cp3', 'cp4'] as const;
const SHIFTS = [1, 2, 5, 15];

/** The replay with `shift` idle ticks before its first timed line (after `from` and setup lines). */
function shifted(text: string, shift: number): string {
  if (!shift) return text;
  const lines = text.split('\n');
  const first = lines.findIndex((l) => /^(\+?\d+|until|advance)\s/.test(l.trim()));
  lines.splice(first, 0, `+${shift} release select  # shifted`);
  return lines.join('\n');
}

function player() {
  let pack: PackData;
  // The slice is enough: the headless game reads no models.
  beforeAll(() => {
    ({ pack } = romSlice());
  });
  return (cp: string, seed: number, shift: number, repeat: boolean) => {
    const log = new CountingStubLog(() => {});
    // The menu apps as in the browser: the evolution scene after a battle runs (and is stopped with B).
    const game = createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, createApp, seed, log, now: () => '2026-01-01T00:00:00.000Z' });
    const chain: string[] = [];
    const resolve: ReplayResolver = (file) => (chain.push(file), { name: file, text: shifted(read(file), shift) });
    const name = `${cp}.replay`;
    return { log, chain, result: runReplay(gameDriver(game), shifted(read(name), shift), { registries: game.registries, seed, name, resolve, repeat }) };
  };
}

/** Each checkpoint chain twice from `seed`, with a save round trip at its end. */
export function describeCheckpoints(seed: 1 | 2 | 3, checkpoints: readonly (typeof CHECKPOINTS)[number][] = CHECKPOINTS): void {
  describe.skipIf(!ROM)(`Platinum checkpoints 2–4, seed ${seed} (OPENSINNOH_NDS_ROM)`, () => {
    const play = player();
    for (const cp of checkpoints) {
      it(`${cp}.replay passes, twice from seed ${seed}, and round-trips its save`, async () => {
        const { log, result: running } = play(cp, seed, 0, true);
        const result = await running;
        console.log(`${cp}: ${result.ticks} ticks, ${result.assertions} asserts, round trip ${JSON.stringify(result.roundTrip)}; stubs ${log.report().map((s) => `${s.key}×${s.count}`).join(', ')}`);
        expect(result.error).toBeUndefined();
        expect(result.ok).toBe(true);
        expect(result.determinism).toBe('identical');
        expect(result.roundTrip).toBe('identical');
      }, 300_000);
    }
  });
}

/** The cp4 chain (opening → cp2 → cp3 → cp4) with every replay started late, on one seed. */
export function describeLateStarts(seed: 1 | 2 | 3, shifts: readonly number[] = SHIFTS): void {
  describe.skipIf(!ROM)(`Platinum checkpoints 2–4 started late, seed ${seed} (OPENSINNOH_NDS_ROM)`, () => {
    const play = player();
    it(`the cp4 chain passes with every replay in it started ${shifts.join('/')} ticks late`, async () => {
      const failures: string[] = [];
      // Unshifted: checkpoints*.rom.test.ts.
      for (const shift of shifts) {
        const { chain, result: running } = play('cp4', seed, shift, false);
        const result = await running;
        if (!result.ok) failures.push(`seed ${seed} +${shift}: ${result.error!.split('\n')[0]}`);
        else expect(chain).toEqual(['cp3.replay', 'cp2.replay', 'opening.replay', 'opening-rival.replay']);
      }
      expect(failures).toEqual([]);
    }, 600_000);
  });
}
