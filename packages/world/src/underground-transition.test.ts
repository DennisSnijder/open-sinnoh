import { describe, expect, it } from 'vitest';
import type { UndergroundTransitionView } from '@opensinnoh/contracts';
import { UgTransition, type UgTransitionPart } from './underground-transition.ts';

/** Runs a part to its end with a fade that takes its frames; the log of fades, sounds and visibility, and every view. */
function run(part: UgTransitionPart) {
  const log: string[] = [];
  let fadeLeft = 0;
  const t = new UgTransition(part, 'female', {
    fade: (kind, frames, color) => {
      log.push(`fade ${kind} ${color} ${frames}`);
      fadeLeft = frames;
    },
    fadeDone: () => fadeLeft === 0,
    playSe: (name) => log.push(name),
    heroVisible: (v) => log.push(v ? 'shown' : 'hidden'),
  });
  const views: (UndergroundTransitionView | null)[] = [];
  const at: Record<string, number> = {};
  for (let tick = 0; !t.done; tick++) {
    if (tick > 500) throw new Error(`${part}: no end`);
    if (fadeLeft > 0) fadeLeft--;
    const before = log.length;
    t.step();
    for (const e of log.slice(before)) at[e] ??= tick;
    views.push(t.view());
  }
  return { log, views, at, ticks: views.length };
}

describe('the way down and up (underground_map_transition.c)', () => {
  it('jumps into the opening hole and fades to black from the top of the jump', () => {
    const r = run('enter-start');
    expect(r.log).toEqual(['hidden', 'fade out black 6']);
    // INIT, INIT_ANIMS, then the jump: the fade starts on its 16th frame (index 0x8000).
    expect(r.at['fade out black 6']).toBe(17);
    const first = r.views[2]!;
    expect(first.gender).toBe('female');
    expect(first.player).toEqual({ anim: 0, frame: 1, x: 112, y: 69 });
    expect(first.hole).toEqual({ anim: 0, frame: 1, x: 112, y: 96 });
    // The top of the arc (index 0x4000): 16 px up; the hole opens over 7 frames.
    expect(r.views[10]!.player!.y).toBe(53);
    expect(r.views[10]!.hole!.frame).toBe(7);
    // The jump's last frame, then the fade's wait, the sprites freed, the end.
    expect(r.views.at(-2)).toEqual({ gender: 'female', player: null, hole: null });
    expect(r.views.at(-1)).toBeNull();
  });

  it('fades in, falls through the other screen, lands at y 69, then shows the player', () => {
    const r = run('enter-arrive');
    expect(r.log).toEqual(['hidden', 'fade in black 6', 'SEQ_SE_DP_PYUU', 'SEQ_SE_DP_SUTYA', 'shown']);
    const shown = r.views.findIndex((v) => v?.player);
    // From y 192 at 8 px a frame: 24 frames on the other screen, then from y −24 on the field's.
    expect(shown).toBe(2 + 24);
    expect(r.views[shown]!.player!.y).toBe(-24);
    // −32 + 8k ≥ 69: the 13th frame lands; the landing sound, 16 frames, the player back.
    expect(r.at['SEQ_SE_DP_SUTYA']).toBe(1 + 24 + 13);
    expect(r.views[r.at['SEQ_SE_DP_SUTYA']!]!.player!.y).toBe(69);
    expect(r.at.shown! - r.at['SEQ_SE_DP_SUTYA']!).toBe(16);
  });

  it('spins up, rises off the screen and fades to white', () => {
    const r = run('exit-start');
    expect(r.log).toEqual(['hidden', 'SEQ_SE_DP_PYUU2', 'fade out white 6']);
    // INIT, INIT_ANIM, 8 frames' wait, 11 frames' spin up (0.2 a frame to 2), 13 frames up the field's screen, the jump
    // to the other screen, the 11th frame there starts the fade.
    expect(r.at['fade out white 6']).toBe(2 + 8 + 11 + 13 + 1 + 10);
    const spin = r.views.slice(2 + 8, 2 + 8 + 11).map((v) => v!.player!.frame);
    expect(spin[0]).toBeCloseTo(0.2, 2);
    expect(spin[10]).toBeCloseTo((819 * 66) / 4096, 5);
    // Off the field's screen once it passes y −32.
    expect(r.views[2 + 8 + 11 + 12]!.player!.y).toBe(-35);
    expect(r.views[2 + 8 + 11 + 13]!.player).toBeNull();
  });

  it('fades in from white, jumps out of the hole spinning to a stop, then closes the hole', () => {
    const r = run('exit-arrive');
    expect(r.log).toEqual(['hidden', 'fade in white 6', 'SEQ_SE_DP_GYURU', 'shown']);
    // The hole is drawn closing's first frame from the start; the player only once the jump starts.
    expect(r.views[0]).toEqual({ gender: 'female', player: null, hole: { anim: 1, frame: 0, x: 112, y: 96 } });
    // Shown, the jump from index 0x2000 (7 frames, 32 px high), then the spin slows 0.4 a frame from 9 frames a frame to a
    // stop (23 frames), the end.
    const gyuru = r.at['SEQ_SE_DP_GYURU']!;
    expect(r.at.shown! - gyuru).toBe(1 + 7 + 1 + 23 + 1);
    expect(r.views[gyuru + 2]!.player!.y).toBeCloseTo(69 - 32 * Math.SQRT1_2, 5);
    // The hole's 8 frames; the player's sprite goes 6 frames after the map object is back.
    const after = r.views.slice(r.at.shown! + 1);
    expect(after.findIndex((v) => !v?.player)).toBe(6);
    expect(r.views.at(-3)!.hole!.frame).toBe(8);
    expect(r.views.at(-1)).toBeNull();
  });
});
