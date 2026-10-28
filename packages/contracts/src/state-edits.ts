/**
 * Shared state edits over the registries (contracts 0.9): the bag by item record, the Pokédex sets, the
 * model's `Dex`, and the deterministic Pokémon of replay setup lines and save migrations. The VM, the
 * game and the app use these, so they agree on the rules.
 */
import { addItem, bagCount, canAddItem, createPokemon, dayPeriod, Dex, ENGLISH, GERMAN, heal, isNight, monGender, PARTY_SIZE, Prng, randomIvs, randomPid, removeItem, type BagPocket, type ClockTime, type EvolutionTrigger, type Id, type Pokemon, type Stats } from '@opensinnoh/core';
import type { NewGame } from './records.ts';
import type { Registries } from './runtime.ts';
import { HALL_OF_FAME_ENTRIES, HALL_OF_FAME_TOTAL_MAX, ROAMING_SLOTS, SIGNATURE_HEIGHT, SIGNATURE_WIDTH, type GameState, type HallOfFameMon, type MysteryGiftId, type RoamerState, type SeenForm } from './state.ts';

const dexes = new WeakMap<Registries, Dex>();

/** The model's view of the registries (one per registries object). */
export function dexOf(registries: Registries): Dex {
  let d = dexes.get(registries);
  if (!d) dexes.set(registries, (d = new Dex(registries)));
  return d;
}

/** A new game's roamers (decomp SpecialEncounter after SaveData_Init: none active, every route index 0). */
export function newRoamerState(): RoamerState {
  return { slots: Array.from({ length: ROAMING_SLOTS }, () => null), routes: Array.from({ length: ROAMING_SLOTS }, () => 0), current: null, previous: null };
}

/**
 * Decomp HallOfFame_AddEntry (0.27.19): the party without its Eggs, in order, dated `date`; nothing once
 * `total` reached HALL_OF_FAME_TOTAL_MAX. Only the last HALL_OF_FAME_ENTRIES stay.
 */
export function addHallOfFameEntry(state: GameState, date: string): void {
  const hof = state.hallOfFame;
  if (hof.total >= HALL_OF_FAME_TOTAL_MAX) return;
  const party = state.party.filter((m) => !m.isEgg).map((m): HallOfFameMon => ({ species: m.species, form: m.form, level: m.level, pid: m.pid, otId: m.otId, nickname: m.nickname, otName: m.otName, moves: [...m.moves] }));
  hof.entries.push({ date, party });
  if (hof.entries.length > HALL_OF_FAME_ENTRIES) hof.entries.shift();
  hof.total++;
}

export function newGameRecord(registries: Registries): NewGame {
  const records = [...registries.newGame.values()];
  if (records.length !== 1) throw new Error(`expected exactly one newGame record, found ${records.length}`);
  return records[0]!;
}

/** The bag pocket an item goes in (its record's `pocket` in `NewGame.pockets`). */
export function pocketOf(registries: Registries, item: Id): BagPocket {
  const rec = registries.items.get(item);
  if (!rec) throw new Error(`unknown item ${item}`);
  const pocket = newGameRecord(registries).pockets.find((p) => p.name === rec.pocket);
  if (!pocket) throw new Error(`item ${item}: pocket "${rec.pocket}" is not a newGame pocket`);
  return pocket;
}

const itemOrder = (registries: Registries) => (id: Id) => registries.items.get(id)?.sourceIndex ?? 0;

export function itemCount(state: GameState, item: Id): number {
  return bagCount(state.bag, item);
}

export function canGiveItem(state: GameState, registries: Registries, item: Id, count: number): boolean {
  return canAddItem(state.bag, pocketOf(registries, item), item, count);
}

/** Adds to the bag (decomp Bag_TryAddItem); false when it does not fit. */
export function giveItem(state: GameState, registries: Registries, item: Id, count: number): boolean {
  return addItem(state.bag, pocketOf(registries, item), item, count, itemOrder(registries));
}

