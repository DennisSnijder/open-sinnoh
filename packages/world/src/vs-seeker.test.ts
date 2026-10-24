import { describe, expect, it } from 'vitest';
import { FIELD_VARS, loadPacks, Prng, readSystemVar, SEEKER_SPIN, SEEKER_USED, systemFlag, writeSystemVar, type Id } from '@opensinnoh/core';
import { REGISTRIES, type NewGame, type Registries } from '@opensinnoh/contracts';
import { fieldPack, f } from '../../../tests/fixtures/field-systems.ts';
import { newState, setup } from './testing.ts';
import { VS_SEEKER_RESULT } from './vs-seeker.ts';

function harness() {
  const pack = fieldPack();
  const ng = pack.registries.newGame![0] as unknown as NewGame;
  // The fixture has no Vs. Seeker art: a second sprite set stands in.
  ng.playerVsSeekerSprite = { ...ng.playerCycleSprite };
  const loaded = loadPacks([pack], '0.1.0', () => {}).registries;
  const regs = Object.fromEntries(REGISTRIES.map((name) => [name, loaded[name] ?? new Map()])) as unknown as Registries;
  const g = setup(newState('TOWN', 38, 14, 'down'), { regs });
  const run = () => {
    g.world.startVsSeeker();
    const seen: { sprite: Id; pose?: string; trainer: { emote: boolean; emoteDouble?: true } }[] = [];
    for (let i = 0; i < 300 && g.world.vsSeekerResult() === null; i++) {
      g.tick();
      const v = g.world.view();
      seen.push({ sprite: v.actors[0]!.sprite, ...(v.actors[0]!.pose ? { pose: v.actors[0]!.pose } : {}), trainer: v.actors.find((a) => a.localId === 70)! });
    }
    return { result: g.world.vsSeekerResult(), seen };
  };
  const trainer = () => g.state.objects.find((o) => o.localId === 70)!;
  return { g, regs, run, trainer, battery: () => readSystemVar(regs, g.state, FIELD_VARS.battery) };
}

describe('Vs. Seeker task (decomp VsSeeker_ExecuteTask)', () => {
  it('without a full battery it ends with NO_BATTERY and changes nothing', () => {
    const { g, regs, run, trainer } = harness();
    writeSystemVar(regs, g.state, FIELD_VARS.battery, 37);
    const { result, seen } = run();
    expect(result).toBe(VS_SEEKER_RESULT.noBattery);
    expect(readSystemVar(regs, g.state, FIELD_VARS.battery)).toBe(37);
    expect(seen.some((s) => s.pose)).toBe(false);
    expect(trainer().movementType).toBe(14);
  });

  it('with no trainer in the 7/7/7/6 range it ends with NO_TRAINERS and keeps the charge', () => {
    const { g, regs, run, battery } = harness();
    writeSystemVar(regs, g.state, FIELD_VARS.battery, 100);
    g.state.player = { ...g.state.player, z: 14 - 2 };
    g.world.enter('load');
    // The trainer stands at (40, 15): 3 tiles below a player at z 12 is in range, so move him 7 below.
    g.world.setPositionLive(70, 40, 12 + 7, 'down');
    expect(run().result).toBe(VS_SEEKER_RESULT.noTrainers);
    expect(battery()).toBe(100);
  });

  it('an unbeaten trainer in range shows "!"; the player raises the Vs. Seeker, the battery empties, the avatar comes back', () => {
    const { g, regs, run, trainer, battery } = harness();
    writeSystemVar(regs, g.state, FIELD_VARS.battery, 100);
    const walking = g.world.view().actors[0]!.sprite;
    const { result, seen } = run();
    expect(seen.some((s) => s.sprite === regs.newGame.get(f('NEW_GAME'))!.playerVsSeekerSprite!.male)).toBe(true);
    expect(result).toBe(VS_SEEKER_RESULT.ok);
    expect(battery()).toBe(0);
    expect(seen.some((s) => s.pose === 'vs-seeker')).toBe(true);
    expect(seen.some((s) => s.trainer.emote && !s.trainer.emoteDouble)).toBe(true);
    expect(seen.some((s) => s.trainer.emoteDouble)).toBe(false);
    expect(trainer().movementType).toBe(14);
    expect(g.world.view().actors[0]!.sprite).toBe(walking);
    expect(g.world.view().actors[0]!.pose).toBeUndefined();
  });

  it('a beaten trainer on a passing roll turns south, shows "!!" and spins; a failed roll leaves NO_TRAINERS_PICKED', () => {
    const { g, regs, run, trainer } = harness();
    g.state.flags[systemFlag(regs, 1360 + 700)] = true;
    let seed = 1;
    while (new Prng(seed).next() % 100 < 50) seed++;
    g.state.fieldRng = { seed };
    writeSystemVar(regs, g.state, FIELD_VARS.battery, 100);
    expect(run().result).toBe(VS_SEEKER_RESULT.noTrainersPicked);
    expect(trainer().movementType).toBe(14);
    seed = 1;
    while (new Prng(seed).next() % 100 >= 50) seed++;
    g.state.fieldRng = { seed };
    writeSystemVar(regs, g.state, FIELD_VARS.battery, 100);
    const { result, seen } = run();
    expect(result).toBe(VS_SEEKER_RESULT.ok);
    expect(seen.some((s) => s.trainer.emoteDouble)).toBe(true);
    expect(trainer().movementType).toBe(SEEKER_SPIN);
    expect(g.state.flags[systemFlag(regs, SEEKER_USED)]).toBe(true);
  });
});
