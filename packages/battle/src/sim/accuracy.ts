import type { ActiveMove, Battle, Pokemon } from '@pkmn/sim';

const scale = (accuracy: number | true, n: number, d: number) => typeof accuracy === 'number' ? Math.floor(accuracy * n / d) : undefined;

/** Integer operations in cartridge order; returning numbers avoids the sim's fixed-point modifier chain. */
export const accuracyAbilities = {
  noguard: { inherit: true, onAnyAccuracy(this: Battle, accuracy: number | true, target: Pokemon, source: Pokemon, move: ActiveMove) {
    if (move.id === 'triplekick' && move.hit > 1) return accuracy;
    if (source === this.effectState.target || target === this.effectState.target) return true;
  } },
  compoundeyes: { inherit: true, onSourceModifyAccuracy: (a: number | true) => scale(a, 130, 100) },
  sandveil: { inherit: true, onModifyAccuracy(this: Battle, a: number | true) { if (this.field.isWeather('sandstorm')) return scale(a, 80, 100); } },
  snowcloak: { inherit: true, onModifyAccuracy(this: Battle, a: number | true) { if (this.field.isWeather('hail')) return scale(a, 80, 100); } },
  hustle: { inherit: true, onSourceModifyAccuracy(a: number | true, _target: Pokemon, _source: Pokemon, move: ActiveMove) { if (move.category === 'Physical') return scale(a, 80, 100); } },
  tangledfeet: { inherit: true, onModifyAccuracy(a: number | true, target: Pokemon) { if (target.volatiles['confusion']) return scale(a, 50, 100); } },
};

export const accuracyItems = {
  brightpowder: { inherit: true, onModifyAccuracy: (a: number | true) => scale(a, 90, 100) },
  laxincense: { inherit: true, onModifyAccuracy: (a: number | true) => scale(a, 90, 100) },
  widelens: { inherit: true, onSourceModifyAccuracy: (a: number | true) => scale(a, 110, 100) },
  zoomlens: { inherit: true, onSourceModifyAccuracy(this: Battle, a: number | true, target: Pokemon) { if (!this.queue.willMove(target)) return scale(a, 120, 100); } },
  micleberry: { inherit: true, condition: { inherit: true, duration: 0, onSourceAccuracy: undefined, onSourceModifyAccuracy(this: Battle, a: number | true, _target: Pokemon, source: Pokemon, move: ActiveMove) {
    // Weather makes Blizzard/Thunder always hit later in the DS pipeline, after consuming this flag.
    if (a === true && this.dex.moves.get(move.id).accuracy === true) return;
    this.add('-enditem', source, 'Micle Berry');
    source.removeVolatile('micleberry');
    return scale(a, 120, 100);
  } } },
};

export const accuracyMoves = {
  lockon: { inherit: true, condition: { inherit: true, onSourceAccuracy(this: Battle, accuracy: number | true, target: Pokemon, source: Pokemon, move: ActiveMove) {
    if (move.id === 'triplekick' && move.hit > 1) return accuracy;
    if (source === this.effectState.target && target === this.effectState.source) return true;
  } } },
  gravity: { inherit: true, condition: { inherit: true, onModifyAccuracy: (a: number | true) => scale(a, 10, 6) } },
  // The sim's later-kick loop has its own accuracy calculation. Normalize the stages before either path.
  triplekick: { inherit: true, onModifyMove(this: Battle, move: ActiveMove, source: Pokemon, target?: Pokemon) {
    if (target) applyStages(this, source, target, move);
  } },
};

function applyStages(battle: Battle, source: Pokemon, target: Pokemon, move: ActiveMove) {
  if (typeof move.accuracy !== 'number' || move.ohko) return;
  battle.activeTarget = target;
  const attacker = battle.runEvent('ModifyBoost', source, null, null, { ...source.boosts });
  const defender = battle.runEvent('ModifyBoost', target, null, null, { ...target.boosts });
  const stage = battle.clampIntRange((move.ignoreAccuracy ? 0 : attacker.accuracy) - (move.ignoreEvasion ? 0 : defender.evasion), -6, 6);
  move.accuracy = stage >= 0 ? Math.floor(move.accuracy * (3 + stage) / 3) : Math.floor(move.accuracy * 3 / (3 - stage));
  move.ignoreAccuracy = move.ignoreEvasion = true;
}

/** Platinum combines stages, then truncates once (CheckMoveHitAccuracy). Keep sim hit overrides/events. */
export function accuracyScripts(parent: { hitStepAccuracy: (this: unknown, targets: Pokemon[], source: Pokemon, move: ActiveMove) => boolean[] }) {
  return {
    hitStepAccuracy(this: { battle: Battle }, targets: Pokemon[], source: Pokemon, move: ActiveMove): boolean[] {
      return targets.flatMap((target) => {
        const saved = { accuracy: move.accuracy, ignoreAccuracy: move.ignoreAccuracy, ignoreEvasion: move.ignoreEvasion };
        try {
          applyStages(this.battle, source, target, move);
          return parent.hitStepAccuracy.call(this, [target], source, move);
        } finally {
          Object.assign(move, saved);
        }
      });
    },
  };
}
