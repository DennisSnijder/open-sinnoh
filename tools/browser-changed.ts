import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { selectBrowserSpecs } from './browser-changes.ts';

const git = (...args: string[]) => {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout;
};
// Merge-base includes branch commits plus staged/unstaged changes; --no-renames includes both sides of a move.
const base = git('merge-base', 'main', 'HEAD').trim();
const changed = [...new Set([
  ...git('diff', '--name-only', '--no-renames', '-z', base, '--').split('\0'),
  ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0'),
].filter(Boolean))];
const specs = readdirSync('tests/browser', { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.spec.ts'))
  .map((file) => `tests/browser/${file.replaceAll('\\', '/')}`);
const selection = selectBrowserSpecs(changed, specs);
process.stdout.write(`browser changed (main merge-base ${base.slice(0, 12)}): ${selection.full ? 'full suite' : `${selection.specs.length} specs`}; ${selection.reason}\n`);
if (!selection.full && !selection.specs.length) process.exit(0);
if (!selection.full) process.stdout.write(selection.specs.join('\n') + '\n');
// Playwright treats positional paths as regexes: escape dots, brackets, etc. and anchor the end.
const filters = selection.full ? [] : selection.specs.map((spec) => spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
const child = spawnSync('pnpm', ['exec', 'playwright', 'test', ...filters, ...process.argv.slice(2)], { stdio: 'inherit' });
if (child.error) throw child.error;
process.exit(child.status ?? 1);
