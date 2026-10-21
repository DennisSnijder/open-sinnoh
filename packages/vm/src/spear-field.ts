import type { SpearPillarAssets, StoryActor, StorySceneView, Vec3 } from '@opensinnoh/contracts';
import type { Runner } from './runner.ts';

/** Field effects have a lifetime independent of the script that starts/polls them. */
export class SpearFieldEffects {
  private tick = 0;
  private terminal = false;
  private brightness = 0;
  private blend = 16;
  private readonly anchor: Vec3;
  private guardian = 0;
  private guardianTick = 0;
  private finish = 0;
  constructor(
    private readonly r: Runner,
    private readonly data: SpearPillarAssets,
    readonly mode: number,
  ) {
    if (mode === 0) {
      r.field.objectPosition(0);
      this.anchor = r.field.objectPosition(1);
    } else this.anchor = r.field.objectPosition(0);
    this.draw();
  }
  done(): boolean {
    return this.terminal;
  }
  finishGuardians(): void {
    this.finish = 30;
  }
  private cry(n: number): void {
    this.r.audio.playCry(this.r.source('species', n)!);
  }
  private sound(name: string): void {
    const id = this.r.namedSequence(name);
    if (id) this.r.audio.playSe(id);
  }
  step(): void {
    if (this.terminal) return;
    this.tick++;
    if (this.mode === 0) {
      // The blend converges while the animation runs; its endpoint gates the final fade to zero.
      const end = this.data.models['6']!.frames;
      if (this.tick < end) this.blend = 8 + Math.abs(8 - (Math.floor(this.tick / 8) % 17));
      else if (this.blend > 0) this.blend--;
      else this.terminal = true;
    } else if (this.mode === 4) {
      if (this.tick <= 30) {
        this.draw();
        return;
      }
      if (this.finish > 0) {
        if (--this.finish === 0) {
          this.terminal = true;
          this.brightness = 0;
        }
      } else if (this.guardian >= 3) this.finish = 30;
      else {
        const t = ++this.guardianTick;
        const lengths = [60 + 6, 24 + 16 + 6, 32 + 32 + 64 + 32 + 8 + 16 + 16 + 60 + 16 + 16 + 32 + 20 + 6];
        if (t === [20, 16, 32 + 32 + 64 + 32 + 8 + 16 + 16][this.guardian]!) this.cry([480, 482, 481][this.guardian]!);
        if (this.guardian === 2) {
          if (t === 20) this.r.field.faceObject(0, 'left');
          if (t === 40) this.r.field.turnPlayer('left');
          if (t === 50) this.r.field.faceObject(0, 'up');
          if (t === 168) this.r.field.setObjectVisible(1, false);
          this.brightness = t >= 168 && t < 184 ? Math.min(16, (t - 168) * 2) : t >= 184 && t < 200 ? 200 - t : 0;
        }
        if (t >= lengths[this.guardian]!) {
          this.sound('SEQ_SE_DP_CLIMAX10');
          this.guardian++;
          this.guardianTick = 0;
        }
      }
    }
    this.draw();
  }
  private draw(): void {
    const actors: StoryActor[] = [];
    if (this.mode === 0 && !this.terminal)
      actors.push({
        key: 'chain',
        asset: '6',
        tick: Math.min(this.tick, this.data.models['6']!.frames - 1),
        position: [...this.anchor],
        alpha: this.blend / 16,
      });
    if (this.mode === 4 && this.tick > 30 && this.guardian < 3 && !this.finish) {
      const g = this.guardian,
        t = this.guardianTick;
      const x = [504, 504, 435][g]!,
        z = 320;
      const duration = [60, 40, 444][g]!;
      const progress = Math.min(1, t / duration);
      actors.push({
        key: 'guardian',
        asset: ['12', '8', '10'][g]!,
        tick: t % 12,
        position: [x + (504 - x) * progress, 99 * (1 - progress), z + 119 * progress],
      });
    }
    const view: StorySceneView = {
      kind: 'spear-field',
      phase: this.terminal ? 'done' : this.mode === 0 ? 'chain' : `guardian-${this.guardian}`,
      tick: this.tick,
      actors,
      brightness: this.brightness,
    };
    this.r.field.setStoryScene(view);
  }
}
