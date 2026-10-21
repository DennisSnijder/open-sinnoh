import { describe, expect, it } from 'vitest';
import type { PackData } from '@opensinnoh/core';
import { BUNDLED_MODS, packsFromFiles } from './bundled-mods.ts';
import { devPacksIfServed, modSource, toggleMod } from './pack-source.ts';

const pack = (id: string, base?: string, name = id): PackData => ({
  manifest: { id, name, version: '0.1.0', engine: '^0.1.0', dependencies: base ? { [base]: '^0.1.0' } : {}, loadAfter: base ? [base] : [], ...(base ? { base } : {}) },
  registries: {},
  scripts: { labels: {} },
  patches: [],
  remove: [],
  provenance: base ? 'original' : 'rom-derived',
});

describe('mods', () => {
  it('bundles the original platinum-demo mod (no ROM content) for the platinum base', () => {
    expect(BUNDLED_MODS.map((p) => [p.manifest.id, p.manifest.base, p.provenance])).toEqual([['platinum-demo', 'platinum', 'original']]);
    const demo = BUNDLED_MODS[0]!;
    expect(Object.keys(demo.scripts.labels)).toEqual(['platinum:TwinleafTown_Collector']);
    expect(demo.patches.map((p) => p.id)).toEqual(['platinum:SPECIES_CHIMCHAR', 'platinum:SPECIES_PIPLUP']);
    // Its own records are all in its namespace.
    for (const records of Object.values(demo.registries)) for (const r of records) expect(r.id).toMatch(/^platinum-demo:/);
  });

  it('reads bundled files grouped by pack folder', () => {
    const packs = packsFromFiles({
      '/packs/b/pack.json': JSON.stringify(pack('b', 'platinum').manifest),
      '/packs/a/pack.json': JSON.stringify(pack('a', 'platinum').manifest),
      '/packs/a/scripts.ir': 'platinum:X::\n  end\n',
    });
    expect(packs.map((p) => p.manifest.id)).toEqual(['a', 'b']);
    expect(packs[0]!.scripts.labels['platinum:X']).toHaveLength(1);
    expect(() => packsFromFiles({ '/elsewhere/pack.json': '{}' })).toThrow(/outside packs/);
  });

  it('lists the mods for the loaded base and toggles them; disabling restores the base alone', async () => {
    const base = pack('platinum');
    const bundled = [pack('platinum-demo', 'platinum', 'Demo'), pack('demo-mod', 'fixture')];
    const served = [pack('platinum-demo', 'platinum', 'Demo (dev server)'), pack('other', 'platinum', 'Other')];
    const offline = modSource(base, bundled, async () => []);
    expect(await offline.mods()).toEqual([{ id: 'platinum-demo', name: 'Demo' }]);
    // A dev server's mod replaces the bundled one with the same id.
    const dev = modSource(base, bundled, async () => served);
    expect(await dev.mods()).toEqual([
      { id: 'platinum-demo', name: 'Demo (dev server)' },
      { id: 'other', name: 'Other' },
    ]);

    let enabled = toggleMod([], 'platinum-demo', true);
    expect(enabled).toEqual(['platinum-demo']);
    expect((await offline.load(enabled)).map((p) => p.manifest.id)).toEqual(['platinum', 'platinum-demo']);
    expect(toggleMod(enabled, 'platinum-demo', true)).toEqual(['platinum-demo']);
    enabled = toggleMod(enabled, 'platinum-demo', false);
    expect(enabled).toEqual([]);
    expect(await offline.load(enabled)).toEqual([base]);
    await expect(offline.load(['demo-mod'])).rejects.toThrow('mod demo-mod is not available');
  });

  it('dev-served mods: none without a dev server (network error, 404); 5xx and bad bodies throw', async () => {
    const answer = (status: number, body: string, type = 'application/json') => (async () => new Response(body, { status, headers: { 'content-type': type } })) as typeof fetch;
    expect(await devPacksIfServed((async () => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch)).toEqual([]);
    expect(await devPacksIfServed(answer(404, 'not found', 'text/plain'))).toEqual([]);
    expect(await devPacksIfServed(answer(200, JSON.stringify({ packs: [pack('a', 'platinum')] })))).toHaveLength(1);
    await expect(devPacksIfServed(answer(500, 'boom', 'text/plain'))).rejects.toThrow(/500 boom/);
    await expect(devPacksIfServed(answer(200, '<!doctype html>', 'text/html'))).rejects.toThrow(/not JSON \(text\/html\)/);
    await expect(devPacksIfServed(answer(200, '{}'))).rejects.toThrow(/no "packs" list/);
  });
});

describe('the follower add-on', () => {
  it('loads between the base and the mods, so a mod overrides it and it overrides the base', async () => {
    const base = pack('platinum');
    const addon = { ...pack('hgss-followers'), manifest: { ...pack('hgss-followers').manifest, dependencies: { platinum: '*' } } };
    const mod = pack('platinum-demo', 'platinum');
    const source = modSource(base, [mod], async () => [], [addon]);
    expect((await source.load([])).map((p) => p.manifest.id)).toEqual(['platinum', 'hgss-followers']);
    expect((await source.load(['platinum-demo'])).map((p) => p.manifest.id)).toEqual(['platinum', 'hgss-followers', 'platinum-demo']);
  });
});

