/**
 * Medicine on a party Pokémon in battle (decomp BattleSystem_UseBagItem's party part, with the battle
 * party's message choice, battle_party_text.c BattlePartyText_PrintUseItemEffect): status cures, HP
 * restore, revive, PP restore of every move or of the move in `moveSlot` (Ether, Leppa Berry). The
 * battle-only parts (confusion, infatuation, stat stages, Guard Spec.) are the battle's.
 */
import type { Dex, Pokemon, StatusCondition } from './pokemon.ts';
import { maxPp } from './pokemon.ts';

/** The party-use data of an item (contracts `ItemPartyUse`). */
export interface PartyItemUse {
  flags: readonly string[];
  hp: number;
  pp: number;
}

/** What the battle party prints (BattleParty_Text_Item*): revived, HP restored (by `amount`), PP, one status cured, or several. */
export type MedicineMessage = 'revived' | 'restored' | 'pp' | 'sleep' | 'poison' | 'burn' | 'freeze' | 'paralysis' | 'confusion' | 'attract' | 'multiple';

export interface MedicineEffect {
  hp: number;
  status: StatusCondition;
  pp: number[];
  message: MedicineMessage;
  /** HP restored (for 'restored'). */
  amount: number;
}

const CURES: [flag: string, cures: StatusCondition[], message: MedicineMessage][] = [
  ['healSleep', ['sleep'], 'sleep'],
  ['healPoison', ['poison', 'toxic'], 'poison'],
  ['healBurn', ['burn'], 'burn'],
  ['healFreeze', ['freeze'], 'freeze'],
  ['healParalysis', ['paralysis'], 'paralysis'],
  ['healConfusion', [], 'confusion'],
  ['healAttract', [], 'attract'],
];

/** decomp HEAL_FULL_HP / HEAL_HALF_HP / HEAL_QUARTER_HP and HEAL_FULL_PP. */
const FULL = 255;
const HALF = 254;
const QUARTER = 253;
const FULL_PP = 127;

/** The effect of `use` on `mon` (not applied), or null when it would do nothing ("It won't have any effect."). */
export function medicineEffect(dex: Dex, mon: Pokemon, use: PartyItemUse, moveSlot?: number): MedicineEffect | null {
  if (mon.isEgg) return null;
  const has = (f: string) => use.flags.includes(f);
  let changed = false;
  let status = mon.status;
  for (const [flag, cures] of CURES) {
    if (has(flag) && cures.includes(status)) {
      status = 'none';
      changed = true;
    }
  }
  let hp = mon.hp;
  const max = mon.stats.hp;
  const revive = has('revive');
  if (has('hpRestore') && (revive ? hp === 0 : hp > 0) && hp < max) {
    const amount = use.hp === FULL ? max : use.hp === HALF ? Math.max(1, Math.floor(max / 2)) : use.hp === QUARTER ? Math.max(1, Math.floor((max * 25) / 100)) : use.hp;
    hp = Math.min(max, hp + amount);
    changed = true;
  }
  const pp = [...mon.pp];
  if (has('ppRestoreAll')) {
    mon.moves.forEach((move, i) => {
      const top = maxPp(dex.move(move).pp, mon.ppUps[i] ?? 0);
      if (pp[i]! < top) {
        pp[i] = use.pp === FULL_PP ? top : Math.min(top, pp[i]! + use.pp);
        changed = true;
      }
    });
  }
  if (has('ppRestore')) {
    const move = moveSlot === undefined ? undefined : mon.moves[moveSlot];
    if (!move) throw new Error(`medicine: a one-move PP item needs the move slot (got ${moveSlot})`);
    const top = maxPp(dex.move(move).pp, mon.ppUps[moveSlot!] ?? 0);
    if (pp[moveSlot!]! < top) {
      pp[moveSlot!] = use.pp === FULL_PP ? top : Math.min(top, pp[moveSlot!]! + use.pp);
      changed = true;
    }
  }
  if (!changed) return null;
  const cured = CURES.filter(([flag]) => has(flag));
  const message: MedicineMessage =
    mon.hp === 0 && hp > 0 ? 'revived' : hp !== mon.hp ? 'restored' : has('ppRestoreAll') || has('ppRestore') ? 'pp' : cured.length === 1 ? cured[0]![2] : 'multiple';
  return { hp, status, pp, message, amount: hp - mon.hp };
}
