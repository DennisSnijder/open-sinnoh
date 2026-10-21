import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { stripVTControlCharacters } from 'node:util';

export interface Failure { test: string; error: string }
interface VitestReport {
  testResults: { name: string; message?: string; assertionResults: { fullName: string; status: string; failureMessages: string[] }[] }[];
}
interface PlaywrightSuite {
  title: string;
  suites?: PlaywrightSuite[];
  specs?: { title: string; tests: { projectName: string; results: { status: string; errors?: { message?: string; stack?: string }[] }[] }[] }[];
}

/** Use runner error messages, not console output (which also contains timings and progress). */
export function reportFailures(runner: 'vitest' | 'playwright', json: string): { passed: number; failures: Failure[] } {
  const failures: Failure[] = [];
  let passed = 0;
  if (runner === 'vitest') {
    const report = JSON.parse(json) as VitestReport;
    for (const file of report.testResults) {
      const before = failures.length;
      for (const test of file.assertionResults) {
        if (test.status === 'passed') passed++;
        if (test.status === 'failed') for (const error of test.failureMessages) failures.push({ test: test.fullName, error });
      }
      if (file.message && failures.length === before) failures.push({ test: file.name, error: file.message });
    }
  } else {
    const report = JSON.parse(json) as { suites: PlaywrightSuite[]; errors?: { message?: string; stack?: string }[] };
    const visit = (suite: PlaywrightSuite, parents: string[]) => {
      const titles = [...parents, suite.title];
      for (const spec of suite.specs ?? []) for (const test of spec.tests) for (const result of test.results) {
        if (result.status === 'passed') passed++;
        if (['failed', 'timedOut', 'interrupted'].includes(result.status)) {
          const errors = result.errors?.length ? result.errors : [{ message: result.status }];
          for (const error of errors) failures.push({ test: `[${test.projectName}] ${[...titles, spec.title].join(' > ')}`, error: error.message ?? error.stack ?? result.status });
        }
      }
      for (const child of suite.suites ?? []) visit(child, titles);
    };
    for (const suite of report.suites) visit(suite, []);
    for (const error of report.errors ?? []) failures.push({ test: 'runner', error: error.message ?? error.stack ?? 'Unknown runner error' });
  }
  return { passed, failures };
}

export function errorKey(error: string): string {
  // Only remove ANSI decoration and volatile durations; keep assertion values and source locations.
  return stripVTControlCharacters(error).replace(/\b([Tt]imeout(?: of)?|[Tt]imed out (?:in|after))\s+\d+(?:\.\d+)?\s*(?:ms|milliseconds)\b/g, '$1 <duration>').trim();
}

