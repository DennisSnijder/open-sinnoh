/**
 * The headless zone sweep on the real ROM (OPENSINNOH_NDS_ROM): every playable zone loads, runs its
 * map scripts and steps without a throw, every warp's arrival tile loads and is standable, and no
 * unknown op is hit (`opensinnoh sweep` prints the per-zone and per-warp report).
 */
import { describe, expect, it } from 'vitest';
import { romSlice } from '../rom.ts';
import { createBattle } from '@opensinnoh/battle';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { createApp, createPoketch } from '@opensinnoh/menus';
import { badArrivals, sweepSummary, sweepZones, UNREACHABLE_WARPS } from '../../packages/cli/src/sweep.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;

describe.skipIf(!romPath)('zone sweep (OPENSINNOH_NDS_ROM)', () => {
  it('loads all 565 playable zones and every warp arrival headless, with no throw and no unknown op; cut content is an exemption', async () => {
    const { pack } = romSlice();
    const r = sweepZones([pack], { createWorld, createScriptRunner, createApp, createBattle, createPoketch });
    console.log(sweepSummary(r));
    expect(r.zones).toMatchObject({ registry: 593, swept: 565, exempt: 1 });
    expect(r.zones.excluded).toHaveLength(28);
    expect(r.results.filter((z) => !z.ok).map((z) => `${z.zone}: ${z.error}`)).toEqual([]);
    expect(r.unknownOps).toEqual({});
    expect(badArrivals(r.results)).toEqual([]);
    expect(r.arrivals.unreachable).toBe(Object.keys(UNREACHABLE_WARPS).length);
    expect(r.arrivals.checked).toBeGreaterThan(1000);
    expect(r.unknownMovementTypes).toEqual({});
    expect(Object.keys(r.unknownActions)).toEqual([]);
    // Zero unnamed. The decomp's UNKNOWN_x60/8F walkable tiles are inert by decision (world INERT_UNKNOWN);
    // UNKNOWN_x3C–3F are only on the excluded UNKNOWN_578.
    expect(r.unnamedBehaviours).toEqual({});
    expect(r.inertBehaviours).toEqual({ UNKNOWN_x60: 3, UNKNOWN_x8F: 2 });
    // Cut content is reported as exemptions, never as unknowns.
    expect(r.exemptions.filter((e) => e.kind === 'behaviour').map((e) => e.name)).toEqual(['DYNAMIC_HEIGHT_COLLISION', 'PASTORIA_GYM_H_GROUND', 'PASTORIA_GYM_L_GROUND', 'PASTORIA_GYM_M_GROUND']);
    // The Distortion World is swept like any zone: no exempt op there.
    expect(r.exemptions.filter((e) => e.kind === 'op' && /distortion|dw_warp|giratina/.test(e.name))).toEqual([]);
  }, 120_000);
});
