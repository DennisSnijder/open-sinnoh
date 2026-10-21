import { measureSequence, readBank, readSdat, readSseq, scanSequence, sdatSource } from '@opensinnoh/audio';
import type { Cry, Sequence, SoundBank, SoundPlayer, WaveArchive } from '@opensinnoh/contracts';
import { asId, type Id } from '@opensinnoh/core';
import type { NitroFs } from '@opensinnoh/nds';

/**
 * The sound archive (docs/research/audio.md): every named sequence, bank, wave archive and player of
 * /data/sound/pl_sound_data.sdat as records, the SSEQ and SWAR files as assets (kept as DS bytes: the
 * synth plays them), and a cry per species. Ids are the SDAT's own symbol names (decomp SEQ_*, BANK_*,
 * WAVE_ARC_*, PLAYER_*). Sequence lengths come from running the sequencer (`Sequence.frames`).
 */

export const SDAT_PATH = '/data/sound/pl_sound_data.sdat';
/** decomp SEQ_PV001: the cry sequence, played with the species' bank (Sound_PlayPokemonCry). */
const CRY_SEQUENCE = 1;
/** decomp shaymin_forms_sky_cry_swar: Shaymin's Sky Forme cry bank (Sound_Impl_IsShayminSkyForm). */
const SHAYMIN_SKY_BANK = 494;
const SPECIES_SHAYMIN = 492;
/** decomp MAX_SPECIES: banks 1..493 are the species' cries. */
const MAX_SPECIES = 493;
/** Sequences that never end within this many sound frames (10 minutes) count as looping. */
const MEASURE_LIMIT = 10 * 60 * 192;

export interface SoundImport {
  sequences: Sequence[];
  soundBanks: SoundBank[];
  waveArchives: WaveArchive[];
  soundPlayers: SoundPlayer[];
  cries: Cry[];
  assets: Map<string, Uint8Array>;
  /** A zone header's music id → its sequence (0 = none → null). */
  music(index: number, where: string): Id | null;
}

export function importSound(fs: NitroFs, speciesIds: readonly Id[], onProgress: (done: number, total: number) => void): SoundImport {
  const sdat = readSdat(fs.file(SDAT_PATH));
  const source = sdatSource(sdat);
  const assets = new Map<string, Uint8Array>();
  const id = (name: string | null, kind: string, i: number) => asId(`platinum:${name ?? `${kind}/${i}`}`);
  const playerIds = sdat.players.map((p, i) => (p ? id(p.name, 'sound-player', i) : null));
  const waveIds = sdat.waveArchives.map((w, i) => (w ? id(w.name, 'wave-archive', i) : null));
  const bankIds = sdat.banks.map((b, i) => (b ? id(b.name, 'sound-bank', i) : null));
  const need = <T>(list: (T | null)[], i: number, what: string): T => {
    const v = list[i];
    if (v === null || v === undefined) throw new Error(`${SDAT_PATH}: ${what} ${i} does not exist`);
    return v;
  };

  const soundPlayers: SoundPlayer[] = [];
  sdat.players.forEach((p, i) => p && soundPlayers.push({ id: playerIds[i]!, sourceIndex: i, maxSequences: p.maxSequences, channels: p.channels }));

  const waveArchives: WaveArchive[] = [];
  sdat.waveArchives.forEach((w, i) => {
    if (!w) return;
    const path = `sound/wave/${w.file}.swar`;
    if (!assets.has(path)) assets.set(path, sdat.file(w.file).slice());
    waveArchives.push({ id: waveIds[i]!, sourceIndex: i, data: asId(`platinum:${path}`) });
  });

  const soundBanks: SoundBank[] = [];
  sdat.banks.forEach((b, i) => {
    if (!b) return;
    const instruments = readBank(sdat.file(b.file));
    const slots = b.waveArchives.map((w) => (w === null ? null : need(waveIds, w, 'wave archive')));
    soundBanks.push({ id: bankIds[i]!, sourceIndex: i, waveArchives: slots, instruments });
  });

  const sequences: Sequence[] = [];
  const total = sdat.sequences.length;
  sdat.sequences.forEach((q, i) => {
    if (!q) return;
    const data = readSseq(sdat.file(q.file));
    const scan = scanSequence(data);
    const path = `sound/seq/${q.file}.sseq`;
    if (!assets.has(path)) assets.set(path, data.slice());
    sequences.push({
      id: id(q.name, 'sequence', i),
      sourceIndex: i,
      data: asId(`platinum:${path}`),
      bank: need(bankIds, q.bank, `bank of sequence ${i}`),
      volume: q.volume,
      channelPriority: q.channelPriority,
      playerPriority: q.playerPriority,
      player: need(playerIds, q.player, `player of sequence ${i}`),
      frames: scan.loops ? null : measureSequence(source, String(i), MEASURE_LIMIT),
    });
    if (i % 100 === 0) onProgress(i, total);
  });
  onProgress(total, total);
  const sequenceIds = new Map(sequences.map((s) => [s.sourceIndex!, s.id]));

  const cries: Cry[] = [];
  const crySequence = sequenceIds.get(CRY_SEQUENCE);
  if (!crySequence) throw new Error(`${SDAT_PATH}: no cry sequence ${CRY_SEQUENCE}`);
  speciesIds.forEach((species, n) => {
    if (n === 0 || n > MAX_SPECIES) return;
    const cry = (bank: number) => {
      const frames = measureSequence(source, String(CRY_SEQUENCE), MEASURE_LIMIT, String(bank));
      if (frames === null) throw new Error(`${SDAT_PATH}: the cry of bank ${bank} does not end`);
      return { bank: need(bankIds, bank, `cry bank of species ${n}`), frames };
    };
    cries.push({ id: species, sequence: crySequence, ...cry(n), ...(n === SPECIES_SHAYMIN ? { forms: { '1': cry(SHAYMIN_SKY_BANK) } } : {}) });
  });

  return {
    sequences,
    soundBanks,
    waveArchives,
    soundPlayers,
    cries,
    assets,
    music(index, where) {
      if (index === 0) return null;
      const seq = sequenceIds.get(index);
      if (!seq) throw new Error(`${where}: music ${index} is not a sequence of ${SDAT_PATH}`);
      return seq;
    },
  };
}
