import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { browserShard, browserWorkers } from './browser-options.ts';
import { selectBrowserSpecs } from './browser-changes.ts';

const specs = ['debug.spec.ts', 'site.spec.ts', 'platinum.rom.spec.ts', 'title.spec.ts', 'onboarding.spec.ts', 'ui.spec.ts'].map((name) => `tests/browser/${name}`);

describe('browser changed selection', () => {
  it('the CLI includes branch commits, staged edits and untracked specs against main', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'opensinnoh-browser-diff-'));
    const run = (command: string, args: string[]) => {
      const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, PATH: `${cwd}/bin:${process.env.PATH}` } });
      expect(result.status, result.stderr).toBe(0);
      return result;
    };
    const write = (file: string, content = '') => {
      mkdirSync(join(cwd, file, '..'), { recursive: true });
      writeFileSync(join(cwd, file), content);
    };
    try {
      run('git', ['init', '-b', 'main']);
      run('git', ['config', 'user.name', 'Fixture']);
      run('git', ['config', 'user.email', 'fixture@example.invalid']);
      for (const spec of specs) write(spec);
      run('git', ['add', '.']);
      run('git', ['commit', '-m', 'original fixtures']);
      run('git', ['checkout', '-b', 'change']);
      write('packages/app/src/debug/panel.ts');
      run('git', ['add', '.']);
      run('git', ['commit', '-m', 'debug change']);
      write('site/src/main.ts');
      run('git', ['add', '.']);
      write('tests/browser/ui.spec.ts', '// unstaged spec change');
      write('tests/browser/new.spec.ts');
      write('tests/browser/nested/another.spec.ts');
      // Capture the real CLI's Playwright arguments without launching a browser.
      write('bin/pnpm', `#!${process.execPath}\nrequire('node:fs').writeFileSync('args.json', JSON.stringify(process.argv.slice(2)));\n`);
      run('chmod', ['+x', 'bin/pnpm']);
      write('.git/info/exclude', 'bin/\nargs.json\n');
      run(process.execPath, [join(import.meta.dirname, 'browser-changed.ts'), '--list']);
      expect(JSON.parse(readFileSync(join(cwd, 'args.json'), 'utf8'))).toEqual([
        'exec', 'playwright', 'test',
        'tests/browser/debug\\.spec\\.ts$', 'tests/browser/nested/another\\.spec\\.ts$', 'tests/browser/new\\.spec\\.ts$', 'tests/browser/site\\.spec\\.ts$', 'tests/browser/ui\\.spec\\.ts$', '--list',
      ]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
  it('includes direct changes and unions folder mappings without duplicates', () => {
    expect(selectBrowserSpecs(['packages/app/src/debug/panel.ts', 'site/src/main.ts', 'tests/browser/debug.spec.ts', 'tests/browser/title.spec.ts'], specs)).toMatchObject({
      full: false, specs: [specs[0], specs[1], specs[3]],
    });
  });
  it('runs everything for shared code, helpers, fixtures, runner/config changes and unknown runtime folders', () => {
    for (const file of ['packages/app/src/title/menu.ts', 'packages/app/src/telemetry/index.ts', 'packages/app/src/battle/scene.ts', 'packages/app/src/starter/index.ts', 'packages/audio/src/index.ts', 'packages/core/src/save.ts', 'packages/game/src/index.ts', 'packages/render/src/cards.ts', 'packages/app/src/main.ts', 'tests/browser/seed.ts', 'tests/rom.ts', 'packs/fixture/pack.json', 'playwright.config.ts', 'pnpm-lock.yaml', 'packages/new/src/index.ts']) {
      expect(selectBrowserSpecs([file], specs).full, file).toBe(true);
    }
  });
  it('handles docs-only diffs, deleted specs and moves across folders', () => {
    expect(selectBrowserSpecs(['docs/browser-tests.md', 'packages/core/src/save.test.ts', 'tests/browser/deleted.spec.ts'], specs).specs).toEqual([]);
    expect(selectBrowserSpecs(['packages/app/src/debug/old.ts', 'site/src/new.ts'], specs).specs).toEqual(specs.slice(0, 2));
  });
  it('falls back to full if a mapped spec disappeared rather than silently dropping its coverage', () => {
    expect(selectBrowserSpecs(['packages/app/src/debug/panel.ts'], specs.slice(1)).full).toBe(true);
  });
});

describe('browser runner resources and shards', () => {
  it('accepts both native shard spellings and rejects malformed shards', () => {
    expect(browserShard(['test', '--shard=2/4'])).toBe('2-of-4');
    expect(browserShard(['test', '--shard', '1/2'])).toBe('1-of-2');
    expect(browserShard(['test'])).toBeUndefined();
    for (const value of ['0/2', '3/2', '1/0', 'x', '1/2/3', '9007199254740993/9007199254740993']) expect(() => browserShard([`--shard=${value}`])).toThrow();
  });
  it('caps automatic workers by CPU and RAM, always allowing at least one, and honors an explicit override', () => {
    expect(browserWorkers(6, 24 * 2 ** 30)).toBe(8);
    expect(browserWorkers(16, 6 * 2 ** 30)).toBe(2);
    expect(browserWorkers(1, 1 * 2 ** 30)).toBe(1);
    expect(browserWorkers(6, 24 * 2 ** 30, '8')).toBe(8);
    for (const value of ['0', '-1', '2.5', '', 'NaN']) expect(() => browserWorkers(6, 24 * 2 ** 30, value)).toThrow();
  });
});
