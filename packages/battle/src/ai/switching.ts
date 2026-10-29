/**
 * The switch AI (decomp trainer_ai.c TrainerAI_ShouldSwitch and its AI_* checks) and the post-KO switch-in
 * (battle_lib.c BattleAI_PostKOSwitchIn). The RNG is drawn exactly where the DS's `&&` reaches it.
 */
import { ABILITY, BATTLE_TYPE, BATTLER_NONE, DEFAULT_STAT_STAGE, MON_CONDITION, MOVE_EFFECT, MOVE_STATUS, MOVE_STATUS_IMMUNE, NO_SLOT, TYPE, VOLATILE_CONDITION_TRAPPED } from './constants.ts';
import { aiMoveType, battlerAbility, battlerHeldItem, countAbility, partnerOf, partyMoveType, type Calc } from './calc.ts';
import { hasSuperEffectiveMove, usable } from './script.ts';
import type { AiPartyMon } from './view.ts';

/** BattleSystem_RandomOpponent: in doubles a random living opponent (one draw), else the one across. */
export function randomOpponent(c: Calc, attacker: number): number {
  if (!(c.view.battleType & BATTLE_TYPE.DOUBLES)) return attacker ^ 1;
  // GetEnemyInSlot RIGHT then LEFT: the opponents' slot-2 battler, then their slot-1 battler.
  const opponents = [(attacker ^ 1) | 2, (attacker ^ 1) & 1];
  const r = c.rng.next() & 1;
  const chosen = opponents[r]!;
  return c.view.battler(chosen).hp === 0 ? opponents[r ^ 1]! : chosen;
}

/** The two battlers whose party slots are taken (aiSlot1/aiSlot2): with a partner of another trainer only one. */
function aiSlots(c: Calc, battler: number): [number, number] {
  const t = c.view.battleType;
  return t & BATTLE_TYPE.TAG || t & BATTLE_TYPE.TWO_VS_TWO ? [battler, battler] : [battler, partnerOf(c.view, battler)];
}

/** Bench Pokémon the battler may switch to: usable, not in the field, not already picked this turn. */
function bench(c: Calc, battler: number): [number, AiPartyMon][] {
  const [s1, s2] = aiSlots(c, battler);
  const v = c.view;
  const taken = [v.selectedPartySlot(s1), v.selectedPartySlot(s2), v.memory.switchedSlot[s1], v.memory.switchedSlot[s2]];
  return v.party(battler).flatMap((m, i): [number, AiPartyMon][] => (usable(m) && !taken.includes(i) ? [[i, m]] : []));
}

const holdEffectOf = (c: Calc, battler: number): number => c.dex.item(battlerHeldItem(c.view, battler)).holdEffect;

/** BattleSystem_CalcEffectiveness of a party Pokémon's move on a battler. */
function partyEffectiveness(c: Calc, mon: AiPartyMon, move: number, defender: number): number {
  const d = c.view.battler(defender);
  return c.view.calcEffectiveness(move, partyMoveType(c, mon, move), mon.ability, battlerAbility(c.view, defender), holdEffectOf(c, defender), d.types[0], d.types[1]);
}

function pick(c: Calc, battler: number, slot: number): true {
  c.view.memory.switchedSlot[battler] = slot;
  return true;
}

/** AI_PerishSongKO (never true on the DS: the count is checked before it drops to 0). */
function perishSongKO(c: Calc, battler: number): boolean {
  const b = c.view.battler(battler);
  return b.moveEffects & MOVE_EFFECT.PERISH_SONG && b.perishSongTurns === 0 ? pick(c, battler, NO_SLOT) : false;
}

/** AI_CannotDamageWonderGuard (singles). */
function cannotDamageWonderGuard(c: Calc, battler: number): boolean {
  const v = c.view;
  if (v.battleType & BATTLE_TYPE.DOUBLES) return false;
  const opp = battler ^ 1;
  if (v.battler(opp).ability !== ABILITY.WONDER_GUARD) return false;
  for (const move of v.battler(battler).moves) {
    if (move && v.applyTypeChart(move, aiMoveType(c, battler, move), battler, opp, 0, false).flags & MOVE_STATUS.SUPER_EFFECTIVE) return false;
  }
  const own = v.selectedPartySlot(battler);
  const party = v.party(battler);
  for (let i = 0; i < party.length; i++) {
    const m = party[i]!;
    if (!usable(m) || i === own) continue;
    for (const move of m.moves) {
      if (move && partyEffectiveness(c, m, move, opp) & MOVE_STATUS.SUPER_EFFECTIVE && c.rng.next() % 3 < 2) return pick(c, battler, i);
    }
  }
  return false;
}

