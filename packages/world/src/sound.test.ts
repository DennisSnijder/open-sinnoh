import { describe, expect, it } from 'vitest';
import { audioTrace, withFieldSounds } from '../../../tests/fixtures/audio.ts';
import { doorSounds } from '../../importer/src/assets/door-sounds.ts';
import { f, mon, newState, registries, setup } from './testing.ts';
import { PlatformLift, initLift } from './platform-lift.ts';
import { FieldSound } from './sound.ts';
import type { AudioHost } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';

function heard(state = newState(), regs = withFieldSounds(registries)) {
  const g = setup(state, { regs });
  const sounds = audioTrace(g.audio, regs, () => g.state.tick);
  const start = g.state.tick;
  const trace = () => sounds.map(({ tick, op, source, handle }) => [tick - start, op, handle === 'cry' ? 'cry' : source]);
  return { ...g, sounds, trace };
}

describe('native field audio on the 30 Hz simulation clock', () => {
  it.each([[1, 1541, 1543], [70, 1544, 0], [75, 1544, 0], [298, 1544, 0], [427, 1544, 0], [456, 1544, 0], [484, 1544, 0], [442, 1492, 0]])('door model %i selects its recorded cues at clip start', (model, open, close) => {
    const regs = withFieldSounds(registries);
    regs.props = new Map([...regs.props].map(([id, p]) => [id, p.id === f('PROP_DOOR') ? { ...p, doorSounds: doorSounds(model) } : p]));
    const g = heard(newState('TOWN', 10, 14, 'up'), regs);
    g.tick(['up']);
    g.hold(['up'], 15);
    g.tick();
    expect(g.trace()).toEqual([[0, 'start', open], ...(close ? [[16, 'start', close]] : [])]);
    // In particular, pushing a blocked door never emits WALL_HIT.
    expect(g.sounds.some((s) => s.source === 1537)).toBe(false);
  });

  it('bumps once at action init, then once per 16-update blocked action; plain walking is silent', () => {
    const g = heard(newState('ROOM', 13, 16, 'up'));
    g.hold(['up'], 33);
    expect(g.trace()).toEqual([[0, 'start', 1537], [16, 'start', 1537], [32, 'start', 1537]]);
    const walk = heard(newState('ROOM', 14, 16, 'up'));
    walk.hold(['up'], 8);
    expect(walk.trace()).toEqual([]);
  });

  it('a player ledge uses the shared 16-update jump cues once', () => {
    const g = heard(newState('ROUTE_W', 16, 13, 'down'));
    g.hold(['down'], 16);
    expect(g.state.player).toMatchObject({ x: 16, z: 15 });
    expect(g.trace()).toEqual([[0, 'start', 1547], [15, 'start', 1607]]);
  });

  it.each([['jump_far_east', 16], ['jump_near_fast_east', 8], ['jump_farther_east', 12]] as const)('script/NPC %s sounds at init and on update %i', (op, ticks) => {
    const regs = withFieldSounds(registries);
    regs.movements = new Map([...regs.movements, [f('JUMP_TEST'), { id: f('JUMP_TEST'), steps: [{ op, count: 1 }] }]]);
    const g = heard(newState(), regs);
    g.world.applyMovement(0, f('JUMP_TEST'));
    g.hold([], ticks);
    expect(g.trace()).toEqual([[0, 'start', 1547], [ticks - 1, 'start', 1607]]);
    g.hold([], 10);
    expect(g.sounds).toHaveLength(2);
  });

  it('Surf cries on cut-in callback 36, takes off at callback 59 and lands on jump update 8', () => {
    const state = newState('TERRAIN', 10, 5, 'left');
    state.party = [mon('SPECIES_DRIPLING', 20)];
    const g = heard(state);
    g.world.surf(0);
    g.hold([], 67);
    expect(g.trace()).toEqual([[35, 'start', 'cry'], [58, 'start', 1547], [65, 'start', 1607]]);
    expect(g.world.surfDone()).toBe(true);
  });

  it('the VM-facing HM presenter has the same cry phase and completes on callback 59', () => {
    const state = newState();
    state.party = [mon('SPECIES_MOSSLET', 10)];
    const g = heard(state);
    g.world.hmCutIn(0);
    g.hold([], 58);
    expect(g.trace()).toEqual([[35, 'start', 'cry']]);
    expect(g.world.hmCutInDone()).toBe(false);
    g.tick();
    expect(g.world.hmCutInDone()).toBe(true);
  });

  it.each([0, 1, 2])('obstacle kind %i sounds with effect creation, before the script removes it', (kind) => {
    const g = heard(newState('TERRAIN', 11, 13, 'right'));
    g.world.destroyObstacle(kind);
    expect(g.trace()).toEqual([[0, 'start', kind === 0 ? 1611 : 1610]]);
    g.hold([], kind === 0 ? 7 : 10);
    expect(g.state.objects.some((o) => o.localId === 0)).toBe(true);
    g.world.removeObject(0);
    expect(g.sounds).toHaveLength(1);
  });

  it('only a successful Strength push starts 1575, with the 16-update boulder walk', () => {
    const g = heard(newState('TERRAIN', 11, 13, 'right'));
    g.tick(['right']);
    expect(g.trace()).toEqual([[0, 'start', 1537]]);
    g.hold([], 16);
    g.state.flags[f('FLAG_STRENGTH_ACTIVE')] = true;
    const at = g.state.tick;
    g.tick(['right']);
    g.tick();
    expect(g.sounds.filter((s) => s.source === 1575).map((s) => s.tick - at)).toEqual([1]);
  });

  it.each([[0, 128, 1553], [3, 80, 1556]])('platform lift %i stops on endpoint %i and clunks next tick', (id, endpoint, motor) => {
    const data = initLift(id, id === 0 ? 26 : 15);
    const lift = new PlatformLift(id, data, [0, 0]);
    lift.trigger();
    const commands: [number, string, number][] = [];
    for (let tick = 0; !lift.done(); tick++) {
      const s = lift.step();
      if (s.play !== undefined) commands.push([tick, 'start', s.play]);
      if (s.stop !== undefined) commands.push([tick, 'stop', s.stop]);
    }
    expect(commands).toEqual([[0, 'start', motor], [endpoint, 'stop', motor], [endpoint + 1, 'start', 1562]]);
  });

  it('elevator cues the motor with the lights and the chime on the last loop, and never waits on the chime', () => {
    const g = heard(newState('TOWN', 38, 16));
    g.world.elevator('up', 1);
    g.hold([], 33);
    expect(g.trace()).toEqual([[1, 'start', 1554], [32, 'stop', 1554], [32, 'start', 1521]]);
    expect(g.world.elevatorDone()).toBe(true);
  });
});

