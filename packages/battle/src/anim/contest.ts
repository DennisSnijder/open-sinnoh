/**
 * Move animations for the contests' acting round (decomp ov17_022444BC: BattleAnimSystem_StartMove with the contest
 * flag set, BattleAnimSystem_SetIsContest): the animation VM in contest mode, battler 0 the performer (its back
 * picture at the contestant's place) and battler 1 the next contestant's Pokémon, hidden. A move without a script, or
 * whose contest path needs what the VM does not run, gets no animation: logged and counted, the act goes on.
 */
import type { AudioHost, ContestMoveAnimation, CreateContestMoveAnimation, Registries } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { animSupport, moveAnimation } from './index.ts';
import { AnimVm, type AnimBattler, type AnimSound } from './vm.ts';

/** The battler as the contest builds it: the back picture (decomp sub_02095484 with face 0) and its height. */
function contestBattler(registries: Registries, species: Id, form: number, visible: boolean): AnimBattler {
  const sprites = registries.pokemonSprites.get(species);
  const face = (sprites?.forms[form] ?? sprites?.forms[0])?.back;
  return { species, form, height: face?.yOffset ?? 0, visible };
}

/** The game's sound for the animation by SDAT index; SEs this animation started count as playing ones. */
function contestSound(registries: Registries, sound: AudioHost): AnimSound {
  const ids = new Map([...registries.sequences.values()].flatMap((s) => (s.sourceIndex === undefined ? [] : [[s.sourceIndex, s.id] as const])));
  const started = new Set<Id>();
  const id = (n: number): Id | null => ids.get(n) ?? null;
  return {
    se: (n) => {
      const s = id(n);
      if (!s) return;
      started.add(s);
      sound.playSe(s);
    },
    stopSe: (n) => {
      const s = id(n);
      if (s) sound.stopSe(s);
    },
    sePlaying: (n) => {
      if (n === undefined) return [...started].some((s) => sound.sePlaying(s));
      const s = id(n);
      return s ? sound.sePlaying(s) : false;
    },
    cry: (species, form, mod, pan, volume) => sound.playCry(species, form, mod, pan, volume),
    cryPlaying: () => sound.cryPlaying(),
    // The AudioHost cannot stop a cry early (WaitForPokemonCries' stop flag): it plays out.
    stopCries: () => {},
  };
}

export const createContestMoveAnimation: CreateContestMoveAnimation = (request, deps) => {
  const record = moveAnimation(deps.registries, request.move);
  if (!record) {
    deps.log.stub(`contest:anim:${request.move}`, 'no animation script for the move: the act has no animation');
    return null;
  }
  const missing = animSupport(record, deps.registries, false, true);
  if (missing.length) {
    deps.log.stub(`contest:anim:${request.move}`, `the contest animation needs ${missing.join(', ')}: the act has no animation`);
    return null;
  }
  const vm = new AnimVm(record.code, {
    registries: deps.registries,
    attacker: 0,
    defender: 1,
    battlers: [contestBattler(deps.registries, request.attacker.species, request.attacker.form, true), contestBattler(deps.registries, request.defender.species, request.defender.form, false)],
    doubles: false,
    effectChance: request.effectChance,
    weather: null,
    seed: request.seed,
    log: deps.log,
    contest: true,
    ...(deps.sound ? { sound: contestSound(deps.registries, deps.sound) } : {}),
  });
  const run: ContestMoveAnimation = {
    tick: () => vm.tick(),
    get done() {
      return vm.done;
    },
    view: () => vm.view(),
  };
  return run;
};

/** Coverage over the move scripts in a contest: the ones that play, and what the others miss. */
export function contestAnimCoverage(registries: Registries): { moves: number; real: number; missing: Map<string, number> } {
  const missing = new Map<string, number>();
  let moves = 0;
  let real = 0;
  for (const a of registries.battleAnimations.values()) {
    if (a.common !== undefined) continue;
    moves++;
    const m = animSupport(a, registries, false, true);
    if (!m.length) real++;
    for (const x of m) missing.set(x, (missing.get(x) ?? 0) + 1);
  }
  return { moves, real, missing };
}
