/**
 * The game's sound system on the fixture pack's original sound records: what it sends to the output,
 * and the tick timing of fades, fanfares and BGM changes (decomp sound_system.c / field_bgm.c rules).
 */
import { describe, expect, it } from 'vitest';
import { soundFramesToTicks, type AudioCommand, type Registries, type Zone } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { loadGamePacks } from './packs.ts';
import { SoundSystem } from './sound.ts';
import { CountingStubLog } from './stub-log.ts';
import { createGame } from './game.ts';
import { createFakeScriptRunner, createFakeWorld } from '../test/fakes.ts';
import { readPack } from '../test/packs.ts';

const F = (s: string) => `fixture:${s}` as Id;

function system(extra: Partial<Registries> = {}) {
  const registries = { ...loadGamePacks([readPack('fixture')]).registries, ...extra } as Registries;
  const sent: AudioCommand[] = [];
  const log = new CountingStubLog(() => {});
  const field = { surfing: false, cycling: false };
  let hour = 12;
  const sound = new SoundSystem({ registries, log, hour: () => hour, field: () => field, output: { send: (c) => void sent.push(c) } });
  return { sound, sent, log, registries, field, setHour: (h: number) => (hour = h) };
}

const ticks = (sound: SoundSystem, n: number) => {
  for (let i = 0; i < n; i++) sound.tick();
};

