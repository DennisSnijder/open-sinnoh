/**
 * The browser's audio output (contracts `AudioOutput`): an AudioContext with the DS synth in an
 * AudioWorklet (packages/audio worklet.ts). Commands go through one queue: before a `start`, the
 * sequence bytecode, its bank, the bank's wave archives and its player are sent to the worklet (once).
 * iOS and the autoplay policies keep the context suspended until a user gesture: the first pointer, key
 * or touch resumes it. The volume and mute settings are the app's own (this device, localStorage); the
 * DS STEREO/MONO option mixes to mono. Output only: nothing here feeds back into the game.
 */
import workletUrl from '@opensinnoh/audio/worklet?worker&url';
import type { WorkletMessage, WorkletReply } from '@opensinnoh/audio/worklet';
import { captureError } from './telemetry/index.ts';
import type { AssetSource, AudioCommand, AudioOutput, Registries, StubLog } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';

export const AUDIO_SETTINGS_KEY = 'lantern-nds:audio'; // pre-rename name, kept: players' stored data uses it

export interface AudioSettings {
  /** 0–100. */
  volume: number;
  muted: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { volume: 80, muted: false };

/** Stored settings, validated (device data): anything unreadable gives the defaults. */
export function readAudioSettings(): AudioSettings {
  try {
    const v = JSON.parse(localStorage.getItem(AUDIO_SETTINGS_KEY) ?? 'null') as Partial<AudioSettings> | null;
    if (v && Number.isInteger(v.volume) && v.volume! >= 0 && v.volume! <= 100 && typeof v.muted === 'boolean') return { volume: v.volume!, muted: v.muted };
  } catch {
    // Unreadable or blocked storage: the defaults.
  }
  return { ...DEFAULT_AUDIO_SETTINGS };
}

export type SynthStatus = Omit<Extract<WorkletReply, { type: 'status' }>, 'type'>;

export interface WebAudio extends AudioOutput {
  readonly context: AudioContext;
  /** After the synth's output gain: tests measure the RMS here. */
  readonly analyser: AnalyserNode;
  settings(): AudioSettings;
  setSettings(s: AudioSettings): void;
  /** The DS STEREO (0) / MONO (1) option. */
  setMono(mono: boolean): void;
  /** Rebinds to a new game's registries (mods change the records): stops everything and forgets loads. */
  bind(registries: Registries, log: StubLog): void;
  /** The page is hidden: stops the audio clock (the music holds its place). */
  suspend(): void;
  /** The page is shown again: starts the audio clock, or waits for the next gesture where the browser demands one. */
  resume(): void;
  /** The game's speed (fast-forward): the synth's sequencer follows it, at the same pitch. */
  setSpeed(speed: number): void;
  /** The worklet's sounding channels and handles, its speed and render timing (tests). */
  status(): Promise<SynthStatus>;
  /** Errors reported by the worklet so far. */
  readonly errors: string[];
}

export function createWebAudio(assets: AssetSource): WebAudio {
  const context = new AudioContext({ latencyHint: 'interactive' });
  const gain = context.createGain();
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  gain.connect(analyser).connect(context.destination);
  let settings = readAudioSettings();
  let mono = false;
  let speed = 1;
  let registries: Registries | null = null;
  let log: StubLog | null = null;
  const errors: string[] = [];
  const loaded = new Set<string>();
  let statusWaiter: ((s: SynthStatus) => void) | null = null;

  const ready: Promise<AudioWorkletNode> = context.audioWorklet.addModule(workletUrl).then(() => {
    const node = new AudioWorkletNode(context, 'opensinnoh-synth', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    node.connect(gain);
    // The processor threw out of process(): it is silent from now on.
    node.onprocessorerror = () => captureError(new Error('audio: the synth processor stopped'), 'audio.worklet');
    node.port.onmessage = (e: MessageEvent<WorkletReply>) => {
      const m = e.data;
      if (m.type === 'error') {
        errors.push(m.message);
        console.error(`audio: ${m.message}`);
        captureError(new Error(`audio: ${m.message}`), 'audio.worklet');
        log?.stub('audio:synth-error', m.message);
      } else if (m.type === 'status') statusWaiter?.(m);
    };
    return node;
  });
  let queue: Promise<unknown> = ready;
  const post = (node: AudioWorkletNode, m: WorkletMessage, transfer: Transferable[] = []) => node.port.postMessage(m, transfer);
  const apply = () => {
    gain.gain.value = settings.muted ? 0 : (settings.volume / 100) ** 2;
    void ready.then((node) => post(node, { type: 'output', volume: 1, mono }));
  };
  apply();

  const bytes = async (ref: Id) => (await assets.get(ref)).arrayBuffer();
  /** Sends a sequence and everything it plays with (bank override for cries) to the worklet. */
  const load = async (node: AudioWorkletNode, seqId: Id, bankOverride?: Id) => {
    const r = registries;
    if (!r) throw new Error('audio: no registries bound');
    const seq = r.sequences.get(seqId);
    if (!seq) throw new Error(`audio: unknown sequence ${seqId}`);
    const player = r.soundPlayers.get(seq.player);
    if (!player) throw new Error(`audio: ${seqId} has no player ${seq.player}`);
    if (!loaded.has(player.id)) {
      post(node, { type: 'player', record: player });
      loaded.add(player.id);
    }
    for (const bankId of [seq.bank, ...(bankOverride ? [bankOverride] : [])]) {
      if (loaded.has(bankId)) continue;
      const bank = r.soundBanks.get(bankId);
      if (!bank) throw new Error(`audio: unknown bank ${bankId}`);
      for (const w of bank.waveArchives) {
        if (w === null || loaded.has(w)) continue;
        const archive = r.waveArchives.get(w);
        if (!archive) throw new Error(`audio: unknown wave archive ${w}`);
        const data = await bytes(archive.data);
        post(node, { type: 'waves', id: w, data }, [data]);
        loaded.add(w);
      }
      post(node, { type: 'bank', record: bank });
      loaded.add(bankId);
    }
    if (!loaded.has(seqId)) {
      const data = await bytes(seq.data);
      post(node, { type: 'sequence', record: seq, data }, [data]);
      loaded.add(seqId);
    }
  };

  // iOS Safari and autoplay policies: resume on the first gesture (and keep trying until it runs).
  const unlock = () => {
    if (context.state === 'running') return;
    void context.resume().catch(() => {});
    // iOS needs a sound started inside the gesture.
    const silent = context.createBufferSource();
    silent.buffer = context.createBuffer(1, 1, context.sampleRate);
    silent.connect(context.destination);
    silent.start();
  };
  const gestures = ['pointerdown', 'keydown', 'touchend'] as const;
  const listen = () => {
    for (const type of gestures) addEventListener(type, unlock, { capture: true, passive: true });
  };
  listen();
  // Whenever the context is not running (autoplay, an iOS interruption, a suspend the browser did) the next gesture resumes it.
  context.addEventListener('statechange', () => {
    if (context.state === 'running') for (const type of gestures) removeEventListener(type, unlock, { capture: true });
    else if (!hiddenSuspend) listen();
  });
  let hiddenSuspend = false;

  return {
    context,
    analyser,
    errors,
    send(command: AudioCommand) {
      queue = queue
        .then(async () => {
          const node = await ready;
          if (command.op === 'start') await load(node, command.seq, command.bank);
          post(node, { type: 'command', command });
        })
        .catch((e: Error) => {
          errors.push(e.message);
          console.error(`audio: ${e.message}`);
          captureError(e, 'audio.output');
          log?.stub('audio:output-error', e.message);
        });
    },
    settings: () => ({ ...settings }),
    setSettings(s) {
      settings = { ...s };
      try {
        localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(settings));
      } catch (e) {
        log?.stub('ui:audio-settings-storage', `audio settings are kept for this visit only: ${(e as Error).message}`);
      }
      apply();
    },
    suspend() {
      hiddenSuspend = true;
      void context.suspend();
    },
    resume() {
      hiddenSuspend = false;
      // A browser that wants a gesture first (iOS) leaves it suspended: the next touch resumes it.
      void context.resume().catch(() => {});
      if (context.state !== 'running') listen();
    },
    setSpeed(next) {
      if (next === speed) return;
      speed = next;
      void ready.then((node) => post(node, { type: 'speed', speed }));
    },
    setMono(m) {
      if (m === mono) return;
      mono = m;
      apply();
    },
    bind(next, nextLog) {
      registries = next;
      log = nextLog;
      loaded.clear();
      queue = queue.then(async () => post(await ready, { type: 'command', command: { op: 'stop-all' } }));
    },
    async status() {
      const node = await ready;
      await queue;
      return new Promise((resolve) => {
        statusWaiter = resolve;
        post(node, { type: 'status' });
      });
    },
  };
}
