/** Sharing input records must never share a game's mutable state. */
import { describe, expect, it } from 'vitest';
import { ROM } from '../rom.ts';
import { storyGame } from './checkpoints-anchors.ts';

describe.skipIf(!ROM)('checkpoint pack reuse (OPENSINNOH_NDS_ROM)', () => {
  it('freezes shared records, with separate registries and game state for every game', () => {
    const a = storyGame(1);
    const b = storyGame(1);
    expect(a.registries).not.toBe(b.registries);
    expect(a.registries.zones).not.toBe(b.registries.zones);
    const zone = a.registries.zones.values().next().value!;
    expect(b.registries.zones.get(zone.id)).toBe(zone);
    expect(() => { zone.events.objects.length = 0; }).toThrow(TypeError);
    expect(a.state).not.toBe(b.state);
    const money = b.state.money;
    a.state.money = 0;
    expect(b.state.money).toBe(money);
  });
});
