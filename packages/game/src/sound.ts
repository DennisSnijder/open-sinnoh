import { soundFramesToTicks, type AudioHost, type AudioOutput, type CryMod, type Registries, type Sequence, type StubLog } from '@opensinnoh/contracts';
import { dayPeriod, isNight, type Id } from '@opensinnoh/core';

/**
 * The game's sound system (contracts `AudioHost`): the decomp's sound_system.c state machine, the BGM
 * rules of sound.c and field_bgm.c, fanfares and cries of sound_playback.c. It runs on the 30 Hz tick
 * (SoundSystem_Tick runs once per main-loop pass) and is deterministic: what plays, and for how long,
 * comes from the records (`Sequence.frames`, `Cry.frames`), never from the synth. It sends what to play
 * to the `AudioOutput` (none headless). Not saved: a loaded game starts its zone's BGM, as on the DS.
 */

/** decomp SoundHandleType by SDAT player number (SoundSystem_GetSoundHandleTypeFromPlayerID). */
const HANDLES = ['cry', 'field-bgm', 'fanfare', 'se-1', 'se-2', 'se-3', 'se-4', 'bgm'];
const PLAYER_PV = 0;
const PLAYER_FIELD = 1;
const PLAYER_ME = 2;
const PLAYER_BGM = 7;
/** decomp SEQ_NAMINORI (surfing) and SEQ_KUSAGASA (the Poké Radar): sequence numbers (`sourceIndex`). */
const SEQ_NAMINORI = 1151;
const SEQ_KUSAGASA = 1150;
/** sound_playback.c DEFAULT_FANFARE_DELAY: checks after the fanfare ends before the BGM resumes. */
const FANFARE_DELAY = 15;

type State = 'idle' | 'play' | 'playing' | 'fade-in' | 'fade-out' | 'fade-out-play' | 'fade-out-fade-in';

/** Pitch (1/64 semitones), duration (ticks) and echo of each cry variation (Sound_PlayPokemonCryEx). */
const CRY_MODS: Record<CryMod, { pitch: number; duration?: number; echo?: number }> = {
  normal: { pitch: 0 },
  half: { pitch: 0, duration: 20 },
  'field-event': { pitch: 64, echo: 20 },
  'mid-move': { pitch: 192, duration: 30, echo: 16 },
  faint: { pitch: -224 },
  'hyper-voice-2': { pitch: 44, echo: -64 },
  'howl-1': { pitch: -128, duration: 11 },
  'howl-2': { pitch: 60, duration: 60 },
  'uproar-2': { pitch: -44, duration: 100 },
  pinch: { pitch: -96 },
  'pinch-half': { pitch: -96, duration: 20 },
  pokedex: { pitch: 0 },
  'pokedex-chorus': { pitch: 0, echo: 20 },
};

interface Playing {
  seq: Id;
  player: number;
  /** Ticks left (null: until stopped). */
  left: number | null;
  paused: boolean;
  /** Game ticks it has played (not paused). */
  played: number;
}

export interface SoundOptions {
  registries: Registries;
  log: StubLog;
  /** The game clock's hour (0–23; `state.gameTime.now`) for day and night BGM. */
  hour: () => number;
  /** The player's avatar state (decomp FieldBGM_GetEffective: surfing music; FieldBGM_TryFadeOut: the bike). */
  field: () => { surfing: boolean; cycling: boolean };
  output?: AudioOutput | null;
}

export class SoundSystem implements AudioHost {
  private readonly handles = new Map<string, Playing>();
  private state: State = 'idle';
  private current: Id | null = null;
  private next: Id | null = null;
  private fieldBgmId: Id | null = null;
  private fadeCounter = 0;
  private followUpWait = 0;
  private followUpFade = 0;
  private fanfareDelay = 0;
  private fixed = false;
  private fieldPaused = false;
  private bgmPaused = false;
  private scene: 'none' | 'field' | 'battle' | 'cutscene' = 'none';
  private special: Id | null = null;
  /** The cry-duration task (Sound_SetPokemonCryDuration): ticks left. */
  private dualCry = false;
  private nextCry = 0;
  private cryDuration: number | null = null;
  private readonly bySource = new Map<number, Id>();
  output: AudioOutput | null;

