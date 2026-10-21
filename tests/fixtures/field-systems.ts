/** Original field-system fixtures, deliberately unrelated to Platinum's trainer/size tables. */
import { FIELD_VARS, SEEKER_USED, type Id, type PackData } from '@opensinnoh/core';
import type { Item, NewGame, RegistryTypes, Trainer, Zone } from '@opensinnoh/contracts';
import { readPack } from '../../packages/game/test/packs.ts';
export const f = (name: string) => `fixture:${name}` as Id;
export function fieldPack(): PackData {
  const p = structuredClone(readPack('fixture'));
  const records = <K extends keyof RegistryTypes>(key: K) => (p.registries[key] ??= []) as unknown as RegistryTypes[K][];
  for (const n of Object.values(FIELD_VARS)) records('vars').push({ id: f(`FIELD_${n}`), sourceIndex: n, initial: 0, scope: 'saved' });
  for (const n of [SEEKER_USED, 2431, 2432, 2433, 2434, 2435, 2739, 1360 + 700, 1360 + 701, 1360 + 702, 1360 + 703]) records('flags').push({ id: f(`FIELD_FLAG_${n}`), sourceIndex: n, initial: false, scope: 'saved' });
  const bike = records('items').find((i) => i.fieldUse === 4)!;
  for (const [name, fieldUse] of [['SEEKER', 15], ['OLD', 16], ['GOOD', 17], ['SUPER', 18], ['ROPE', 21]] as const) records('items').push({ ...bike, id: f(name), fieldUse, pocket: fieldUse === 21 ? 'items' : bike.pocket } as Item);
  const tr = records('trainers')[0]!;
  for (const n of [700, 701, 702, 703]) records('trainers').push({ ...tr, id: f(`TRAINER_${n}`), sourceIndex: n, rematches: n === 700 ? [f('TRAINER_700'), null, f('TRAINER_701'), f('TRAINER_702'), null, f('TRAINER_703')] : undefined } as Trainer);
  records('zones').find((z) => z.id === f('ROOM'))!.sourceIndex = 700;
  const town = records('zones').find((z) => z.id === f('TOWN'))!;
  town.events.objects.push({ ...town.events.objects[0]!, localId: 70, x: 40, z: 15, movementType: 14, trainerType: 1, trainer: { id: f('TRAINER_700'), battler: 0 }, hideFlag: undefined });
  records('zones').push({ ...structuredClone(town), id: f('ORIGINAL_CAVE'), mapType: 'cave', flags: { ...town.flags, escapeRope: true } } as Zone);
  records('matrices').find((m) => m.id === town.matrix)!.sourceIndex = 0;
  for (const name of ['VsSeeker_Text_BatteryIsntChargedEnough', 'VsSeeker_Text_NoTrainersWithinRange', 'VsSeeker_Text_NoTrainersReadyToBattle', 'CommonStrings_Text_NotEvenANibble', 'CommonStrings_Text_ReeledItInTooQuickly', 'CommonStrings_Text_ThePokemonGotAway', 'CommonStrings_Text_LandedAPokemon']) records('texts').push({ id: f(name), text: 'Original fixture notice {var 0}.' });
  const ng = records('newGame')[0]! as NewGame;
  ng.sizeIntervals = Array.from({ length: 16 }, (_, i) => ({ base: 100 + i * 10, divisor: 2, start: i * 4000 }));
  return p;
}
