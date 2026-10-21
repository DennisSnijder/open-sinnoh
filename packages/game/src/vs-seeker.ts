/** VsSeekerSystem_CollectViableNPCs / PickRematchTrainers (pret/pokeplatinum 1dc13dc,
 * src/overlay005/vs_seeker.c:500–555,659–690). Data is supplied by the pack. */
import { FIELD_VARS, nextFieldRandom, readSystemVar, SEEKER_SPIN, SEEKER_USED, systemFlag, trainerDefeated, writeSystemVar, type Id } from '@opensinnoh/core';
import type { FieldItemDeps } from './field-items.ts';

export function useVsSeeker(d: FieldItemDeps): void {
  const { state: s, registries: reg } = d;
  const say = (name: string, slots: string[] = []) => d.scripts.notice(`${d.ns}:VsSeeker_Text_${name}` as Id, slots);
  const charge = readSystemVar(reg, s, FIELD_VARS.battery);
  if (charge !== 100) return say('BatteryIsntChargedEnough', [String(100 - charge)]);
  const zone = reg.zones.get(s.player.zone)!;
  const actors = d.world.view().actors;
  const viable = s.objects.flatMap((o) => {
    if (o.zone !== zone.id || o.x < s.player.x - 7 || o.x > s.player.x + 7 || o.z < s.player.z - 7 || o.z > s.player.z + 6 || [51, 52, 53, 54].includes(o.movementType)) return [];
    const ev = zone.events.objects.find((e) => e.localId === o.localId && !e.cloneOf);
    if (!ev?.trainer || ![1, 2, 4, 5, 6, 7, 8].includes(ev.trainerType)) return [];
    if (!actors.some((a) => a.localId === o.localId && a.visible)) return [];
    return [{ o, ev, trainer: reg.trainers.get(ev.trainer.id)! }];
  });
  if (!viable.length) return say('NoTrainersWithinRange');
  writeSystemVar(reg, s, FIELD_VARS.battery, 0);
  let available = false;
  for (const v of viable) {
    const n = v.trainer.sourceIndex;
    if (n === undefined) throw new Error(`Vs. Seeker: ${v.trainer.id} has no sourceIndex`);
    if (!trainerDefeated(reg, s, n)) { available = true; continue; }
    // The native roll is consumed even if this trainer is already spinning.
    if ((nextFieldRandom(s) % 100) >= 50 || v.o.movementType === SEEKER_SPIN) continue;
    d.world.switchMovementType(v.o.localId, SEEKER_SPIN);
    // VsSeeker_GetSecondDoubleBattleTrainer searches all native objects, including beyond the scan radius.
    if (v.trainer.double) {
      const second = zone.events.objects.find((e) => !e.cloneOf && e.trainer?.id === v.ev.trainer!.id && e.trainer.battler !== v.ev.trainer!.battler && [1, 2, 4, 5, 6, 7, 8].includes(e.trainerType));
      if (second && s.objects.some((o) => o.zone === zone.id && o.localId === second.localId)) d.world.switchMovementType(second.localId, SEEKER_SPIN);
    }
    s.flags[systemFlag(reg, SEEKER_USED)] = true;
    available = true;
  }
  if (!available) say('NoTrainersReadyToBattle');
}