  constructor(private readonly o: SoundOptions) {
    this.output = o.output ?? null;
    for (const s of o.registries.sequences.values()) if (s.sourceIndex !== undefined) this.bySource.set(s.sourceIndex, s.id);
  }

  /** A decomp sequence number (`sourceIndex`) → its record; a pack without it plays nothing (logged). */
  sequenceBySource(n: number): Id | null {
    const id = this.bySource.get(n);
    if (!id) this.o.log.stub('audio:sequence-missing', `no sequence with sourceIndex ${n} in the packs: not played`);
    return id ?? null;
  }

  /** Sound_PlayEffect of a decomp sequence number (UI and field sounds the game plays itself). */
  playSeBySource(n: number): void {
    const seq = this.sequenceBySource(n);
    if (seq) this.playSe(seq);
  }

  stopSeBySource(n: number): void {
    const seq = this.bySource.get(n);
    if (seq) this.stopSe(seq);
  }

  sePlayingBySource(n: number): boolean {
    const seq = this.bySource.get(n);
    return seq !== undefined && this.sePlaying(seq);
  }

  private sequence(seq: Id): Sequence {
    const s = this.o.registries.sequences.get(seq);
    if (!s) throw new Error(`sound: unknown sequence ${seq}`);
    return s;
  }

  private playerOf(seq: Id): number {
    const p = this.o.registries.soundPlayers.get(this.sequence(seq).player);
    if (!p) throw new Error(`sound: ${seq} has no player`);
    return p.sourceIndex;
  }

  private send(command: Parameters<AudioOutput['send']>[0]): void {
    this.output?.send(command);
  }

  private start(handle: string, seq: Id, frames: number | null, bank?: Id): void {
    this.handles.set(handle, { seq, player: this.playerOf(seq), left: frames === null ? null : soundFramesToTicks(frames), paused: false, played: 0 });
    this.send(bank ? { op: 'start', handle, seq, bank } : { op: 'start', handle, seq });
  }

  private stopHandle(handle: string, ticks = 0): void {
    const h = this.handles.get(handle);
    if (!h) return;
    if (ticks > 0) h.left = h.left === null ? ticks : Math.min(h.left, ticks);
    else this.handles.delete(handle);
    this.send({ op: 'stop', handle, ticks });
  }

  /** NNS_SndPlayerCountPlayingSeqByPlayerNo. */
  private playingOn(player: number): number {
    let n = 0;
    for (const h of this.handles.values()) if (h.player === player) n++;
    return n;
  }

  private handleFor(player: number): string {
    const h = HANDLES[player];
    if (!h) throw new Error(`sound: no handle for player ${player}`);
    return h;
  }

  // ------------------------------------------------------------------ the tick

  /** SoundSystem_Tick, once per game tick (after the field and the VM). */
  tick(): void {
    for (const [handle, h] of this.handles) {
      if (h.paused) continue;
      h.played++;
      if (h.left !== null && --h.left <= 0) this.handles.delete(handle);
    }
    if (!this.fanfarePlaying()) {
      if (this.fadeCounter > 0) this.fadeCounter--;
      this.updateState();
    }
    if (this.cryDuration !== null) {
      // Sound_Impl_CryDurationTask.
      if (this.cryDuration === 10) for (const h of ['cry', 'echo']) this.send({ op: 'volume', handle: h, volume: 0, ticks: 10 });
      this.cryDuration--;
      if (!this.cryPlaying()) this.cryDuration = 0;
      if (this.cryDuration <= 0) {
        this.stopCries();
        this.cryDuration = null;
      }
    }
  }

  private fanfarePlaying(): boolean {
    return this.playingOn(PLAYER_ME) !== 0 || this.fanfareDelay !== 0;
  }

  private updateState(): void {
    switch (this.state) {
      case 'play':
        this.state = 'playing';
        break;
      case 'fade-in':
      case 'fade-out':
        if (!this.fadeActive()) this.state = 'playing';
        break;
      case 'fade-out-play':
      case 'fade-out-fade-in':
        if (!this.fadeActive() && !this.followUpWaitTick()) {
          const fadeIn = this.state === 'fade-out-fade-in';
          this.stopHandle('bgm');
          this.playBgm(this.next);
          if (fadeIn) this.fadeInBgm(this.followUpFade);
        }
        break;
    }
  }

