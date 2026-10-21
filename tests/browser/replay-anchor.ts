/** Browser replays that only need a predecessor's state start from its saved anchor. */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { parseReplay } from '@opensinnoh/core';
import type { GameSnapshot, WildBattleMode, EvolutionMode } from '@opensinnoh/contracts';
import { gameDriver, runReplay, type ReplayDriver } from '@opensinnoh/game';
import { anchoredDriver, anchorPath, chainAnchor, readReplay, storyGame } from '../integration/checkpoints-anchors.ts';

interface Start {
  battles: GameSnapshot['battles'];
  wild: WildBattleMode;
  evolutions: EvolutionMode;
}

/**
 * Saves omit battle history and replay policies. Carry the prefix's real history and policies too, so
 * cumulative battle assertions remain unchanged. The history comes from the same engine and seed,
 * keyed like the anchor by the ROM, importer, engine sources and every replay in its prefix.
 */
async function prefixStart(prefix: string, seed: number, anchor: string): Promise<Start> {
  const path = `${anchorPath(prefix, seed)}.browser-start-v1`;
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as Start;
  const game = storyGame(seed);
  const base = gameDriver(game);
  let start: Start | undefined;
  let endState: string | undefined;
  const result = await runReplay({ ...base, async save() {
    const save = await base.save();
    endState = JSON.stringify((JSON.parse(save) as { state: unknown }).state);
    start = { battles: structuredClone([...game.battles]), wild: game.wildBattles, evolutions: game.evolutions };
    return save;
  } }, readReplay(prefix), {
    registries: game.registries, seed, name: prefix, repeat: false,
    resolve: (file) => ({ name: file, text: readReplay(file) }),
  });
  if (!result.ok || result.roundTrip !== 'identical' || !start) throw new Error(`${prefix}: browser anchor history: ${result.error ?? 'no savable end'}`);
  if (endState !== JSON.stringify((JSON.parse(anchor) as { state: unknown }).state)) throw new Error(`${prefix}: browser history and chain anchor ended in different states`);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(start));
  renameSync(tmp, path);
  return start;
}

/** Keeps every main-replay line/assertion; only its already-tested `from` prefix is replaced by a save. */
export async function fromChainAnchor(base: ReplayDriver, file: string, seed = 1): Promise<{ driver: ReplayDriver; text: string }> {
  const text = readReplay(file);
  const replay = parseReplay(text);
  if (!replay.from) throw new Error(`${file}: expected a from prefix`);
  const prefix = replay.from.file;
  const save = await chainAnchor(prefix, seed);
  const start = await prefixStart(prefix, seed, save);
  const anchored = anchoredDriver(base, save);
  const lines = text.split('\n');
  lines[replay.from.line - 1] = `# from ${prefix}: saved chain anchor`;
  const first = replay.lines[0];
  if (first?.action.type === 'reload' && 'after' in first.at && first.at.after === 0) lines[first.line - 1] = '# reload: the anchor is loaded';
  return {
    text: lines.join('\n'),
    driver: {
      ...anchored,
      async reset(seed) {
        await anchored.reset(seed);
        await base.setWildBattles(start.wild);
        await base.setEvolutions(start.evolutions);
      },
      async snapshot() {
        const snapshot = await base.snapshot();
        return { ...snapshot, battles: [...start.battles, ...snapshot.battles] };
      },
    },
  };
}
