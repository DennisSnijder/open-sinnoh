/**
 * The game's sound on the real ROM (OPENSINNOH_NDS_ROM). Every sequence the code plays by its SDAT name exists
 * under that bare name (no `_sseq` suffix). The opening replay (bedroom → Twinleaf → Route 201
 * → Lake Verity) sends the music the decomp's rules choose, at the same ticks on every run, and the
 * zone connection into Route 201 fades the Twinleaf BGM out over 60 ticks before the route BGM starts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AudioCommand, AudioHost } from '@opensinnoh/contracts';
import type { Id, PackData } from '@opensinnoh/core';
import { CountingStubLog, createGame, gameDriver, runReplay, type ReplayResolver } from '@opensinnoh/game';
import { createBattle } from '@opensinnoh/battle';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { FieldSound } from '../../packages/world/src/sound.ts';
import { romSlice } from '../rom.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;
const dir = join(import.meta.dirname, '../rom-replays');
const read = (file: string) => readFileSync(join(dir, file), 'utf8');

async function opening(pack: PackData) {
  const sent: { tick: number; command: AudioCommand }[] = [];
  const log = new CountingStubLog(() => {});
  const game = createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, seed: 1, log, now: () => '2026-01-01T00:00:00.000Z' });
  game.audioOutput = { send: (command) => void sent.push({ tick: game.state.tick, command }) };
  const resolve: ReplayResolver = (file) => ({ name: file, text: read(file) });
  const result = await runReplay(gameDriver(game), read('opening.replay'), { registries: game.registries, seed: 1, name: 'opening.replay', resolve, repeat: false });
  return { result, sent, log };
}

describe.skipIf(!romPath)('sound on the opening (OPENSINNOH_NDS_ROM)', () => {
  let pack: PackData;
  beforeAll(() => {
    ({ pack } = romSlice());
  }, 60_000);

  it('plays the zone BGM of Twinleaf and Route 201, fading across the zone connection, the same on every run', async () => {
    const a = await opening(pack);
    expect(a.result.error).toBeUndefined();
    const starts = a.sent.filter((s) => s.command.op === 'start').map((s) => (s.command as { seq: string }).seq);
    const town = starts.indexOf('platinum:SEQ_TOWN01_D');
    const route = starts.indexOf('platinum:SEQ_ROAD_A_D');
    expect(town).toBeGreaterThanOrEqual(0);
    expect(route).toBeGreaterThan(town);
    // The connection: the field BGM fades to silence over 60 ticks, and the route BGM starts 60 ticks later.
    const routeAt = a.sent.find((s) => s.command.op === 'start' && s.command.seq === 'platinum:SEQ_ROAD_A_D')!;
    const fade = a.sent.filter((s) => s.command.op === 'volume' && s.command.ticks === 60 && s.tick <= routeAt.tick).at(-1)!;
    expect(fade.command).toEqual({ op: 'volume', handle: 'field-bgm', volume: 0, ticks: 60 });
    expect(routeAt.tick - fade.tick).toBe(60);
    console.log(`opening music: ${[...new Set(starts)].join(' → ')}; sequences missing: ${a.log.counts.get('audio:sequence-missing') ?? 0}`);
    expect(a.log.counts.get('audio:sequence-missing')).toBeUndefined();
    const b = await opening(pack);
    expect(b.sent).toEqual(a.sent);
  }, 180_000); // Two complete opening replays on the machine shared by the other test runs.

  it('every sequence the code plays by name resolves and plays (warp panel, Sunyshore gym, Spear Pillar, Distortion World)', () => {
    const log = new CountingStubLog(() => {});
    const game = createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, seed: 1, log, now: () => '2026-01-01T00:00:00.000Z' });
    const played: Id[] = [];
    const audio = { playSe: (id: Id) => void played.push(id), sePlaying: () => false } as unknown as AudioHost;
    const sound = new FieldSound(audio, game.registries, log);
    const names = [
      'SEQ_SE_DP_TELE2', 'SEQ_SE_DP_GAGAGA', 'SEQ_SE_PL_SYUWA2', 'SEQ_SE_PL_SYUWA3', 'SEQ_SE_PL_FW089_2', 'SEQ_SE_PL_MEKI', 'SEQ_SE_PL_MEKI2',
      'SEQ_SE_DP_FW019', 'SEQ_SE_DP_UG_008', 'SEQ_SE_PL_FW089B', 'SEQ_SE_PL_FW463', 'SEQ_SE_PL_GIRA',
      ...['01', '03', '06', '09', '10', '12'].map((n) => `SEQ_SE_DP_CLIMAX${n}`), 'SEQ_SE_PL_W060', 'SEQ_SE_PL_W082C', 'SEQ_SE_PL_W392',
      'SEQ_D_RYAYHY', 'SEQ_PL_EV_GIRA', 'SEQ_PL_EV_GIRA2',
    ];
    for (const name of names) sound.playNamed(name);
    expect(log.counts.get('audio:sequence-missing')).toBeUndefined();
    expect(played).toEqual(names.map((n) => `platinum:${n}`));
  }, 60_000);
});