/** AI_OnlyIneffectiveMoves: every damaging move fails on the foes; switch to a bench Pokémon that hits them. */
function onlyIneffectiveMoves(c: Calc, battler: number): boolean {
  const v = c.view;
  // decomp BATTLER_PLAYER_1/2: the player's side, whichever side the AI is on.
  const defenders = v.battleType & BATTLE_TYPE.DOUBLES ? [0, 2] : [0, 0];
  let damaging = 0;
  for (const move of v.battler(battler).moves) {
    if (!move || !c.dex.move(move).power) continue;
    damaging++;
    for (const d of defenders) {
      const flags = v.battler(d).hp ? v.applyTypeChart(move, aiMoveType(c, battler, move), battler, d, 0, false).flags : 0;
      if (!(flags & MOVE_STATUS.INEFFECTIVE)) return false;
    }
  }
  if (damaging < 2) return false;
  const candidates = bench(c, battler);
  const effectiveness = (m: AiPartyMon, move: number, d: number) => (v.battler(d).hp ? partyEffectiveness(c, m, move, d) : 0);
  for (const [i, m] of candidates) {
    for (const move of m.moves) {
      if (!move || !c.dex.move(move).power) continue;
      for (const d of defenders) if (effectiveness(m, move, d) & MOVE_STATUS.SUPER_EFFECTIVE && c.rng.next() % 3 < 2) return pick(c, battler, i);
    }
  }
  for (const [i, m] of candidates) {
    for (const move of m.moves) {
      if (!move || !c.dex.move(move).power) continue;
      for (const d of defenders) if (effectiveness(m, move, d) === 0 && c.rng.next() % 2 === 0) return pick(c, battler, i);
    }
  }
  return false;
}

/** AI_HasAbsorbAbilityInParty: a bench Pokémon absorbs the type of the last move that hit us. */
function absorbAbilityInParty(c: Calc, battler: number): boolean {
  const v = c.view;
  if (hasSuperEffectiveMove(c, battler, true) && c.rng.next() % 3 !== 0) return false;
  const hit = v.lastHitBy(battler).move;
  if (!hit || !c.dex.move(hit).power) return false;
  const type = c.dex.move(hit).type;
  const absorb = type === TYPE.FIRE ? ABILITY.FLASH_FIRE : type === TYPE.WATER ? ABILITY.WATER_ABSORB : type === TYPE.ELECTRIC ? ABILITY.VOLT_ABSORB : 0;
  if (!absorb || battlerAbility(v, battler) === absorb) return false;
  for (const [i, m] of bench(c, battler)) if (m.ability === absorb && c.rng.next() & 1) return pick(c, battler, i);
  return false;
}

/**
 * AI_HasPartyMemberWithSuperEffectiveMove: a bench Pokémon that takes the last hit with `checkEffectiveness`
 * (MOVE_STATUS_* bits) and has a move super effective on its user; taken when rand % `odds` is 0.
 */
function partyMemberWithSuperEffectiveMove(c: Calc, battler: number, checkEffectiveness: number, odds: number): boolean {
  const v = c.view;
  const { move: hit, battler: hitter } = v.lastHitBy(battler);
  if (!hit || hitter === BATTLER_NONE || !c.dex.move(hit).power) return false;
  const h = v.battler(hitter);
  for (const [i, m] of bench(c, battler)) {
    const taken = v.calcEffectiveness(hit, aiMoveType(c, hitter, hit), battlerAbility(v, hitter), m.ability, c.dex.item(m.heldItem).holdEffect, m.types[0], m.types[1]);
    if (!(taken & checkEffectiveness)) continue;
    for (const move of m.moves) {
      if (!move) continue;
      const eff = v.calcEffectiveness(move, partyMoveType(c, m, move), m.ability, battlerAbility(v, hitter), holdEffectOf(c, hitter), h.types[0], h.types[1]);
      if (eff & MOVE_STATUS.SUPER_EFFECTIVE && c.rng.next() % odds === 0) return pick(c, battler, i);
    }
  }
  return false;
}

/** AI_IsAsleepWithNaturalCure. */
function asleepWithNaturalCure(c: Calc, battler: number): boolean {
  const v = c.view;
  const b = v.battler(battler);
  if (!(b.status & MON_CONDITION.SLEEP) || battlerAbility(v, battler) !== ABILITY.NATURAL_CURE || b.hp < Math.trunc(b.maxHp / 2)) return false;
  const hit = v.lastHitBy(battler).move;
  if (hit === 0 && c.rng.next() & 1) return pick(c, battler, NO_SLOT);
  if (c.dex.move(hit).power === 0 && c.rng.next() & 1) return pick(c, battler, NO_SLOT);
  if (partyMemberWithSuperEffectiveMove(c, battler, MOVE_STATUS.INEFFECTIVE, 1)) return true;
  if (partyMemberWithSuperEffectiveMove(c, battler, MOVE_STATUS.NOT_VERY_EFFECTIVE, 1)) return true;
  return c.rng.next() & 1 ? pick(c, battler, NO_SLOT) : false;
}

/** AI_IsHeavilyStatBoosted: 4 or more positive stages in total. */
function heavilyStatBoosted(c: Calc, battler: number): boolean {
  const sum = c.view.battler(battler).statStages.reduce((n, s) => (s > DEFAULT_STAT_STAGE ? n + s - DEFAULT_STAT_STAGE : n), 0);
  return (sum & 0xff) >= 4;
}

