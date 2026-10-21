/**
 * The sound archive on the real ROM (OPENSINNOH_NDS_ROM; skipped without it): every sequence parses, every
 * bank and wave reference resolves, the tables match the ARM7 binary's copies, sample sequences have
 * plausible lengths, and the import wires zones, sequences and cries together.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { REGISTRIES, soundFramesToTicks, type Registries } from '@opensinnoh/contracts';
import { loadPacks, type Id } from '@opensinnoh/core';
import { NitroFs } from '@opensinnoh/nds';
import { readBank } from './bank.ts';
import { scanSequence } from './commands.ts';
import { measureSequence, SoundEngine } from './engine.ts';
import { readSdat, readSseq, type Sdat } from './sdat.ts';
import { sdatSource } from './sdat-source.ts';
import { ATTACK_TABLE, decibel, decibelSquare, SINE } from './tables.ts';
import { readWaveArchive } from './wave.ts';
import { romSlice } from '../../../tests/rom.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;
const P = (s: string) => `platinum:${s}` as Id;

describe.skipIf(!romPath)('sound archive (OPENSINNOH_NDS_ROM)', () => {
  let rom: Uint8Array;
  let fs: NitroFs;
  let sdat: Sdat;
  beforeAll(() => {
    rom = new Uint8Array(readFileSync(romPath!));
    fs = new NitroFs(rom);
    sdat = readSdat(fs.file('/data/sound/pl_sound_data.sdat'));
  });

  it('every sequence parses and every bank and wave archive it plays resolves', () => {
    const used = sdat.sequences.filter((q) => q !== null);
    expect(used.length).toBe(1013);
    let loops = 0;
    const checked = new Set<number>();
    for (const q of used) {
      const scan = scanSequence(readSseq(sdat.file(q.file)));
      if (scan.loops) loops++;
      const bank = sdat.banks[q.bank];
      expect(bank, q.name ?? '').toBeTruthy();
      expect(sdat.players[q.player], q.name ?? '').toBeTruthy();
      if (checked.has(q.bank)) continue;
      checked.add(q.bank);
      const instruments = readBank(sdat.file(bank!.file));
      const waves = bank!.waveArchives.map((w) => (w === null ? null : readWaveArchive(sdat.file(sdat.waveArchives[w]!.file))));
      for (const regions of instruments)
        for (const r of regions ?? []) {
          if (r.type !== 'pcm') continue;
          const archive = waves[r.archive!];
          expect(archive, `${bank!.name} slot ${r.archive}`).toBeTruthy();
          expect(archive![r.wave!], `${bank!.name} wave ${r.wave}`).toBeTruthy();
        }
    }
    // Every BGM loops; fanfares, sound effects and the cry sequence end.
    expect(loops).toBe(204);
  });

  it('the decibel, sine and attack tables match the ARM7 binary', () => {
    const dv = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
    const arm7 = rom.subarray(dv.getUint32(0x30, true), dv.getUint32(0x30, true) + dv.getUint32(0x3c, true));
    const find = (bytes: number[]) => {
      outer: for (let i = 0; i + bytes.length <= arm7.length; i++) {
        for (let k = 0; k < bytes.length; k++) if (arm7[i + k] !== bytes[k]) continue outer;
        return i;
      }
      return -1;
    };
    const s16 = (values: number[]) => values.flatMap((v) => [v & 0xff, (v >> 8) & 0xff]);
    expect(find(s16(Array.from({ length: 128 }, (_, i) => decibelSquare(i))))).toBeGreaterThan(0);
    expect(find(s16(Array.from({ length: 128 }, (_, i) => decibel(i))))).toBeGreaterThan(0);
    expect(find([...SINE])).toBeGreaterThan(0);
    expect(find([...ATTACK_TABLE])).toBeGreaterThan(0);
  });

  it('measures fanfares, sound effects and cries; the town BGM renders as sound', () => {
    const source = sdatSource(sdat);
    const index = (name: string) => sdat.sequences.findIndex((q) => q?.name === name);
    // SEQ_ASA (the Pokémon Center heal) and SEQ_FANFA1 (an item) in game ticks.
    expect(soundFramesToTicks(measureSequence(source, String(index('SEQ_ASA')), 20_000)!)).toBe(72);
    expect(soundFramesToTicks(measureSequence(source, String(index('SEQ_FANFA1')), 20_000)!)).toBe(39);
    // The cry sequence with Pikachu's bank (25) plays its wave to the end: about 0.8 s.
    expect(measureSequence(source, String(index('SEQ_PV001')), 20_000, '25')).toBe(153);
    const engine = new SoundEngine(source, 48_000);
    engine.start('field-bgm', String(index('SEQ_TOWN01_D')));
    const left = new Float32Array(48_000 * 2);
    const right = new Float32Array(left.length);
    engine.render(left, right);
    let sum = 0;
    for (let i = 0; i < left.length; i++) sum += left[i]! ** 2 + right[i]! ** 2;
    expect(Math.sqrt(sum / (2 * left.length))).toBeGreaterThan(0.02);
  });

  it('the import: zone music, sequence records and cries', () => {
    const loaded = loadPacks([romSlice().pack], '0.1.0', () => {});
    const reg = Object.fromEntries(REGISTRIES.map((r) => [r, loaded.registries[r] ?? new Map()])) as unknown as Registries;
    expect(reg.sequences.size).toBe(1013);
    expect(reg.soundBanks.size).toBe(521);
    expect(reg.waveArchives.size).toBe(521);
    expect(reg.soundPlayers.size).toBe(8);
    expect(reg.zones.get(P('MAP_HEADER_TWINLEAF_TOWN'))!.music).toEqual({ day: P('SEQ_TOWN01_D'), night: P('SEQ_TOWN01_N') });
    expect(reg.zones.get(P('MAP_HEADER_ROUTE_201'))!.music).toEqual({ day: P('SEQ_ROAD_A_D'), night: P('SEQ_ROAD_A_N') });
    const town = reg.sequences.get(P('SEQ_TOWN01_D'))!;
    expect(town).toMatchObject({ bank: P('BANK_BGM_FIELD'), player: P('PLAYER_FIELD'), frames: null });
    expect(reg.sequences.get(P('SEQ_FANFA1'))!.frames).toBe(248);
    expect(reg.cries.size).toBe(493);
    expect(reg.cries.get(P('SPECIES_PIKACHU'))).toMatchObject({ sequence: P('SEQ_PV001'), bank: P('BANK_PV025'), frames: 153 });
    expect(reg.cries.get(P('SPECIES_SHAYMIN'))!.forms!['1']!.bank).toBe(P('BANK_PV516_SKY'));
    // Eyes-meet music by class (field_bgm.c sTrainerEncounterBGMs), SEQ_EYE_KID for classes without a row.
    const byClass = (c: string) => [...reg.trainers.values()].find((t) => t.class === P(c))!.encounterBgm;
    expect(byClass('TRAINER_CLASS_YOUNGSTER')).toBe(P('SEQ_EYE_BOY'));
    expect(byClass('TRAINER_CLASS_GALACTIC_GRUNT_MALE')).toBe(P('SEQ_EYE_GINGA'));
    expect(byClass('TRAINER_CLASS_LEADER_ROARK')).toBe(P('SEQ_EYE_KID'));
    expect([...reg.trainers.values()].every((t) => t.encounterBgm && reg.sequences.has(t.encounterBgm))).toBe(true);
  });
});
