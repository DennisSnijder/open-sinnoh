import { describe, expect, it } from 'vitest';
import type { Id } from '@opensinnoh/core';
import { storyGame } from './checkpoints-anchors.ts';
import { ROM } from '../rom.ts';
const P = (s: string) => `platinum:${s}` as Id;
describe.skipIf(!ROM)('Field events on Platinum data (OPENSINNOH_NDS_ROM)', () => {
  it('Looker moves, visits the Windworks, and leaves after his scene', () => {
    const game = storyGame(1);
    const save = { format: 'lantern-nds-save' as const, version: 1 as const, savedAt: 'test', state: structuredClone(game.state) };
    save.state.player = { zone: P('MAP_HEADER_VALLEY_WINDWORKS_OUTSIDE'), x: 243, z: 655, y: 0, facing: 'down' };
    save.state.objects = [];
    save.state.vars[P('VAR_VALLEY_WINDWORKS_STATE')] = 2;
    save.state.vars[P('VAR_VALLEY_WINDWORKS_TEAM_GALACTIC_STATE')] = 2;
    save.state.vars[P('VAR_VALLEY_WINDWORKS_LOOKER_STATE')] = 1;
    save.state.flags[P('FLAG_UNLOCKED_VALLEY_WINDWORKS_DOOR')] = true;
    save.state.flags[P('FLAG_HIDE_VALLEY_WINDWORKS_OUTSIDE_GRUNT_M')] = true;
    save.state.flags[P('FLAG_HIDE_VALLEY_WINDWORKS_OUTSIDE_LOOKER')] = false;
    game.load(save, 'arrival');
    const positions = new Set<string>();
    let hidden = false;
    for (let t = 0; t < 2000; t++) {
      const looker = game.world.view().actors.find(a => a.sprite === P('OBJ_EVENT_GFX_LOOKER'));
      if (looker) {
        positions.add(looker.cur.join(','));
        hidden ||= !looker.visible;
      }
      if (t % 4 === 0)
        game.press('a');
      else
        game.release('a');
      game.tick();
      if (game.state.vars[P('VAR_VALLEY_WINDWORKS_LOOKER_STATE')] === 2 && !game.scripts.running())
        break;
    }
    expect(positions.size, 'Looker walks instead of the neighbouring signpost').toBeGreaterThan(4);
    expect(hidden, 'Looker goes inside before returning').toBe(true);
    expect(game.state.flags[P('FLAG_HIDE_VALLEY_WINDWORKS_OUTSIDE_LOOKER')]).toBe(true);
    expect(game.world.view().actors.some(a => a.sprite === P('OBJ_EVENT_GFX_LOOKER'))).toBe(false);
  });
  it('the Pokémon Center escalator carries the player off its landing facing away', () => {
    const game = storyGame(1);
    const save = { format: 'lantern-nds-save' as const, version: 1 as const, savedAt: 'test', state: structuredClone(game.state) };
    save.state.player = { zone: P('MAP_HEADER_ETERNA_CITY_POKECENTER_1F'), x: 3, z: 10, y: 0, facing: 'left' };
    save.state.objects = [];
    game.load(save, 'arrival');
    game.advance(40);
    game.press('left');
    for (let t = 0; t < 30 && game.state.player.zone === P('MAP_HEADER_ETERNA_CITY_POKECENTER_1F'); t++)
      game.tick();
    game.release('left');
    game.advance(80);
    expect(game.state.player.zone).toBe(P('MAP_HEADER_ETERNA_CITY_POKECENTER_2F'));
    const zone = game.registries.zones.get(game.state.player.zone)!;
    const landing = zone.events.warps[0]!;
    expect(game.state.player).toMatchObject({ x: landing.x + 1, z: landing.z, facing: 'right' });
    expect(game.world.idle()).toBe(true);
  });
});