it('rejects overlapping Waterfall before starting another HM presenter', () => {
  const state = newState('TERRAIN', 5, 4, 'up');
  state.playerState = 'surf';
  state.party = [mon('SPECIES_DRIPLING', 20)];
  const g = heard(state);
  g.world.waterfall(0);
  expect(() => g.world.waterfall(0)).toThrow(/waterfall during waterfall/);
  g.hold([], 59);
  expect(g.trace()).toEqual([[35, 'start', 'cry']]);
});

it('named sounds resolve by the bare SDAT name (SEQ_SE_DP_TELE2, the warp panel); a missing one is logged, not played', () => {
  const blip = registries.sequences.get(f('SEQ_SE_BLIP'))!;
  const tele = { ...blip, id: 'platinum:SEQ_SE_DP_TELE2' as Id };
  const played: Id[] = [];
  const stubs: string[] = [];
  const audio = { playSe: (id: Id) => void played.push(id), sePlaying: () => false } as unknown as AudioHost;
  const sound = new FieldSound(audio, { ...registries, sequences: new Map([...registries.sequences, [tele.id, tele]]) }, { stub: (key) => void stubs.push(key) });
  sound.playNamed('SEQ_SE_DP_TELE2');
  sound.playNamed('SEQ_SE_DP_TELE2_sseq');
  expect(played).toEqual(['platinum:SEQ_SE_DP_TELE2']);
  expect(stubs).toEqual(['audio:sequence-missing']);
});
