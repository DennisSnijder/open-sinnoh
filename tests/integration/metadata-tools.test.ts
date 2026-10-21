import { afterEach, expect, test } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const script = resolve(import.meta.dirname, '../../tools/merge-main.ts');
const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const contracts = 'packages/contracts/src/index.ts';
const importer = 'packages/app/src/importer.ts';
const source = (name: string, value: string, head = 'head') => `// ${head}\n\n\nexport const ${name} = '${value}';\n`;

/** A repo whose `feature` branch (checked out in a worktree) and `main` both changed the metadata. */
function repo(files: { feature: Record<string, string>; main: Record<string, string> }) {
  const dir = mkdtempSync(join(tmpdir(), 'opensinnoh-merge-'));
  temporary.push(dir);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  const write = (record: Record<string, string>) => {
    for (const [path, text] of Object.entries(record)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    git('add', '.');
    git('commit', '-qm', 'fixture');
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  write({
    [contracts]: source('CONTRACTS_VERSION', '0.27.7'),
    [importer]: source('IMPORTER_VERSION', 'platinum-55'),
  });
  git('branch', 'feature');
  write(files.main);
  git('worktree', 'add', '-q', 'wt', 'feature');
  const wt = join(dir, 'wt');
  for (const [path, text] of Object.entries(files.feature)) writeFileSync(join(wt, path), text);
  execFileSync('git', ['commit', '-qam', 'feature'], { cwd: wt, stdio: 'pipe' });
  const result = spawnSync(process.execPath, [script, 'main'], { cwd: wt, encoding: 'utf8' });
  const read = (path: string) => readFileSync(join(wt, path), 'utf8');
  const parents = () => execFileSync('git', ['rev-list', '--parents', '-n1', 'HEAD'], { cwd: wt, encoding: 'utf8' }).trim().split(' ').length - 1;
  return { status: result.status, output: result.stdout + result.stderr, read, parents };
}

test('both sides bumped both versions: merged and committed', () => {
  const r = repo({
    feature: {
      [contracts]: source('CONTRACTS_VERSION', '0.27.8', 'feature edit'),
      [importer]: source('IMPORTER_VERSION', 'platinum-56'),
    },
    main: {
      [contracts]: source('CONTRACTS_VERSION', '0.28.0'),
      [importer]: source('IMPORTER_VERSION', 'platinum-56'), // the same value: git alone merges it silently
    },
  });
  expect(r.status, r.output).toBe(0);
  expect(r.parents()).toBe(2);
  expect(r.read(contracts)).toBe(source('CONTRACTS_VERSION', '0.28.1', 'feature edit'));
  expect(r.read(importer)).toBe(source('IMPORTER_VERSION', 'platinum-57'));
}, 30_000);

test('a one-sided bump is left to git', () => {
  const r = repo({
    feature: { [importer]: source('IMPORTER_VERSION', 'platinum-55', 'feature edit') },
    main: { [importer]: source('IMPORTER_VERSION', 'platinum-58') },
  });
  expect(r.status, r.output).toBe(0);
  expect(r.read(importer)).toBe(source('IMPORTER_VERSION', 'platinum-58', 'feature edit'));
}, 30_000);

test('versions: the bump is resolved and other conflicts in the file remain', () => {
  const r = repo({
    feature: { [importer]: source('IMPORTER_VERSION', 'platinum-56', 'feature') },
    main: { [importer]: source('IMPORTER_VERSION', 'platinum-56', 'main') },
  });
  expect(r.status, r.output).toBe(1);
  expect(r.read(importer)).toContain("export const IMPORTER_VERSION = 'platinum-57';");
  expect(r.read(importer)).toMatch(/<<<<<<< HEAD\n\/\/ feature\n=======\n\/\/ main\n>>>>>>> main/);
}, 30_000);