/** Removes from the bag (decomp Bag_TryRemoveItem); false when the bag holds fewer. */
export function takeItem(state: GameState, item: Id, count: number): boolean {
  return removeItem(state.bag, item, count);
}

/** The form and gender a Pokémon shows the Pokédex (decomp Pokedex_Encounter reads both from the Pokémon). */
export function seenFormOf(registries: Registries, mon: Pick<Pokemon, 'species' | 'form' | 'pid'>): SeenForm {
  return { form: mon.form, gender: monGender(dexOf(registries), mon) };
}

/**
 * Decomp Pokedex_Encounter: marks a species seen, and its form and gender when a Pokémon was seen
 * (null: only the species is known, e.g. `set_species_seen`).
 */
export function markSeen(state: Pick<GameState, 'pokedex'>, species: Id, look: SeenForm | null): void {
  if (!state.pokedex.seen.includes(species)) state.pokedex.seen.push(species);
  if (!look) return;
  const forms = (state.pokedex.forms[species] ??= []);
  if (!forms.some((f) => f.form === look.form && f.gender === look.gender)) forms.push({ form: look.form, gender: look.gender });
}

/** Decomp Pokedex_Capture (SaveData_UpdateCatchRecords): seen (with its form and gender) and caught. */
export function markCaught(state: GameState, registries: Registries, mon: Pokemon): void {
  markSeen(state, mon.species, seenFormOf(registries, mon));
  if (!state.pokedex.caught.includes(mon.species)) state.pokedex.caught.push(mon.species);
}

/** Decomp PCBoxes_FirstEmptyBox: the first box with a free slot from the current box on, wrapping; null when all are full. */
export function firstFreeBox(state: GameState): number | null {
  const n = state.boxes.length;
  for (let k = 0; k < n; k++) {
    const box = (state.currentBox + k) % n;
    if (state.boxes[box]!.slots.some((m) => m === null)) return box;
  }
  return null;
}

/**
 * Decomp PCBoxes_TryStoreBoxMonInBox after a catch with a full party: the first free slot of `box`, which
 * becomes the current box (as the catch does). The DS keeps only box data, so HP, PP and status come back
 * full (core `heal`).
 */
export function storeInBox(state: GameState, registries: Registries, box: number, mon: Pokemon): void {
  const slots = state.boxes[box]?.slots;
  const free = slots?.indexOf(null) ?? -1;
  if (!slots || free < 0) throw new Error(`storeInBox: box ${box} has no free slot`);
  heal(dexOf(registries), mon);
  slots[free] = mon;
  state.currentBox = box;
}