export async function flaky(args: string[]): Promise<number> {
  const usage = 'Usage: pnpm flaky <file.spec.ts|file.test.ts|test name> [--runs N] [--cpu-load N] [--runner vitest|playwright] [--grep regex] [-- <runner options>]\nDefaults: 10 runs, no CPU load. --cpu-load N starts N busy worker threads (CPU contention).';
  if (args.includes('--help')) { console.log(usage); return 0; }
  const options = { runs: 10, load: 0, runner: '', grep: '' };
  const targets: string[] = [];
  let extra: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--') { extra = args.slice(i + 1); break; }
    if (['--runs', '--cpu-load', '--runner', '--grep'].includes(arg)) {
      const value = args[++i];
      if (!value) throw new Error(`Missing value for ${arg}\n${usage}`);
      if (arg === '--runs' || arg === '--cpu-load') {
        const number = Number(value);
        if (!Number.isSafeInteger(number) || number < (arg === '--runs' ? 1 : 0)) throw new Error(`${arg} needs ${arg === '--runs' ? 'a positive' : 'a nonnegative'} integer`);
        if (arg === '--runs') options.runs = number; else options.load = number;
      } else if (arg === '--runner') options.runner = value; else options.grep = value;
    } else if (arg.startsWith('-')) throw new Error(`Unknown option ${arg}\n${usage}`);
    else targets.push(arg);
  }
  if (!targets.length) throw new Error(usage);
  const runner = options.runner || (targets.some((t) => /\.spec\.[cm]?[jt]sx?(?::\d+)?$/.test(t)) ? 'playwright' : 'vitest');
  if (runner !== 'vitest' && runner !== 'playwright') throw new Error('--runner must be vitest or playwright');
  // A bare name selects tests by title; file arguments keep the runner's file/line filtering.
  const files = targets.filter((t) => /\.(?:test|spec)\.[cm]?[jt]sx?(?::\d+)?$/.test(t));
  const grep = options.grep || (files.length ? '' : targets.join(' '));
  const dir = mkdtempSync(join(tmpdir(), 'opensinnoh-flaky-'));
  const workers: Worker[] = [];
  let active: ReturnType<typeof spawn> | undefined;
  let interrupted = false;
  const stop = () => {
    interrupted = true;
    if (active?.pid) {
      if (process.platform === 'win32') active.kill('SIGTERM');
      else process.kill(-active.pid, 'SIGTERM');
    }
    for (const worker of workers) void worker.terminate();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const errors = new Map<string, { run: number; count: number; failure: Failure }>();
  let successes = 0;
  let completed = 0;
  try {
    for (let i = 0; i < options.load; i++) workers.push(new Worker('while (true) { Math.sqrt(Math.random()); }', { eval: true }));
    console.log(`${runner}: ${options.runs} runs; CPU load: ${options.load} busy workers`);
    for (let run = 1; run <= options.runs && !interrupted; run++) {
      const report = join(dir, `${run}.json`);
      const command = runner === 'vitest'
        ? ['exec', 'vitest', 'run', ...files, ...extra, ...(grep ? ['-t', grep] : []), '--retry=0', '--reporter=json', `--outputFile=${report}`]
        : ['exec', 'playwright', 'test', ...files, '--workers=1', ...extra, ...(grep ? ['--grep', grep] : []), '--retries=0', '--reporter=json'];
      let output = '';
      const code = await new Promise<number | null>((resolve, reject) => {
        active = spawn('pnpm', command, { detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '0', PLAYWRIGHT_JSON_OUTPUT_FILE: report } });
        active.stdout!.on('data', (chunk: Buffer) => { output += chunk; });
        active.stderr!.on('data', (chunk: Buffer) => { output += chunk; });
        active.once('error', reject);
        active.once('close', resolve);
      });
      active = undefined;
      if (interrupted) break;
      completed++;
      const result = existsSync(report) ? reportFailures(runner, readFileSync(report, 'utf8')) : { passed: 0, failures: [] };
      const ok = code === 0 && result.passed > 0 && result.failures.length === 0;
      if (ok) successes++;
      else if (!result.failures.length) result.failures.push({ test: 'runner', error: output.trim() || `No tests passed (exit ${code})` });
      console.log(`Run ${run}/${options.runs}: ${ok ? 'PASS' : 'FAIL'}`);
      const seen = new Set<string>();
      for (const failure of result.failures) {
        const key = errorKey(failure.error);
        if (seen.has(key)) continue;
        seen.add(key);
        const known = errors.get(key);
        if (known) known.count++; else errors.set(key, { run, count: 1, failure });
      }
    }
    console.log(`\nPass rate: ${successes}/${completed} (${completed ? (successes / completed * 100).toFixed(1) : '0.0'}%); ${errors.size} distinct errors`);
    for (const { run, count, failure } of errors.values()) console.log(`\nFirst failure: run ${run}, ${failure.test} (${count} runs)\n${failure.error}`);
    return interrupted ? 130 : successes === completed && completed === options.runs ? 0 : 1;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await Promise.all(workers.map((worker) => worker.terminate()));
    rmSync(dir, { recursive: true, force: true });
  }
}
