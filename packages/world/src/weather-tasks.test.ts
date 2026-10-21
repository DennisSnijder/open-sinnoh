import { describe, expect, it } from 'vitest';
import { WEATHER_LOAD_TICKS, weatherFadeTicks, type Weather } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import type { FieldSound } from './sound.ts';
import { Lightning, WeatherTasks } from './weather-tasks.ts';

const weather = (sourceIndex: number, fade?: Weather['fade']): Weather => ({ id: `t:W${sourceIndex}` as Id, sourceIndex, name: `W${sourceIndex}`, ...(fade ? { fade } : {}) });
const CLEAR = weather(0);
const RAIN = weather(2, { particles: { in: Array(30).fill(0.5), out: Array(40).fill(0.5) }, fog: { in: 1, out: 1 } });
const HEAVY = weather(3);
const STORM = weather(4);
const SAND = weather(10);

function tasks() {
  const sent: string[] = [];
  const sound = { playNamed: (n: string) => void sent.push(`play ${n}`), stopNamed: (n: string) => void sent.push(`stop ${n}`) } as unknown as FieldSound;
  return { w: new WeatherTasks(sound), sent };
}

describe('weather tasks (ov5_021D5EB8.c)', () => {
  it('a map load starts the rain loop at once, a change stops it at the fade out’s start, the next starts after the fade and load', () => {
    const { w, sent } = tasks();
    w.step(RAIN, 1, true);
    expect(sent).toEqual(['play SEQ_SE_DP_T_AME']);
    w.step(RAIN, 1, true);
    expect(sent).toHaveLength(1);
    // RAINING → HEAVY_RAIN without a load: the loop stops now; T_OOAME starts once the rain fades out and the next loads.
    w.step(HEAVY, 1, true);
    expect(sent).toEqual(['play SEQ_SE_DP_T_AME', 'stop SEQ_SE_DP_T_AME']);
    let ticks = 1;
    while (sent.length === 2) {
      w.step(HEAVY, 1, true);
      ticks++;
    }
    expect(sent[2]).toBe('play SEQ_SE_DP_T_OOAME');
    expect(ticks).toBe(weatherFadeTicks(RAIN, 'out') + WEATHER_LOAD_TICKS - 1);
    // Into a silent weather: the loop stops and nothing else plays.
    for (let t = 0; t < 400; t++) w.step(SAND, 1, true);
    expect(sent.slice(3)).toEqual(['stop SEQ_SE_DP_T_OOAME']);
  });

  it('a warp indoors stops it; a battle or app stops it and the field’s return starts it again', () => {
    const { w, sent } = tasks();
    w.step(RAIN, 1, true);
    w.step(CLEAR, 2, true);
    expect(sent).toEqual(['play SEQ_SE_DP_T_AME', 'stop SEQ_SE_DP_T_AME']);
    w.step(RAIN, 3, true);
    w.step(RAIN, 3, false);
    w.step(RAIN, 3, false);
    w.step(RAIN, 3, true);
    expect(sent.slice(2)).toEqual(['play SEQ_SE_DP_T_AME', 'stop SEQ_SE_DP_T_AME', 'play SEQ_SE_DP_T_AME']);
  });

  it('a thunderstorm plays heavy rain and a thunder clap with each flash, which ends with the storm', () => {
    const { w, sent } = tasks();
    const flashes: number[] = [];
    for (let t = 0; t < 1500; t++) {
      w.step(STORM, 1, true);
      flashes.push(w.flash());
    }
    expect(sent[0]).toBe('play SEQ_SE_DP_T_OOAME');
    const claps = sent.slice(1);
    expect(claps.length).toBeGreaterThan(3);
    expect(new Set(claps)).toEqual(new Set(['play SEQ_SE_DP_T_KAMI', 'play SEQ_SE_DP_T_KAMI2']));
    expect(Math.max(...flashes)).toBeGreaterThan(0.2);
    expect(flashes.filter((a) => a === 0).length).toBeGreaterThan(500);
    w.step(CLEAR, 1, true);
    expect(w.flash()).toBe(0);
    expect(sent.at(-1)).toBe('stop SEQ_SE_DP_T_OOAME');
  });

  it('lightning: the clap comes as the flash starts, and the flash brightens over the next two ticks', () => {
    const l = new Lightning();
    let t = 0;
    let kind: string | null = null;
    while (!kind && t++ < 100) kind = l.step();
    expect(kind).not.toBeNull();
    expect(l.alpha).toBe(0);
    l.step();
    const one = l.alpha;
    l.step();
    expect(one).toBeGreaterThan(0);
    expect(l.alpha).toBeGreaterThan(one);
  });
});