  /** Sound_UpdateFollowUpWaitFrames. */
  private followUpWaitTick(): boolean {
    if (this.followUpWait <= 0) {
      this.followUpWait = 0;
      return false;
    }
    return --this.followUpWait > 0;
  }

  // ------------------------------------------------------------------ BGM

  playBgm(seq: Id | null): void {
    if (seq === null) {
      this.stopBgm();
      return;
    }
    const player = this.playerOf(seq);
    if (player !== PLAYER_BGM && player !== PLAYER_FIELD) throw new Error(`sound: ${seq} is not a BGM (player ${player})`);
    const s = this.sequence(seq);
    this.start(this.handleFor(player), seq, s.frames);
    this.current = seq;
    this.next = null;
    this.state = 'play';
  }

  stopBgm(): void {
    const seq = this.current;
    if (seq !== null) for (const [handle, h] of this.handles) if (h.seq === seq) this.stopHandle(handle);
    this.current = null;
    this.next = null;
    this.state = 'idle';
  }

  /** The music playing now, by handle (field BGM, BGM; fanfares, sounds and cries left out): one at most outside a fade-over. */
  bgmHandles(): { handle: string; seq: Id }[] {
    return [...this.handles].filter(([, h]) => h.player === PLAYER_FIELD || h.player === PLAYER_BGM).map(([handle, h]) => ({ handle, seq: h.seq }));
  }

  /** The handle the current BGM plays on (for an output attached late). */
  currentHandleName(): string | null {
    return this.currentHandle();
  }

  private currentHandle(): string | null {
    if (this.current === null) return null;
    return this.handleFor(this.playerOf(this.current));
  }

  fadeOutBgm(volume: number, ticks: number): void {
    const handle = this.currentHandle();
    if (handle === null) return;
    if (!this.fadeActive()) {
      this.send({ op: 'volume', handle, volume, ticks });
      this.fadeCounter = ticks;
    }
    this.state = 'fade-out';
  }

  fadeInBgm(ticks: number): void {
    const handle = this.currentHandle();
    if (handle === null) return;
    this.send({ op: 'volume', handle, volume: 0, ticks: 0 });
    this.send({ op: 'volume', handle, volume: 127, ticks });
    this.fadeCounter = ticks;
    this.state = 'fade-in';
  }

  fadeActive(): boolean {
    return this.fadeCounter > 0;
  }

  currentBgm(): Id | null {
    return this.current;
  }

  fieldBgm(zone: Id): Id | null {
    const z = this.o.registries.zones.get(zone);
    if (!z) throw new Error(`sound: unknown zone ${zone}`);
    // Not modelled: SystemFlag_GetAltMusicForHeader and the Cycling Road gates (FieldBGM_GetForMapHeader).
    // decomp IsNight: TimeOfDayForHour is night or late night.
    return isNight(dayPeriod(this.o.hour())) ? z.music.night : z.music.day;
  }

  /** FieldBGM_GetEffective: surfing, then the special BGM, over the zone's own. */
  effectiveBgm(zone: Id): Id | null {
    const f = this.o.field();
    if (f.surfing) {
      const surf = this.bySource.get(SEQ_NAMINORI);
      if (surf) return surf;
    }
    return this.special ?? this.fieldBgm(zone);
  }

  setSpecialBgm(seq: Id | null): void {
    this.special = seq;
  }

  setBgmFixed(fixed: boolean): void {
    this.fixed = fixed;
  }

  setBgmPaused(player: 'field' | 'bgm', paused: boolean): void {
    const handle = player === 'field' ? 'field-bgm' : 'bgm';
    if (!paused) this.current = this.handles.get(handle)?.seq ?? null;
    const h = this.handles.get(handle);
    if (h) h.paused = paused;
    this.send({ op: 'pause', handle, paused });
    if (player === 'field') this.fieldPaused = paused;
    else this.bgmPaused = paused;
  }

  swapBgm(seq: Id): void {
    this.pauseOrStopFieldBgm();
    this.playBgm(seq);
  }

  /** Sound_Impl_PauseOrStopFieldBGM. */
  private pauseOrStopFieldBgm(): void {
    if (!this.fadeActive() && this.handles.has('field-bgm') && this.current !== this.bySource.get(SEQ_KUSAGASA)) {
      this.stopAll();
      this.setBgmPaused('field', true);
    } else this.stopAllSequences();
  }

