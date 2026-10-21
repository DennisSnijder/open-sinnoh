import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Id } from '@opensinnoh/core';
import { loadGamePacks } from '@opensinnoh/game';
import { checkPack, checkSummary } from './check.ts';
import { classifyOp, coverageReport, coverageSummary } from './coverage.ts';
import { arrivalStatus, EXCLUDED_ZONE, EXEMPT_ZONE, m5Exemption, sweepSummary, sweepZones } from './sweep.ts';
import { loadWorkspace } from './workspace.ts';
import { loadEngine } from './engine.ts';
import { parseArgs } from './index.ts';
import { testPack, testSummary } from './test-command.ts';

const PACKS = join(import.meta.dirname, '../../../packs');

describe('opensinnoh cli', () => {
  it('parses arguments', () => {
    const a = parseArgs(['packs/demo-mod', '--dependency', 'fixture=../f', '--replay', 'a.replay', '--browser', '--seed', '3']);
    expect(a).toMatchObject({ positional: ['packs/demo-mod'], dependencies: { fixture: '../f' }, replays: ['a.replay'], values: { seed: '3' } });
    expect(a.flags.has('browser')).toBe(true);
    expect(() => parseArgs(['--dependency', 'nope'])).toThrow('--dependency expects id=path');
    expect(() => parseArgs(['--frobnicate'])).toThrow('unknown option --frobnicate');
  });

  it('check reports load order, overrides and diagnostics', () => {
    const r = checkPack(join(PACKS, 'demo-mod'));
    expect(r.loadOrder.map((p) => p.id)).toEqual(['fixture', 'demo-mod']);
    expect(r.overrides).toEqual([{ label: 'fixture:Town_Guide', previousPack: 'fixture', pack: 'demo-mod' }]);
    expect(r.diagnostics).toEqual([]);
    expect(checkSummary(r)).toBe('demo-mod: ok (0 errors, 0 warnings, 2 packs, 1 label overrides)');
  });

  it('check fails loudly on a missing dependency', () => {
    const r = checkPack(join(PACKS, 'demo-mod'), { fixture: join(PACKS, 'nope') });
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]!.message).toMatch(/nope: no pack.json|missing pack.json/);
  });

  it('test runs every replay headless on the real World and VM and writes results.json', async () => {
    const output = mkdtempSync(join(tmpdir(), 'opensinnoh-test-'));
    const r = await testPack({ packDir: join(PACKS, 'demo-mod'), engine: loadEngine, output });
    expect(r.ok).toBe(true);
    expect(r.results.map((x) => [x.mode, x.ok, x.roundTrip])).toEqual([['node', true, 'identical']]);
    expect(testSummary(r)).toBe('demo-mod: 1/1 replay runs passed');
    expect(JSON.parse(readFileSync(join(output, 'results.json'), 'utf8'))).toEqual(JSON.parse(JSON.stringify(r)));
    await expect(testPack({ packDir: join(PACKS, 'demo-mod'), files: [], engine: loadEngine, output })).rejects.toThrow(
      /no .replay files/,
    );
  });

  it('coverage follows labels from the zones and classifies each op', () => {
    const r = coverageReport(join(PACKS, 'fixture'), {}, null);
    expect(r.zones).toEqual({ matched: 7, regex: null });
    expect(r.ops.distinct).toBe(r.ops.real + r.ops.stub + r.ops.unknown);
    expect(r.ops.unknown).toBe(0);
    expect(r.byOp.find((o) => o.op === 'end')).toMatchObject({ kind: 'real' });
    const room = coverageReport(join(PACKS, 'fixture'), {}, ':ROOM$');
    expect(room.zones.matched).toBe(1);
    expect(room.labels).toBeLessThan(r.labels);
    expect(coverageSummary(r)).toMatch(/^fixture: 7 zones, \d+ labels \(ROM-wide roots: \d+ zone labels, \+8 behaviour, \+2 new-game, \+\d+ entry labels\); \d+ distinct ops/);
    // ROM-wide roots: every script entry counts, so labels no zone reaches (behaviour and new-game scripts) are in.
    expect(r.roots.entries).toBeGreaterThan(0);
    expect(r.labels).toBeGreaterThan(r.roots.zones);
    expect(room.roots).toMatchObject({ behaviors: 0, newGame: 0, entries: 0 });
    expect(r.realMissing).toEqual([]);
    expect(coverageSummary({ ...r, realMissing: ['use_surf (M1b)', 'select_move_tutor_pokemon (M3a)'] })).toMatch(/FAIL: tagged real ops not implemented: use_surf \(M1b\), select_move_tutor_pokemon \(M3a\)$/);
    expect(classifyOp('play_music').kind).toBe('real');
    expect(classifyOp('play_trainer_encounter_bgm').kind).toBe('real');
    expect(classifyOp('no_such_op').kind).toBe('unknown');
  });

  it('sweep loads every zone headless and reports per zone', async () => {
    const ws = loadWorkspace(join(PACKS, 'fixture'));
    const r = sweepZones(ws.packs, await loadEngine(), { ticks: 10 });
    expect(r.zones).toEqual({ registry: 7, swept: 7, exempt: 0, excluded: [] });
    expect(r.failed).toBe(0);
    expect(r.results.map((z) => [z.zone, z.ok, z.spawn.from])).toEqual([
      ['fixture:ROOM', true, 'warp'],
      ['fixture:TOWN', true, 'warp'],
      ['fixture:TERRAIN', true, 'warp'],
      ['fixture:GROTTO', true, 'warp'],
      ['fixture:SHOP', true, 'object'],
      ['fixture:ROUTE_W', true, 'centre'],
      ['fixture:ROUTE_E', true, 'object'],
    ]);
    expect(r.results.map((z) => z.warps.map((w) => `${w.to} ${w.toWarp} ${w.x},${w.z} ${w.status}`))).toEqual([['fixture:TOWN 0 10,13 ok'], ['fixture:ROOM 0 15,20 ok'], ['fixture:GROTTO 0 16,27 ok'], ['fixture:TERRAIN 0 3,28 ok'], [], [], []]);
    expect(r.arrivals).toEqual({ checked: 4, dynamic: 0, unreachable: 0, bad: 0 });
    expect(r).toMatchObject({ unknownOps: {}, unknownMovementTypes: {}, unknownActions: {}, unnamedBehaviours: {}, exemptions: [] });
    expect(m5Exemption('behaviour', 'JUMP_NORTH_TWICE')).toBeUndefined();
    expect(m5Exemption('op', 'press_pastoria_gym_button')?.reason).toBe('gym puzzles (M5)');
    expect(m5Exemption('op', 'trigger_platform_lift')).toBeUndefined();
    expect(sweepSummary(r)).toMatch(/swept 7\/7 zones/);
    const { registries } = loadGamePacks(ws.packs);
    const town = registries.zones.get('fixture:TOWN' as Id)!;
    const room = registries.zones.get('fixture:ROOM' as Id)!;
    expect(arrivalStatus(registries, town, -1, 0, null)).toBe('out-of-bounds');
    // The room's arrival (15,20) is blocked: the player walks one step north onto the mat; south is the wall.
    expect(arrivalStatus(registries, room, 15, 20, 'up')).toBe('ok');
    expect(arrivalStatus(registries, room, 15, 20, 'down')).toBe('blocked');
    expect(EXCLUDED_ZONE.test('platinum:MAP_HEADER_UNUSED_BATTLE_PARK')).toBe(true);
    expect(EXCLUDED_ZONE.test('platinum:MAP_HEADER_NOTHING')).toBe(true);
    expect(EXCLUDED_ZONE.test('platinum:MAP_HEADER_UNKNOWN_578')).toBe(true);
    expect(EXCLUDED_ZONE.test('platinum:MAP_HEADER_TWINLEAF_TOWN')).toBe(false);
    expect(EXEMPT_ZONE.test('platinum:MAP_HEADER_DISTORTION_WORLD_B1F')).toBe(false);
    expect(EXEMPT_ZONE.test('platinum:MAP_HEADER_UNDERGROUND')).toBe(true);
    expect(EXEMPT_ZONE.test('platinum:MAP_HEADER_ETERNA_CITY_UNDERGROUND_MAN_HOUSE')).toBe(false);
  });
});
