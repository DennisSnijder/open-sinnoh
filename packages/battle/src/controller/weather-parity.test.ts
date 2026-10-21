import { describe, expect, it, vi } from 'vitest';
import type { BattleWeather } from '@opensinnoh/contracts';
import { CountingStubLog } from '@opensinnoh/game';
import { simData, simSet } from '../sim/dex.ts';
import { battle, configure, damageRolls, dex, f, mon, registries, untilPrompt } from './parity-fixture.ts';

const data = simData(registries, new CountingStubLog(() => {}));
function start(weather: BattleWeather, species = 'SNORLAX', ability = 'No Ability', move = 'WATER_GUN') {
  const a = mon('SQUIRTLE', 50, move);
  const b = mon(species, 50, 'SPLASH');
  const sim = data.createBattle('wild', 'singles', { seed: [1, 2, 3, 4] } as never, { weather });
  sim.setPlayer('p1', { team: [simSet(data, dex, a, 'Squirtle')] } as never);
  const foe = { ...simSet(data, dex, b, species), ability };
  sim.setPlayer('p2', { team: [foe] } as never);
  for (const p of sim.getAllPokemon()) {
    p.hp = p.maxhp = p.baseMaxhp = 160;
    p.storedStats = { atk: 100, def: 100, spa: 100, spd: 100, spe: 100 };
  }
  return sim;
}

describe('field weather and fog (battle-parity weather oracles)', () => {
  it('snow at entry damages both 160-HP Snorlax by 10, and remains through turn 6 (150 then 100)', () => {
    const lead = mon('SNORLAX', 50, 'SPLASH');
    const b = battle([lead], { weather: 'hail', wild: [{ species: f('SPECIES_SNORLAX'), level: 50 }] });
    configure(b, 1, mon('SNORLAX', 50, 'SPLASH'));
    untilPrompt(b);
    for (let turn = 1; turn <= 6; turn++) {
      b.choose({ kind: 'move', slot: 0 });
      untilPrompt(b);
      expect(b.view().battlers.map((p) => p.hp)).toEqual([160 - turn * 10, 160 - turn * 10]);
    }
    expect(b.sim.field.weather).toBe('hail');
  });

  it.each([['rain', 'raindance'], ['sun', 'sunnyday'], ['sandstorm', 'sandstorm'], ['hail', 'hail'], ['fog', 'fog']] as const)('carries %s before switch-in abilities and makes it permanent', (weather, id) => {
    const sim = start(weather);
    expect(sim.field.weather).toBe(id);
    expect(sim.field.weatherState.duration).toBe(0);
  });

  it('switch-in Drizzle replaces field hail; Cloud Nine suppresses fog without removing it', () => {
    const sim = start('hail', 'PSYDUCK', 'Drizzle');
    expect(sim.field.weather).toBe('raindance');
    expect(sim.log.findIndex((l) => l.startsWith('|-weather|Hail'))).toBeLessThan(sim.log.findIndex((l) => l.includes('ability: Drizzle')));
    const fog = start('fog', 'PSYDUCK', 'Cloud Nine');
    expect(fog.field.weather).toBe('fog');
    expect(fog.field.effectiveWeather()).toBe('');
  });

  it('overworld Trick Room reverses order and expires after five turns', () => {
    const sim = start('trickroom');
    expect(sim.field.pseudoWeather['trickroom']).toBeTruthy();
    sim.p1.active[0]!.storedStats.spe = 50;
    for (let turn = 0; turn < 5; turn++) sim.makeChoices('move 1', 'move 1');
    const moves = sim.log.filter((l) => l.startsWith('|move|'));
    expect(moves[0]).toMatch(/^\|move\|p1a:/);
    expect(sim.field.pseudoWeather['trickroom']).toBeUndefined();
  });

  it.each([['SNORLAX', 'No Ability', 60, 24, 28], ['PSYDUCK', 'Cloud Nine', 100, 12, 14], ['PSYDUCK', 'Air Lock', 100, 12, 14]] as const)('fog Water Gun against %s/%s: exact hit domain and damage range', (species, ability, threshold, low, high) => {
    const probe = start('fog', species, ability);
    const vector = damageRolls(probe, probe.p1.active[0]!, probe.p2.active[0]!, 'watergun');
    const expected = Array.from({ length: 16 }, (_, r) => {
      const stab = Math.floor(Math.floor(19 * (100 - r) / 100) * 1.5);
      return species === 'PSYDUCK' ? Math.floor(stab / 2) : stab;
    });
    expect(vector).toEqual(expected);
    expect([Math.min(...vector), Math.max(...vector)]).toEqual([low, high]);
    for (let roll = 0; roll < 100; roll++) {
      const sim = start('fog', species, ability);
      const accuracy = vi.spyOn(sim, 'randomChance').mockImplementation((n, d) => d === 100 ? roll < n : false);
      sim.makeChoices('move 1', 'move 1');
      expect(accuracy).toHaveBeenCalledWith(threshold, 100);
      const loss = 160 - sim.p2.active[0]!.hp;
      if (roll < threshold) expect(loss).toBeGreaterThanOrEqual(low);
      else expect(loss).toBe(0);
      expect(loss).toBeLessThanOrEqual(high);
    }
  });

  it('Defog removes fog, preserves its ordinary evasion effect and restores accuracy', () => {
    const sim = start('fog', 'SNORLAX', 'No Ability', 'DEFOG');
    sim.makeChoices('move 1', 'move 1');
    expect(sim.field.weather).toBe('');
    expect(sim.p2.active[0]!.boosts.evasion).toBe(-1);
  });

  it('fog Weather Ball remains Normal and doubles power; Cloud Nine suppresses the boost', () => {
    for (const ability of ['No Ability', 'Cloud Nine']) {
      const sim = start('fog', 'SNORLAX', ability, 'WEATHER_BALL');
      const move = sim.dex.getActiveMove('weatherball');
      sim.singleEvent('ModifyType', move, null, sim.p1.active[0]!, sim.p2.active[0]!, move, move);
      sim.singleEvent('ModifyMove', move, null, sim.p1.active[0]!, sim.p2.active[0]!, move, move);
      expect(move.type).toBe('Normal');
      expect(move.basePower).toBe(ability === 'Cloud Nine' ? 50 : 100);
    }
  });

  it('fog halves Solar Beam power; Cloud Nine suppresses the reduction', () => {
    for (const ability of ['No Ability', 'Cloud Nine']) {
      const sim = start('fog', 'SNORLAX', ability, 'SOLAR_BEAM');
      const vector = damageRolls(sim, sim.p1.active[0]!, sim.p2.active[0]!, 'solarbeam');
      const base = ability === 'Cloud Nine' ? 54 : 28;
      expect(vector).toEqual(Array.from({ length: 16 }, (_, r) => Math.floor(base * (100 - r) / 100)));
    }
  });

  it.each(['MOONLIGHT', 'MORNING_SUN', 'SYNTHESIS'])('%s heals a quarter in fog, half under Cloud Nine', (move) => {
    for (const ability of ['No Ability', 'Cloud Nine']) {
      const sim = start('fog', 'SNORLAX', ability, move);
      sim.p1.active[0]!.hp = 1;
      sim.makeChoices('move 1', 'move 1');
      expect(sim.p1.active[0]!.hp).toBe(ability === 'Cloud Nine' ? 81 : 41);
    }
  });
});
