/** Battle and victory music by encounter (decomp enc_effects.c, battle_controller_player.c) and the red gauge rule. */
import { describe, expect, it } from 'vitest';
import type { BattleSetup, Registries } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { battleBgm, redHp, victoryBgm } from './battle-music.ts';
import { loadGamePacks } from './packs.ts';
import { readPack } from '../test/packs.ts';

const F = (s: string) => `fixture:${s}` as Id;
const base = loadGamePacks([readPack('fixture')]).registries;

function reg(classId: string, double = false): Registries {
  const t = [...base.trainers.values()][0]!;
  return { ...base, trainers: new Map([[F('T'), { ...t, id: F('T'), class: `platinum:${classId}` as Id, double }]]) } as Registries;
}

const setup = (kind: 'wild' | 'trainer', species = 'platinum:SPECIES_BIDOOF'): BattleSetup => ({
  kind,
  trainers: kind === 'wild' ? [] : [F('T')],
  wild: kind === 'wild' ? [{ species: species as Id, level: 5 }] : [],
  background: null,
  terrain: null,
  time: 'day',
});

describe('battle music', () => {
  it('picks the battle music by trainer class and wild species (decomp sequence numbers)', () => {
    expect(battleBgm(setup('wild'), reg('X'))).toBe(1116);
    expect(battleBgm(setup('wild', 'platinum:SPECIES_GIRATINA'), reg('X'))).toBe(1201);
    expect(battleBgm(setup('trainer'), reg('TRAINER_CLASS_YOUNGSTER'))).toBe(1119);
    expect(battleBgm(setup('trainer'), reg('TRAINER_CLASS_LEADER_ROARK'))).toBe(1117);
    expect(battleBgm(setup('trainer'), reg('TRAINER_CLASS_RIVAL'))).toBe(1124);
    // Galactic before doubles; a double battle plays the trainer music, except Volkner's.
    expect(battleBgm(setup('trainer'), reg('TRAINER_CLASS_GALACTIC_GRUNT_MALE', true))).toBe(1123);
    expect(battleBgm(setup('trainer'), reg('TRAINER_CLASS_LEADER_ROARK', true))).toBe(1119);
    expect(battleBgm(setup('trainer'), reg('TRAINER_CLASS_LEADER_VOLKNER', true))).toBe(1117);
  });

  it('picks the victory music by trainer class', () => {
    expect(victoryBgm(setup('wild'), reg('X'))).toBe(1127);
    expect(victoryBgm(setup('trainer'), reg('TRAINER_CLASS_YOUNGSTER'))).toBe(1128);
    expect(victoryBgm(setup('trainer'), reg('TRAINER_CLASS_LEADER_ROARK'))).toBe(1129);
    expect(victoryBgm(setup('trainer'), reg('TRAINER_CLASS_COMMANDER_MARS'))).toBe(1131);
    expect(victoryBgm(setup('trainer'), reg('TRAINER_CLASS_GALACTIC_BOSS'))).toBe(1132);
  });

  it('the low-HP beep: a red gauge is 1–9 of 48 pixels, never at full HP', () => {
    expect(redHp(20, 100)).toBe(true);
    expect(redHp(21, 100)).toBe(false);
    expect(redHp(1, 100)).toBe(true);
    expect(redHp(0, 100)).toBe(false);
    expect(redHp(1, 1)).toBe(false);
  });
});