  /** Sound_StopAll: the BGM player, sound effects and cries (the paused field BGM stays). */
  private stopAll(): void {
    this.stopHandle('bgm');
    this.current = null;
    this.next = null;
    this.state = 'idle';
    for (const h of ['se-1', 'se-2', 'se-3', 'se-4']) this.stopHandle(h);
    this.stopCries();
  }

  /** Sound_StopWaveOutAndSequences: every handle stops, the paused field BGM too. */
  stopAllSequences(): void {
    this.handles.clear();
    this.send({ op: 'stop-all' });
    this.current = null;
    this.next = null;
    this.fieldPaused = this.bgmPaused = false;
    this.state = 'idle';
  }

  /**
   * Sound_SetSceneAndPlayBGM for a cutscene scene (Sound_Impl_PlayCutsceneBGM: the title screen, Rowan's
   * intro, the ending): everything stops, then `seq` plays alone.
   */
  playCutsceneBgm(seq: Id | null): void {
    this.stopAllSequences();
    this.scene = 'cutscene';
    if (seq) this.playBgm(seq);
  }

  // ------------------------------------------------------------------ the field (field_bgm.c)

  /** FieldBGM_PlayForMapHeader: a map load plays the zone's BGM (it keeps playing when unchanged). */
  playForZone(zone: Id): void {
    if (this.fixed) return;
    this.scene = 'none';
    const bgm = this.fieldBgm(zone);
    this.fieldBgmId = bgm;
    this.playFieldScene(bgm);
  }

  /** FieldBGM_PlayEffectiveForMapHeader (after a battle, the start menu …). */
  playEffectiveForZone(zone: Id): void {
    this.fieldBgmId = this.fieldBgm(zone);
    this.scene = 'none';
    this.playFieldScene(this.effectiveBgm(zone));
  }

  /** Sound_SetSceneAndPlayBGM(SOUND_SCENE_FIELD) → Sound_Impl_PlayFieldBGM. */
  private playFieldScene(bgm: Id | null): void {
    if (this.scene === 'field') return;
    this.scene = 'field';
    this.fanfareDelay = 0;
    const current = this.handles.get('field-bgm')?.seq ?? null;
    if (!this.fieldPaused && current === bgm && current !== null) return;
    this.stopAll();
    if (current !== bgm) {
      this.setBgmPaused('field', false);
      this.stopAllSequences();
    }
    if (this.fieldPaused) {
      // Sound_Impl_ResumeAndSwitchFieldBGM: the paused field BGM resumes, fading in over 40 frames.
      this.setBgmPaused('field', false);
      this.fadeInBgm(40);
      return;
    }
    this.playBgm(bgm);
  }

  /**
   * A zone connection (FieldMap_ChangeZone): FieldBGM_TryFadeOut(mode 1) to the new zone's effective BGM.
   */
  zoneChanged(zone: Id): void {
    this.fadeToBgm(this.effectiveBgm(zone));
  }

  fadeToBgm(bgm: Id | null): void {
    if (this.fixed || bgm === this.current) return;
    this.fieldPaused = this.bgmPaused = false;
    // Sound_Impl_FadeToBGM.
    this.fadeOutBgm(0, 60);
    this.current = null;
    this.next = bgm;
    this.followUpWait = 0;
    this.state = this.o.field().cycling ? 'fade-out-fade-in' : 'fade-out-play';
    this.followUpFade = 30;
  }

  /** The battle scene (Sound_Impl_PlayBattleBGM): the field BGM pauses and the battle BGM plays. */
  playBattleBgm(seq: Id | null): void {
    this.scene = 'battle';
    this.pauseOrStopFieldBgm();
    if (seq) this.playBgm(seq);
  }

  // ------------------------------------------------------------------ sound effects and fanfares

  playSe(seq: Id): void {
    const s = this.sequence(seq);
    this.start(this.handleFor(this.playerOf(seq)), seq, s.frames);
  }

  stopSe(seq: Id): void {
    for (const [handle, h] of this.handles) if (h.seq === seq) this.stopHandle(handle);
  }

  sePlaying(seq: Id): boolean {
    return this.playingOn(this.playerOf(seq)) !== 0;
  }

  /** Sound_IsAnyEffectPlaying: a sequence plays on one of the sound effect players (SE_1–SE_4). */
  anySePlaying(): boolean {
    return [3, 4, 5, 6].some((p) => this.playingOn(p) !== 0);
  }

