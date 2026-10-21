/**
 * The weather's sounds on the real ROM (OPENSINNOH_NDS_ROM; world weather-tasks.ts). Route 215's rain starts its loop
 * (SEQ_SE_DP_T_AME) with the map load; walking west into Route 210 (clear) stops it at the zone connection (the fade
 * out's start); walking back starts it once the rain has loaded. A
 * thunderstorm plays the heavy rain loop and a thunder clap with each lightning flash. The same on every run.
 */
import { describe, expect, it } from 'vitest';
import { WEATHER_LOAD_TICKS, weatherFadeTicks, type AudioCommand } from '@opensinnoh/contracts';
import type { Button, Id } from '@opensinnoh/core';
import { createBattle } from '@opensinnoh/battle';
import { CountingStubLog, createGame, gameDriver, runReplay, type Game } from '@opensinnoh/game';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';
import { resolveReplay } from '../rom-replays/sys-replays.ts';

const AME = 'platinum:SEQ_SE_DP_T_AME';
const OOAME = 'platinum:SEQ_SE_DP_T_OOAME';
type Sent = { tick: number; command: AudioCommand };
const zone = (name: string) => `platinum:MAP_HEADER_${name}` as Id;

function newGame() {
  const game = createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, createBattle, seed: 1, log: new CountingStubLog(() => {}), now: () => '2009-03-22T12:00:00Z' });
  const sent: Sent[] = [];
  game.audioOutput = { send: (command) => void sent.push({ tick: game.state.tick, command }) };
  return { game, sent };
}

const run = async (game: Game, sent: Sent[], lines: string[]) => {
  const result = await runReplay(gameDriver(game), [...lines, ''].join('\n'), { name: 'weather-sound', registries: game.registries, resolve: resolveReplay, seed: 1, repeat: false });
  expect(result.error).toBeUndefined();
  // The replay's reset silences everything: keep what the game sent since.
  const reset = sent.map((s) => s.command.op).lastIndexOf('stop-all');
  if (reset >= 0) sent.splice(0, reset + 1);
};

/** Holds `dir` until the player's zone is `to` (at most `limit` ticks). */
function walkInto(game: Game, dir: Button, to: Id, limit = 600): void {
  game.press(dir);
  for (let t = 0; t < limit && game.state.player.zone !== to; t++) game.tick();
  game.release(dir);
  expect(game.state.player.zone).toBe(to);
}

/** The ticks at which `seq` started and its handle was stopped. */
function loop(sent: Sent[], seq: Id) {
  const handle = 'se-3';
  const starts = sent.filter((s) => s.command.op === 'start' && s.command.seq === seq).map((s) => s.tick);
  const stops = sent.filter((s) => s.command.op === 'stop' && s.command.handle === handle).map((s) => s.tick);
  return { starts, stops };
}

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('weather sounds (OPENSINNOH_NDS_ROM)', () => {
  it('Route 215’s rain loop: starts with the map, stops at the Route 210 connection, comes back after the load', async () => {
    const play = async () => {
      const { game, sent } = newGame();
      await run(game, sent, ['set state repel 250', 'time 14:00', `warp ${zone('ROUTE_215')} 577 596 left`, 'until idle']);
      const arrived = game.state.tick;
      expect(game.state.weather).toBe('platinum:OVERWORLD_WEATHER_RAINING');
      walkInto(game, 'left', zone('ROUTE_210_SOUTH'));
      const crossed = game.state.tick;
      expect(game.state.weather).toBe('platinum:OVERWORLD_WEATHER_CLEAR');
      for (let t = 0; t < 200; t++) game.tick();
      walkInto(game, 'right', zone('ROUTE_215'));
      const back = game.state.tick;
      for (let t = 0; t < 700; t++) game.tick();
      return { game, sent, arrived, crossed, back };
    };
    const a = await play();
    const { starts, stops } = loop(a.sent, AME);
    console.log(`rain loop starts ${starts.join(', ')}; se-3 stops ${stops.join(', ')}; arrived ${a.arrived}, crossed ${a.crossed}, back ${a.back}`);
    // The map load (the replay's warp, before the first tick): the loop starts on the first tick.
    expect(starts[0]).toBe(a.arrived + 1);
    // The zone connection: the loop stops on the tick the weather changes.
    expect(stops.find((t) => t > starts[0]!)).toBe(a.crossed);
    // Back into the rain: the clear weather has no fade out; the rain loads before the loop starts again.
    const clear = a.game.registries.weathers.get('platinum:OVERWORLD_WEATHER_CLEAR' as Id)!;
    expect(starts[1]! - a.back).toBe(weatherFadeTicks(clear, 'out') + WEATHER_LOAD_TICKS - 1);
    expect(starts).toHaveLength(2);
    const b = await play();
    expect(b.sent).toEqual(a.sent);
  }, 300_000);

  it('a thunderstorm plays the heavy rain loop and thunder with its flashes; a warp indoors stops the loop', async () => {
    const { game, sent } = newGame();
    // Route 212 South's yearly weather on 6 January (sys-replays.ts).
    await run(game, sent, ['set state repel 250', 'date 2009-01-06', `warp ${zone('ROUTE_212_SOUTH')} 517 845 down`, 'until idle']);
    expect(game.state.weather).toBe('platinum:OVERWORLD_WEATHER_THUNDERSTORM');
    let flashed = 0;
    for (let t = 0; t < 900; t++) {
      game.tick();
      if (game.world.view().lightning) flashed++;
    }
    const claps = sent.filter((s) => s.command.op === 'start' && /SEQ_SE_DP_T_KAMI2?$/.test(s.command.seq));
    expect(loop(sent, OOAME).starts).toHaveLength(1);
    expect(claps.length).toBeGreaterThan(2);
    expect(flashed).toBeGreaterThan(claps.length);
  }, 300_000);

  it('walking into Route 215’s gate stops the rain loop', async () => {
    const { game, sent } = newGame();
    await run(game, sent, ['set state repel 250', 'time 14:00', `warp ${zone('ROUTE_215')} 669 598 right`, 'until idle']);
    walkInto(game, 'right', zone('ROUTE_215_GATE_TO_VEILSTONE_CITY'));
    const inside = game.state.tick;
    for (let t = 0; t < 300; t++) game.tick();
    const { starts, stops } = loop(sent, AME);
    expect(starts).toHaveLength(1);
    expect(stops.filter((t) => t > starts[0]!)).toHaveLength(1);
    expect(stops.find((t) => t > starts[0]!)).toBeLessThanOrEqual(inside + 1);
  }, 300_000);
});
