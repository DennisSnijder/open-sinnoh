/**
 * The Distortion World audit on the real ROM (OPENSINNOH_NDS_ROM; skipped without it), from the shared
 * slice import: every room parses (the readers reject unknown handlers, kinds, commands and
 * conditions), and the only fields left opaque are the listed decomp dummies.
 */
import { describe, expect, it } from 'vitest';
import { ROM, romSlice } from '../../../../tests/rom.ts';
import type { DistortionRoom, NewGame } from '@opensinnoh/contracts';
import { formatDistortionAudit } from './index.ts';

const ROOMS = ['1F', 'B1F', 'B2F', 'B3F', 'B4F', 'B5F', 'B6F', 'B7F', 'GIRATINA_ROOM', 'TURNBACK_CAVE_ROOM'].map((r) => `platinum:MAP_HEADER_DISTORTION_WORLD_${r}`);

describe.skipIf(!ROM)('Distortion World audit (OPENSINNOH_NDS_ROM)', () => {
  it('parses all ten rooms', () => {
    const { report } = romSlice();
    const audit = report.distortionWorld;
    expect(formatDistortionAudit(audit)).toMatch(/^Distortion World:\n {2}DISTORTION_WORLD_1F: /);
    expect(audit.rooms.map((r) => r.zone).sort()).toEqual([...ROOMS].sort());
    expect(report.counts.distortionRooms).toBe(10);
    // Every Distortion World script reference resolved (an unresolved one throws in the import).
    expect(Object.values(report.unknowns).flat().filter((u) => u.includes('DISTORTION_WORLD'))).toEqual([]);
  });

  it('writes one distortionRooms record per room and the shared tables', () => {
    const { pack } = romSlice();
    const rooms = pack.registries.distortionRooms as unknown as DistortionRoom[];
    expect(rooms.map((r) => r.id).sort()).toEqual([...ROOMS].sort());
    const b2f = rooms.find((r) => r.id.endsWith('_B2F'))!;
    expect(b2f.supports.map((s) => s.kind)).toEqual(['floor', 'floor', 'floor', 'floor', 'west-wall']);
    expect(b2f.supports.every((s) => s.cells.length === s.vertical * s.horizontal)).toBe(true);
    expect(rooms.flatMap((r) => r.jumps).filter((j) => j.to === 'land')).toHaveLength(8);
    const tables = (pack.registries.newGame![0] as unknown as NewGame).distortionWorld!;
    expect(tables.elevatorPaths).toHaveLength(22);
    expect(tables.cascadeUp.map((c) => c.kind)).toEqual(['cascade-up']);
    expect(tables.cascadeDown.map((c) => c.kind)).toEqual(['cascade-down']);
    // Every prop kind has its fldeff model; the joint-animated ones their clip; the sky its picture and seven clouds.
    expect(Object.values(tables.props).every((p) => /^platinum:MODEL_FLDEFF_\d+$/.test(p.model))).toBe(true);
    expect(Object.entries(tables.props).filter(([, p]) => p.clip).map(([k]) => k).sort()).toEqual(['land-rock', 'land-vine-flower', 'portal']);
    expect(tables.sky.clouds).toHaveLength(7);
    expect(tables.sky.background).toBe('platinum:distortion/sky/background.png');
    // The warp is a separate title-demo model with looping joint and texture animation.
    expect(tables.warp).toMatchObject({ model: 'platinum:MODEL_DW_WARP', frames: 240, loop: true });
    expect(tables.warp!.srt).toHaveLength(1);
    expect(tables.warp!.srt[0]!.frames).toBe(240);
    expect(pack.registries.models!.some(m => m.id === tables.warp!.model)).toBe(true);
  });

  it('leaves only the listed fields opaque', () => {
    const { opaque } = romSlice().report.distortionWorld;
    // Decomp dummies: none is read by overlay 9. Terrain cell bits 8–14 are never set.
    expect(opaque).toEqual([
      { field: 'room file unknown00', values: [0] },
      { field: 'simple prop unknown00', values: [0] },
      { field: 'jump point unknown04', values: [0] },
      { field: 'move-platform unknown04', values: [0, 1, 2] },
    ]);
  });
});
