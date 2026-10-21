import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, readdirSync, lstatSync, rmSync, existsSync, realpathSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyCleanup, cleanupPlan } from '../../tools/maintenance/clean-worktrees.ts';
import { errorKey, reportFailures, flaky } from '../../tools/maintenance/flaky.ts';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function repository(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'opensinnoh-clean-test-')));
  dirs.push(dir);
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.name', 'Fixture');
  git(dir, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(dir, '.gitignore'), '.claude/\n.opensinnoh-cache/\n*.nds\n');
  git(dir, 'add', '.gitignore');
  git(dir, 'commit', '-m', 'fixture');
  return dir;
}
function tree(root: string, name: string): string {
  const path = join(root, '.claude/worktrees', name);
  git(root, 'worktree', 'add', '-b', name, path);
  return path;
}
function commit(path: string, file: string): void {
  writeFileSync(join(path, file), `original ${file}`);
  git(path, 'add', file);
  git(path, 'commit', '-m', file);
}
function age(path: string): void {
  if (lstatSync(path).isDirectory()) for (const name of readdirSync(path)) age(join(path, name));
  utimesSync(path, new Date('2000-01-01'), new Date('2000-01-01'));
}
const paths = (root: string, staleDays?: number) => cleanupPlan(root, { base: 'main', staleDays }).candidates.map((c) => c.path).sort();

describe('worktree cleanup', { timeout: 30_000 }, () => {
  it('removes only idle, clean, merged worktrees under .claude/worktrees by default, keeping branches', () => {
    const root = repository();
    const merged = tree(root, 'merged'); age(merged);
    const unmerged = tree(root, 'unmerged'); commit(unmerged, 'work.txt'); age(unmerged);
    const active = tree(root, 'active'); // merged, but just written: may be in use
    const dirty = tree(root, 'dirty'); age(dirty); writeFileSync(join(dirty, 'untracked'), 'keep');
    const locked = tree(root, 'locked'); age(locked); git(root, 'worktree', 'lock', locked);
    const rom = tree(root, 'rom'); writeFileSync(join(rom, 'game.nds'), 'not a rom'); age(rom);
    const cache = tree(root, 'cache'); age(cache);
    mkdirSync(join(cache, '.opensinnoh-cache/tests/key'), { recursive: true });
    writeFileSync(join(cache, '.opensinnoh-cache/tests/key/slice.v8'), 'fresh'); // a test run in progress
    const outside = join(root, 'elsewhere'); git(root, 'worktree', 'add', '-b', 'elsewhere', outside); age(outside);
    const plan = cleanupPlan(root, { base: 'main' });
    expect(plan.candidates.map((c) => c.path)).toEqual([merged]);
    expect(applyCleanup(root, plan.candidates, { base: 'main' })).toBeGreaterThan(0);
    expect(existsSync(merged)).toBe(false);
    expect(git(root, 'branch', '--list', 'merged')).toContain('merged');
    for (const path of [unmerged, active, dirty, locked, rom, cache, outside, join(root, '.git')]) expect(existsSync(path)).toBe(true);
  });
  it('includes idle unmerged branches only with explicit stale days, and keeps their commits', () => {
    const root = repository();
    const stale = tree(root, 'stale'); commit(stale, 'work.txt'); age(stale);
    const recent = tree(root, 'recent'); commit(recent, 'new.txt');
    expect(paths(root)).toEqual([]);
    expect(paths(root, 30)).toEqual([stale]);
    applyCleanup(root, cleanupPlan(root, { base: 'main', staleDays: 30 }).candidates, { base: 'main', staleDays: 30 });
    expect(existsSync(stale)).toBe(false);
    expect(git(root, 'show', 'stale:work.txt')).toBe('original work.txt');
    expect(existsSync(recent)).toBe(true);
  });
  it('protects the current worktree and refuses a changed plan', () => {
    const root = repository(); const path = tree(root, 'idle'); age(path);
    expect(cleanupPlan(path, { base: 'main' }).candidates).toEqual([]);
    const plan = cleanupPlan(root, { base: 'main' });
    expect(plan.candidates).toHaveLength(1);
    writeFileSync(join(path, 'new-work'), 'keep me');
    expect(() => applyCleanup(root, plan.candidates, { base: 'main' })).toThrow('candidate changed');
    expect(existsSync(path)).toBe(true);
  });
  it('retains an unmerged detached HEAD even when stale or missing', () => {
    const root = repository(); const path = tree(root, 'detached');
    commit(path, 'original'); git(path, 'checkout', '--detach'); age(path);
    expect(paths(root, 1)).toEqual([]);
    rmSync(path, { recursive: true });
    expect(paths(root, 1)).toEqual([]);
  });
  it('removes only the targeted missing registration', () => {
    const root = repository(); const missing = tree(root, 'missing');
    const outside = join(root, 'outside'); git(root, 'worktree', 'add', '-b', 'outside', outside);
    rmSync(missing, { recursive: true }); rmSync(outside, { recursive: true });
    const plan = cleanupPlan(root, { base: 'main' });
    expect(plan.candidates.map((c) => c.path)).toEqual([missing]);
    applyCleanup(root, plan.candidates, { base: 'main' });
    expect(git(root, 'worktree', 'list')).not.toContain(missing);
    expect(git(root, 'worktree', 'list')).toContain(outside);
  });
});

