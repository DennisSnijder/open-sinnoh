/**
 * Party, bag, money and Pokédex commands over the real Pokémon model (contracts 0.9). Each follows
 * its decomp handler (src/scrcmd_party.c, scrcmd_item.c, scrcmd_money.c, scrcmd.c); script operands are
 * native numbers (species, items, moves, natures, types), mapped through the records' `sourceIndex`.
 */
import { addPoketchHistory, BOX_SIZE, canGiveItem, dexOf, giveItem, itemCount, markCaught, markSeen, MONEY_MAX, newGameRecord, takeItem } from '@opensinnoh/contracts';
import { createRandomPokemon, heal, natureIndex, PARTY_SIZE, STATS, type Arg, type Id, type Pokemon } from '@opensinnoh/core';
import { localDexGoal, localSeenCount, nationalCaughtCount, scoreCatch, systemFlag } from '@opensinnoh/services';
import { plainMarkup } from '@opensinnoh/text';
import type { Handler, Runner, Thread } from './runner.ts';

/** pl_msg bank of the Pokédex rating messages (decomp TEXT_BANK_POKEDEX_RATINGS). */
const POKEDEX_RATINGS_BANK = 383;
/** Decomp Pokedex_GetRatingMessageID_Local: seen counts up to which each message is used (the last: complete). */
const LOCAL_RATINGS: [number, string][] = [
  [15, 'RowanPokemonSeenUpTo15'], [30, 'RowanPokemonSeenOver15'], [45, 'RowanPokemonSeenOver30'], [60, 'RowanPokemonSeenOver45'],
  [80, 'RowanPokemonSeenOver60'], [100, 'RowanPokemonSeenOver80'], [120, 'RowanPokemonSeenOver100'], [140, 'RowanPokemonSeenOver120'],
  [160, 'RowanPokemonSeenOver140'], [180, 'RowanPokemonSeenOver160'], [200, 'RowanPokemonSeenOver180'],
];
/** Decomp FIRST_ARRIVAL_ETERNA_CITY's flag (SystemFlag_HandleFirstArrivalToZone; `flags` sourceIndex): Rowan's completion message waits for it. */
const FLAG_FIRST_ARRIVAL_ETERNA_CITY = 2490;
/** Decomp Pokedex_GetRatingMessageID_National: caught counts up to which each message is used (`/` = by player gender), then complete. */
const NATIONAL_RATINGS: [number, string][] = [
  [39, 'OakPokemonCaughtUnder40'], [59, 'OakPokemonCaught40'], [89, 'OakPokemonCaught60'], [119, 'OakPokemonCaught90'], [149, 'OakPokemonCaught120'],
  [189, 'OakPokemonCaught150'], [229, 'OakPokemonCaught190'], [269, 'OakPokemonCaught230'], [309, 'OakPokemonCaught270'], [349, 'OakPokemonCaught310'],
  [379, 'OakPokemonCaught350'], [409, 'OakPokemonCaught380'], [429, 'OakPokemonCaught410_/'], [449, 'OakPokemonCaught430'], [459, 'OakPokemonCaught450'],
  [469, 'OakPokemonCaught460'], [475, 'OakPokemonCaught470'], [481, 'OakPokemonCaught476'], [Infinity, 'OakCompleteNationalDex_/'],
];
/** Decomp ScrCmd_FindPartySlotWithSpecies: no slot. */
const NO_SLOT = 0xff;
/** Decomp HOLD_EFFECT_FRIENDSHIP_UP (Soothe Bell) and ITEM_LUXURY_BALL. */
const FRIENDSHIP_UP = 'FRIENDSHIP_UP';
const LUXURY_BALL = 'ITEM_LUXURY_BALL';

