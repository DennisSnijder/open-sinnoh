import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, realpathSync, readFileSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

/**
 * Worktree cleanup for `.claude/worktrees/` only. A worktree is removed (with `git worktree remove`,
 * never --force, keeping its branch) only when it is clean, idle and merged into the base, or, with an
 * explicit `staleDays`, unmerged on a branch and untouched for that long. The main checkout, anything
 * outside `.claude/worktrees/`, ROM files and recently written caches are never touched.
 */
export interface Candidate { path: string; reason: string; bytes: number; stamp: string }
export interface PlanOptions { base: string; staleDays?: number; now?: number }
interface Worktree { path: string; head: string; branch?: string; locked: boolean }

/** A worktree written to (files or its `.opensinnoh-cache`) within this window may be in use: kept. */
export const IDLE_HOURS = 24;

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const inside = (root: string, path: string) => { const rel = relative(root, path); return rel !== '' && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel); };

function worktrees(cwd: string): Worktree[] {
  return git(cwd, 'worktree', 'list', '--porcelain', '-z').split('\0\0').filter(Boolean).map((block) => {
    const fields = block.split('\0');
    const field = (name: string) => fields.find((s) => s.startsWith(`${name} `))?.slice(name.length + 1);
    const path = field('worktree');
    const head = field('HEAD');
    if (!path || !head) throw new Error('Unexpected git worktree list output');
    return { path, head, branch: field('branch'), locked: fields.some((s) => s === 'locked' || s.startsWith('locked ')) };
  });
}

/** Never follows symlinks. blocks measures allocated disk space rather than sparse-file length. */
export function diskBytes(path: string): number {
  const stat = lstatSync(path);
  let bytes = stat.blocks * 512;
  if (stat.isDirectory()) for (const name of readdirSync(path)) bytes += diskBytes(join(path, name));
  return bytes;
}

/** Newest modification time, ignoring .git and node_modules (installs and fetches are not work). */
function activity(path: string): number {
  const stat = lstatSync(path);
  let newest = stat.mtimeMs;
  if (stat.isDirectory()) for (const name of readdirSync(path)) {
    if (name === '.git' || name === 'node_modules') continue;
    newest = Math.max(newest, activity(join(path, name)));
  }
  return newest;
}

export function cleanupPlan(cwd: string, { base, staleDays, now = Date.now() }: PlanOptions): { candidates: Candidate[]; kept: string[] } {
  const trees = worktrees(cwd);
  const primary = trees[0]!.path;
  git(cwd, 'rev-parse', '--verify', `${base}^{commit}`);
  const roots = [...new Set([primary, git(cwd, 'rev-parse', '--show-toplevel')])];
  const allowed = roots.map((root) => join(root, '.claude/worktrees'));
  const candidates: Candidate[] = [];
  const kept: string[] = [];
  for (const tree of trees) {
    if (tree.path === primary || !allowed.some((root) => inside(root, tree.path))) continue;
    const keep = (reason: string) => kept.push(`${tree.path}: ${reason}`);
    if (tree.locked) { keep('locked'); continue; }
    // Also protects a caller whose shell is in a subdirectory of this worktree.
    if (existsSync(tree.path) && (realpathSync(tree.path) === realpathSync(cwd) || inside(realpathSync(tree.path), realpathSync(cwd)))) { keep('current worktree'); continue; }
    // Refuse paths reached through symlinks, including a symlinked .claude directory.
    const ancestor = existsSync(tree.path) ? tree.path : dirname(tree.path);
    if (existsSync(ancestor) && realpathSync(ancestor) !== resolve(ancestor)) { keep('symlinked path'); continue; }
    const check = spawnSync('git', ['-C', cwd, 'merge-base', '--is-ancestor', tree.head, base]);
    if (check.status !== 0 && check.status !== 1) throw new Error(`Could not compare ${tree.path} to ${base}: ${check.stderr}`);
    const merged = check.status === 0;
    if (!merged && !tree.branch) { keep('unmerged detached HEAD'); continue; }
    if (!merged && staleDays === undefined) { keep(`not merged into ${base} (pass --stale-days N to include idle unmerged branches)`); continue; }
    if (!existsSync(tree.path)) {
      candidates.push({ path: tree.path, reason: 'missing checkout (stale registration)', bytes: 0, stamp: tree.head });
      continue;
    }
    if (git(tree.path, 'status', '--porcelain', '--untracked-files=all')) { keep('uncommitted or untracked files'); continue; }
    // `git worktree remove` deletes ignored files: never a ROM.
    const ignored = git(tree.path, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory').split('\n');
    if (ignored.some((name) => /\.nds$/i.test(name))) { keep('contains a ROM file'); continue; }
    const idleMs = now - activity(tree.path);
    if (idleMs < IDLE_HOURS * 3_600_000) { keep(`written to within ${IDLE_HOURS} hours (may be in use)`); continue; }
    if (!merged && idleMs < staleDays! * 86_400_000) { keep(`unmerged and written to within ${staleDays} days`); continue; }
    candidates.push({ path: tree.path, reason: merged ? `merged into ${base}` : `unmerged, ${staleDays}+ days idle; branch ${tree.branch} retained`, bytes: diskBytes(tree.path), stamp: tree.head });
  }
  return { candidates, kept };
}

export function applyCleanup(cwd: string, candidates: Candidate[], options: PlanOptions): number {
  // Re-check the plan right before deleting: any change invalidates it.
  const fresh = cleanupPlan(cwd, options).candidates;
  for (const item of candidates) {
    if (!fresh.some((other) => other.path === item.path && other.stamp === item.stamp)) throw new Error(`Cleanup candidate changed: ${item.path}; rerun the dry run`);
  }
  let freed = 0;
  for (const item of candidates) {
    if (existsSync(item.path)) {
      freed += diskBytes(item.path);
      git(cwd, 'worktree', 'remove', item.path); // no --force; the branch ref stays
    } else {
      // Remove only this missing registration: git worktree prune would affect unrelated paths.
      const registrations = join(git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'), 'worktrees');
      const entry = readdirSync(registrations).find((name) => readFileSync(join(registrations, name, 'gitdir'), 'utf8').trim() === join(item.path, '.git'));
      if (!entry) throw new Error(`Missing worktree registration: ${item.path}`);
      rmSync(join(registrations, entry), { recursive: true });
    }
    console.log(`Removed ${item.path}`);
  }
  return freed;
}

export const formatBytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