    sequencePlaying(seq: Id): boolean {
    return this.playingOn(this.playerOf(seq)) !== 0;
  }

  setPlayerVolume(seq: Id, volume: number): void {
    this.send({ op: 'initial-volume', handle: this.handleFor(this.playerOf(seq)), volume: Math.max(0, Math.min(127, volume)) });
  }

  setFieldVolume(volume: number): void {
    const player = [...this.o.registries.soundPlayers.values()].find((p) => p.sourceIndex === PLAYER_FIELD);
    if (!player) throw new Error(`sound: no sound player ${PLAYER_FIELD} (PLAYER_FIELD)`);
    this.send({ op: 'player-volume', player: player.id, volume: Math.max(0, Math.min(127, volume)) });
  }

  playFanfare(seq: Id): void {
    const s = this.sequence(seq);
    this.fanfareDelay = FANFARE_DELAY;
    if (this.current !== null) {
      const player = this.playerOf(this.current);
      if (player === PLAYER_FIELD || player === PLAYER_BGM) this.setBgmPaused(player === PLAYER_FIELD ? 'field' : 'bgm', true);
    }
    this.start('fanfare', seq, s.frames);
  }

  waitFanfare(): boolean {
    if (this.playingOn(PLAYER_ME) !== 0) return true;
    if (this.fanfareDelay > 0) {
      this.fanfareDelay--;
      return true;
    }
    this.stopHandle('fanfare');
    if (this.current !== null) {
      const player = this.playerOf(this.current);
      if (player === PLAYER_FIELD || player === PLAYER_BGM) this.setBgmPaused(player === PLAYER_FIELD ? 'field' : 'bgm', false);
    }
    return false;
  }

  // ------------------------------------------------------------------ cries

  setDualCry(enabled: boolean): void {
    this.stopCries();
    this.dualCry = enabled;
    this.nextCry = 0;
  }

  playCry(species: Id, form = 0, mod: CryMod = 'normal', pan = 0, volume = 127): void {
    const cry = this.o.registries.cries.get(species);
    if (!cry) {
      this.o.log.stub('audio:cry-missing', `${species} has no cry record`);
      return;
    }
    const variant = cry.forms?.[String(form)] ?? cry;
    const m = CRY_MODS[mod];
    if (!this.dualCry) this.stopCries();
    const primary = this.dualCry && this.nextCry++ % 2 ? 'cry-2' : 'cry';
    const scale = (pitch: number) => Math.ceil(variant.frames * Math.pow(2, -pitch / 768));
    // Both handles count as the cry player (Sound_IsPokemonCryPlaying counts PLAYER_PV).
    this.start(primary, cry.sequence, scale(m.pitch), variant.bank);
    this.handles.get(primary)!.player = PLAYER_PV;
    const handles = [primary];
    if (m.echo !== undefined) {
      this.start('echo', cry.sequence, scale(m.echo), variant.bank);
      this.handles.get('echo')!.player = PLAYER_PV;
      handles.push('echo');
    }
    for (const handle of handles) {
      const pitch = handle === primary ? m.pitch : m.echo!;
      if (pitch) this.send({ op: 'pitch', handle, pitch });
      if (pan && mod !== 'pokedex-chorus') this.send({ op: 'pan', handle, pan });
    }
    if (mod === 'pokedex-chorus') {
      this.send({ op: 'initial-volume', handle: primary, volume: 127 });
      this.send({ op: 'pan', handle: 'echo', pan });
      this.send({ op: 'volume', handle: 'echo', volume, ticks: 0 });
    } else {
      this.send({ op: 'initial-volume', handle: primary, volume });
      if (m.echo !== undefined) this.send({ op: 'initial-volume', handle: 'echo', volume: Math.max(1, volume - 30) });
    }
    this.cryDuration = m.duration ?? null;
  }

  cryPlaying(): boolean {
    return this.playingOn(PLAYER_PV) !== 0;
  }

  /** The game ticks the cry handle has played, or null when no cry plays on it (the Pokédex cry page's waveform). */
  cryTicks(): number | null {
    return this.handles.get('cry')?.played ?? null;
  }

  /** Sound_StopPokemonCries. */
  stopCries(): void {
    this.stopHandle('cry');
    this.stopHandle('cry-2');
    this.stopHandle('echo');
  }
}
