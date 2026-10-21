/** Generic OAM resources and cell animation. The simulation owns timing; the app draws resolved cells. */
import { animSpriteSheetId, type AnimSpriteResource, type AnimSpriteView, type Ui2dAnimation, type Ui2dSheet } from '@opensinnoh/contracts';
import type { AnimVm } from './vm.ts';
import { startSpriteCallback } from './sprite-callbacks.ts';

/** NANR playback, including loop starts, reverse legs and SRT results. Forward sequences hold their last frame. */
export function cellFrame(sequence: Ui2dAnimation, tick: number): Ui2dAnimation['frames'][number] {
  const frames = sequence.frames;
  if (!frames.length || frames.some((f) => f.ticks <= 0)) throw new Error('battle OBJ: empty animation or nonpositive frame duration');
  const total = frames.reduce((n, f) => n + f.ticks, 0);
  const start = frames.slice(0, sequence.loopStart).reduce((n, f) => n + f.ticks, 0);
  let t = tick;
  const ping = sequence.mode === 'pingpong' || sequence.mode === 'pingpong-loop';
  if (ping && t >= total) {
    const reverse = frames.slice(sequence.loopStart).reverse();
    const duration = total - start;
    if (sequence.mode === 'pingpong-loop') t = (t - total) % (duration * 2);
    else t -= total;
    if (t < duration) {
      for (const f of reverse) { if (t < f.ticks) return f; t -= f.ticks; }
    } else if (sequence.mode === 'pingpong') return frames[sequence.loopStart]!;
    else t = start + t - duration;
  } else if (sequence.mode === 'loop' && t >= total) t = start + (t - start) % (total - start);
  for (const f of frames) { if (t < f.ticks) return f; t -= f.ticks; }
  return frames[frames.length - 1]!;
}

export class ObjectSprite {
  x = 0;
  y = 0;
  scaleX = 1;
  scaleY = 1;
  rotation = 0;
  alpha = 1;
  visible = true;
  active = true;
  private animation = 0;
  private animationTick = -1;
  constructor(readonly sheet: Ui2dSheet) {}

  setAnimation(index: number): void {
    if (!this.sheet.animations?.[index]) throw new Error(`battle OBJ ${this.sheet.id}: missing sequence ${index}`);
    this.animation = index;
    this.animationTick = -1;
  }
  get sequence(): Ui2dAnimation {
    const seq = this.sheet.animations?.[this.animation];
    if (!seq) throw new Error(`battle OBJ ${this.sheet.id}: missing sequence ${this.animation}`);
    return seq;
  }
  get duration(): number { return this.sequence.frames.reduce((n, f) => n + f.ticks, 0); }
  tick(): void { this.animationTick++; }
  view(): AnimSpriteView {
    const f = cellFrame(this.sequence, this.animationTick);
    return { kind: 'cell', sheet: this.sheet.id, cell: f.cell, x: this.x + (f.dx ?? 0), y: this.y + (f.dy ?? 0), scaleX: this.scaleX * (f.scaleX ?? 1), scaleY: this.scaleY * (f.scaleY ?? 1), rotation: this.rotation + (f.rotation ?? 0), alpha: this.alpha, fade: null };
  }
}

interface Manager {
  max: number;
  chars: Set<number>;
  palettes: Set<number>;
  cells: Set<number>;
  animations: Set<number>;
  sprites: Set<ObjectSprite>;
}

export class ObjectSprites {
  private readonly managers = new Map<number, Manager>();
  constructor(private readonly vm: AnimVm) {}
  init(id: number, max: number): void {
    if (this.managers.has(id)) throw new Error(`battle OBJ: manager ${id} already exists`);
    this.managers.set(id, { max, chars: new Set(), palettes: new Set(), cells: new Set(), animations: new Set(), sprites: new Set() });
  }
  private manager(id: number): Manager {
    const m = this.managers.get(id);
    if (!m) throw new Error(`battle OBJ: manager ${id} is not initialized`);
    return m;
  }
  load(id: number, kind: 'chars' | 'palettes' | 'cells' | 'animations', member: number): void { this.manager(id)[kind].add(member); }
  add(id: number, resource: AnimSpriteResource, callback: number, args: number[]): void {
    const m = this.manager(id);
    for (const [kind, member] of [['chars', resource.chars], ['palettes', resource.palette], ['cells', resource.cells], ['animations', resource.animation]] as const)
      if (!m[kind].has(member)) throw new Error(`battle OBJ: ${kind} ${member} was not loaded into manager ${id}`);
    const sheet = this.vm.deps.registries.ui2d?.get(animSpriteSheetId(resource));
    if (!sheet) throw new Error(`battle OBJ: missing sheet ${animSpriteSheetId(resource)}`);
    // A callback may make several sprites (hands, claws, roots) from one request.
    const spawn = () => {
      if (m.sprites.size >= m.max) throw new Error(`battle OBJ: manager ${id} exceeded ${m.max} sprites`);
      const s = new ObjectSprite(sheet);
      m.sprites.add(s);
      return s;
    };
    startSpriteCallback(this.vm, callback, args, spawn, (s) => { s.active = false; m.sprites.delete(s); });
  }
  free(id: number): void {
    // Tasks can outlive a manager in scripts without a WaitForAnimTasks. Clearing the live set prevents
    // their remaining updates from drawing and releasing twice is harmless for those owned sprites.
    // Some shipped particle-only scripts release an unused manager.
    const m = this.managers.get(id);
    if (!m) return;
    for (const s of m.sprites) s.active = false;
    m.sprites.clear();
    this.managers.delete(id);
  }
  tick(): void { for (const m of this.managers.values()) for (const s of m.sprites) if (s.visible) s.tick(); }
  view(): AnimSpriteView[] {
    return [...this.managers.values()].flatMap((m) => [...m.sprites].filter((s) => s.visible).map((s) => s.view()));
  }
  get size(): number { return [...this.managers.values()].reduce((n, m) => n + m.sprites.size, 0); }
  clear(): void { this.managers.clear(); }
}
