import { readBank } from './bank.ts';
import type { BankData, EngineData, PlayerData, SequenceData } from './engine.ts';
import { readSseq, type Sdat } from './sdat.ts';
import { readWaveArchive, type Wave } from './wave.ts';

/** Engine data straight from an SDAT, keyed by index as strings (the importer's sequence measurements, tests). */
export function sdatSource(sdat: Sdat): EngineData {
  const sequences = new Map<string, SequenceData>();
  const banks = new Map<string, BankData>();
  const waves = new Map<string, Wave[]>();
  const need = <T>(v: T | null | undefined, what: string): T => {
    if (v === null || v === undefined) throw new Error(`SDAT: no ${what}`);
    return v;
  };
  return {
    sequence(id) {
      let s = sequences.get(id);
      if (!s) {
        const q = need(sdat.sequences[Number(id)], `sequence ${id}`);
        s = { data: readSseq(sdat.file(q.file)), bank: String(q.bank), volume: q.volume, channelPriority: q.channelPriority, playerPriority: q.playerPriority, player: String(q.player) };
        sequences.set(id, s);
      }
      return s;
    },
    bank(id) {
      let b = banks.get(id);
      if (!b) {
        const info = need(sdat.banks[Number(id)], `bank ${id}`);
        b = { waveArchives: info.waveArchives.map((w) => (w === null ? null : String(w))), instruments: readBank(sdat.file(info.file)) };
        banks.set(id, b);
      }
      return b;
    },
    waves(id) {
      let w = waves.get(id);
      if (!w) {
        w = readWaveArchive(sdat.file(need(sdat.waveArchives[Number(id)], `wave archive ${id}`).file));
        waves.set(id, w);
      }
      return w;
    },
    player(id): PlayerData {
      const p = need(sdat.players[Number(id)], `player ${id}`);
      return { maxSequences: p.maxSequences, channels: p.channels };
    },
  };
}
