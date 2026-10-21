import type { SunyshoreGymRoom } from '@opensinnoh/contracts';
import { gymTables, slotOf, type FeatureHost, type MapFeature } from './feature.ts';

/** Coupled procedural gears. The target collision state changes immediately; scripts wait for the
 * 16/32 transform callbacks and a cleanup callback. No passenger or camera movement is authored.
 */
export class SunyshoreGym implements MapFeature {
  private readonly t: SunyshoreGymRoom;
  private angle: number;
  private task: { left: number; delta: number } | null = null;

  constructor(private readonly h: FeatureHost) {
    const slot = slotOf(h.state, 'sunyshore-gym');
    const tables = gymTables(h.reg).sunyshore;
    if (!tables?.[slot.roomID]) throw new Error(`world: no Sunyshore room ${slot.roomID} tables`);
    this.t = tables[slot.roomID]!;
    this.angle = slot.rotationState * 90;
  }

  press(button: number): void {
    if (this.task) throw new Error('world: Sunyshore gears already moving');
    const turns = [1, -1, 2][button];
    if (turns === undefined) throw new Error(`world: Sunyshore button ${button}`);
    const slot = slotOf(this.h.state, 'sunyshore-gym');
    slot.rotationState = (slot.rotationState + turns + 4) % 4;
    this.task = { left: Math.abs(turns) * 16, delta: Math.sign(turns) * 5.625 };
  }

  blocks(x: number, z: number): boolean {
    const state = slotOf(this.h.state, 'sunyshore-gym').rotationState;
    return this.t.collisions[state]!.some((i) => {
      const r = this.t.rectangles[i]!;
      return x >= r.x && x < r.x + r.width && z >= r.z && z < r.z + r.depth;
    });
  }

  step(): void {
    if (!this.task) return;
    if (this.task.left === 0) {
      this.task = null;
      return;
    }
    this.angle = (this.angle + this.task.delta + 360) % 360;
    this.task.left--;
  }

  busy(): boolean {
    return this.task !== null;
  }

  view(): ReturnType<MapFeature['view']> {
    return {
      effects: [],
      features: {
        models: this.t.gears.map((g, i) => {
          const angle = (g.initialRotation * 90 + (g.clockwise ? -this.angle : this.angle) + 360) % 360;
          return {
            key: `sunyshore-gear-${i}`,
            prop: g.prop,
            position: [g.x * 16 + 8, g.y * 16 + (g.vertical ? 8 : 0), g.z * 16 + 8],
            rotation: g.vertical ? [angle, 0, 0] : [0, angle, 0],
          };
        }),
      },
    };
  }
}
