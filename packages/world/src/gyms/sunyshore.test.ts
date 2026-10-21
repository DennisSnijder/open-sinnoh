import { describe, expect, it } from 'vitest';
import type { SunyshoreGymRoom } from '@opensinnoh/contracts';
import { f, newState, registries } from '../testing.ts';
import { SunyshoreGym } from './sunyshore.ts';
import type { FeatureHost } from './feature.ts';

const room: SunyshoreGymRoom = {
  gears: [
    { prop: f('GEAR'), x: 12, y: 2, z: 15, initialRotation: 1, clockwise: false, vertical: false },
    { prop: f('VERTICAL'), x: 18, y: 3, z: 15, initialRotation: 2, clockwise: true, vertical: true },
  ],
  rectangles: [
    { x: 13, z: 14, width: 2, depth: 3 },
    { x: 17, z: 14, width: 1, depth: 1 },
  ],
  collisions: [[0], [1], [0, 1], []],
};
function setup(rotationState = 0) {
  const state = newState();
  state.mapFeatures = { kind: 'sunyshore-gym', roomID: 0, rotationState };
  const ng = [...registries.newGame.values()][0]!;
  const reg = { ...registries, newGame: new Map([[ng.id, { ...ng, gyms: { ...ng.gyms!, sunyshore: [room] } }]]) };
  const host = { state, reg } as unknown as FeatureHost;
  return { state, gym: new SunyshoreGym(host), host };
}
describe('Sunyshore gears on original tables', () => {
  for (const [button, turn, ticks] of [
    [0, 1, 16],
    [1, -1, 16],
    [2, 2, 32],
  ] as const)
    it(`button ${button}: target collision at once, ${ticks} transforms then cleanup`, () => {
      const { state, gym } = setup();
      const before = gym.view().features!.models.map((m) => m.position);
      gym.press(button);
      expect(state.mapFeatures).toMatchObject({ rotationState: (turn + 4) % 4 });
      expect(gym.blocks(17, 14)).toBe(button !== 1);
      for (let i = 0; i < ticks; i++) gym.step();
      expect(gym.busy()).toBe(true);
      const models = gym.view().features!.models;
      expect(models.map((m) => m.position)).toEqual(before);
      expect(models[0]!.rotation).toEqual([0, 90 + turn * 90, 0]);
      expect(models[1]!.rotation).toEqual([180 - turn * 90, 0, 0]);
      gym.step();
      expect(gym.busy()).toBe(false);
    });
  it('four normal turns wrap both saved orientation and displayed angles', () => {
    const { state, gym } = setup();
    const before = gym.view();
    for (let i = 0; i < 4; i++) { gym.press(0); for (let tick = 0; tick < 17; tick++) gym.step(); }
    expect(state.mapFeatures).toMatchObject({ rotationState: 0 });
    expect(gym.view()).toEqual(before);
  });
  it('restores every gear transform and collision from the saved nonzero state', () => {
    const { state, gym, host } = setup(2);
    const restored = new SunyshoreGym({ ...host, state: JSON.parse(JSON.stringify(state)) });
    expect(restored.view()).toEqual(gym.view());
    for (let x = 10; x < 22; x++) for (let z = 12; z < 20; z++) expect(restored.blocks(x, z)).toBe(gym.blocks(x, z));
  });
});
