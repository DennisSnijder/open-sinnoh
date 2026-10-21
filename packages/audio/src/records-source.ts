import type { Sequence, SoundBank, SoundPlayer } from '@opensinnoh/contracts';
import type { EngineData } from './engine.ts';
import type { Wave } from './wave.ts';

/**
 * Engine data from the sound records: sequence bytecode and wave archives come from `bytes(asset)` and
 * `waves(archive id)` (the worklet's loaded files, or a pack folder). Unknown ids throw.
 */
export function recordsSource(
  records: { sequences: ReadonlyMap<string, Sequence>; soundBanks: ReadonlyMap<string, SoundBank>; soundPlayers: ReadonlyMap<string, SoundPlayer> },
  bytes: (asset: string) => Uint8Array,
  waves: (archive: string) => Wave[],
): EngineData {
  const need = <T>(map: ReadonlyMap<string, T>, id: string, what: string): T => {
    const v = map.get(id);
    if (!v) throw new Error(`sound: no ${what} ${id}`);
    return v;
  };
  return {
    sequence(id) {
      const s = need(records.sequences, id, 'sequence');
      return { data: bytes(s.data), bank: s.bank, volume: s.volume, channelPriority: s.channelPriority, playerPriority: s.playerPriority, player: s.player };
    },
    bank: (id) => need(records.soundBanks, id, 'sound bank'),
    waves,
    player: (id) => need(records.soundPlayers, id, 'sound player'),
  };
}
