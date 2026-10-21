import type { Ui2dAnimation } from '@opensinnoh/contracts';

/** Cosmetic, repeatable stream: never consumes the game RNG. The native cadence is 17+ riding cycles,
 * then a one-in-five glance; eyes alternate during that longer animation (common.c).
 */
export function bikePose(animations: Ui2dAnimation[], frame: number): { sequence: number; tick: number; eyes: number | null } {
  const lengths = animations.map(a => a.frames.reduce((sum, f) => sum + f.ticks, 0));
  let seed = 1;
  const random = () => { seed = (Math.imul(seed, 0x41c64e6d) + 0x6073) >>> 0; return seed >>> 16; };
  let sequence = 0;
  let age = 0;
  let cycles = 0;
  let wait = 0;
  let blinkCount = 0;
  let eyes = 0;
  for (let t = 0; t < frame; t++) {
    if (sequence === 1) {
      if (wait > 0) wait--;
      else {
        if (eyes === 0) {
          if (blinkCount % 3 === 0 && (random() & 1)) { wait = random() % 10; blinkCount++; }
          else { wait = 40; if (blinkCount % 3 !== 0) blinkCount++; }
        } else wait = 1;
        eyes ^= 1;
      }
    }
    if (age * 2 + 1 >= lengths[sequence]!) {
      if (sequence === 1) { cycles = 0; sequence = 0; }
      else if (++cycles > 16 && random() % 5 === 0) sequence = 1;
      age = 0;
    }
    age++;
  }
  return { sequence, tick: age, eyes: sequence === 1 ? eyes ^ 1 : null };
}
