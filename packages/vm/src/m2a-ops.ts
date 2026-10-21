/**
 * The battle commands: real battles through `FieldHost.startBattle`, with
 * the script waiting on `battleDone` (decomp: the script waits on the encounter field task), and the result
 * kept for check_won_battle / check_lost_battle (decomp SCRIPT_MANAGER_BATTLE_RESULT).
 *
 * The player and an AI partner against two trainers (decomp BATTLE_TYPE_TRAINER_WITH_AI_PARTNER, 75)
 * is a real battle, from `start_tag_battle` (its explicit partner) and from `start_trainer_battle` while a partner
 * walks with the player (the has-partner flag and VAR_PARTNER_TRAINER_ID). Ordinary doubles (a double
 * trainer or the same trainer twice, 3) and two trainers against the player alone (19) are real battles too.
 */
import type { Arg } from '@opensinnoh/core';
import type { BattleOutcome, BattleRequest, Trainer } from '@opensinnoh/contracts';
import { BANKS } from './ops.ts';
import type { Context, Handler, Result, Runner, Thread } from './runner.ts';

/** Species and level of the catching tutorial's wild Pokémon (decomp FieldBattleDTO_NewCatchingTutorial). */
const SPECIES_BIDOOF = 399;
const TUTORIAL_LEVEL = 2;
/** Decomp VAR_PLAYER_STARTER, VAR_PARTNER_TRAINER_ID. */
const VAR_PLAYER_STARTER = 0x4030;
const VAR_PARTNER_TRAINER_ID = 0x403f;

/** The battle outcome per script (decomp SCRIPT_MANAGER_BATTLE_RESULT). Not saved: saves happen between scripts. */
const outcomes = new WeakMap<Thread, BattleOutcome>();

/**
 * Starts the battle and waits for its end (the game runs it in battle mode, and the field's return), keeping its
 * outcome for the script.
 */
export function scriptBattle(r: Runner, t: Thread, c: Context, request: BattleRequest): Result {
  r.field.startBattle(request);
  return r.pause(c, () => {
    const result = r.field.battleDone();
    if (!result) return false;
    outcomes.set(t, result.outcome);
    return true;
  });
}

/** The outcome of the script's last battle (decomp SCRIPT_MANAGER_BATTLE_RESULT); none yet is a script error. */
export function battleOutcome(t: Thread, op: string): BattleOutcome {
  const o = outcomes.get(t);
  if (!o) throw new Error(`${op}: no battle has run in this script`);
  return o;
}

