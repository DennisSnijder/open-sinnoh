/**
 * The fixture pack's sound: original chiptune music (PSG squares and noise, no wave data) written as
 * SSEQ bytecode with our own writer, its bank, the eight players (numbered as the decomp's PLAYER_*), a
 * town and a route theme, a jingle on the fanfare player and a blip sound effect.
 */
import type { InstrumentRegion, Sequence, SoundBank, SoundPlayer } from '../../packages/contracts/src/index.ts';
import { measureSequence } from '../../packages/audio/src/engine.ts';
import { recordsSource } from '../../packages/audio/src/records-source.ts';
import { Seq } from '../../packages/audio/src/writer.ts';

type Id = `${string}:${string}`;
const id = (s: string) => `fixture:${s}` as Id;

const psg = (duty: number, decay: number, sustain: number): InstrumentRegion => ({ low: 0, high: 127, type: 'psg', duty, baseKey: 60, attack: 127, decay, sustain, release: 110, pan: 64 });
const noise: InstrumentRegion = { low: 0, high: 127, type: 'noise', baseKey: 60, attack: 127, decay: 100, sustain: 0, release: 100, pan: 64 };

const Q = 48;

/** A looping two-voice tune: lead on track 0, bass on track 1, a noise tick on track 2. */
function theme(lead: number[][], bass: number[][], tempo: number): Uint8Array {
  const s = new Seq().allocateTracks(0b111).openTrack(1, 'bass').openTrack(2, 'drum').tempo(tempo).noteWait(false).program(0).volume(100).label('lead');
  for (const [key, len] of lead) {
    if (key) s.note(key, 100, len! - 4);
    s.wait(len!);
  }
  s.jump('lead');
  s.label('bass').noteWait(false).program(1).volume(90).label('bass-loop');
  for (const [key, len] of bass) {
    s.note(key!, 110, len! - 6);
    s.wait(len!);
  }
  s.jump('bass-loop');
  s.label('drum').noteWait(false).program(2).volume(60).label('drum-loop');
  s.note(60, 90, 6).wait(Q).note(60, 60, 4).wait(Q);
  s.jump('drum-loop');
  return s.build();
}

const town = theme(
  [
    [76, Q], [79, Q], [81, 2 * Q], [79, Q], [76, Q], [74, 2 * Q],
    [72, Q], [74, Q], [76, Q], [79, Q], [76, 4 * Q],
  ],
  [
    [48, 2 * Q], [55, 2 * Q], [57, 2 * Q], [52, 2 * Q],
    [53, 2 * Q], [55, 2 * Q], [48, 4 * Q],
  ],
  112,
);
const route = theme(
  [
    [69, Q / 2], [72, Q / 2], [76, Q], [74, Q / 2], [72, Q / 2], [69, Q], [0, Q],
    [67, Q / 2], [69, Q / 2], [72, Q], [71, Q], [69, 2 * Q], [0, Q],
  ],
  [
    [45, 2 * Q], [43, 2 * Q], [41, 2 * Q], [40, Q],
    [45, 2 * Q], [43, 2 * Q], [45, 2 * Q], [40, Q],
  ],
  136,
);
const jingle = new Seq().tempo(150).noteWait(false).program(0).volume(110).note(72, 110, 20).wait(24).note(76, 110, 20).wait(24).note(79, 110, 20).wait(24).note(84, 120, 60).wait(72).end().build();
const blip = new Seq().tempo(240).noteWait(false).program(0).volume(90).note(84, 100, 6).wait(6).note(91, 100, 10).wait(10).end().build();

/** Name, sequences at once, channels (music may take any; sound effects the top four). */
const PLAYERS: [string, number, number][] = [
  ['PLAYER_PV', 2, 0xc000],
  ['PLAYER_FIELD', 1, 0xffff],
  ['PLAYER_ME', 1, 0xffff],
  ['PLAYER_SE_1', 1, 0xf000],
  ['PLAYER_SE_2', 1, 0xf000],
  ['PLAYER_SE_3', 1, 0xf000],
  ['PLAYER_SE_4', 1, 0xf000],
  ['PLAYER_BGM', 1, 0xffff],
];

export function fixtureSound() {
  const soundPlayers: SoundPlayer[] = PLAYERS.map(([name, maxSequences, channels], i) => ({ id: id(name), sourceIndex: i, maxSequences, channels }));
  const soundBanks: SoundBank[] = [{ id: id('BANK_CHIPTUNE'), sourceIndex: 1, waveArchives: [], instruments: [[psg(1, 110, 90)], [psg(3, 100, 100)], [noise]] }];
  const files: Record<string, Uint8Array> = { 'sound/town.sseq': town, 'sound/route.sseq': route, 'sound/jingle.sseq': jingle, 'sound/blip.sseq': blip };
  const seq = (name: string, sourceIndex: number, file: string, player: string, volume: number): Sequence => ({
    id: id(name),
    sourceIndex,
    data: id(file),
    bank: id('BANK_CHIPTUNE'),
    volume,
    channelPriority: player === 'PLAYER_ME' ? 127 : 30,
    playerPriority: 64,
    player: id(player),
    frames: null,
  });
  const sequences = [
    seq('SEQ_TOWN', 1001, 'sound/town.sseq', 'PLAYER_FIELD', 100),
    seq('SEQ_ROUTE', 1002, 'sound/route.sseq', 'PLAYER_FIELD', 100),
    seq('SEQ_JINGLE', 1100, 'sound/jingle.sseq', 'PLAYER_ME', 110),
    seq('SEQ_SE_BLIP', 1500, 'sound/blip.sseq', 'PLAYER_SE_1', 100),
  ];
  const source = recordsSource(
    { sequences: new Map(sequences.map((s) => [s.id, s])), soundBanks: new Map(soundBanks.map((b) => [b.id, b])), soundPlayers: new Map(soundPlayers.map((p) => [p.id, p])) },
    (asset) => files[asset.slice('fixture:'.length)]!,
    () => [],
  );
  for (const s of sequences) s.frames = measureSequence(source, s.id, 60 * 192);
  return { records: { soundPlayers, soundBanks, waveArchives: [], sequences, cries: [] }, files };
}
