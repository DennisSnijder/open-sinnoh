import { describe, expect, it } from 'vitest';
import { BALL_TICKS, FINAL_TICKS, HealMachine } from './heal-machine.ts';

describe('healing machine (decomp FieldTask_PlayHealingAnimation_Pokecenter)', () => {
  it('waits for the imported Hall of Fame one-shot and exposes every pattern frame once', () => {
    const machine = new HealMachine(6, 68, true);
    const frames: number[] = [];
    while (!machine.step()) {
      const { frame } = machine.view();
      if (frame !== undefined) frames.push(frame);
    }
    // The cleanup tick keeps the final pose; the renderer clamps to the final imported frame.
    expect(frames).toEqual(Array.from({ length: 69 }, (_, i) => i));
  });
  it('places one ball per 17 ticks, flashes, then ends', () => {
    const m = new HealMachine(2);
    const seen: string[] = [];
    let ticks = 0;
    for (;;) {
      ticks++;
      if (m.step()) break;
      const v = m.view();
      const key = `${v.balls}${v.flash ? 'f' : ''}`;
      if (seen.at(-1) !== key) seen.push(key);
    }
    expect(seen).toEqual(['0', '1', '2', '2f']);
    expect(ticks).toBe(1 + 2 * BALL_TICKS + 1 + FINAL_TICKS + 1);
    expect(() => new HealMachine(0)).toThrow(/1–6/);
  });
  it('the Pokémon Center: a sound per ball, the jingle with the one-shots, then waits for the jingle', () => {
    const events: string[] = [];
    let checks = 0;
    let ends = 0;
    const m = new HealMachine(3, 73, true, {
      ball: () => events.push(`ball@${tick}`),
      fanfare: () => (events.push(`fanfare@${tick}`), (ends = tick + 30)),
      fanfareWaiting: () => (checks++, tick < ends),
    });
    let tick = 0;
    for (;;) {
      tick++;
      if (m.step()) break;
    }
    // ADD_POKEBALL on ticks 2, 19, 36; PLAY_FINAL_ANIMATION on 53.
    expect(events).toEqual(['ball@2', 'ball@19', 'ball@36', 'fanfare@53']);
    // The jingle is checked only once the 73-frame one-shots are done: a short one ends with them.
    expect(checks).toBe(1);
    expect(tick).toBe(1 + 3 * BALL_TICKS + 1 + 73 + 1);
  });
  it('a jingle longer than the one-shots holds the machine until it ends', () => {
    let ends = 0;
    let tick = 0;
    const m = new HealMachine(1, 68, true, { ball: () => {}, fanfare: () => (ends = tick + 100), fanfareWaiting: () => tick < ends });
    let last: number | undefined;
    for (;;) {
      tick++;
      if (m.step()) break;
      last = m.view().frame;
    }
    // The fanfare starts on tick 19 and is waited for until tick 119; CLEAN_UP follows.
    expect(tick).toBe(119 + 1);
    expect(last).toBe(100);
  });
});