/** Mixes the new-game seed with a salt: a stream of its own that never shares values with the main one. */
function mixSeed(seed: number, salt: number): number {
  let x = (seed ^ salt) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** The player's trainer id from the new-game seed (decomp: a random u32 at new game); the main stream is untouched. */
export function trainerIdFor(seed: number): number {
  return mixSeed(seed, 0x54524944); // "TRID"
}

/** PID and IVs of a set-up Pokémon: a stream of its own from (seed, party slot), so setting a party up never moves the game's rolls. */
export function setupPidIvs(seed: number, slot: number): { pid: number; ivs: Stats } {
  const rng = new Prng(mixSeed(seed, 0x50415254 + slot)); // "PART"
  return { pid: randomPid(rng), ivs: randomIvs(rng) };
}

/**
 * A Pokémon as a replay `party` line (and tests) set it up: PID and IVs from (seed, slot), the player as
 * OT, the pack's ball, met here; the given moves or the default ones.
 */
export function setupPokemon(state: GameState, registries: Registries, slot: number, species: Id, level: number, moves: readonly Id[] = []): Pokemon {
  return createPokemon(dexOf(registries), {
    species,
    level,
    ...setupPidIvs(state.seed, slot),
    otId: state.trainerId,
    otName: state.names.player,
    otGender: state.gender,
    ball: newGameRecord(registries).pokeBall,
    met: { zone: state.player.zone, level, date: null },
    ...(moves.length ? { moves: [...moves] } : {}),
  });
}

/** Byte and bit of signature pixel (x, y) in the DS layout (decomp TrainerCase_ConvertSignature1BppTo8Bpp). */
const signatureBit = (x: number, y: number): [number, number] => [((y >> 3) * (SIGNATURE_WIDTH >> 3) + (x >> 3)) * 8 + (y & 7), x & 7];

/** `GameState.signature` → one byte per pixel (1 = ink), row-major 192×64 (0.20.0). Null → all blank. */
export function decodeSignature(hex: string | null): Uint8Array {
  const px = new Uint8Array(SIGNATURE_WIDTH * SIGNATURE_HEIGHT);
  if (hex === null) return px;
  if (!/^[0-9a-f]{3072}$/.test(hex)) throw new Error('signature: expected 3072 hex chars');
  for (let y = 0; y < SIGNATURE_HEIGHT; y++)
    for (let x = 0; x < SIGNATURE_WIDTH; x++) {
      const [byte, bit] = signatureBit(x, y);
      px[y * SIGNATURE_WIDTH + x] = (parseInt(hex.slice(byte * 2, byte * 2 + 2), 16) >> bit) & 1;
    }
  return px;
}

/** Row-major pixels → `GameState.signature` (0.20.0); null when no pixel is inked (the DS saves zeros: the same card). */
export function encodeSignature(px: Uint8Array): string | null {
  if (px.length !== SIGNATURE_WIDTH * SIGNATURE_HEIGHT) throw new Error(`signature: ${px.length} pixels`);
  if (!px.includes(1)) return null;
  const bytes = new Uint8Array((SIGNATURE_WIDTH * SIGNATURE_HEIGHT) / 8);
  for (let y = 0; y < SIGNATURE_HEIGHT; y++)
    for (let x = 0; x < SIGNATURE_WIDTH; x++) {
      if (!px[y * SIGNATURE_WIDTH + x]) continue;
      const [byte, bit] = signatureBit(x, y);
      bytes[byte] = bytes[byte]! | (1 << bit);
    }
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 0.21.1. The context of a level-up evolution check (decomp Pokemon_GetEvolutionTargetSpecies with
 * EVO_CLASS_BY_LEVEL): IsNight from the clock (night and late night), the party's species
 * (Party_HasSpecies, eggs included), the zone's special method (MapHeader_GetMapEvolutionMethod) and the
 * trade substitute (the device option `tradeEvolution` 0 = on).
 */
export function levelEvolutionTrigger(registries: Registries, state: GameState, clock: ClockTime, tradeSubstitute: boolean): EvolutionTrigger {
  const zone = registries.zones.get(state.player.zone);
  if (!zone) throw new Error(`levelEvolutionTrigger: unknown zone ${state.player.zone}`);
  return { kind: 'level', isNight: isNight(dayPeriod(clock.hour)), partySpecies: state.party.map((m) => m.species), ...(zone.mapEvolution ? { mapEvolution: zone.mapEvolution } : {}), tradeSubstitute };
}

/** Decomp VAR_DISTRIBUTION_EVENT_DARKRAI (`vars` sourceIndex): Darkrai, Shaymin, Arceus and Rotom's vars follow, by enum DistributionEvent. */
export const DISTRIBUTION_EVENT_VAR = 0x4043;
/** Decomp sDistributionEventMagicNumbers (system_vars.c): the value SystemVars_CheckDistributionEvent wants, by enum DistributionEvent. */
export const DISTRIBUTION_EVENT_MAGIC = [0x1209, 0x1112, 0x1123, 0x1103] as const;

/**
 * 0.28.1. The event-only content a cartridge alone never reaches (docs/decisions.md: a dev-only
 * flag, hidden from players). The four distributions and their key items (decomp DistributionEvent order; the item
 * by its ITEM_* constant): the Member Card, Oak's Letter, the Azure Flute, the Secret Key. `regigigas`: a fateful
 * Regigigas (the Regi ruins' gate, decomp CheckPartyHasFatefulEncounterRegigigas).
 */
export const DEV_EVENTS = { darkrai: { event: 0, item: 454 }, shaymin: { event: 1, item: 452 }, arceus: { event: 2, item: 455 }, rotom: { event: 3, item: 467 }, regigigas: null } as const;
export type DevEvent = keyof typeof DEV_EVENTS;
/** Decomp SPECIES_REGIGIGAS; the level the dev flag's Regigigas has (My Pokémon Ranch's was 100). */
const SPECIES_REGIGIGAS = 486;
const DEV_REGIGIGAS_LEVEL = 100;

/** Decomp VAR_SHAYMIN_EVENT_STATE (`vars` sourceIndex): Oak's Letter's gift sets it to 1 when 0 (InitShayminEvent). */
const SHAYMIN_EVENT_STATE_VAR = 0x4057;

function bySource<T extends { id: Id; sourceIndex?: number }>(records: ReadonlyMap<Id, T>, n: number, what: string): T {
  const r = [...records.values()].find((x) => x.sourceIndex === n);
  if (!r) throw new Error(`mystery gift: no ${what} ${n}`);
  return r;
}

/** The fateful Regigigas the `regigigas` gift (and the dev flag) gives: deterministic, as replay setup Pokémon. */
function fatefulRegigigas(state: GameState, registries: Registries): Pokemon {
  const species = bySource(registries.species, SPECIES_REGIGIGAS, 'species').id;
  const mon = setupPokemon(state, registries, state.party.length, species, DEV_REGIGIGAS_LEVEL);
  mon.fatefulEncounter = true;
  return mon;
}

/** Decomp SystemVars_SetDistributionEventMagic, and InitShayminEvent's VAR_SHAYMIN_EVENT_STATE 0 → 1. */
function setDistributionEvent(state: GameState, registries: Registries, event: number): void {
  const v = bySource(registries.vars, DISTRIBUTION_EVENT_VAR + event, 'var');
  state.vars[v.id] = DISTRIBUTION_EVENT_MAGIC[event]!;
  if (event === DEV_EVENTS.shaymin.event) {
    const shaymin = bySource(registries.vars, SHAYMIN_EVENT_STATE_VAR, 'var');
    if ((state.vars[shaymin.id] ?? shaymin.initial) === 0) state.vars[shaymin.id] = 1;
  }
}

/**
 * Grants a dev event (`DEV_EVENTS`) as the distribution would have: the ROM's own distribution var gets its magic
 * number and the key item goes into the bag (so the game's scripts run), or a fateful Regigigas joins the party
 * (the first free box when the party is full). Throws when the bag, party and boxes have no room. The same edits as
 * the Poké Mart deliveryman's `giveMysteryGift` (0.30.0), without his checks.
 */
export function grantDevEvent(state: GameState, registries: Registries, event: DevEvent): void {
  const def = DEV_EVENTS[event];
  if (def) {
    const item = bySource(registries.items, def.item, 'item').id;
    if (itemCount(state, item) === 0 && !giveItem(state, registries, item, 1)) throw new Error(`grantDevEvent: ${item} does not fit the bag`);
    setDistributionEvent(state, registries, def.event);
    return;
  }
  const mon = fatefulRegigigas(state, registries);
  if (state.party.length < PARTY_SIZE) state.party.push(mon);
  else {
    const box = firstFreeBox(state);
    if (box === null) throw new Error('grantDevEvent: the party and the PC boxes are full');
    storeInBox(state, registries, box, mon);
  }
  markCaught(state, registries, mon);
}

/**
 * 0.30.0. The built-in Mystery Gifts (docs/decisions.md "Event legendaries through Mystery Gift with gift codes"):
 * our own definitions, received with a gift code and picked up from the Poké Mart deliveryman. `type` is the decomp
 * MysteryGiftType the deliveryman's script reads (MYST_GIFT_MEMBER_CARD 8, OAKS_LETTER 9, AZURE_FLUTE 10, SECRET_KEY
 * 12, POKEMON 1); `species` the Pokémon the card pictures (a species sourceIndex). The Wonder Card's text is
 * `MYSTERY_GIFT_TEXT`.
 */
export const MYSTERY_GIFTS: Readonly<Record<MysteryGiftId, { type: number; species: number }>> = {
  darkrai: { type: 8, species: 491 },
  shaymin: { type: 9, species: 492 },
  arceus: { type: 10, species: 493 },
  rotom: { type: 12, species: 479 },
  regigigas: { type: 1, species: 486 },
};

/**
 * The built-in Mystery Gifts' Wonder Card text per game language (core ENGLISH, GERMAN; our own words, the card shows
 * three lines of text): the title and the description.
 */
export const MYSTERY_GIFT_TEXT: Readonly<Record<number, Readonly<Record<MysteryGiftId, { title: string; description: string }>>>> = {
  [ENGLISH]: {
    darkrai: { title: 'Member Card', description: 'A Member Card for the Harbor Inn in Canalave City. Spend a night there, and you may dream of a faraway island.' },
    shaymin: { title: 'Oak’s Letter', description: 'A letter from Professor Oak. Bring it to Route 224 once the National Pokédex is yours.' },
    arceus: { title: 'Azure Flute', description: 'A flute with an otherworldly melody. Play it at Spear Pillar, atop Mt. Coronet, and see what answers.' },
    rotom: { title: 'Secret Key', description: 'The key to a hidden room in the Galactic Eterna Building, full of appliances a Pokémon may like.' },
    regigigas: { title: 'Regigigas', description: 'A Regigigas met in a fateful encounter. Take it to Sinnoh’s ancient ruins, and the titans may stir.' },
  },
  [GERMAN]: {
    darkrai: { title: 'Mitgliedskarte', description: 'Eine Mitgliedskarte für das Hotel am Hafen von Fleetburg. Wer dort übernachtet, träumt vielleicht von einer fernen Insel.' },
    shaymin: { title: 'Eichs Brief', description: 'Ein Brief von Professor Eich. Bring ihn zur Route 224, sobald du den Nationalen Pokédex besitzt.' },
    arceus: { title: 'Azurflöte', description: 'Eine Flöte mit einer überirdischen Melodie. Spiele sie auf der Speersäule am Kraterberg und sieh, was antwortet.' },
    rotom: { title: '?-Öffner', description: 'Der Schlüssel zu einem verborgenen Raum im Galaktik-Gebäude in Ewigenau, voller Geräte, die einem Pokémon gefallen könnten.' },
    regigigas: { title: 'Regigigas', description: 'Ein Regigigas aus einer schicksalhaften Begegnung. Bring es zu Sinnohs uralten Ruinen, und die Titanen erwachen vielleicht.' },
  },
};

/** Decomp CanReceiveMemberCard and the other key items (Bag_CanFitItem), CanReceivePokemon (a free party slot). */
export function canReceiveMysteryGift(state: GameState, registries: Registries, gift: MysteryGiftId): boolean {
  const def = DEV_EVENTS[gift];
  if (def) return canGiveItem(state, registries, bySource(registries.items, def.item, 'item').id, 1);
  return state.party.length < PARTY_SIZE;
}

/**
 * Decomp InitDarkraiEvent, InitShayminEvent, InitArceusEvent and InitRotomEvent (the key item and the distribution
 * var), GivePokemon (the fateful Regigigas into the party, caught in the Pokédex): what the deliveryman gives. Throws
 * unless `canReceiveMysteryGift` holds.
 */
export function giveMysteryGift(state: GameState, registries: Registries, gift: MysteryGiftId): void {
  if (!canReceiveMysteryGift(state, registries, gift)) throw new Error(`giveMysteryGift: no room for ${gift}`);
  const def = DEV_EVENTS[gift];
  if (def) {
    giveItem(state, registries, bySource(registries.items, def.item, 'item').id, 1);
    setDistributionEvent(state, registries, def.event);
    return;
  }
  const mon = fatefulRegigigas(state, registries);
  state.party.push(mon);
  markCaught(state, registries, mon);
}
