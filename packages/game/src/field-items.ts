/**
 * Key items used in the field (decomp item_use_functions.c, sItemUseFuncs by the item's `fieldUse`), from
 * the bag's USE and from Y (the registered item). Both paths share the check and the use:
 * - `fieldItemCheck` is the item's canUseItemFunc (CanUseBicycle, CanUseEscapeRope, …): null, or the
 *   ItemUseCheckResult the bag (BagContext_FormatErrorMessage) or the field prints;
 * - `useFieldItem` is the use that runs on the field: the bag's useItemFromMenuFunc after
 *   FieldSystem_StartFieldMap (the bag has closed), or Y's useItemInFieldFunc. The Bicycle mounts or
 *   dismounts; Vs. Seeker scans, rods start the fishing task, and Escape Rope consumes and warps.
 * - `useRegisteredItem` is Y on the idle field (decomp sub_02069238; Platinum moved it to Y from Diamond
 *   and Pearl's Select): nothing registered or a bag-message item prints its usage message
 *   (UseBagMessageItem, BagContext_FormatUsageMessage), else the check, then the use.
 */
import { DISTRIBUTION_EVENT_MAGIC, DISTRIBUTION_EVENT_VAR, newGameRecord, takeItem, type AppHost, type GameState, type Registries, type ScriptRunner, type StubLog, type World } from '@opensinnoh/contracts';
import { onMainMatrix, type Id } from '@opensinnoh/core';
import { facingSoil, totalAccessories, totalBackdrops } from '@opensinnoh/services';
import type { SoundSystem } from './sound.ts';
import { useVsSeeker } from './vs-seeker.ts';

/** Decomp ITEM_USE_FUNC_* (constants/items.h) the field checks or runs. */
const USE = { none: 0, townMap: 2, explorerKit: 3, journal: 5, bicycle: 4, berry: 8, poffinCase: 9, pokeRadar: 11, sprayduck: 12, mulch: 13, honey: 14, vsSeeker: 15, oldRod: 16, goodRod: 17, superRod: 18, bagMessage: 19, escapeRope: 21, azureFlute: 22 } as const;
/** Decomp MapHeader_IsAzureFluteAllowed: MAP_HEADER_SPEAR_PILLAR, _DIALGA, _PALKIA (`zones` sourceIndex). */
const AZURE_FLUTE_ZONES = [220, 584, 585];
/** Decomp FLAG_GAME_COMPLETED, DISTRIBUTION_EVENT_ARCEUS; the Azure Flute's script (UseAzureFluteInField: common script 39). */
const FLAG_GAME_COMPLETED = 2404;
const DISTRIBUTION_EVENT_ARCEUS = 2;
const AZURE_FLUTE_SCRIPT = 'CommonScript_TryUseAzureFlute';
/** Decomp SCRIPT_ID(BERRY_TREE_INTERACTIONS, 1–3): planting from the bag, the Sprayduck, mulch. */
const BERRY_SCRIPTS = { plant: 'BerryTree_PlantBerry', sprayduck: 'BerryTree_UseSprayduck', mulch: 'BerryTree_UseMulch' } as const;
/** Decomp SEQ_BICYCLE (the bike's BGM override, MountOrUnmountBicycle). */
const SEQ_BICYCLE = 1152;

export type ItemUseError = NonNullable<ReturnType<AppHost['fieldItemCheck']>>;

export interface FieldItemDeps {
  registries: Registries;
  state: GameState;
  world: World;
  scripts: ScriptRunner;
  sound: SoundSystem;
  log: StubLog;
  /** The base pack's namespace (the messages are its `Bag_Text_*` and `CommonStrings_Text_*` texts). */
  ns: string;
  /** Opens a menu app over the field (the Poffin Case on Y, the journal, the Town Map). */
  openApp(request: { app: 'poffin-case' } | { app: 'journal' } | { app: 'town-map' }): void;
}

const local = (id: Id) => id.slice(id.indexOf(':') + 1);

function fieldUse(d: Pick<FieldItemDeps, 'registries'>, item: Id): number {
  const rec = d.registries.items.get(item);
  if (!rec) throw new Error(`field item ${item}: no item record`);
  return rec.fieldUse;
}

/**
 * The item's canUseItemFunc (decomp ItemUseContext_Init, then sItemUseFuncs[fieldUse].canUseItemFunc);
 * null for items without one.
 */
