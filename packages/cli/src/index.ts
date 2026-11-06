/**
 * `pnpm opensinnoh <command>`:
 *   check <pack> [--dependency id=path]...              validate records and references (JSON on stdout)
 *   test <pack> [--browser] [--replay f]... [--seed n]   run replays headless (and through the app)
 *   import <rom> --output <git-ignored dir>              build the base pack from a ROM
 *   dev <pack>... [--port n]                             serve the app with packs (HMR on pack changes)
 *   coverage <pack> [--zones regex]                      script ops reachable (ROM-wide, or from the zones): real, stub, unknown
 *   sweep <pack> [--zones regex] [--ticks n]             load every playable zone headless; errors and stubs per zone
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { checkPack, checkSummary } from './check.ts';
import { coverageReport, coverageSummary } from './coverage.ts';
import { loadEngine } from './engine.ts';
import { importRom, importSummary } from './import-command.ts';
import { openSinnohPacksPlugin } from './plugin.ts';
import { sweepSummary, sweepZones } from './sweep.ts';
import { testPack, testSummary } from './test-command.ts';
import { loadWorkspace, readPackDir } from './workspace.ts';

interface Args {
  positional: string[];
  dependencies: Record<string, string>;
  replays: string[];
  flags: Set<string>;
  values: Record<string, string>;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { positional: [], dependencies: {}, replays: [], flags: new Set(), values: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--dependency') {
      const m = /^([a-z][a-z0-9-]*)=(.+)$/.exec(value());
      if (!m) throw new Error('--dependency expects id=path');
      args.dependencies[m[1]!] = m[2]!;
    } else if (a === '--replay') args.replays.push(value());
    else if (a === '--browser') args.flags.add('browser');
    else if (a === '--seed' || a === '--port' || a === '--output' || a === '--zones' || a === '--ticks') args.values[a.slice(2)] = value();
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else args.positional.push(a);
  }
  return args;
}

function int(s: string | undefined, name: string): number | undefined {
  if (s === undefined) return undefined;
  if (!/^\d+$/.test(s)) throw new Error(`--${name} must be a non-negative integer`);
  return Number(s);
}

const USAGE = 'usage: opensinnoh check <pack> | test <pack> [--browser] | import <rom> --output <dir> | dev <pack...> | coverage <pack> [--zones re] | sweep <pack> [--zones re] [--ticks n]';

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);
  switch (command) {
    case 'check': {
      const pack = args.positional[0];
      if (!pack || args.positional.length > 1) throw new Error('usage: opensinnoh check <pack> [--dependency id=path]');
      const result = checkPack(pack, args.dependencies);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      process.stderr.write(checkSummary(result) + '\n');
      return result.ok ? 0 : 1;
    }
    case 'test': {
      const pack = args.positional[0];
      if (!pack || args.positional.length > 1) throw new Error('usage: opensinnoh test <pack> [--browser] [--replay file]... [--seed n]');
      const browser = args.flags.has('browser') ? (await import('./browser.ts')).runBrowserReplays : undefined;
      const result = await testPack({
        packDir: pack,
        dependencies: args.dependencies,
        ...(args.replays.length ? { files: args.replays } : {}),
        ...(args.values.seed !== undefined ? { seed: int(args.values.seed, 'seed')! } : {}),
        ...(args.values.output !== undefined ? { output: args.values.output } : {}),
        engine: loadEngine,
        ...(browser ? { browser } : {}),
      });
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      process.stderr.write(testSummary(result) + '\n');
      return result.ok ? 0 : 1;
    }
    case 'import': {
      const rom = args.positional[0];
      const output = args.values.output;
      if (!rom || !output) throw new Error('usage: opensinnoh import <rom> --output <git-ignored dir>');
      const result = await importRom(rom, output, (line) => process.stderr.write(`\r${line.padEnd(30)}`));
      process.stderr.write('\n' + importSummary(result) + '\n');
      return 0;
    }
    case 'coverage': {
      const pack = args.positional[0];
      if (!pack || args.positional.length > 1) throw new Error('usage: opensinnoh coverage <pack> [--zones regex]');
      const result = coverageReport(pack, args.dependencies, args.values.zones ?? null);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      process.stderr.write(coverageSummary(result) + '\n');
      return result.realMissing.length ? 1 : 0;
    }
    case 'sweep': {
      const pack = args.positional[0];
      if (!pack || args.positional.length > 1) throw new Error('usage: opensinnoh sweep <pack> [--zones regex] [--ticks n]');
      const ws = loadWorkspace(pack, args.dependencies);
      const result = sweepZones(ws.packs, await loadEngine(), {
        ...(args.values.ticks !== undefined ? { ticks: int(args.values.ticks, 'ticks')! } : {}),
        ...(args.values.zones !== undefined ? { zones: new RegExp(args.values.zones) } : {}),
      });
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      process.stderr.write(sweepSummary(result) + '\n');
      return result.failed === 0 ? 0 : 1;
    }
    case 'dev': {
      if (!args.positional.length) throw new Error('usage: opensinnoh dev <pack>... [--port n]');
      const port = int(args.values.port, 'port') ?? 5173;
      const server = await createServer({ root: resolve(import.meta.dirname, '../../..'), plugins: [openSinnohPacksPlugin(args.positional, args.dependencies)], server: { host: '127.0.0.1', port, strictPort: true } });
      await server.listen();
      server.printUrls();
      // Without ?packs the app shows the ROM page; this URL opens the served packs.
      const ids = args.positional.map((d) => readPackDir(resolve(d)).manifest.id);
      process.stdout.write(`  ➜  Packs:   http://127.0.0.1:${port}/?packs=${ids.join(',')}\n`);
      return new Promise(() => {});
    }
    default:
      process.stderr.write(USAGE + '\n');
      return command === undefined || command === 'help' ? 0 : 1;
  }
}

// Run as a script (a file URL on every OS: `file:///D:/…` on Windows).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: Error) => {
      process.stderr.write(`opensinnoh: ${e.message}\n`);
      process.exit(1);
    },
  );
}
