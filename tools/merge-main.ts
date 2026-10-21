/**
 * `pnpm merge:main [ref]`: merge a ref (default origin/main) into HEAD and resolve the routine
 * metadata conflicts between parallel branches, then commit if nothing else conflicts.
 * - CONTRACTS_VERSION, IMPORTER_VERSION: when both sides bumped, the result is one past the larger.
 *   Read from the commits, not the merged file: two equal bumps merge cleanly in git but still collide.
 * Anything else keeps git's own merge, conflict markers included, so nothing is dropped silently.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ref = process.argv[2] ?? 'origin/main';
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' });
const show = (rev: string, path: string) => {
  const result = spawnSync('git', ['show', `${rev}:${path}`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout : undefined;
};
const merging = () => spawnSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).status === 0;

const declaration = (name: string) => new RegExp(`^export const ${name} = '(\\d+)\\.(\\d+)\\.(\\d+)';$|^export const ${name} = 'platinum-(\\d+)';$`, 'm');

function mergeVersion(name: string, base: string, ours: string, theirs: string) {
  const parts = (source: string) => declaration(name).exec(source)?.slice(1).filter(Boolean).map(Number);
  const [b, o, t] = [parts(base), parts(ours), parts(theirs)];
  if (!b || !o || !t || o.length !== b.length || t.length !== b.length) throw new Error(`${name}: unexpected declaration`);
  if (o.join() === b.join() || t.join() === b.join()) return; // one side bumped: git's merge is right
  const difference = o.map((part, i) => part - t[i]!).find((d) => d !== 0) ?? 0;
  const next = [...(difference >= 0 ? o : t)];
  next[next.length - 1]! += 1;
  const line = `export const ${name} = '${next.length === 3 ? next.join('.') : `platinum-${next[0]}`}';`;
  // Give all three the same line, so merge-file merges only the rest of the file.
  const dir = mkdtempSync(join(tmpdir(), 'opensinnoh-merge-'));
  const files = [ours, base, theirs].map((source, i) => {
    const path = join(dir, ['ours', 'base', 'theirs'][i]!);
    writeFileSync(path, source.replace(declaration(name), line));
    return path;
  });
  const result = spawnSync('git', ['merge-file', '-p', '-L', 'HEAD', '-L', 'base', '-L', ref, ...files], { encoding: 'utf8' });
  rmSync(dir, { recursive: true });
  if (result.status === null || result.status < 0) throw new Error(`git merge-file failed: ${result.stderr}`);
  return { text: result.stdout, clean: result.status === 0 };
}

if (merging()) throw new Error('A merge is already in progress');
const base = git('merge-base', 'HEAD', ref).trim();
spawnSync('git', ['merge', '--no-ff', '--no-commit', ref], { stdio: 'inherit' });
if (!merging()) process.exit(0); // already up to date

const files: [string, (b: string, o: string, t: string) => { text: string; clean: boolean } | undefined][] = [
  ['packages/contracts/src/index.ts', (b, o, t) => mergeVersion('CONTRACTS_VERSION', b, o, t)],
  ['packages/app/src/importer.ts', (b, o, t) => mergeVersion('IMPORTER_VERSION', b, o, t)],
];
for (const [path, merge] of files) {
  const [b, o, t] = [show(base, path), show('HEAD', path), show(ref, path)];
  if (b === undefined || o === undefined || t === undefined || o === b || t === b) continue;
  const merged = merge(b, o, t);
  if (!merged) continue;
  writeFileSync(path, merged.text);
  if (merged.clean) git('add', path);
  console.log(`${path}: ${merged.clean ? 'resolved' : 'version resolved, other conflicts remain'}`);
}

const unmerged = git('diff', '--name-only', '--diff-filter=U').trim();
if (unmerged) {
  console.error(`Resolve these, then git commit:\n${unmerged}`);
  process.exit(1);
}
git('commit', '--no-edit');
