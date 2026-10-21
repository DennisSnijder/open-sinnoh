import type { ActiveMove, Battle, Pokemon } from '@pkmn/sim';

/** UpdateHP caps substitute damage before drain/recoil; drain uses DivideVarByValue (minimum one). */
export const substitute = {
  inherit: true,
  condition: {
    inherit: true,
    onTryPrimaryHit(this: Battle, target: Pokemon, source: Pokemon, move: ActiveMove) {
      if (target === source || move.flags['bypasssub']) return;
      const result = this.actions.getDamage(source, target, move);
      if (typeof result !== 'number') {
        this.add('-fail', source);
        this.attrLastMove('[still]');
        return null;
      }
      const shield = target.volatiles['substitute']!;
      const lost = Math.min(shield.hp, result);
      shield.hp -= lost;
      source.lastDamage = lost;
      if (shield.hp === 0) {
        target.removeVolatile('substitute');
        target.addVolatile('substitutebroken');
        target.volatiles['substitutebroken']!.move = move.id;
      } else this.add('-activate', target, 'Substitute', '[damage]');
      if (move.ohko) this.add('-ohko');
      if (move.recoil && lost) this.damage(this.actions.calcRecoilDamage(lost, move, source), source, target, 'recoil');
      if (move.drain && lost) this.heal(Math.max(1, Math.floor(lost * move.drain[0] / move.drain[1])), source, target, 'drain');
      this.runEvent('AfterSubDamage', target, source, move, lost);
      return this.HIT_SUBSTITUTE;
    },
  },
};
