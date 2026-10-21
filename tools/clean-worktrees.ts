import { applyCleanup, cleanupPlan, formatBytes, type PlanOptions } from './maintenance/clean-worktrees.ts';

const usage = `Usage: pnpm clean:worktrees [--apply] [--base main] [--stale-days N]
Default: dry run. --apply removes the listed worktrees (branches are kept).
Only clean, idle worktrees under .claude/worktrees/ merged into the base qualify; --stale-days N also
includes unmerged branches untouched for N days.`;

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log(usage); return; }
  const options: PlanOptions = { base: 'main' };
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--apply') apply = true;
    else if (arg === '--stale-days') {
      const days = Number(args[++i]);
      if (!Number.isSafeInteger(days) || days < 1) throw new Error('--stale-days needs a positive integer');
      options.staleDays = days;
    } else if (arg === '--base') {
      const value = args[++i];
      if (!value || value.startsWith('-')) throw new Error('--base needs a git ref');
      options.base = value;
    } else throw new Error(`Unknown option ${arg}\n${usage}`);
  }
  const cwd = process.cwd();
  const { candidates, kept } = cleanupPlan(cwd, options);
  console.log(`${apply ? 'Removing' : 'Dry run'} (base ${options.base}${options.staleDays ? `, stale after ${options.staleDays} days` : ''}):`);
  for (const item of candidates) console.log(`  Remove: ${item.path}\n    ${item.reason}; ${formatBytes(item.bytes)}`);
  for (const item of kept) console.log(`  Keep: ${item}`);
  console.log(`${candidates.length} to remove; ${formatBytes(candidates.reduce((n, item) => n + item.bytes, 0))}`);
  if (!apply) { console.log('Nothing removed. Rerun with --apply to remove them.'); return; }
  console.log(`Freed ${formatBytes(applyCleanup(cwd, candidates, options))}`);
}

try { main(); } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
