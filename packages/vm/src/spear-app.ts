import type { SpearPillarAssets, StoryActor, StorySceneView, Vec3 } from '@opensinnoh/contracts';
import type { Runner, Thread } from './runner.ts';

const FX = 4096;
const TURN = (2 * Math.PI) / 65536;
/** The camera helper writes N−1 truncated fx32 translations and snaps angles on its final call. */
export function cameraTranslation(delta: number, calls: number): number {
  return (Math.trunc((delta * FX) / calls) * (calls - 1)) / FX;
}

/** An awaited application: printer and animation endpoints gate its three resource lifetimes. */
export class SpearPillarApplication {
  private actors = new Map<string, StoryActor & { speed: number; loop: boolean }>();
  private tick = 0;
  private phase = 'summoning';
  private brightness = -16;
  private target: Vec3 = [0, 0, 34];
  private pitch = -0x29fe;
  private distance = 0x13c805 / FX;
  private fov = (0xc01 * 720) / 65536;
  private background: string | undefined;
  private feedback = false;
  private scanline = 0;
  private readonly task: Generator<void>;
  constructor(
    private readonly r: Runner,
    private readonly thread: Thread,
    private readonly data: SpearPillarAssets,
  ) {
    this.r.audio.setDualCry(true);
    this.thread.slots[0] = r.state.names.player;
    this.task = this.run();
  }
  step(): boolean {
    for (const a of this.actors.values()) {
      const frames = this.data.models[a.asset]!.frames;
      a.tick = a.loop ? (a.tick + a.speed) % frames : Math.min(frames - 1, a.tick + a.speed);
    }
    const next = this.task.next();
    if (next.done) {
      this.r.audio.setDualCry(false);
      this.r.field.setStoryScene(null);
      this.r.ui.message = null;
      return true;
    }
    this.tick++;
    const angle = this.pitch * TURN;
    const camera = {
      target: [...this.target] as Vec3,
      position: [
        this.target[0],
        this.target[1] - Math.sin(angle) * this.distance,
        this.target[2] + Math.cos(angle) * this.distance,
      ] as Vec3,
      fovY: this.fov,
      near: this.phase === 'guardians' ? 0.1 : 10,
      far: this.phase === 'guardians' ? 2048 : 1008,
    };
    const view: StorySceneView = {
      kind: 'spear-app',
      phase: this.phase,
      tick: this.tick,
      actors: [...this.actors.values()].map(({ speed: _speed, loop: _loop, ...a }) => a),
      camera,
      brightness: this.brightness,
      background: this.background,
      feedback: this.feedback,
      scanline: this.scanline,
    };
    this.r.field.setStoryScene(view);
    return false;
  }
  private add(key: string, asset: number, position: Vec3 = [0, 0, 0], speed = 1, loop = false): StoryActor {
    const a = { key, asset: String(asset), tick: 0, position, speed, loop };
    this.actors.set(key, a);
    return a;
  }
  private *wait(n: number): Generator<void> {
    for (let i = 0; i < n; i++) yield;
  }
  private *animation(key: string): Generator<void> {
    const a = this.actors.get(key)!;
    while (a.tick < this.data.models[a.asset]!.frames - 1) yield;
  }
  private *fade(to: number, n: number): Generator<void> {
    const from = this.brightness;
    for (let i = 1; i <= n; i++) {
      this.brightness = from + ((to - from) * i) / n;
      yield;
    }
  }
  private *print(index: number): Generator<void> {
    const printer = this.r.showMessage(this.thread, this.data.messages[index]!, this.r.textSpeed());
    while (!printer.done) yield;
    this.r.ui.message = null;
  }
  private *pan(delta: number, n: number, axis: 0 | 1 | 2 = 2): Generator<void> {
    const step = Math.trunc((delta * FX) / n) / FX;
    for (let i = 0; i < n; i++) {
      if (i < n - 1) this.target[axis] += step;
      yield;
    }
  }
  private se(name: string): void {
    const id = this.r.namedSequence(name);
    if (id) this.r.audio.playSe(id);
  }
  private music(name: string): void {
    const id = this.r.namedSequence(name);
    if (id) this.r.audio.playBgm(id);
  }
  private cry(species: number, pan = 0, volume = 127): void {
    this.r.audio.playCry(this.r.source('species', species)!, 0, 'normal', pan, volume);
  }
  private stage(): void {
    this.add('environment', 46);
    this.add('center', 24, [0, 0, 0], 1, true);
    this.add('player-shadow', 65, [1, 0.1, 140]);
    this.add('cyrus-shadow', 65, [1, 0.1, 60]);
    this.add('player', this.r.state.gender === 'male' ? 61 : 63, [1, 0, 140], 0.25, true);
    this.add('cyrus', 13, [1, 0, 60], 0.25, true);
  }
  private *run(): Generator<void> {
    this.stage();
    yield* this.fade(0, 12);
    yield* this.pan(-46, 60);
    yield* this.print(14);
    yield* this.print(16);
    this.feedback = true;
    this.add('left', 79, [-48, -10, -70]);
    yield* this.wait(60);
    this.add('right', 79, [48, -10, -70]);
    // Both tracks start at their authored relative offsets; cries/reveals wait for each endpoint.
    let count = 60,
      left = false,
      right = false;
    while (!left || !right) {
      count++;
      const sounds: Record<number, string> = {
        80: '01',
        135: '01',
        165: '03',
        220: '03',
        284: '09',
        338: '09',
        406: '09',
        310: '06',
        375: '06',
        432: '06',
        470: '10',
        520: '10',
      };
      if (sounds[count]) this.se(`SEQ_SE_DP_CLIMAX${sounds[count]}`);
      if (!left && this.actors.get('left')!.tick >= this.data.models['79']!.frames - 1) {
        left = true;
        this.add('dialga', 66, [-50, 0, -50], 0.5, true);
        this.add('dialga-shadow', 65, [-50, 0.1, -50]);
        this.cry(483, -80, 80);
        this.se('SEQ_SE_DP_CLIMAX12');
      }
      if (!right && this.actors.get('right')!.tick >= this.data.models['79']!.frames - 1) {
        right = true;
        this.add('palkia', 68, [50, 0, -50], 0.5, true);
        this.add('palkia-shadow', 65, [50, 0.1, -50]);
        this.cry(484, 80, 80);
        this.se('SEQ_SE_DP_CLIMAX12');
      }
      yield;
    }
    yield* this.wait(30);
    for (const peak of [8, 12, 16]) {
      yield* this.fade(peak, peak / 2);
      if (peak !== 16) yield* this.fade(0, peak / 2);
    }
    this.add('left', 84, [-48, -5, -70]);
    this.add('right', 84, [48, -5, -70]);
    yield* this.fade(0, 16);
    for (let fx = 410; fx < 3277; fx += 82) {
      const scale = fx / FX;
      for (const key of ['left', 'right']) this.actors.get(key)!.scale = [scale, 1, scale];
      yield;
    }
    yield* this.print(18);
    yield* this.print(19);
    for (let fx = 3277; fx > 410; fx -= 82) {
      const scale = fx / FX;
      for (const key of ['left', 'right']) this.actors.get(key)!.scale = [scale, 1, scale];
      yield;
    }
    yield* this.fade(-16, 6);
    this.actors.clear();
    this.feedback = false;

    this.phase = 'guardians';
    this.background = 'guardians';
    this.scanline = 2;
    this.target = [0, 25, 0];
    this.distance = 200;
    this.pitch = 1274;
    this.fov = (0xa66 * 720) / 65536;
    this.add('environment', 60);
    this.music('SEQ_D_RYAYHY');
    yield* this.fade(0, 6);
    for (const [i, asset] of [59, 45, 17].entries()) {
      this.add('guardian', asset);
      const duration = [210, 120, 120][i]!,
        cryAt = [145, 119, 100][i]!,
        soundAt = [100, 19, 18][i]!;
      for (let t = 0; t < duration; t++) {
        if (t === soundAt) this.se('SEQ_SE_PL_W392');
        if (t === cryAt) this.cry([480, 481, 482][i]!);
        yield;
      }
      for (let b = 1; b <= 15; b++) {
        this.brightness = b;
        yield;
      }
      this.actors.delete('guardian');
      yield;
      if (i < 2)
        for (let b = 15; b >= 1; b--) {
          this.brightness = b;
          yield;
        }
    }
    yield* this.wait(119);
    for (let b = 1; b <= 15; b++) {
      this.brightness = b;
      yield;
    }
    yield* this.fade(16, 1);
    this.actors.clear();
    this.scanline = 0;

    this.phase = 'giratina';
    this.background = 'giratina';
    this.scanline = 4;
    this.target = [0, 0, 34 + cameraTranslation(-46, 60)];
    this.pitch = -0x29fe;
    this.distance = 0x13c805 / FX;
    this.fov = (0xc01 * 720) / 65536;
    this.stage();
    this.add('dialga', 66, [-50, 0, -50], 0.5, true);
    this.add('palkia', 68, [50, 0, -50], 0.5, true);
    yield* this.fade(0, 6);
    const startPitch = this.pitch;
    for (let i = 1; i <= 60; i++) {
      this.pitch = startPitch + Math.trunc((3640 * i) / 60);
      yield;
    }
    yield* this.print(20);
    yield* this.pan(70, 60);
    yield* this.wait(9);
    yield* this.print(21);
    this.r.audio.fadeOutBgm(0, 10);
    yield* this.print(22);
    yield* this.wait(30);
    for (let b = 1; b <= 6; b++) {
      yield;
      this.brightness = -b;
      yield;
    }
    yield* this.print(23);
    yield* this.pan(-80, 90);
    this.add('opening', 41);
    yield* this.animation('opening');
    this.add('opening', 42);
    this.music('SEQ_PL_EV_GIRA');
    this.add('giratina', 26, [0, -90, 0]);
    for (let i = 0; i < 80; i++) {
      this.actors.get('giratina')!.position[1] += 0.5;
      if ([15, 45, 75].includes(i)) this.se('SEQ_SE_PL_W060');
      yield;
    }
    yield* this.animation('giratina');
    this.add('giratina', 29, [0, -50, 0]);
    for (let i = 1; i <= 100; i++) {
      this.actors.get('giratina')!.position[1] += 0.5;
      this.actors.get('dialga')!.position[2] -= i >= 40 ? 0.5 : 0.25;
      this.actors.get('palkia')!.position[2] -= i >= 65 ? 0.5 : 0.25;
      if (i === 1) this.se('SEQ_SE_PL_W082C');
      if (i === 40) this.cry(483, -80, 40);
      if (i === 65) this.cry(484, 80, 40);
      yield;
    }
    yield* this.print(24);
    this.add('giratina', 32);
    this.cry(487);
    yield* this.animation('giratina');
    this.add('giratina', 35, [0, 0, 0], 1, true);
    yield* this.print(25);
    this.add('giratina', 38);
    this.music('SEQ_PL_EV_GIRA2');
    for (let i = 1; i < this.data.models['38']!.frames; i++) {
      if (i === 170) this.r.showMessage(this.thread, this.data.messages[26]!, this.r.textSpeed());
      if (i === 238) this.cry(487);
      yield;
    }
    this.r.ui.message = null;
    this.brightness = -16;
    this.r.audio.stopBgm();
    yield;
    this.actors.clear();
    this.scanline = 0;
    this.brightness = 0;
    yield* this.wait(60);
  }
}
