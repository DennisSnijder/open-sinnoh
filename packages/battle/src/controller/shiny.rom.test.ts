/**
 * The shiny sparkle on the real ROM (OPENSINNOH_NDS_ROM): a shiny Pokémon coming in plays common animation 11
 * (`shiny`: its particles and SEQ_SE_DP_REAPOKE) once it is in place (decomp Task_SetEncounter, Task_ShowPokemon);
 * a plain one does not. It plays with the battle scene off too (BattleDisplay_PlayMoveAnimation does not ask).
 */
import { describe, expect, it } from 'vitest';
import { createTrainerPokemon, type Id, type PackData, type Pokemon } from '@opensinnoh/core';
import { dexOf, type BattleSetup, type InputFrame, type Registries } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import { ROM, romSlice } from '../../../../tests/rom.ts';
import { createBattle } from '../controller.ts';

const IDLE: InputFrame = { held: [], pressed: [], touch: null };
const P = (s: string) => `platinum:${s}` as Id;
/** SEQ_SE_DP_REAPOKE in the US ROM's SDAT. */
const SE_SHINY = 1808;

describe.skipIf(!ROM)('the shiny sparkle (OPENSINNOH_NDS_ROM)', () => {
  let reg: Registries | null = null;
  const registries = () => (reg ??= loadGamePacks([(romSlice() as { pack: PackData }).pack]).registries);
  /** otId 1: pid 1 is shiny, pid 0x10 is not. */
  const mon = (pid: number): Pokemon => createTrainerPokemon(dexOf(registries()), { species: P('SPECIES_BIDOOF'), level: 10, ivs: 31, pid, otId: 1, moves: [P('MOVE_TACKLE')] }, 'Lucas', P('ITEM_POKE_BALL'));
  /** Runs the intro to the first prompt: the SE calls, and the particle frames drawn on each battler. */
  const intro = (party: Pokemon[], wild: BattleSetup['wild'], scene = true) => {
    const se: number[] = [];
    const log = new CountingStubLog(() => {});
    const b = createBattle(
      { kind: 'wild', trainers: [], wild, background: null, terrain: null, time: 'day' },
      {
        registries: registries(),
        party,
        bag: {},
        pc: { current: { box: 0, name: 'BOX 1' }, free: { box: 0, name: 'BOX 1' }, metBebe: false },
        met: { zone: null, date: null },
        player: { name: 'Lucas', gender: 'male', trainerId: 1, rival: 'Barry' },
        money: 0,
        badges: 0,
        caught: [],
        seed: 3,
        textSpeed: 1,
        log,
        sound: { victory: () => {}, se: (n) => se.push(n), stopSe: () => {}, sePlaying: () => false, cry: () => {}, cryPlaying: () => false, stopCries: () => {} },
        options: { scene, style: 'shift' },
      },
    );
    const sparkleFrames = [0, 0];
    for (let i = 0; i < 5000 && !b.view().prompt; i++) {
      b.step(IDLE);
      const v = b.view();
      if (v.anim?.particles.length) {
        // The wild sparkle plays before the first message, the player’s during "Go! X!".
        const sparkling = v.message?.text ? 0 : 1;
        sparkleFrames[sparkling]!++;
      }
    }
    expect(b.view().prompt).toBeTruthy();
    expect(log.report().filter((s) => s.key.startsWith('anim:'))).toEqual([]);
    return { se, sparkleFrames };
  };

  it('a shiny wild Pokémon sparkles after it slides in; the plain player Pokémon does not', () => {
    const { se, sparkleFrames } = intro([mon(0x10)], [{ species: P('SPECIES_STARLY'), level: 5, shiny: true }]);
    expect(se.filter((n) => n === SE_SHINY)).toHaveLength(1);
    expect(sparkleFrames[1]).toBeGreaterThan(20);
    expect(sparkleFrames[0]).toBe(0);
  }, 120_000);

  it('the player’s shiny Pokémon sparkles at its send-out, with the battle scene off too', () => {
    for (const scene of [true, false]) {
      const { se, sparkleFrames } = intro([mon(1)], [{ species: P('SPECIES_STARLY'), level: 5 }], scene);
      expect(se.filter((n) => n === SE_SHINY), `scene ${scene}`).toHaveLength(1);
      expect(sparkleFrames[0], `scene ${scene}`).toBeGreaterThan(20);
      expect(sparkleFrames[1], `scene ${scene}`).toBe(0);
    }
  }, 120_000);

  it('no shiny, no sparkle', () => {
    const { se, sparkleFrames } = intro([mon(0x10)], [{ species: P('SPECIES_STARLY'), level: 5 }]);
    expect(se).not.toContain(SE_SHINY);
    expect(sparkleFrames).toEqual([0, 0]);
  }, 120_000);
});
