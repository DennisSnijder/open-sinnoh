/**
 * Berry patches (decomp berry_patches.c, berry_patch_manager.c; docs/research/berries-honey-radar.md): planting,
 * growth over game minutes, moisture, mulch and yield. Pure rules over `GameState.berryPatches`; the clock feeds
 * `elapseBerryMinutes` with whole minutes (game `updateGameTime`), the scripts and the world call the rest.
 */
import type { Id } from '@opensinnoh/core';
import { BERRY_STAGES, newGameRecord, type BerryPatch, type BerryStage, type BerryTables, type GameState, type Registries } from '@opensinnoh/contracts';

/** Decomp BASE_HARVEST_STAGES, BASE_MAX_REPLANT_COUNT, MAX_MOISTURE_RATING, MAX_YIELD_RATING. */
const HARVEST_STAGES = 4;
const MAX_REPLANTS = 10;
const MAX_MOISTURE = 100;
const MAX_YIELD_RATING = 5;
/** Decomp BerryPatches_Init: a new game's fruit carries yield rating 3. */
const INIT_YIELD_RATING = 3;
/** Decomp CalcBerryYield's floor at bloom → fruit. */
const MIN_YIELD = 2;

/** Decomp enum MulchType without NONE, in `BerryTables.mulches` order. */
type Mulch = 'growth' | 'damp' | 'stable' | 'gooey' | null;
const MULCHES = ['growth', 'damp', 'stable', 'gooey'] as const;

function mulchOf(tables: BerryTables, p: BerryPatch): Mulch {
  if (p.mulch === null) return null;
  const i = tables.mulches.indexOf(p.mulch);
  if (i < 0) throw new Error(`berry patch: ${p.mulch} is not a mulch`);
  return MULCHES[i]!;
}

function berryOf(tables: BerryTables, berry: Id) {
  const b = tables.berries.find((x) => x.item === berry);
  if (!b) throw new Error(`berry patch: ${berry} is not a berry`);
  return b;
}

/** Decomp CalcMinutesRemainingInStage: the stage hours in minutes; Growth Mulch ×3/4, Damp Mulch ×3/2. */
function stageMinutes(tables: BerryTables, berry: Id, mulch: Mulch): number {
  const m = berryOf(tables, berry).stageHours * 60;
  if (mulch === 'growth') return Math.floor((m * 3) / 4);
  if (mulch === 'damp') return m + Math.floor(m / 2);
  return m;
}

/** Decomp CalcMoistureDrainRate: Damp Mulch halves it, Growth Mulch adds half. */
function drainRate(tables: BerryTables, berry: Id, mulch: Mulch): number {
  const d = berryOf(tables, berry).drain;
  if (mulch === 'damp') return Math.floor(d / 2);
  if (mulch === 'growth') return d + Math.floor(d / 2);
  return d;
}

/** Decomp GetHarvestTimeWithMulch: the fruit stays 4 stages, 6 with Stable Mulch. */
const harvestStages = (mulch: Mulch) => (mulch === 'stable' ? HARVEST_STAGES + HARVEST_STAGES / 2 : HARVEST_STAGES);
/** Decomp GetTotalReplantCountWithMulch: 10 cycles, 15 with Gooey Mulch. */
const maxReplants = (mulch: Mulch) => (mulch === 'gooey' ? MAX_REPLANTS + MAX_REPLANTS / 2 : MAX_REPLANTS);

export function emptyBerryPatch(): BerryPatch {
  return { berry: null, stage: 'none', stageMinutes: 0, moistureMinutes: 0, replants: 0, yield: 0, moisture: 0, yieldRating: 0, mulch: null, growing: false };
}

/** Decomp BerryPatches_Init: every listed patch bears its berry in fruit (4 stages left), moisture full, not growing yet. */
export function newBerryPatches(tables: BerryTables): BerryPatch[] {
  return tables.patches.map((init) => ({
    ...emptyBerryPatch(),
    berry: init.item,
    stage: 'fruit',
    stageMinutes: stageMinutes(tables, init.item, null) * HARVEST_STAGES,
    yield: init.yield,
    moisture: MAX_MOISTURE,
    yieldRating: INIT_YIELD_RATING,
  }));
}

export function berryPatch(patches: BerryPatch[], id: number): BerryPatch {
  const p = patches[id];
  if (!p) throw new Error(`berry patch ${id} does not exist (${patches.length} patches)`);
  return p;
}

/** Decomp BerryGrowthStage as a number (NONE 0 … FRUIT 5), what `get_berry_growth_stage` writes. */
export const berryStageIndex = (stage: BerryStage): number => BERRY_STAGES.indexOf(stage);

/** Decomp BerryPatches_GetPatchMoisture: 0 very dry (rating 0), 1 dry (up to 50), 2 moist. */
export function patchMoisture(p: BerryPatch): 0 | 1 | 2 {
  if (p.moisture === 0) return 0;
  return p.moisture <= 50 ? 1 : 2;
}

/** Decomp BerryPatches_PlantInPatch: the berry is planted with a full stage ahead, moisture 100, yield rating 5, growing. */
export function plantBerry(tables: BerryTables, p: BerryPatch, berry: Id): void {
  if (p.stage !== 'none') throw new Error(`berry patch: planting ${berry} over a ${p.stage} plant`);
  Object.assign(p, {
    berry,
    stage: 'planted',
    stageMinutes: stageMinutes(tables, berry, mulchOf(tables, p)),
    moistureMinutes: 0,
    replants: 0,
    yield: 0,
    moisture: MAX_MOISTURE,
    yieldRating: MAX_YIELD_RATING,
    growing: true,
  } satisfies Partial<BerryPatch>);
}

