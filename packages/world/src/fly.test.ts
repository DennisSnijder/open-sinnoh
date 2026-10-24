import { describe, expect, it } from 'vitest';
import { FlyTask, type FlyTaskHost } from './fly.ts';
import { TeleportTask } from './teleport.ts';
import { HmCutIn } from './hm-cut-in.ts';

/** A host that logs each call with the tick it came on; fades take 6 ticks. */
function host() {
  const log: string[] = [];
  let tick = 0;
  let fading = 0;
  const h: FlyTaskHost & { log: string[]; tick(): void } = {
    log,
    tick: () => {
      tick++;
      if (fading) fading--;
    },
    cry: () => log.push(`${tick} cry`),
    se: (name) => log.push(`${tick} se ${name}`),
    fadeOut: () => (log.push(`${tick} fade out`), (fading = 6)),
    fadeIn: () => (log.push(`${tick} fade in`), (fading = 6)),
    fadeDone: () => fading === 0,
    hidePlayer: (hidden) => log.push(`${tick} player ${hidden ? 'hidden' : 'shown'}`),
    changeMap: () => log.push(`${tick} map`),
  };
  return h;
}

describe('Fly (hm_cut_in.c sCutInTaskFuncsFly, the landing; FieldTask_MapChangeFly)', () => {
  it('the cut-in, the swoosh, the white fade, the map change and the landing, in order, then done', () => {
    const h = host();
    const task = new FlyTask(h);
    const views: string[] = [];
    let ticks = 0;
    for (; ticks < 400 && !task.done; ticks++) {
      task.tick();
      const v = task.view('male', { species: 'x:S' as never, form: 0, shiny: false, female: false });
      views.push(v ? [v.band ? 'band' : '', v.mon ? 'mon' : '', v.player ? 'player' : '', v.bird ? 'bird' : ''].join('') : 'none');
      h.tick();
    }
    expect(task.done).toBe(true);
    expect(h.log.map((l) => l.replace(/^\d+ /, ''))).toEqual(['cry', 'player hidden', 'se SEQ_SE_DP_FW019', 'fade out', 'map', 'player hidden', 'fade in', 'player shown']);
    // The cry when the Pokémon reaches the centre, before the bird; the map changes while the screen is white.
    const at = (what: string) => Number(h.log.find((l) => l.endsWith(what))!.split(' ')[0]);
    expect(at('cry')).toBeLessThan(at('player hidden'));
    expect(at('map')).toBeGreaterThan(at('fade out') + 6);
    expect(views).toContain('bandmonplayer');
    expect(views).toContain('bandplayerbird');
    expect(views).toContain('playerbird');
    expect(views.at(-1)).toBe('');
    expect(ticks).toBeGreaterThan(150);
    expect(ticks).toBeLessThan(220);
  });
});

describe('Teleport (field_warp.c sDigTeleportStates, sFieldWarpFadeInStates)', () => {
  it('the cut-in, the spin out, the fade to black, the map change, the spin in, then done', () => {
    const log: string[] = [];
    let fading = 0;
    let tick = 0;
    const facings: string[] = [];
    const task = new TeleportTask({
      cutIn: new HmCutIn({ species: 'x:S', form: 0 } as never, { playCry: () => log.push(`${tick} cry`) } as never),
      se: (name) => log.push(`${tick} se ${name}`),
      fade: (kind) => (log.push(`${tick} fade ${kind}`), (fading = 6)),
      fadeDone: () => fading === 0,
      face: (f) => facings.push(f),
      changeMap: () => log.push(`${tick} map`),
    });
    for (; tick < 600 && !task.done; tick++) {
      task.tick();
      if (fading) fading--;
    }
    expect(task.done).toBe(true);
    expect(log.map((l) => l.replace(/^\d+ /, ''))).toEqual(['cry', 'se SEQ_SE_DP_TELE', 'fade out', 'map', 'fade in']);
    expect(facings.at(-1)).toBe('down');
    expect(task.cameraDistance()).toBe(0);
  });
});

describe('the HM cut-in (hm_cut_in.c sCutInTaskFuncs)', () => {
  it('opens the band, slides the Pokémon through with its cry at the centre, closes the band and ends on tick 59', () => {
    const cries: number[] = [];
    let tick = 0;
    const cutIn = new HmCutIn({ species: 'x:S', form: 0 } as never, { playCry: () => cries.push(tick) } as never);
    const mon = { species: 'x:S' as never, form: 0, shiny: false, female: false };
    const bands: string[] = [];
    let monAtCry: number | undefined;
    let done = false;
    for (tick = 1; tick <= 70 && !done; tick++) {
      done = cutIn.step();
      const v = cutIn.view('female', mon);
      if (cries.length === 1 && monAtCry === undefined) monAtCry = v?.mon?.x;
      if (v?.band) bands.push(`${v.band.y1}-${v.band.y2}`);
      if (v) expect(v.bird).toBeNull();
    }
    expect(tick - 1).toBe(59);
    expect(cries).toEqual([36]);
    expect(monAtCry).toBe(128);
    expect(bands).toContain('56-136');
    expect(bands.at(-1)).toBe('88-104');
    expect(cutIn.view('female', mon)).toBeNull();
  });
});
