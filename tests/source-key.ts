/** Content key for a headless harness and its workspace dependencies, excluding test files. */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function sourceKey(repo: string, roots: readonly string[], harness: readonly string[] = []): string {
  const files = new Set(harness);
  const visited = new Set<string>();
  const visit = (pkg: string) => {
    if (visited.has(pkg)) return;
    visited.add(pkg);
    const manifest = `packages/${pkg}/package.json`;
    files.add(manifest);
    const { dependencies = {} } = JSON.parse(readFileSync(join(repo, manifest), 'utf8')) as { dependencies?: Record<string, string> };
    for (const dep of Object.keys(dependencies)) if (dep.startsWith('@opensinnoh/')) visit(dep.slice('@opensinnoh/'.length));
    for (const sub of ['src', 'data']) {
      const dir = `packages/${pkg}/${sub}`;
      if (!existsSync(join(repo, dir))) continue;
      for (const f of readdirSync(join(repo, dir), { recursive: true, encoding: 'utf8' })) {
        if (/\.test\.ts$/.test(f) || !statSync(join(repo, dir, f)).isFile()) continue;
        files.add(`${dir}/${f}`);
      }
    }
  };
  for (const pkg of roots) visit(pkg);
  // External dependency upgrades (notably the battle simulator) can change a replay's end state too.
  files.add('pnpm-lock.yaml');
  const hash = createHash('sha1');
  for (const file of [...files].sort()) hash.update(file).update('\0').update(readFileSync(join(repo, file))).update('\0');
  return hash.digest('hex').slice(0, 16);
}
