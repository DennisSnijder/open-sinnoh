/** Original fixture sequences reused under native source numbers; no ROM bytes or timing fixtures. */
import { SoundSystem } from '@opensinnoh/game';
import type { GameState, Registries, StubLog } from '@opensinnoh/contracts';

export function fixtureAudio(registries: Registries, state: GameState, log: StubLog = { stub: () => {} }): SoundSystem {
  return new SoundSystem({ registries, log, hour: () => 12, field: () => ({ surfing: state.playerState === 'surf', cycling: state.playerState === 'cycle' }), output: null });
}

/** Native numbers on our own blip/jingle records. Motor loops have no fixed end; short effects last two ticks. */
export function withFieldSounds(registries: Registries): Registries {
  const blip = [...registries.sequences.values()].find((s) => s.sourceIndex === 1500)!;
  const jingle = [...registries.sequences.values()].find((s) => s.sourceIndex === 1100)!;
  const loops = new Set([1355, 1356, 1553, 1554, 1556, 1557, 1593, 1624, 1626]);
  const sources = [1355, 1356, 1357, 1367, 1492, 1500, 1506, 1507, 1572, 1694, 1685, 1686, 1689, 1501, 1504, 1505, 1508, 1514, 1515, 1516, 1521, 1522, 1523, 1533, 1536, 1537, 1539, 1541, 1543, 1544, 1547, 1553, 1554, 1556, 1557, 1561, 1562, 1563, 1564, 1575, 1578, 1592, 1593, 1604, 1607, 1610, 1611, 1622, 1624, 1626, 1627, 1692, 1696, 1738, 1740, 1741, 1742];
  const sequences = new Map(registries.sequences);
  for (const sourceIndex of sources) {
    const id = `fixture:FIELD_SE_${sourceIndex}` as const;
    // Replace the original alias too, so source indexes remain unique.
    for (const [key, s] of sequences) if (s.sourceIndex === sourceIndex) sequences.delete(key);
    sequences.set(id, { ...blip, id, sourceIndex, frames: loops.has(sourceIndex) ? null : 12 });
  }
  for (const sourceIndex of [1157, 1158, 1160, 1163]) {
    const id = `fixture:FIELD_ME_${sourceIndex}` as const;
    sequences.set(id, { ...jingle, id, sourceIndex, frames: 12 });
  }
  const cries = new Map(registries.cries);
  for (const species of registries.species.keys()) cries.set(species, { id: species, sequence: 'fixture:FIELD_SE_1500', bank: blip.bank, frames: 12 });
  return { ...registries, sequences, cries };
}

/** Observe real AudioOutput commands, preserving same-tick ordering and source/handle semantics. */
export function audioTrace(audio: SoundSystem, registries: Registries, tick: () => number) {
  const events: { tick: number; op: 'start' | 'stop'; source: number; handle: string }[] = [];
  const handles = new Map<string, number>();
  audio.output = { send(command) {
    if (command.op === 'start') {
      const source = registries.sequences.get(command.seq)!.sourceIndex!;
      handles.set(command.handle, source);
      events.push({ tick: tick(), op: 'start', source, handle: command.handle });
    } else if (command.op === 'stop') {
      events.push({ tick: tick(), op: 'stop', source: handles.get(command.handle)!, handle: command.handle });
      handles.delete(command.handle);
    }
  } };
  return events;
}
