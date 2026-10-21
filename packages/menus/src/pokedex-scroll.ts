/** Pokédex-specific scroll clock. Measurements: ov21_021D5AEC.c and ov21_021D76B0.c; no copied code.
 * A row is 640 travel units. A held direction starts at 60/tick and accelerates after 4, 4, 8, 12 rows.
 * The touch wheel supplies signed travel/tick; after release it loses 2/tick and stops at a row boundary.
 */
import type { InputFrame } from '@opensinnoh/contracts';

export class DexScroll {
  cursor = 0;
  private remaining = 0;
  private direction = 0;
  private speed = 60;
  private stage = 0;
  private untilFaster = 4;
  private destination: number | null = null;
  private wheel = 0;
  private touching = false;

  constructor(private readonly count: () => number) {}

  get position(): number { return this.cursor - this.direction * this.remaining / 640; }
  get moving(): boolean { return this.remaining > 0 || this.destination !== null || this.wheel !== 0; }

  reset(cursor: number): void {
    this.cursor = Math.max(0, Math.min(Math.max(0, this.count() - 1), cursor));
    this.remaining = 0;
    this.destination = null;
    this.wheel = 0;
    this.touching = false;
    this.resetSpeed();
  }

  seek(to: number): void {
    const target = Math.max(0, Math.min(Math.max(0, this.count() - 1), to));
    this.destination = target === this.cursor ? null : target;
  }

  touch(speed: number | null): void {
    this.touching = speed !== null;
    if (speed !== null) {
      this.destination = null;
      this.wheel = Math.max(-640, Math.min(640, Math.trunc(speed)));
    }
  }

  tick(frame: InputFrame): void {
    const held = frame.held.includes('up') ? -1 : frame.held.includes('down') ? 1 : 0;
    if (!this.moving && !held) this.resetSpeed();
    if (!this.moving && !held && (frame.pressed.includes('left') || frame.pressed.includes('right'))) {
      this.seek(this.cursor + (frame.pressed.includes('left') ? -5 : 5));
    }
    const queued = this.destination !== null;
    const dir = queued ? Math.sign(this.destination! - this.cursor) : this.wheel ? Math.sign(this.wheel) : held;
    if (this.remaining === 0 && dir) {
      const next = this.cursor + dir;
      if (next < 0 || next >= this.count()) {
        this.destination = null;
        this.wheel = 0;
        this.resetSpeed();
        return;
      }
      this.cursor = next;
      this.direction = dir;
      this.remaining = 640;
    }
    if (this.remaining === 0) return;
    const step = queued ? 640 : this.wheel ? Math.abs(this.wheel) : this.speed;
    this.remaining = Math.max(0, this.remaining - step);
    if (this.remaining === 0) {
      if (this.destination === this.cursor) this.destination = null;
      if (!queued && !this.wheel && this.stage < 4 && --this.untilFaster === 0) {
        this.speed = Math.trunc(this.speed * 1.6);
        this.stage++;
        this.untilFaster = this.stage * 4;
      }
    }
    if (this.wheel) {
      const sign = Math.sign(this.wheel);
      const slowed = Math.max(4, Math.abs(this.wheel) - 2);
      this.wheel = !this.touching && slowed <= 33 ? 0 : sign * (this.touching ? Math.max(33, slowed) : slowed);
      // Finish a released slow gesture on the current row, rather than starting another.
      if (!this.wheel && this.remaining) this.remaining = Math.max(0, this.remaining - 33);
    }
  }

  private resetSpeed(): void {
    this.speed = 60;
    this.stage = 0;
    this.untilFaster = 4;
  }
}
