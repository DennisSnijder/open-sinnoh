/**
 * Seeded, serializable PRNG (mulberry32). Game logic never uses Math.random.
 * State is a single u32 so it round-trips through JSON saves and replays.
 */
export interface PrngState {
  seed: number;
}

export class Prng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  static from(saved: PrngState): Prng {
    return new Prng(saved.seed);
  }

  save(): PrngState {
    return { seed: this.state };
  }

  /** Next u32. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Integer in [0, n). */
  below(n: number): number {
    if (!Number.isInteger(n) || n <= 0) throw new Error(`Prng.below: invalid bound ${n}`);
    return this.next() % n;
  }
}