export function partyHandlers(r: Runner): Record<string, Handler> {
  const dest = (t: Thread, a: Arg | undefined, v: number) => r.setVar(t, r.ref(a, 'var'), v);
  const val = (t: Thread, a: Arg | undefined) => r.val(t, a);
  const int = (a: Arg | undefined) => r.int(a);
  const dex = () => dexOf(r.registries);
  const state = () => r.state;
  const party = () => r.state.party;
  const mon = (i: number): Pokemon => {
    const m = r.state.party[i];
    if (!m) throw new Error(`no party member ${i} (party of ${r.state.party.length})`);
    return m;
  };
  const species = (n: number) => r.source('species', n)!;
  const item = (n: number) => r.itemRecord(n).id;
  const native = (registry: 'species' | 'moves' | 'types' | 'items', id: Id | null) => {
    if (!id) return 0;
    const rec = r.registries[registry].get(id);
    if (rec?.sourceIndex === undefined) throw new Error(`${registry} ${id} has no sourceIndex`);
    return rec.sourceIndex;
  };
  const alive = (m: Pokemon) => !m.isEgg && m.hp > 0;
  const regional = (s: Id) => r.registries.species.get(s)?.regionalDex !== undefined;
  const money = (delta: number) => (r.state.money = Math.max(0, Math.min(MONEY_MAX, r.state.money + delta)));
  const ratingText = (name: string) => r.bankIndex(POKEDEX_RATINGS_BANK, `platinum:PokedexRatings_Text_${name}` as Id);

  return {
    // ---------------------------------------------------------------- money (TrainerInfo_GiveMoney / TakeMoney clamp)
    give_money: (_t, _c, a) => (money(int(a[0])), 'continue'),
    remove_money: (_t, _c, a) => (money(-int(a[0])), 'continue'),
    remove_money2: (t, _c, a) => (money(-val(t, a[0])), 'continue'),
    check_money: (t, _c, a) => (dest(t, a[0], state().money >= int(a[1]) ? 1 : 0), 'continue'),
    check_money2: (t, _c, a) => (dest(t, a[0], state().money >= val(t, a[1]) ? 1 : 0), 'continue'),

    // ---------------------------------------------------------------- bag
    add_item: (t, _c, a) => (dest(t, a[2], giveItem(state(), r.registries, item(val(t, a[0])), val(t, a[1])) ? 1 : 0), 'continue'),
    remove_item: (t, _c, a) => (dest(t, a[2], takeItem(state(), item(val(t, a[0])), val(t, a[1])) ? 1 : 0), 'continue'),
    can_fit_item: (t, _c, a) => (dest(t, a[2], canGiveItem(state(), r.registries, item(val(t, a[0])), val(t, a[1])) ? 1 : 0), 'continue'),
    check_item: (t, _c, a) => (dest(t, a[2], itemCount(state(), item(val(t, a[0]))) >= val(t, a[1]) ? 1 : 0), 'continue'),
    get_item_quantity: (t, _c, a) => (dest(t, a[1], itemCount(state(), item(val(t, a[0])))), 'continue'),
    is_item_tmhm: (t, _c, a) => (dest(t, a[1], r.itemRecord(val(t, a[0])).tm ? 1 : 0), 'continue'),
    check_pocket_has_items: (t, _c, a) => {
      const pocket = newGameRecord(r.registries).pockets[val(t, a[0])];
      if (!pocket) throw new Error(`check_pocket_has_items: no pocket ${val(t, a[0])}`);
      dest(t, a[1], (state().bag[pocket.name]?.length ?? 0) > 0 ? 1 : 0);
      return 'continue';
    },
    buffer_tmhm_move_name: (t, _c, a) => {
      const tm = r.itemRecord(val(t, a[1])).tm;
      if (!tm) throw new Error(`buffer_tmhm_move_name: item ${val(t, a[1])} is not a TM/HM`);
      t.slots[int(a[0])] = plainMarkup(r.registries.moves.get(tm)!.name);
      return 'continue';
    },

    // ---------------------------------------------------------------- party
    give_pokemon: (t, _c, a) => {
      // Decomp Pokemon_GiveMonFromScript: random PID and IVs, the player as OT, a Poké Ball, the map as met location; party only.
      const ok = party().length < PARTY_SIZE;
      if (ok) {
        const s = species(val(t, a[0]));
        const held = val(t, a[2]);
        const m = createRandomPokemon(dex(), r.rngSource(), {
          species: s,
          level: val(t, a[1]),
          trainer: { otId: state().trainerId, otName: state().names.player, otGender: state().gender },
          ball: newGameRecord(r.registries).pokeBall,
          met: { zone: state().player.zone, level: val(t, a[1]), date: null },
          heldItem: held ? item(held) : null,
        });
        party().push(m);
        // Decomp Pokemon_GiveMonFromScript → SaveData_UpdateCatchRecords: the first catch of a species scores, the Pokédex, the Pokétch history.
        scoreCatch(state(), r.registries, m.species);
        markCaught(state(), r.registries, m);
        addPoketchHistory(state(), m);
      }
      dest(t, a[3], ok ? 1 : 0);
      return 'continue';
    },
    heal_party: () => {
      for (const m of party()) heal(dex(), m);
      return 'continue';
    },
    check_has_two_alive_mons: (t, _c, a) => (dest(t, a[0], party().filter(alive).length >= 2 ? 1 : 0), 'continue'),
    count_party_non_eggs: (t, _c, a) => (dest(t, a[0], party().filter((m) => !m.isEgg).length), 'continue'),
    count_party_eggs: (t, _c, a) => (dest(t, a[0], party().filter((m) => m.isEgg).length), 'continue'),
    count_alive_mons_except: (t, _c, a) => {
      const skip = val(t, a[1]);
      dest(t, a[0], party().filter((m, i) => i !== skip && alive(m)).length);
      return 'continue';
    },
    count_alive_mons_and_box_mons: (t, _c, a) => {
      const boxed = state().boxes.reduce((n, b) => n + b.slots.filter((m) => m && !m.isEgg).length, 0);
      dest(t, a[0], party().filter(alive).length + boxed);
      return 'continue';
    },
    get_first_non_egg_in_party: (t, _c, a) => (dest(t, a[0], Math.max(0, party().findIndex((m) => !m.isEgg))), 'continue'),
    get_party_mon_species: (t, _c, a) => {
      const m = mon(r.getVar(t, r.ref(a[0], 'var')));
      dest(t, a[1], m.isEgg ? 0 : native('species', m.species));
      return 'continue';
    },
    get_party_mon_level: (t, _c, a) => {
      const m = mon(val(t, a[1]));
      dest(t, a[0], m.isEgg ? 0 : m.level);
      return 'continue';
    },
    get_party_mon_form: (t, _c, a) => (dest(t, a[1], mon(val(t, a[0])).form), 'continue'),
    get_party_mon_form2: (t, _c, a) => (dest(t, a[1], mon(val(t, a[0])).form), 'continue'),
    get_party_mon_friendship: (t, _c, a) => (dest(t, a[0], mon(val(t, a[1])).friendship), 'continue'),
    increase_party_mon_friendship: (t, _c, a) => {
      // Decomp ScrCmd_IncreasePartyMonFriendship: Soothe Bell ×1.5, +1 in a Luxury Ball (the met-here bonus needs egg locations: not modelled).
      let v = val(t, a[0]);
      const m = mon(val(t, a[1]));
      if (v > 0) {
        if (dex().holdEffect(m.heldItem).holdEffect === FRIENDSHIP_UP) v = Math.floor((v * 150) / 100);
        if (m.ball.endsWith(`:${LUXURY_BALL}`)) v++;
      }
      m.friendship = Math.min(255, m.friendship + v);
      return 'continue';
    },
    decrease_party_mon_friendship_unused: (t, _c, a) => {
      const m = mon(val(t, a[1]));
      m.friendship = Math.max(0, m.friendship - val(t, a[0]));
      return 'continue';
    },
    get_party_mon_nature: (t, _c, a) => (dest(t, a[0], natureIndex(dex(), mon(val(t, a[1])).pid)), 'continue'),
    find_party_slot_with_nature: (t, _c, a) => {
      const n = val(t, a[1]);
      const i = party().findIndex((m) => !m.isEgg && natureIndex(dex(), m.pid) === n);
      dest(t, a[0], i < 0 ? NO_SLOT : i);
      return 'continue';
    },
    get_party_mon_type: (t, _c, a) => {
      const m = mon(val(t, a[2]));
      const [t1, t2] = dex().form(m.species, m.form).types;
      dest(t, a[0], native('types', t1));
      dest(t, a[1], native('types', t2));
      return 'continue';
    },
    get_party_mon_move_count: (t, _c, a) => {
      const m = mon(val(t, a[1]));
      dest(t, a[0], m.isEgg ? 0 : m.moves.length);
      return 'continue';
    },
    get_party_mon_move: (t, _c, a) => (dest(t, a[0], native('moves', mon(val(t, a[1])).moves[val(t, a[2])] ?? null)), 'continue'),
    check_party_mon_has_move: (t, _c, a) => {
      const m = mon(val(t, a[2]));
      const move = val(t, a[1]);
      dest(t, a[0], !m.isEgg && m.moves.some((x) => native('moves', x) === move) ? 1 : 0);
      return 'continue';
    },
    get_party_mon_ev_total: (t, _c, a) => {
      const m = mon(val(t, a[1]));
      dest(t, a[0], STATS.reduce((n, s) => n + m.evs[s], 0));
      return 'continue';
    },
    get_party_mon_held_item_unused: (t, _c, a) => (dest(t, a[0], native('items', mon(val(t, a[1])).heldItem)), 'continue'),
    delete_party_mon_held_item_unused: (t, _c, a) => ((mon(val(t, a[0])).heldItem = null), 'continue'),
    check_party_has_species: (t, _c, a) => {
      const s = species(val(t, a[1]));
      dest(t, a[0], party().some((m) => !m.isEgg && m.species === s) ? 1 : 0);
      return 'continue';
    },
    check_party_has_species2: (t, _c, a) => {
      const s = species(val(t, a[0]));
      dest(t, a[1], party().some((m) => !m.isEgg && m.species === s) ? 1 : 0);
      return 'continue';
    },
    find_party_slot_with_species: (t, _c, a) => {
      const s = species(val(t, a[1]));
      const i = party().findIndex((m) => !m.isEgg && m.species === s);
      dest(t, a[0], i < 0 ? NO_SLOT : i);
      return 'continue';
    },
    count_repeated_species_in_party: (t, _c, a) => {
      // Decomp: species 0 = "does any species appear twice?" (1/0); else how many of that species.
      const n = val(t, a[1]);
      const list = party().filter((m) => !m.isEgg).map((m) => m.species);
      dest(t, a[0], n === 0 ? (new Set(list).size < list.length ? 1 : 0) : list.filter((s) => s === species(n)).length);
      return 'continue';
    },
    count_party_mons_below_level_threshold: (t, _c, a) => {
      const limit = val(t, a[1]);
      dest(t, a[0], party().filter((m) => !m.isEgg && m.level <= limit).length);
      return 'continue';
    },
    check_party_has_held_item: (t, _c, a) => {
      const it = item(val(t, a[0]));
      dest(t, a[1], party().some((m) => m.heldItem === it) ? 1 : 0);
      return 'continue';
    },
    check_party_pokerus: (t, _c, a) => (dest(t, a[0], party().some((m) => m.pokerus) ? 1 : 0), 'continue'),
    check_is_party_mon_outsider: (t, _c, a) => {
      // Decomp ScrCmd_CheckIsPartyMonOutsider compares the low 16 bits (trainer ids).
      const m = mon(r.getVar(t, r.ref(a[0], 'var')));
      dest(t, a[1], (m.otId & 0xffff) === (state().trainerId & 0xffff) ? 0 : 1);
      return 'continue';
    },
    get_pc_boxes_free_slot_count: (t, _c, a) => {
      const used = state().boxes.reduce((n, b) => n + b.slots.filter((m) => m).length, 0);
      dest(t, a[0], state().boxes.length * BOX_SIZE - used);
      return 'continue';
    },

    // ---------------------------------------------------------------- Pokédex
    // Decomp FieldSystem_WriteSpeciesSeen encounters a random level-50 Pokémon: its form and gender are not recorded here.
    set_species_seen: (t, _c, a) => (markSeen(state(), species(val(t, a[0])), null), 'continue'),
    check_has_seen_species: (t, _c, a) => (dest(t, a[1], state().pokedex.seen.includes(species(val(t, a[0]))) ? 1 : 0), 'continue'),
    get_local_dex_seen_count: (t, _c, a) => (dest(t, a[0], state().pokedex.seen.filter(regional).length), 'continue'),
    get_local_dex_caught_count_unused: (t, _c, a) => (dest(t, a[0], state().pokedex.caught.filter(regional).length), 'continue'),
    get_national_dex_seen_count: (t, _c, a) => (dest(t, a[0], state().pokedex.seen.length), 'continue'),
    get_national_dex_caught_count: (t, _c, a) => (dest(t, a[0], state().pokedex.caught.length), 'continue'),
    load_pokedex_rating: (t, _c, a) => {
      // Decomp ScrCmd_LoadPokedexRating: Rowan rates the Sinnoh seen count (complete: by whether Eterna City
      // was reached), Oak the national caught count without the mythicals (some messages by the player's gender).
      let name: string;
      if (int(a[0]) === 0) {
        const seen = localSeenCount(state(), r.registries);
        const hit = LOCAL_RATINGS.find(([max]) => seen <= max);
        if (hit) name = hit[1];
        else if (seen <= localDexGoal(r.registries) - 1) name = 'RowanPokemonSeenOver200';
        else name = systemFlag(state(), r.registries, FLAG_FIRST_ARRIVAL_ETERNA_CITY) ? 'RowanCompleteLocalDex' : 'RowanCompleteLocalDex_TooEarly';
      } else {
        const caught = nationalCaughtCount(state(), r.registries);
        name = NATIONAL_RATINGS.find(([max]) => caught <= max)![1].replace('/', state().gender === 'female' ? 'Female' : 'Male');
      }
      dest(t, a[1], ratingText(name));
      return 'continue';
    },
  };
}