export function m2aHandlers(r: Runner): Record<string, Handler> {
  const val = (t: Thread, a: Arg | undefined) => r.val(t, a);
  const dest = (t: Thread, a: Arg | undefined, v: number) => r.setVar(t, r.ref(a, 'var'), v);
  const trainer = (n: number): Trainer => {
    const id = r.source('trainers', n);
    const tr = id && r.registries.trainers.get(id);
    if (!tr) throw new Error(`no trainer ${n}`);
    return tr;
  };

  const battle = (t: Thread, c: Context, request: BattleRequest): Result => scriptBattle(r, t, c, request);

  /**
   * Decomp Encounter_NewVsTrainer: two distinct enemy trainers are a tag battle, with the partner (75) or without
   * (19); the same trainer twice is an ordinary double (3); one trainer battles alone, a double one as a double
   * (Trainer_Encounter ORs its header's doubles bit in). A partner beside an ordinary double or a single trainer
   * does not battle (only the two-enemy branch takes it).
   */
  const trainerBattle = (t: Thread, c: Context, enemy1: number, enemy2: number, partner: number): Result => {
    if (enemy1 === 0) throw new Error('trainer battle with no trainer');
    if (enemy2 !== 0 && enemy1 !== enemy2) {
      const enemies = [trainer(enemy1), trainer(enemy2)].map((x) => x.id);
      if (partner === 0) return battle(t, c, { kind: 'trainer', trainers: enemies, wild: [], topology: 'trainer-pair' });
      return battle(t, c, { kind: 'trainer', trainers: enemies, wild: [], topology: 'ai-partner', partner: trainer(partner).id });
    }
    const single = trainer(enemy1);
    if (enemy1 === enemy2 || single.double) return battle(t, c, { kind: 'trainer', trainers: [single.id], wild: [], topology: 'double' });
    return battle(t, c, { kind: 'trainer', trainers: [single.id], wild: [] });
  };

  /** Decomp ScrCmd_StartTrainerBattle: the walking partner battles too (SystemFlag_CheckHasPartner, VAR_PARTNER_TRAINER_ID). */
  const walkingPartner = (t: Thread): number => {
    if (!r.state.hasPartner) return 0;
    const id = r.source('vars', VAR_PARTNER_TRAINER_ID);
    if (!id) throw new Error(`no var ${VAR_PARTNER_TRAINER_ID} (VAR_PARTNER_TRAINER_ID)`);
    return r.getVar(t, id);
  };

  const outcome = battleOutcome;

  return {
    start_trainer_battle: (t, c, a) => trainerBattle(t, c, val(t, a[0]), val(t, a[1]), walkingPartner(t)),
    // Decomp ScrCmd_StartTagBattle: partner, then the two enemies.
    start_tag_battle: (t, c, a) => trainerBattle(t, c, val(t, a[1]), val(t, a[2]), val(t, a[0])),
    start_first_battle: (t, c, a) => battle(t, c, { kind: 'first', trainers: [trainer(val(t, a[0])).id], wild: [] }),
    start_catching_tutorial: (t, c) => {
      // Decomp FieldBattleDTO_NewCatchingTutorial: the counterpart (the other gender's name from bank 553)
      // with the starter before the player's (SystemVars_GetPlayerCounterpartStarter), against Bidoof L2.
      const options = r.starterOptions();
      const player = r.getVar(t, r.source('vars', VAR_PLAYER_STARTER)!);
      const i = options.findIndex((s) => s.sourceIndex === player);
      if (i < 0) throw new Error(`player starter ${player} is not a starter species`);
      const gender = r.state.gender === 'male' ? 'female' : 'male';
      const name = r.plainText(r.bankText(BANKS.counterpartNames, gender === 'male' ? 0 : 1));
      const species = options[(i + options.length - 1) % options.length]!.id;
      const bidoof = r.source('species', SPECIES_BIDOOF);
      if (!bidoof) throw new Error(`no species ${SPECIES_BIDOOF} (the catching tutorial's Bidoof)`);
      return battle(t, c, {
        kind: 'tutorial',
        trainers: [],
        wild: [{ species: bidoof, level: TUTORIAL_LEVEL }],
        counterpart: { name, gender, species },
      });
    },
    // Decomp CheckPlayerWonBattle: anything but a loss or a draw; CheckPlayerLostBattle: anything but a win or a capture.
    check_won_battle: (t, _c, a) => {
      const o = outcome(t, 'check_won_battle');
      dest(t, a[0], o === 'lost' || o === 'draw' ? 0 : 1);
      return 'yield';
    },
    check_lost_battle: (t, _c, a) => {
      const o = outcome(t, 'check_lost_battle');
      dest(t, a[0], o === 'won' || o === 'caught' ? 0 : 1);
      return 'yield';
    },
    // Decomp CheckPlayerDidNotCaptureWildMon: anything but a capture.
    check_did_not_capture: (t, _c, a) => {
      dest(t, a[0], outcome(t, 'check_did_not_capture') === 'caught' ? 0 : 1);
      return 'yield';
    },
    // Decomp ScrCmd_BlackOutFromBattle → FieldTask_BlackOutFromBattle: the game warps and recovers once this script ends.
    black_out_from_battle: () => {
      r.field.blackOut();
      return 'yield';
    },
  };
}