export function fieldItemCheck(d: Pick<FieldItemDeps, 'registries' | 'state' | 'world'>, item: Id): ItemUseError | null {
  const s = d.state;
  switch (fieldUse(d, item)) {
    case USE.explorerKit:
      return d.world.explorerKitCheck();
    case USE.bicycle:
      return d.world.bicycleCheck();
    case USE.vsSeeker:
      return onMainMatrix(d.registries, s.player.zone) ? null : 'generic';
    case USE.pokeRadar:
      // CanUsePokeRadar: no partner, not on the bike, standing in tall grass.
      if (s.hasPartner) return 'partner';
      return s.playerState === 'cycle' ? 'generic' : d.world.pokeRadarCheck();
    case USE.sprayduck:
      // Decomp CanUseSprayDuck: no partner, and a plant in the patch faced (BERRY_PATCH_FLAG_HAS_BERRY).
      if (s.hasPartner) return 'partner';
      return (facingSoil(d.registries, s)?.patch.stage ?? 'none') !== 'none' ? null : 'generic';
    case USE.mulch: {
      // Decomp CanUseMulch: empty soil with no mulch faced (BERRY_PATCH_FLAG_CAN_MULCH).
      const soil = facingSoil(d.registries, s);
      return soil && soil.patch.stage === 'none' && soil.patch.mulch === null ? null : 'generic';
    }
    case USE.oldRod:
    case USE.goodRod:
    case USE.superRod:
      if (s.hasPartner) return 'partner';
      return d.world.fishingCheck();
    case USE.escapeRope: {
      if (s.hasPartner) return 'partner';
      const zone = d.registries.zones.get(s.player.zone);
      if (!zone) throw new Error(`field item ${item}: unknown zone ${s.player.zone}`);
      return zone.mapType === 'cave' && zone.flags.escapeRope ? null : 'generic';
    }
    case USE.azureFlute: {
      // Decomp CanUseAzureFlute: the game completed, the Arceus distribution, the National Pokédex, Spear Pillar.
      const reg = d.registries;
      const completed = [...reg.flags.values()].find((f) => f.sourceIndex === FLAG_GAME_COMPLETED);
      const event = [...reg.vars.values()].find((v) => v.sourceIndex === DISTRIBUTION_EVENT_VAR + DISTRIBUTION_EVENT_ARCEUS);
      if (!completed || !event) throw new Error('Azure Flute: no FLAG_GAME_COMPLETED or VAR_DISTRIBUTION_EVENT_ARCEUS in the packs');
      if (!(s.flags[completed.id] ?? completed.initial)) return 'generic';
      if ((s.vars[event.id] ?? event.initial) !== DISTRIBUTION_EVENT_MAGIC[DISTRIBUTION_EVENT_ARCEUS]) return 'generic';
      if (!s.pokedex.national) return 'generic';
      return AZURE_FLUTE_ZONES.includes(reg.zones.get(s.player.zone)?.sourceIndex ?? -1) ? null : 'generic';
    }
    default:
      return null;
  }
}

/** The message of a refused use (decomp BagContext_FormatErrorMessage): a text name and its slots. */
export function itemUseErrorText(error: ItemUseError, player: string): { name: string; slots: string[] } {
  switch (error) {
    case 'dismount':
      return { name: 'Bag_Text_CannotDismount', slots: [] };
    case 'partner':
      return { name: 'Bag_Text_CannotUseWithPartner', slots: [] };
    case 'fish':
      return { name: 'Bag_Text_CannotUseNoFishing', slots: [] };
    case 'generic':
      return { name: 'CommonStrings_Text_CantDoThatRightNow', slots: [player] };
  }
}

/** Whether the item's use runs on the field once the bag has closed (the rest are bag-side or stubs). */
export function runsOnField(d: Pick<FieldItemDeps, 'registries'>, item: Id): boolean {
  const uses: readonly number[] = [USE.townMap, USE.journal, USE.explorerKit, USE.bicycle, USE.pokeRadar, USE.sprayduck, USE.mulch, USE.honey, USE.vsSeeker, USE.oldRod, USE.goodRod, USE.superRod, USE.escapeRope, USE.azureFlute];
  return uses.includes(fieldUse(d, item));
}

/**
 * The item's use on the field (after a passed check). Decomp MountOrUnmountBicycle for the Bicycle:
 * getting off changes the avatar, then the zone's BGM fades back in; getting on sets the bike BGM first
 * (the world clears the Poké Radar's chain). Fishing, escape, the Poké Radar and Honey use the world tasks.
 */