/** Decomp BerryPatches_ResetPatchMoisture (watering). */
export function waterBerryPatch(p: BerryPatch): void {
  p.moisture = MAX_MOISTURE;
}

/** Decomp BerryPatches_SetPatchMulchType. */
export function mulchBerryPatch(tables: BerryTables, p: BerryPatch, mulch: Id): void {
  if (!tables.mulches.includes(mulch)) throw new Error(`berry patch: ${mulch} is not a mulch`);
  p.mulch = mulch;
}

/** Decomp BerryPatches_HarvestPatch: the patch is cleared (mulch too); returns the berry and its yield. */
export function harvestBerryPatch(p: BerryPatch): { berry: Id; count: number } {
  if (p.stage !== 'fruit' || !p.berry) throw new Error(`berry patch: harvesting a ${p.stage} plant`);
  const out = { berry: p.berry, count: p.yield };
  Object.assign(p, emptyBerryPatch());
  return out;
}

/** Decomp AdvancePatchGrowth: one stage on; bloom → fruit sets the yield; fruit → sprouted again until the replants run out. */
function advance(tables: BerryTables, p: BerryPatch): void {
  switch (p.stage) {
    case 'none':
      throw new Error('berry patch: advancing an empty patch');
    case 'planted':
    case 'sprouted':
    case 'growing':
      p.stage = BERRY_STAGES[berryStageIndex(p.stage) + 1]!;
      return;
    case 'blooming':
      p.yield = Math.max(MIN_YIELD, berryOf(tables, p.berry!).baseYield * p.yieldRating);
      p.stage = 'fruit';
      return;
    case 'fruit':
      p.yield = 0;
      p.stage = 'sprouted';
      p.yieldRating = MAX_YIELD_RATING;
      p.replants++;
      if (p.replants === maxReplants(mulchOf(tables, p))) Object.assign(p, emptyBerryPatch());
      return;
  }
}

/**
 * Decomp DrainPatchMoisture: whole hours (with the carried minutes) drain the moisture; hours after it ran dry
 * each cost a yield rating point. A plant in fruit does not dry out.
 */
function drain(tables: BerryTables, p: BerryPatch, minutes: number): void {
  if (p.stage === 'fruit') return;
  const rate = drainRate(tables, p.berry!, mulchOf(tables, p));
  const total = minutes + p.moistureMinutes;
  let hours = Math.floor(total / 60);
  p.moistureMinutes = total % 60;
  if (hours === 0) return;
  if (p.moisture >= rate * hours) {
    p.moisture -= rate * hours;
    return;
  }
  if (p.moisture > 0) {
    hours -= Math.ceil(p.moisture / rate);
    p.moisture = 0;
  }
  p.yieldRating = Math.max(0, p.yieldRating - hours);
}

/**
 * Decomp BerryPatches_ElapseMinutes: each growing patch takes `minutes`, stage by stage (each stage drains its own
 * moisture before it advances); a gap past the plant's whole life (its stage length × (1 + (3 + fruit stages) ×
 * replants)) clears it at once.
 */
export function elapseBerryMinutes(tables: BerryTables, patches: BerryPatch[], minutes: number): void {
  if (!Number.isInteger(minutes) || minutes < 0) throw new Error(`berry patches: ${minutes} minutes`);
  for (const p of patches) {
    if (!p.berry || p.stage === 'none' || !p.growing) continue;
    const mulch = mulchOf(tables, p);
    const lifetime = stageMinutes(tables, p.berry, mulch) * (1 + (3 + harvestStages(mulch)) * maxReplants(mulch));
    if (minutes >= lifetime) {
      Object.assign(p, emptyBerryPatch());
      continue;
    }
    let left = minutes;
    // `advance` may clear the patch: read the stage through a function so it is not narrowed.
    const empty = () => p.stage === 'none';
    while (!empty() && left !== 0) {
      if (p.stageMinutes > left) {
        drain(tables, p, left);
        p.stageMinutes -= left;
        break;
      }
      drain(tables, p, p.stageMinutes);
      left -= p.stageMinutes;
      advance(tables, p);
      if (empty()) break;
      p.stageMinutes = stageMinutes(tables, p.berry!, mulchOf(tables, p));
      if (p.stage === 'fruit') p.stageMinutes *= harvestStages(mulchOf(tables, p));
    }
  }
}

const FACING_DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const;

/**
 * The berry soil object the player faces (decomp ItemUseContext_Init: sub_0203C9D4's object, then
 * BerryPatches_GetPatchFlags), with its patch; null when the player faces no soil (or the packs have no berries).
 */
export function facingSoil(registries: Registries, state: GameState): { localId: number; patch: BerryPatch } | null {
  const tables = newGameRecord(registries).berries;
  if (!tables) return null;
  const p = state.player;
  const [dx, dz] = FACING_DELTA[p.facing];
  const o = state.objects.find((x) => x.zone === p.zone && x.x === p.x + dx && x.z === p.z + dz);
  if (!o) return null;
  const ev = registries.zones.get(p.zone)?.events.objects.find((e) => e.localId === o.localId);
  if (!ev || ev.sprite !== tables.soil) return null;
  return { localId: o.localId, patch: berryPatch(state.berryPatches, ev.data[0]!) };
}
