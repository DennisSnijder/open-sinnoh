import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bucketOf, classifyOp, TRIAGE } from './classify.ts';
import { COMMANDS, COMMAND_BY_NAME } from './commands.ts';
import { classificationReport, classifyOps, implementedOps, m5Progress, M5_PATH, REAL_CONTESTS, REAL_SEALS, REAL_GAME_CORNER, REAL_TOWN, REAL_M1B, REAL_M2A, REAL_M3B, REAL_M5, REAL_P, type M5Chunk } from './coverage.ts';
import { CP_PATH_OPS } from './cp-path.ts';

describe('op classification', () => {
  it('classifies every native command once', () => {
    const ops = classifyOps();
    expect(ops.map((o) => o.op)).toEqual(COMMANDS.map((c) => c.name));
    for (const o of ops) if (o.status !== 'implemented') expect(o.milestone && o.default, o.op).toBeTruthy();
  });

  it('every op on the checkpoint path is implemented or stubbed', () => {
    const byOp = new Map(classifyOps().map((o) => [o.op, o]));
    expect(CP_PATH_OPS.length).toBeGreaterThan(100);
    expect(CP_PATH_OPS.filter((op) => byOp.get(op)?.status === 'unimplemented')).toEqual([]);
  });

  it('each M5 chunk tags only stubs on its own story path, each op once; the O0 ops and start_tag_battle are real', () => {
    const byOp = new Map(classifyOps().map((o) => [o.op, o]));
    const all = (Object.keys(REAL_M5) as M5Chunk[]).flatMap((k) => REAL_M5[k] as readonly string[]);
    expect(new Set(all).size).toBe(all.length);
    for (const k of Object.keys(REAL_M5) as M5Chunk[]) {
      expect(M5_PATH[k].length, k).toBeGreaterThan(100);
      expect(M5_PATH[k].filter((op) => byOp.get(op)?.status === 'unimplemented'), k).toEqual([]);
      for (const op of REAL_M5[k]) {
        expect(M5_PATH[k], `${op} on the ${k} path`).toContain(op);
        expect(byOp.get(op)!.real, op).toBe(k);
      }
    }
    for (const op of ['scr_cmd_32d', 'scr_cmd_32e', 'scr_cmd_331', 'scr_cmd_332', 'scr_cmd_2cd', 'set_black_out_warp_id', 'try_set_unused_collected_orb_flag', 'scr_cmd_2b6', 'get_unown_forms_seen_count']) expect(byOp.get(op)!.status, op).toBe('implemented');
    const m5a = m5Progress().find((c) => c.chunk === 'M5a')!;
    expect(m5a.realDone).toEqual(['scr_cmd_32d', 'scr_cmd_32e', 'scr_cmd_331', 'scr_cmd_332', 'scr_cmd_2cd', 'set_black_out_warp_id', 'try_set_unused_collected_orb_flag', 'start_tag_battle', 'init_persisted_map_features_for_eterna_gym', 'advance_eterna_gym_clock', 'init_persisted_map_features_for_hearthome_gym', 'init_persisted_map_features_for_veilstone_gym']);
  });

  it('buckets and defaults', () => {
    expect(bucketOf('buffer_move_name')).toBe('text');
    expect(bucketOf('start_wild_battle')).toBe('battle');
    expect(bucketOf('get_party_mon_level')).toBe('party');
    expect(bucketOf('show_object')).toBe('objects');
    expect(bucketOf('check_step_flag')).toBe('other');
    expect(bucketOf('scr_cmd_135')).toBe('communication');
    expect(classifyOp('get_party_mon_level')).toMatchObject({ status: 'stubbed', default: 'returns 0' });
    expect(classifyOp('buffer_move_name')).toMatchObject({ status: 'stubbed', default: 'buffers an empty string' });
    expect(classifyOp('start_fateful_encounter')).toMatchObject({ status: 'stubbed', default: 'no-op' });
    expect(classifyOp('unused_004').status).toBe('unimplemented');
    expect(classifyOp('check_step_flag').status).toBe('unimplemented');
    expect(classifyOp('scr_cmd_1e3')).toMatchObject({ status: 'stubbed', bucket: 'battle', milestone: 'later (Battle Tower)' });
    expect(classifyOp('scr_cmd_1e3').default).toMatch(/^returns 0; decomp: /);
    expect(classifyOp('use_fly').milestone).toMatch(/^M3/);
    expect(classifyOp('init_persisted_map_features_for_pastoria_gym').milestone).toMatch(/^M5/);
    expect(classifyOp('fade_in_bgm').milestone).toMatch(/^M4/);
  });

  it('every real: M1b op is implemented; triage covers only real, handler-less commands', () => {
    const impl = new Set(implementedOps());
    expect(REAL_M1B.filter((op) => !impl.has(op))).toEqual([]);
    expect(REAL_P.filter((op) => !impl.has(op))).toEqual([]);
    expect(classifyOps().filter((o) => o.real === 'M2a' && o.status !== 'implemented')).toEqual([]);
    expect(classifyOps().filter((o) => o.real === 'M2a').length).toBe(REAL_M2A.length);
    expect(classifyOps().filter((o) => o.real === 'P').length).toBe(REAL_P.length);
    expect(classifyOps().filter((o) => o.real === 'M3b' && o.status !== 'implemented')).toEqual([]);
    expect(classifyOps().filter((o) => o.real === 'M3b').length).toBe(REAL_M3B.length);
    expect(classifyOps().filter((o) => o.real === 'contests' && o.status !== 'implemented')).toEqual([]);
    expect(classifyOps().filter((o) => o.real === 'contests').length).toBe(REAL_CONTESTS.length);
    expect(classifyOps().filter((o) => o.real === 'seals' && o.status !== 'implemented')).toEqual([]);
    expect(classifyOps().filter((o) => o.real === 'seals').length).toBe(REAL_SEALS.length);
    expect(classifyOps().filter((o) => o.real === 'game-corner' && o.status !== 'implemented')).toEqual([]);
    expect(classifyOps().filter((o) => o.real === 'game-corner').length).toBe(REAL_GAME_CORNER.length);
    expect(classifyOps().filter((o) => o.real === 'town' && o.status !== 'implemented')).toEqual([]);
    expect(classifyOps().filter((o) => o.real === 'town').length).toBe(REAL_TOWN.length);
    expect(classifyOps().filter((o) => o.real === 'M1b').map((o) => o.op)).toEqual(COMMANDS.map((c) => c.name).filter((op) => REAL_M1B.includes(op)));
    for (const op of Object.keys(TRIAGE)) {
      expect(COMMAND_BY_NAME.has(op), op).toBe(true);
      expect(impl.has(op), op).toBe(false);
    }
  });

  it('the committed JSON report is current (pnpm tsx packages/vm/tools/gen-classification.ts)', () => {
    expect(readFileSync(join(import.meta.dirname, 'data/op-classification.json'), 'utf8')).toBe(classificationReport());
  });
});
