/**
 * `opensinnoh test` on the bundled packs, through the CLI entry point (what `pnpm test:replays` runs):
 * every replay of packs/fixture and packs/demo-mod passes headless. In-process, so `pnpm check` runs it
 * alongside the other unit tests instead of starting two more tsx processes.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from './index.ts';

const PACKS = join(import.meta.dirname, '../../../packs');

describe('opensinnoh test on the bundled packs', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['fixture', 'demo-mod'])('%s: every replay passes', async (pack) => {
    const stderr: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation((s) => (stderr.push(String(s)), true));
    const output = mkdtempSync(join(tmpdir(), 'opensinnoh-replays-'));
    expect(await main(['test', join(PACKS, pack), '--output', output])).toBe(0);
    // n/n: every replay file of the pack ran and passed (packs gain replays; the count is not pinned).
    expect(stderr.join('')).toMatch(new RegExp(`^${pack}: ([1-9]\\d*)/\\1 replay runs passed\n$`));
  });
});