describe('SoundSystem', () => {
  it('a cutscene BGM (the title, the intro) stops everything first, the paused field BGM too: one BGM plays', () => {
    const sequences = new Map(loadGamePacks([readPack('fixture')]).registries.sequences);
    const title = F('SEQ_TITLE');
    sequences.set(title, { ...sequences.get(F('SEQ_ROUTE'))!, id: title, sourceIndex: 1173, player: F('PLAYER_BGM') });
    const { sound, sent } = system({ sequences });
    // The session's map load behind the title started the zone's BGM; a fanfare left it paused.
    sound.playForZone(F('TOWN'));
    sound.playFanfare(F('SEQ_JINGLE'));
    sent.length = 0;
    sound.playCutsceneBgm(title);
    expect(sent).toEqual([{ op: 'stop-all' }, { op: 'start', handle: 'bgm', seq: title }]);
    expect(sound.bgmHandles()).toEqual([{ handle: 'bgm', seq: title }]);
    expect(sound.currentBgm()).toBe(title);
    // Leaving the title stops it: nothing plays (the main menu has no BGM).
    sound.stopBgm();
    expect(sound.bgmHandles()).toEqual([]);
    // The intro's start, then its BGM: still one.
    sound.playCutsceneBgm(title);
    sound.stopAllSequences();
    expect(sound.bgmHandles()).toEqual([]);
    expect(sound.currentBgm()).toBeNull();
    // A map load afterwards plays the zone's BGM alone (not resumed from a pause).
    sent.length = 0;
    sound.playForZone(F('TOWN'));
    expect(sent.at(-1)).toEqual({ op: 'start', handle: 'field-bgm', seq: F('SEQ_TOWN') });
    expect(sound.bgmHandles()).toEqual([{ handle: 'field-bgm', seq: F('SEQ_TOWN') }]);
  });

  it('a map load plays the zone BGM on the field player; the same BGM keeps playing on the next load', () => {
    const { sound, sent } = system();
    sound.playForZone(F('TOWN'));
    // Sound_Impl_PlayFieldBGM: a new field BGM unpauses the field player, stops everything, then starts.
    expect(sent).toEqual([{ op: 'pause', handle: 'field-bgm', paused: false }, { op: 'stop-all' }, { op: 'start', handle: 'field-bgm', seq: F('SEQ_TOWN') }]);
    expect(sound.currentBgm()).toBe(F('SEQ_TOWN'));
    sent.length = 0;
    sound.playForZone(F('ROOM'));
    expect(sent).toEqual([]);
  });

  it('night music comes from the hour (decomp IsNight: 20:00–3:59)', () => {
    const night = F('SEQ_ROUTE');
    const zones = new Map(loadGamePacks([readPack('fixture')]).registries.zones);
    zones.set(F('TOWN'), { ...zones.get(F('TOWN'))!, music: { day: F('SEQ_TOWN'), night } } as Zone);
    const { sound, setHour } = system({ zones });
    expect(sound.fieldBgm(F('TOWN'))).toBe(F('SEQ_TOWN'));
    setHour(20);
    expect(sound.fieldBgm(F('TOWN'))).toBe(night);
    setHour(3);
    expect(sound.fieldBgm(F('TOWN'))).toBe(night);
    setHour(4);
    expect(sound.fieldBgm(F('TOWN'))).toBe(F('SEQ_TOWN'));
  });

  it('a zone connection fades the BGM out over 60 ticks, then starts the new zone BGM', () => {
    const { sound, sent } = system();
    sound.playForZone(F('TOWN'));
    sent.length = 0;
    sound.zoneChanged(F('ROUTE_W'));
    expect(sent).toEqual([{ op: 'volume', handle: 'field-bgm', volume: 0, ticks: 60 }]);
    expect(sound.currentBgm()).toBeNull();
    ticks(sound, 59);
    expect(sent).toHaveLength(1);
    ticks(sound, 1);
    expect(sent.slice(1)).toEqual([{ op: 'start', handle: 'field-bgm', seq: F('SEQ_ROUTE') }]);
    expect(sound.currentBgm()).toBe(F('SEQ_ROUTE'));
    // On the bike the new BGM fades in over 30 ticks.
    const bike = system();
    bike.sound.playForZone(F('TOWN'));
    bike.field.cycling = true;
    bike.sound.zoneChanged(F('ROUTE_W'));
    ticks(bike.sound, 60);
    expect(bike.sent.slice(-3)).toEqual([
      { op: 'start', handle: 'field-bgm', seq: F('SEQ_ROUTE') },
      { op: 'volume', handle: 'field-bgm', volume: 0, ticks: 0 },
      { op: 'volume', handle: 'field-bgm', volume: 127, ticks: 30 },
    ]);
  });

  it('fade_out_bgm: the fade is active for its ticks', () => {
    const { sound } = system();
    sound.playForZone(F('TOWN'));
    sound.fadeOutBgm(0, 10);
    ticks(sound, 9);
    expect(sound.fadeActive()).toBe(true);
    ticks(sound, 1);
    expect(sound.fadeActive()).toBe(false);
  });

  it('a fanfare pauses the BGM, plays for its measured length, then 15 checks, and the BGM resumes', () => {
    const { sound, sent, registries } = system();
    sound.playForZone(F('TOWN'));
    sent.length = 0;
    sound.playFanfare(F('SEQ_JINGLE'));
    expect(sent).toEqual([
      { op: 'pause', handle: 'field-bgm', paused: true },
      { op: 'start', handle: 'fanfare', seq: F('SEQ_JINGLE') },
    ]);
    const length = soundFramesToTicks(registries.sequences.get(F('SEQ_JINGLE'))!.frames!);
    let waited = 0;
    // wait_fanfare checks once per tick, after the tick's sound update.
    for (; waited < 1000; waited++) {
      sound.tick();
      if (!sound.waitFanfare()) break;
    }
    expect(waited).toBe(length + 15 - 1);
    expect(sent.at(-1)).toEqual({ op: 'pause', handle: 'field-bgm', paused: false });
    expect(sound.currentBgm()).toBe(F('SEQ_TOWN'));
  });

  it('sound effects play on their player for their length; a missing cry is logged', () => {
    const { sound, registries, log } = system();
    sound.playSe(F('SEQ_SE_BLIP'));
    expect(sound.sePlaying(F('SEQ_SE_BLIP'))).toBe(true);
    ticks(sound, soundFramesToTicks(registries.sequences.get(F('SEQ_SE_BLIP'))!.frames!));
    expect(sound.sePlaying(F('SEQ_SE_BLIP'))).toBe(false);
    sound.playCry(F('SPECIES_MOSSLET'));
    expect(sound.cryPlaying()).toBe(false);
    expect(log.counts.get('audio:cry-missing')).toBe(1);
  });

  it('cries: the species bank on the cry sequence, its length scaled by the pitch; the echo and short cries', () => {
    const cries = new Map([[F('SPECIES_MOSSLET'), { id: F('SPECIES_MOSSLET'), sequence: F('SEQ_SE_BLIP'), bank: F('BANK_CHIPTUNE'), frames: 192 }]]);
    const { sound, sent } = system({ cries } as Partial<Registries>);
    sound.playCry(F('SPECIES_MOSSLET'), 0, 'faint');
    expect(sent).toContainEqual({ op: 'start', handle: 'cry', seq: F('SEQ_SE_BLIP'), bank: F('BANK_CHIPTUNE') });
    expect(sent).toContainEqual({ op: 'pitch', handle: 'cry', pitch: -224 });
    // 192 frames ≈ 1 s; 3.5 semitones lower plays 2^(224/768) longer.
    ticks(sound, soundFramesToTicks(Math.ceil(192 * 2 ** (224 / 768))) - 1);
    expect(sound.cryPlaying()).toBe(true);
    sound.tick();
    expect(sound.cryPlaying()).toBe(false);
    sent.length = 0;
    sound.playCry(F('SPECIES_MOSSLET'), 0, 'half');
    ticks(sound, 20);
    expect(sound.cryPlaying()).toBe(false);
    expect(sent).toContainEqual({ op: 'volume', handle: 'cry', volume: 0, ticks: 10 });
    sent.length = 0;
    sound.playCry(F('SPECIES_MOSSLET'), 0, 'field-event');
    expect(sent.filter((c) => c.op === 'start').map((c) => (c as { handle: string }).handle)).toEqual(['cry', 'echo']);
  });

  it('Spear Pillar permits two cry handles, then restores ordinary single-cry playback', () => {
    const cries = new Map([[F('SPECIES_MOSSLET'), { id: F('SPECIES_MOSSLET'), sequence: F('SEQ_SE_BLIP'), bank: F('BANK_CHIPTUNE'), frames: 192 }]]);
    const { sound, sent } = system({ cries } as Partial<Registries>);
    sound.setDualCry(true);
    sound.playCry(F('SPECIES_MOSSLET'), 0, 'normal', -80, 80);
    sent.length = 0;
    sound.playCry(F('SPECIES_MOSSLET'), 0, 'normal', 80, 40);
    expect(sent).toContainEqual({ op: 'start', handle: 'cry-2', seq: F('SEQ_SE_BLIP'), bank: F('BANK_CHIPTUNE') });
    expect(sent).not.toContainEqual({ op: 'stop', handle: 'cry' });
    sound.setDualCry(false);
    expect(sound.cryPlaying()).toBe(false);
    sent.length = 0;
    sound.playCry(F('SPECIES_MOSSLET'));
    expect(sent).toContainEqual({ op: 'start', handle: 'cry', seq: F('SEQ_SE_BLIP'), bank: F('BANK_CHIPTUNE') });
  });

  it('the game plays the zone BGM on a new game and when a save loads, and sends nothing without an output', () => {
    const sent: AudioCommand[] = [];
    const game = createGame({ packs: [readPack('fixture')], createWorld: createFakeWorld, createScriptRunner: createFakeScriptRunner, seed: 1, log: new CountingStubLog(() => {}), audio: { send: (c) => void sent.push(c) } });
    expect(sent.filter((c) => c.op === 'start')).toEqual([{ op: 'start', handle: 'field-bgm', seq: game.sound.fieldBgm(game.state.player.zone) }]);
    const save = game.save();
    sent.length = 0;
    game.load(save);
    expect(sent.filter((c) => c.op === 'start')).toHaveLength(1);
    const silent = createGame({ packs: [readPack('fixture')], createWorld: createFakeWorld, createScriptRunner: createFakeScriptRunner, seed: 1, log: new CountingStubLog(() => {}) });
    silent.advance(5);
    expect(silent.sound.currentBgm()).toBe(game.sound.currentBgm());
  });
});
