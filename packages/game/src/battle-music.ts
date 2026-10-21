import type { BattleSetup, Registries } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';

/**
 * Battle music by encounter (decomp enc_effects.c EncEffects_GetEffectPair / sEncEffectsTable) and the
 * victory music by trainer class (battle_controller_player.c, the result check; battle_script.c for wild
 * battles). Sequences are the decomp's (sourceIndex): BATTLE_* and VICTORY_* are the SDAT's SEQ_BA_* and
 * SEQ_WIN* names. Classes and species are matched by their decomp names.
 */

const SEQ = {
  wild: 1116, // SEQ_BA_POKE (BATTLE_WILD_POKEMON)
  gymLeader: 1117, // SEQ_BA_GYM
  lakeGuardian: 1118, // SEQ_BA_DPOKE1
  trainer: 1119, // SEQ_BA_TRAIN
  cyrus: 1120, // SEQ_BA_AKAGI
  dialgaPalkia: 1121, // SEQ_BA_DPOKE2
  champion: 1122, // SEQ_BA_CHANP
  galacticGrunt: 1123, // SEQ_BA_GINGA
  rival: 1124, // SEQ_BA_RIVAL
  arceus: 1125, // SEQ_BA_SECRET1
  legendary: 1126, // SEQ_BA_SECRET2
  galacticCommander: 1134, // SEQ_BA_GINGA3
  eliteFour: 1136, // SEQ_BA_TENNO
  giratina: 1201, // SEQ_PL_BA_GIRA
  frontierBrain: 1202, // SEQ_PL_BA_BRAIN
  regiTrio: 1204, // SEQ_PL_BA_REGI
} as const;

const VICTORY = {
  wild: 1127, // SEQ_WINPOKE
  trainer: 1128, // SEQ_WINTRAIN
  gymLeader: 1129, // SEQ_WINTGYM
  champion: 1130, // SEQ_WINCHAMP
  galactic: 1131, // SEQ_WINGINGA
  cyrus: 1132, // SEQ_WINAKAGI
  eliteFour: 1133, // SEQ_WINTENNO
  frontierBrain: 1203, // SEQ_PL_WINBRAIN
} as const;

const LEADERS = ['ROARK', 'GARDENIA', 'WAKE', 'MAYLENE', 'FANTINA', 'CANDICE', 'BYRON', 'VOLKNER'].map((n) => `TRAINER_CLASS_LEADER_${n}`);
const ELITE_FOUR = ['AARON', 'BERTHA', 'FLINT', 'LUCIAN'].map((n) => `TRAINER_CLASS_ELITE_FOUR_${n}`);
const COMMANDERS = ['MARS', 'JUPITER', 'SATURN'].map((n) => `TRAINER_CLASS_COMMANDER_${n}`);
const GRUNTS = ['TRAINER_CLASS_GALACTIC_GRUNT_MALE', 'TRAINER_CLASS_GALACTIC_GRUNT_FEMALE'];
const FRONTIER_BRAINS = ['TOWER_TYCOON', 'HALL_MATRON', 'FACTORY_HEAD', 'ARCADE_STAR', 'CASTLE_VALET'].map((n) => `TRAINER_CLASS_${n}`);
/** EncEffects_WildPokemonEffect (Pal Park exceptions aside: there is no Pal Park). */
const WILD: Record<string, number> = {
  SPECIES_SHAYMIN: SEQ.wild,
  SPECIES_CRESSELIA: SEQ.wild,
  SPECIES_GIRATINA: SEQ.giratina,
  SPECIES_REGISTEEL: SEQ.regiTrio,
  SPECIES_REGICE: SEQ.regiTrio,
  SPECIES_REGIROCK: SEQ.regiTrio,
  SPECIES_REGIGIGAS: SEQ.legendary,
  SPECIES_HEATRAN: SEQ.legendary,
  SPECIES_DARKRAI: SEQ.legendary,
  SPECIES_ROTOM: SEQ.legendary,
  SPECIES_MESPRIT: SEQ.lakeGuardian,
  SPECIES_UXIE: SEQ.lakeGuardian,
  SPECIES_AZELF: SEQ.lakeGuardian,
  SPECIES_DIALGA: SEQ.dialgaPalkia,
  SPECIES_PALKIA: SEQ.dialgaPalkia,
  SPECIES_ARCEUS: SEQ.arceus,
  SPECIES_MOLTRES: SEQ.legendary,
  SPECIES_ARTICUNO: SEQ.legendary,
  SPECIES_ZAPDOS: SEQ.legendary,
};

