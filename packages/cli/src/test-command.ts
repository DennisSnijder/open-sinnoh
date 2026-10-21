import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { CountingStubLog, createGame, failedReplay, gameDriver, loadGamePacks, runReplay, type ReplayResult } from '@opensinnoh/game';
import type { Engine } from './engine.ts';
import { fileReplayResolver, loadWorkspace, replayFiles } from './workspace.ts';

export interface ReplayRun extends ReplayResult {
  file: string;
  /** 'node' = headless; otherwise the browser viewport. */
  mode: string;
  stubs?: { key: string; count: number }[];
}

export interface TestResult {
  pack: string;
  ok: boolean;
  results: ReplayRun[];
}

export interface TestOptions {
  packDir: string;
  dependencies?: Record<string, string>;
  /** Defaults to `<pack>/replays/*.replay`. */
  files?: string[];
  seed?: number;
  engine: () => Promise<Engine>;
  /** Runs the replays through the app too (Playwright, two viewports). */
  browser?: (args: { files: string[]; dirs: Map<string, string>; registries: ReturnType<typeof loadGamePacks>['registries']; seed: number; output: string }) => Promise<ReplayRun[]>;
  output?: string;
}

export async function testPack(options: TestOptions): Promise<TestResult> {
  const ws = loadWorkspace(options.packDir, options.dependencies);
  const files = options.files ?? replayFiles(options.packDir);
  if (!files.length) throw new Error(`no .replay files: add ${join(options.packDir, 'replays')}/*.replay or pass --replay <file>`);
  const seed = options.seed ?? 1;
  const engine = await options.engine();
  const results: ReplayRun[] = [];
  for (const file of files) {
    const log = new CountingStubLog(() => {});
    const name = relative(process.cwd(), resolve(file));
    try {
      const game = createGame({ packs: ws.packs, ...engine, seed, log });
      const r = await runReplay(gameDriver(game), readFileSync(file, 'utf8'), { registries: game.registries, seed, name, resolve: fileReplayResolver });
      results.push({ file: name, mode: 'node', ...r, stubs: log.report() });
    } catch (e) {
      results.push({ file: name, mode: 'node', ...failedReplay((e as Error).message) });
    }
  }
  const output = resolve(options.output ?? join('test-artifacts/opensinnoh', basename(resolve(options.packDir))));
  if (options.browser) {
    const { registries } = loadGamePacks(ws.packs);
    results.push(...(await options.browser({ files, dirs: ws.dirs, registries, seed, output })));
  }
  const result = { pack: ws.pack, ok: results.every((r) => r.ok), results };
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

export function testSummary(r: TestResult): string {
  const failed = r.results.filter((x) => !x.ok).map((x) => `\n  ${x.file} [${x.mode}]: ${x.error}`);
  const skippedRoundTrips = r.results.filter((x) => typeof x.roundTrip === 'object').length;
  return `${r.pack}: ${r.results.filter((x) => x.ok).length}/${r.results.length} replay runs passed${skippedRoundTrips ? ` (${skippedRoundTrips} without a save round-trip)` : ''}${failed.join('')}`;
}
