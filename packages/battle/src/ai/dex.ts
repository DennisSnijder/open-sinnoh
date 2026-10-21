import type { AiScript, Registries } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';

/** decomp MoveTable fields the AI reads, as decomp numbers. */
export interface AiMove {
  type: number;
  power: number;
  effect: number;
  /** CLASS_PHYSICAL 0, CLASS_SPECIAL 1, CLASS_STATUS 2. */
  class: number;
  /** Decomp RANGE_* name without the prefix. */
  range: string;
}

/** decomp ItemData fields the AI reads. */
export interface AiItem {
  holdEffect: number;
  /** The hold effect's decomp name without the prefix. */
  holdEffectName: string;
  naturalGiftPower: number;
  naturalGiftType: number;
  flingPower: number;
  /** ItemPartyParam: bit flags by name, stat stages, the HP restored (raw, 255 = all). */
  partyFlags: ReadonlySet<string>;
  stages: Readonly<Record<string, number>>;
  hpRestored: number;
}

/** The pack data the AI reads, by decomp number (`sourceIndex`), plus the AI script. */
export interface AiDex {
  readonly script: AiScript;
  move(move: number): AiMove;
  item(item: number): AiItem;
  /** SPECIES_DATA_ABILITY_1 and _2 (0 = none). */
  speciesAbilities(species: number): [number, number];
  /** An item id's decomp number (trainer items). */
  itemNumber(item: Id): number;
}

const CLASSES = { physical: 0, special: 1, status: 2 } as const;
const NO_MOVE: AiMove = { type: 0, power: 0, effect: 0, class: 0, range: 'SINGLE_TARGET' };
/** decomp ITEM_NONE (item 0): no hold effect; packs need not carry a record for it. */
const NO_ITEM: AiItem = { holdEffect: 0, holdEffectName: 'NONE', naturalGiftPower: 0, naturalGiftType: 0, flingPower: 0, partyFlags: new Set(), stages: {}, hpRestored: 0 };

function bySourceIndex<T extends { id: Id; sourceIndex?: number }>(what: string, records: ReadonlyMap<Id, T>): Map<number, T> {
  const out = new Map<number, T>();
  for (const r of records.values()) if (r.sourceIndex !== undefined) out.set(r.sourceIndex, r);
  if (!out.size) throw new Error(`trainer AI: no ${what} with a sourceIndex`);
  return out;
}

/** Index the registries for the AI. Data gaps throw when read: the AI needs decomp numbers for everything. */
export function createAiDex(registries: Registries): AiDex {
  const scripts = [...registries.aiScripts.values()];
  if (scripts.length !== 1) throw new Error(`trainer AI: expected one aiScripts record, found ${scripts.length}`);
  const script = scripts[0]!;
  const number = (what: string, map: ReadonlyMap<Id, { sourceIndex?: number }>, id: Id | null): number => {
    if (id === null) return 0;
    const n = map.get(id)?.sourceIndex;
    if (n === undefined) throw new Error(`trainer AI: ${what} ${id} has no decomp number`);
    return n;
  };
  const effects = new Map(script.battleEffects.map((e, i) => [e, i]));
  const holdEffects = new Map(script.holdEffects.map((e, i) => [e, i]));
  const moves = bySourceIndex('moves', registries.moves);
  const items = bySourceIndex('items', registries.items);
  const species = bySourceIndex('species', registries.species);
  const moveCache = new Map<number, AiMove>();
  const itemCache = new Map<number, AiItem>();
  return {
    script,
    move(n) {
      if (n === 0) return NO_MOVE;
      let m = moveCache.get(n);
      if (!m) {
        const r = moves.get(n);
        if (!r) throw new Error(`trainer AI: no move ${n}`);
        const effect = effects.get(r.effect);
        if (effect === undefined) throw new Error(`trainer AI: move ${r.id} effect ${r.effect} is not a decomp battle effect`);
        m = { type: number('type', registries.types, r.type), power: r.power, effect, class: CLASSES[r.category], range: r.target };
        moveCache.set(n, m);
      }
      return m;
    },
    item(n) {
      if (n === 0) return NO_ITEM;
      let it = itemCache.get(n);
      if (!it) {
        const r = items.get(n);
        if (!r) throw new Error(`trainer AI: no item ${n}`);
        const holdEffect = holdEffects.get(r.holdEffect);
        if (holdEffect === undefined) throw new Error(`trainer AI: item ${r.id} hold effect ${r.holdEffect} is not a decomp hold effect`);
        it = {
          holdEffect,
          holdEffectName: r.holdEffect,
          naturalGiftPower: r.naturalGift?.power ?? 0,
          naturalGiftType: r.naturalGift ? number('type', registries.types, r.naturalGift.type) : 0,
          flingPower: r.fling.power,
          partyFlags: new Set(r.partyUse?.flags ?? []),
          stages: r.partyUse?.stages ?? {},
          hpRestored: r.partyUse?.hp ?? 0,
        };
        itemCache.set(n, it);
      }
      return it;
    },
    speciesAbilities(n) {
      const s = species.get(n);
      if (!s) throw new Error(`trainer AI: no species ${n}`);
      return [number('ability', registries.abilities, s.abilities[0]), number('ability', registries.abilities, s.abilities[1])];
    },
    itemNumber: (id) => number('item', registries.items, id),
  };
}