const local = (id: Id) => id.slice(id.indexOf(':') + 1);

/** The opposing trainer's class (decomp: trainer[1], the first enemy), or null in a wild battle. */
function enemyClass(setup: BattleSetup, registries: Registries): string | null {
  // A frontier battle's trainers are its own (FieldBattleDTO_InitFrontierTrainer): the Tower Tycoon is a brain.
  if (setup.frontier) return local(setup.frontier.trainers[0]!.class);
  const first = setup.trainers[0];
  if (setup.kind === 'wild' || setup.kind === 'tutorial' || !first) return null;
  const trainer = registries.trainers.get(first);
  if (!trainer) throw new Error(`battle music: unknown trainer ${first}`);
  return local(trainer.class);
}

/** EncEffects_BGM: the battle's music (a decomp sequence number). */
export function battleBgm(setup: BattleSetup, registries: Registries): number {
  const cls = enemyClass(setup, registries);
  if (cls === null) {
    const species = setup.wild[0]?.species;
    const special = species ? WILD[local(species)] : undefined;
    if (special !== undefined) return special;
    return SEQ.wild;
  }
  // FrontierScrCmd_3F plays BGM_BATTLE_TRAINER for the frontier's battles; a brain's is the brain's (the Tycoon).
  if (setup.frontier) return FRONTIER_BRAINS.includes(cls) ? SEQ.frontierBrain : SEQ.trainer;
  if (GRUNTS.includes(cls)) return SEQ.galacticGrunt;
  if (COMMANDERS.includes(cls)) return SEQ.galacticCommander;
  if (cls === 'TRAINER_CLASS_GALACTIC_BOSS') return SEQ.cyrus;
  const doubles = setup.trainers.length > 1 || registries.trainers.get(setup.trainers[0]!)!.double;
  if (doubles) return cls === 'TRAINER_CLASS_LEADER_VOLKNER' ? SEQ.gymLeader : SEQ.trainer;
  if (LEADERS.includes(cls)) return SEQ.gymLeader;
  if (ELITE_FOUR.includes(cls)) return SEQ.eliteFour;
  if (cls === 'TRAINER_CLASS_CHAMPION_CYNTHIA') return SEQ.champion;
  if (cls === 'TRAINER_CLASS_RIVAL') return SEQ.rival;
  if (FRONTIER_BRAINS.includes(cls)) return SEQ.frontierBrain;
  return SEQ.trainer;
}

/** The victory music (a decomp sequence number): VICTORY_WILD_POKEMON, or by the trainer's class. */
export function victoryBgm(setup: BattleSetup, registries: Registries): number {
  const cls = enemyClass(setup, registries);
  if (cls === null) return VICTORY.wild;
  if (LEADERS.includes(cls)) return VICTORY.gymLeader;
  if (FRONTIER_BRAINS.includes(cls)) return VICTORY.frontierBrain;
  if (cls === 'TRAINER_CLASS_CHAMPION_CYNTHIA') return VICTORY.champion;
  if (COMMANDERS.includes(cls) || GRUNTS.includes(cls)) return VICTORY.galactic;
  if (cls === 'TRAINER_CLASS_GALACTIC_BOSS') return VICTORY.cyrus;
  if (ELITE_FOUR.includes(cls)) return VICTORY.eliteFour;
  return VICTORY.trainer;
}

/** decomp SEQ_SE_DP_HINSI: the low-HP beep. */
export const SEQ_SE_DP_HINSI = 1796;

/**
 * HealthBar_Color(cur, max, 48) == BARCOLOR_RED: 1–9 of the gauge's 48 pixels (not at full HP).
 */
export function redHp(hp: number, maxHp: number): boolean {
  if (hp === maxHp || hp <= 0) return false;
  const pixels = Math.max(1, Math.floor((hp * 48) / maxHp));
  return pixels * 256 <= Math.floor((48 * 256) / 5);
}