/** TrainerAI_ShouldSwitch. On true, memory.switchedSlot[battler] holds the slot (6 = use the post-KO choice). */
export function shouldSwitch(c: Calc, battler: number): boolean {
  const v = c.view;
  const b = v.battler(battler);
  // The DS's own (naive) trap check: no Shed Shell, no Flying vs Arena Trap, Magnet Pull counted from anyone.
  if (
    b.volatile & VOLATILE_CONDITION_TRAPPED ||
    b.moveEffects & MOVE_EFFECT.INGRAIN ||
    countAbility(v, 'their-side', battler, ABILITY.SHADOW_TAG) ||
    countAbility(v, 'their-side', battler, ABILITY.ARENA_TRAP) ||
    (countAbility(v, 'all-except-me', battler, ABILITY.MAGNET_PULL) && (b.types[0] === TYPE.STEEL || b.types[1] === TYPE.STEEL))
  )
    return false;
  if (!bench(c, battler).length) return false;
  if (perishSongKO(c, battler)) return true;
  if (cannotDamageWonderGuard(c, battler)) return true;
  if (onlyIneffectiveMoves(c, battler)) return true;
  if (absorbAbilityInParty(c, battler)) return true;
  if (asleepWithNaturalCure(c, battler)) return true;
  if (hasSuperEffectiveMove(c, battler, false)) return false;
  if (heavilyStatBoosted(c, battler)) return false;
  if (partyMemberWithSuperEffectiveMove(c, battler, MOVE_STATUS.INEFFECTIVE, 2)) return true;
  if (partyMemberWithSuperEffectiveMove(c, battler, MOVE_STATUS.NOT_VERY_EFFECTIVE, 3)) return true;
  return false;
}

/**
 * BattleAI_PostKOSwitchIn: the bench Pokémon to send out after `battler` fainted, or 6 for none.
 * Stage 1: the best offensive type matchup against a random opponent that also has a super-effective move.
 * Stage 2: the most damage the fainted battler would deal with each bench Pokémon's moves.
 * Scores are u8 (the decomp's documented overflow: two ×4 matchups wrap to 64) and stage 2 compares the
 * last score again after an empty or power-1 move slot.
 */
export function postKOSwitchIn(c: Calc, battler: number): number {
  const v = c.view;
  const [s1, s2] = aiSlots(c, battler);
  const defender = randomOpponent(c, battler);
  const party = v.party(battler);
  const d = v.battler(defender);
  const valid = (m: AiPartyMon, i: number) =>
    usable(m) && v.selectedPartySlot(s1) !== i && v.selectedPartySlot(s2) !== i && i !== v.memory.switchedSlot[s1] && i !== v.memory.switchedSlot[s2];
  let disregarded = 0;
  let score = 0;
  while (disregarded !== 0x3f) {
    let maxScore = 0;
    let picked = NO_SLOT;
    party.forEach((m, i) => {
      if (valid(m, i) && !(disregarded & (1 << i))) {
        score = v.typeMatchup(m.types[0], d.types[0], d.types[1]) & 0xff;
        score = (score + v.typeMatchup(m.types[1], d.types[0], d.types[1])) & 0xff;
        if (maxScore < score) {
          maxScore = score;
          picked = i;
        }
      } else disregarded |= 1 << i;
    });
    if (picked === NO_SLOT) break;
    const m = party[picked]!;
    if (m.moves.some((move) => move && partyEffectiveness(c, m, move, defender) & MOVE_STATUS.SUPER_EFFECTIVE)) return picked;
    disregarded |= 1 << picked;
  }
  let maxScore = 0;
  let picked = NO_SLOT;
  party.forEach((m, i) => {
    if (!valid(m, i)) return;
    for (const move of m.moves) {
      if (move && c.dex.move(move).power !== 1) {
        score = v.calcMoveDamage(move, battler, defender, 0, 0) & 0xff;
        const r = v.applyTypeChart(move, partyMoveType(c, m, move), battler, defender, score, false);
        score = r.flags & MOVE_STATUS_IMMUNE ? 0 : r.damage & 0xff;
      }
      if (maxScore < score) {
        maxScore = score;
        picked = i;
      }
    }
  });
  return picked;
}

/**
 * The first Pokémon with HP that is not in the field: the DS's fallback when the post-KO choice finds none.
 * TrainerAI_PickCommand skips the slots already picked this turn (`skipPicked`); the party menu after a KO
 * skips the partner's Pokémon, which the controller holds as its pick while the DS has it in the field.
 * Returns the party size when there is none.
 */
export function firstAlive(c: Calc, battler: number, skipPicked: boolean): number {
  const v = c.view;
  const [s1, s2] = aiSlots(c, battler);
  const skip = [v.selectedPartySlot(s1), v.selectedPartySlot(s2), ...(skipPicked ? [v.memory.switchedSlot[s1], v.memory.switchedSlot[s2]] : [])];
  const party = v.party(battler);
  const i = party.findIndex((m, k) => m.hp !== 0 && !skip.includes(k));
  return i < 0 ? party.length : i;
}