describe('flaky reports', () => {
  it('reads Vitest assertions and suite setup failures, without counting skips as passes', () => {
    expect(reportFailures('vitest', JSON.stringify({ testResults: [
      { name: 'a', assertionResults: [{ fullName: 'pass', status: 'passed', failureMessages: [] }, { fullName: 'skip', status: 'pending', failureMessages: [] }, { fullName: 'fails', status: 'failed', failureMessages: ['Expected 2, got 1'] }] },
      { name: 'b', message: 'setup broke', assertionResults: [] },
    ] }))).toEqual({ passed: 1, failures: [{ test: 'fails', error: 'Expected 2, got 1' }, { test: 'b', error: 'setup broke' }] });
  });
  it('reads nested Playwright failures across projects and global errors', () => {
    const result = reportFailures('playwright', JSON.stringify({ suites: [{ title: 'spec', suites: [{ title: 'group', specs: [{ title: 'test', tests: [{ projectName: 'phone', results: [{ status: 'timedOut', errors: [{ message: 'Timeout 30000ms exceeded' }, { message: 'second error' }] }] }, { projectName: 'desktop', results: [{ status: 'passed' }] }] }] }] }], errors: [{ message: 'global failure' }] }));
    expect(result.passed).toBe(1);
    expect(result.failures.map((f) => f.error)).toEqual(['Timeout 30000ms exceeded', 'second error', 'global failure']);
    expect(result.failures[0]!.test).toContain('[phone]');
  });
  it('groups volatile timeouts but keeps different assertion values distinct', () => {
    expect(errorKey('\x1b[31mTimeout 30000ms exceeded\x1b[0m')).toBe(errorKey('Timeout 60000ms exceeded'));
    expect(errorKey('Expected 1, got 2')).not.toBe(errorKey('Expected 2, got 3'));
    expect(errorKey('Expected 10ms, got 20ms')).not.toBe(errorKey('Expected 10ms, got 30ms'));
  });
  it('rejects invalid user options before starting processes', async () => {
    await expect(flaky(['test', '--runs', '0'])).rejects.toThrow('positive integer');
    await expect(flaky(['test', '--cpu-load', '-1'])).rejects.toThrow('nonnegative integer');
    await expect(flaky(['test', '--runner', 'unknown'])).rejects.toThrow('must be vitest or playwright');
  });
});


it('flaky CLI counts iterations, deduplicates errors and exits under CPU load', { timeout: 30_000 }, () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'opensinnoh-flaky-test-')));
  dirs.push(dir);
  const shim = join(dir, 'pnpm');
  // A tiny original runner fixture: emits the same report format as Vitest, with three outcomes.
  writeFileSync(shim, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const report = process.argv.find((arg) => arg.startsWith('--outputFile=')).slice(13);
const run = Number(path.basename(report, '.json'));
const errors = run === 1 ? [] : run === 2 ? ['AssertionError: original failure'] : ['AssertionError: original failure', 'Error: second failure'];
fs.writeFileSync(report, JSON.stringify({ testResults: [{ name: 'fixture', assertionResults: [{ fullName: 'fixture test', status: errors.length ? 'failed' : 'passed', failureMessages: errors }] }] }));
process.exit(errors.length ? 1 : 0);
`);
  chmodSync(shim, 0o755);
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'tools/flaky.ts', 'fixture.test.ts', '--runs', '3', '--cpu-load', '1'], {
    cwd: join(import.meta.dirname, '../..'), env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8', timeout: 25_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('Pass rate: 1/3 (33.3%); 2 distinct errors');
  expect(result.stdout).toContain('First failure: run 2, fixture test (2 runs)');
  expect(result.stdout).toContain('First failure: run 3, fixture test (1 runs)');
});
