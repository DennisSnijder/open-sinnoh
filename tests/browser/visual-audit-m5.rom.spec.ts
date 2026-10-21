/** Local field audit. ROM pixels stay in ignored test-artifacts; no image goldens. */
import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { seedRomImport } from './seed.ts';
import { mainCanvasStats } from '../../packages/cli/src/browser.ts';

const spots: [string, number, number][] = [
  ['PASTORIA_CITY', 601, 837], ['PASTORIA_CITY_GYM', 13, 40],
  ['CANALAVE_CITY', 39, 733], ['CANALAVE_CITY_GYM', 8, 15],
  ['SNOWPOINT_CITY', 366, 201], ['SNOWPOINT_CITY_GYM', 7, 15],
  ['SUNYSHORE_CITY', 849, 764], ['SUNYSHORE_CITY_GYM_ROOM_3', 11, 25],
  // Authored stair/warp tiles, rather than the solid wall two tiles north of each stair.
  ['VICTORY_ROAD_1F', 7, 47], ['VICTORY_ROAD_2F', 23, 26], ['VICTORY_ROAD_B1F', 6, 46],
  ['POKEMON_LEAGUE_AARON_ROOM', 8, 8], ['POKEMON_LEAGUE_BERTHA_ROOM', 8, 8],
  ['POKEMON_LEAGUE_FLINT_ROOM', 8, 8], ['POKEMON_LEAGUE_LUCIAN_ROOM', 8, 8],
  ['POKEMON_LEAGUE_CHAMPION_ROOM', 8, 16], ['POKEMON_LEAGUE_HALL_OF_FAME', 8, 12],
  ['SPEAR_PILLAR', 31, 35], ['DISTORTION_WORLD_B1F', 16, 49],
];

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');
// An audit probe (docs/research/visual-audit-m5.md), not a regression gate: run it with OPENSINNOH_AUDIT=1.
test.skip(!process.env.OPENSINNOH_AUDIT, 'audit probe: set OPENSINNOH_AUDIT=1');
test('field checkpoints draw geometry and actors', async ({ page }, info) => {
  test.setTimeout(1_200_000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true);
  const initial = await page.evaluate(() => window.openSinnohGame!.snapshot().state);
  const results = [];
  for (const [name, x, z] of spots) {
    const state = {
      ...initial, player: { zone: `platinum:MAP_HEADER_${name}`, x, z, y: 0, facing: 'up' },
      vars: { ...initial.vars, 'platinum:VAR_DISTORTION_WORLD_PROGRESS': 5, 'platinum:VAR_SUNYSHORE_CITY_STATE': 3 },
      objects: [], follower: null, mapFeatures: null,
    };
    await page.evaluate(json => window.openSinnohGame!.load(json, 'arrival'), JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: '2026-01-01T00:00:00.000Z', state }));
    await page.evaluate(() => { window.openSinnohGame!.setClock('2009-03-22', '12:00'); window.openSinnohGame!.advance(40); });
    await page.waitForFunction(() => window.openSinnohApp?.sceneLoading() === false, undefined, { timeout: 120_000 });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const stats = await mainCanvasStats(page);
    const view = await page.evaluate(() => {
      const g = window.openSinnohApp!.game, v = g.world.view();
      const zone = g.registries.zones.get(v.zone)!;
      return { player: g.state.player, weather: v.weather, camera: zone.camera, area: v.area,
        actors: v.actors.length, effects: v.effects.length, battleBackground: zone.battleBackground,
        distortion: v.distortion && { floors: v.distortion.floors.length, props: v.distortion.props.length } };
    });
    results.push({ name, stats, view });
    console.log(`${name}: ${stats.colours} colours, lit ${stats.litShare}`);
    await page.screenshot({ path: `test-artifacts/visual-audit-m5/${info.project.name}-${name}.png` });
    expect(stats.colours, name).toBeGreaterThan(8);
    expect(stats.litShare, name).toBeGreaterThan(0.1);
  }
  writeFileSync(`test-artifacts/visual-audit-m5/${info.project.name}.json`, JSON.stringify(results, null, 2));
  expect(errors).toEqual([]);
});