export function useFieldItem(d: FieldItemDeps, item: Id): void {
  const use = fieldUse(d, item);
  if (use === USE.vsSeeker) return useVsSeeker(d);
  // UseJournalFromMenu / UseJournalInField and UseTownMapFromMenu / UseTownMapInField: their apps over the field.
  if (use === USE.journal) return d.openApp({ app: 'journal' });
  if (use === USE.townMap) return d.openApp({ app: 'town-map' });
  // UseExplorerKitFromMenu / UseExplorerKitInField: FieldTask_MapChangeToUnderground.
  if (use === USE.explorerKit) return d.world.enterUnderground();
  // Packs without the special encounters (the original fixture) have no Radar or Sweet Scent to run: logged.
  if ((use === USE.pokeRadar || use === USE.honey) && !newGameRecord(d.registries).specialEncounters) {
    d.log.stub(`field:item-use:${item}`, `using ${item} needs NewGame.specialEncounters, which the packs lack`);
    return;
  }
  // UsePokeRadarFromMenu / UsePokeRadarInField: RefreshRadarChain.
  if (use === USE.pokeRadar) return d.world.pokeRadar();
  // UseHoneyFromMenu: one Honey goes, then Sweet Scent's task without the cut-in.
  if (use === USE.honey) {
    if (!takeItem(d.state, item, 1)) throw new Error(`Honey: missing ${item} in bag`);
    return d.world.sweetScent(null);
  }
  if (use >= USE.oldRod && use <= USE.superRod) return d.world.fish((use - USE.oldRod) as 0 | 1 | 2);
  if (use === USE.escapeRope) {
    const exit = d.state.escapeLocation;
    if (!exit) throw new Error('Escape Rope: no exit location recorded');
    if (!takeItem(d.state, item, 1)) throw new Error(`Escape Rope: missing ${item} in bag`);
    d.world.warp(exit.zone, exit.x, exit.z, exit.facing);
    return;
  }
  if (use === USE.azureFlute) {
    d.scripts.start({ label: `${d.ns}:${AZURE_FLUTE_SCRIPT}` as Id, zone: d.state.player.zone, source: 'item' });
    return;
  }
  if (use === USE.sprayduck || use === USE.mulch || use === USE.berry) return useBerryItem(d, item, use);
  if (use !== USE.bicycle) {
    d.log.stub(`field:item-use:${item}`, `using ${item} in the field (field use ${use}) is not implemented yet`);
    return;
  }
  if (d.state.playerState === 'cycle') {
    d.world.setPlayerState('walk');
    d.sound.setSpecialBgm(null);
    d.sound.fadeToBgm(d.sound.effectiveBgm(d.state.player.zone));
  } else {
    const bike = d.sound.sequenceBySource(SEQ_BICYCLE);
    d.sound.setSpecialBgm(bike);
    d.sound.fadeToBgm(bike);
    d.world.setPlayerState('cycle');
  }
}

/** Y on the idle field: the registered item (decomp sub_02069238), or the item wheel's pick (OpenSinnoh). */
export function useRegisteredItem(d: FieldItemDeps, item = d.state.registeredItem): void {
  const say = (name: string, slots: string[] = []) => d.scripts.notice(`${d.ns}:${name}` as Id, slots);
  if (!item) return say('Bag_Text_KeyItemInfo');
  const use = fieldUse(d, item);
  if (use === USE.none || use === USE.bagMessage) {
    // BagContext_FormatUsageMessage: the Coin Case shows the coins; the Point Card, Seal Case and Fashion
    // Case count systems of later milestones.
    if (local(item) === 'ITEM_COIN_CASE') return say('Bag_Text_CoinCaseMessage', [String(d.state.coins)]);
    if (local(item) === 'ITEM_FASHION_CASE') return say('Bag_Text_FashionCaseMessage', [String(totalAccessories(d.state.fashionCase)), String(totalBackdrops(d.state.fashionCase))]);
    d.log.stub(`field:registered-item:${item}`, `the usage message of ${item} on Y is not shown yet (its count is a later system)`);
    return;
  }
  // UsePoffinCaseInField: the Poffin Case app over the field.
  if (use === USE.poffinCase) return d.openApp({ app: 'poffin-case' });
  const error = fieldItemCheck(d, item);
  if (error) {
    const text = itemUseErrorText(error, d.state.names.player);
    return say(text.name, text.slots);
  }
  useFieldItem(d, item);
}

/** Whether a berry from the bag plants (decomp: the bag's PLANT, BerryPatch_IsEmpty: the soil faced is empty). */
export function plantsBerry(d: Pick<FieldItemDeps, 'registries' | 'state'>, item: Id): boolean {
  return fieldUse(d, item) === USE.berry && facingSoil(d.registries, d.state)?.patch.stage === 'none';
}

/**
 * The berry items' field scripts (decomp sub_02068540 → sub_020685AC: the script with the faced object as its target
 * and the item in VAR_0x8000): planting a berry, the Sprayduck, mulch.
 */
function useBerryItem(d: FieldItemDeps, item: Id, use: number): void {
  const soil = facingSoil(d.registries, d.state);
  if (!soil) throw new Error(`${item}: no berry soil faced (the check passed)`);
  const script = use === USE.sprayduck ? BERRY_SCRIPTS.sprayduck : use === USE.mulch ? BERRY_SCRIPTS.mulch : BERRY_SCRIPTS.plant;
  const index = d.registries.items.get(item)?.sourceIndex;
  if (index === undefined) throw new Error(`${item}: no sourceIndex`);
  d.scripts.start({ label: `${d.ns}:${script}` as Id, zone: d.state.player.zone, source: 'item', lastTalked: soil.localId, params: [index] });
}
