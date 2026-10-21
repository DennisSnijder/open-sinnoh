/**
 * The Poké Radar's chain (decomp pokeradar.c RadarChain, GrassPatch; wild_encounters.c TryGenerateGrassEncounter_WithRadar,
 * CreateWildMon_FromRadarKeepChain / _NoChain; encounter.c FieldTask_WildEncounter). The chain is field state, not
 * saved: a load starts without one (field_system.c), as do warps, zone changes, the bike, Surf and every scripted
 * battle. The charge and the three best chains are saved (core `SpecialEncounterState`). Rolls take the encounter
 * stream (the DS's LCRNG), drawn only while the Radar is in use.
 */
import {
  RADAR_BATTERY_STEPS, RADAR_CHAIN_MAX, radarPatchContinues, radarPatchShiny, radarRecordChain, radarRecordSlot, specialEncounters, type Id,
} from '@opensinnoh/core';
import type { EffectView, SpecialEncounterTables } from '@opensinnoh/contracts';

/** Decomp NUM_GRASS_PATCHES: one patch per ring, outer (distance 4) to inner (1). */
const RINGS = 4;
/** RadarSpawnPatches: the tiles of each ring. */
const RING_TILES = [32, 24, 16, 8];
/** Effect keys of the patches, past the field's own effect counter. */
const PATCH_EFFECT_KEY = 0x7e000000;

type Shake = 'soft' | 'hard';

interface GrassPatch {
  x: number;
  z: number;
  shake: Shake;
  active: boolean;
  continues: boolean;
  shiny: boolean;
  /** The shaking effect's tick while it plays (FieldSystem_CreateShakingRadarPatches), null when done or none. */
  effect: number | null;
}

/** What the radar asks of the field. */
export interface RadarHost {
  behaviour(x: number, z: number): string;
  /** The terrain height (world units) at a tile's corner, as TerrainCollisionManager_GetHeight at 16·x, 16·z. */
  tileHeight(x: number, z: number): number;
  /** The zone of the matrix cell holding the tile (MapMatrix_GetMapHeaderIDAtCoords), null outside it. */
  zoneAt(x: number, z: number): Id | null;
  /** One roll in [0, n) on the encounter stream. */
  rand(n: number): number;
  /** The patch effects' lengths in ticks (their `shake` animation). */
  effectTicks(effect: Id): number;
  /** Sound_PlayBGM(SEQ_KUSAGASA). */
  playBgm(seq: Id): void;
  /** FieldBGM_TryFadeOut(effective BGM): the chain ended with nothing to show. */
  restoreBgm(): void;
}

/** A Radar encounter's data (RadarEncounterData). */
export interface RadarEncounter {
  shake: Shake;
  preserve: boolean;
  shiny: boolean;
}

export class PokeRadar {
  private shake: Shake = 'soft';
  private count = 0;
  private species: Id | null = null;
  private level = 0;
  private active = false;
  /** unk_14: the next patch entered starts the chain (its record slot is picked then). */
  private first = true;
  /** unk_18: the last encounter came from a patch (FieldTask_WildEncounter keeps the chain only then). */
  private fromPatch = false;
  private recordSlot = 0;
  private patches: GrassPatch[] = [];

  constructor(
    private readonly host: RadarHost,
    private readonly tables: SpecialEncounterTables['pokeRadar'],
    private readonly state: { encounters?: import('@opensinnoh/core').SpecialEncounterState },
  ) {
    this.clear();
  }

  /** RadarChain_Clear. */
  clear(): void {
    this.count = 0;
    this.shake = 'soft';
    this.species = null;
    this.level = 0;
    this.active = false;
    this.recordSlot = 0;
    this.first = true;
    this.fromPatch = false;
    this.patches = Array.from({ length: RINGS }, () => ({ x: 0, z: 0, shake: 'soft', active: false, continues: false, shiny: false, effect: null }));
  }

  /** GetRadarChainActive. */
  isActive(): boolean {
    return this.active;
  }

  /** The live chain for the Trainer Counter (GetChainCount, GetRadarSpecies). */
  chain(): { species: Id; count: number } | null {
    return this.count && this.species ? { species: this.species, count: this.count } : null;
  }

  /** RadarChargeStep: a step with the Radar in the bag charges it, up to the battery. */
  chargeStep(owned: boolean): void {
    if (!owned) return;
    const enc = specialEncounters(this.state);
    if (enc.radarCharge < RADAR_BATTERY_STEPS) enc.radarCharge++;
  }

  /**
   * RefreshRadarChain state 0: below a full battery, the low-battery script with the steps left; else the battery
   * empties and the patches are drawn (`quiet` when none survives; the chain is gone). Then the patches roll as after
   * a defeat (SetupGrassPatches with BATTLE_RESULT_WIN) and shake, and the BGM changes.
   */
  use(px: number, pz: number, py: number, zone: Id): { kind: 'low'; steps: number } | { kind: 'quiet' } | { kind: 'active' } {
    const enc = specialEncounters(this.state);
    if (enc.radarCharge < RADAR_BATTERY_STEPS) return { kind: 'low', steps: RADAR_BATTERY_STEPS - enc.radarCharge };
    enc.radarCharge = 0;
    if (!this.spawn(px, pz, py, zone)) return { kind: 'quiet' };
    this.setup('won');
    this.startEffects();
    this.host.playBgm(this.tables.bgm);
    return { kind: 'active' };
  }

  /**
   * RadarSpawnPatches: one tile drawn on each ring's perimeter around the player, kept when it is tall grass at the
   * player's height in the current zone (no retry). None kept clears the chain and fades the BGM back.
   */
  spawn(px: number, pz: number, py: number, zone: Id): boolean {
    let kept = 0;
    for (let ring = 0; ring < RINGS; ring++) {
      const n = this.host.rand(RING_TILES[ring]!);
      const side = 9 - ring * 2;
      const row = Math.floor(n / side);
      let dx: number;
      let dz: number;
      if (row === 0) {
        dx = ring + (n % side);
        dz = ring;
      } else if (row === 1) {
        dx = ring + (n % side);
        dz = ring + side - 1;
      } else {
        const k = n - side * 2;
        dz = ring + Math.floor(k / 2) + 1;
        dx = k % 2 === 0 ? ring : ring + side - 1;
      }
      const patch = this.patches[ring]!;
      patch.x = px - 4 + dx;
      patch.z = pz - 4 + dz;
      patch.active = this.host.behaviour(patch.x, patch.z) === 'TALL_GRASS' && this.host.tileHeight(patch.x, patch.z) === py && this.host.zoneAt(patch.x, patch.z) === zone;
      if (patch.active) kept++;
    }
    if (kept === 0) {
      this.clear();
      this.host.restoreBgm();
    } else this.active = true;
    return this.active;
  }

  /**
   * SetupGrassPatches: each live patch rolls whether it continues the chain (by ring, after a defeat or a capture);
   * one that breaks it shakes soft or hard at random and is never shiny, one that continues shakes as the chain does
   * and may be the shiny patch (CheckPatchShiny).
   */
  setup(result: 'won' | 'caught'): void {
    for (let ring = 0; ring < RINGS; ring++) {
      const patch = this.patches[ring]!;
      if (!patch.active) continue;
      patch.continues = radarPatchContinues(ring, result, (n) => this.host.rand(n));
      if (!patch.continues) {
        patch.shake = this.host.rand(100) < 50 ? 'soft' : 'hard';
        patch.shiny = false;
      } else {
        patch.shake = this.shake;
        patch.shiny = radarPatchShiny(this.count, (n) => this.host.rand(n));
      }
    }
  }

  /** FieldSystem_CreateShakingRadarPatches: each live patch shakes (shiny, soft or hard). */
  startEffects(): void {
    for (const patch of this.patches) patch.effect = patch.active ? 0 : null;
  }

  /** sub_02069690: the shaking effects step; true once all are done (the field task waits for it). */
  stepEffects(): boolean {
    let done = 0;
    for (const patch of this.patches) {
      if (patch.effect === null) {
        done++;
        continue;
      }
      if (++patch.effect >= this.host.effectTicks(this.effectOf(patch))) {
        patch.effect = null;
        done++;
      }
    }
    return done >= RINGS;
  }

  effectsDone(): boolean {
    return this.patches.every((p) => p.effect === null);
  }

  private effectOf(patch: GrassPatch): Id {
    return patch.shiny ? this.tables.effects.shiny : this.tables.effects[patch.shake];
  }

  /** The shaking patches as field effects (the tall grass renderer's billboards 5–7). */
  effects(): EffectView[] {
    return this.patches.flatMap((p, ring) => {
      if (p.effect === null) return [];
      const at: [number, number, number] = [p.x * 16 + 8, 0, p.z * 16 + 8];
      return [{ key: PATCH_EFFECT_KEY + ring, effect: this.effectOf(p), cur: at, prev: at, anim: 'shake', tick: p.effect }];
    });
  }

  /** The live patches outer to inner, for replays (`World.radarPatches`). */
  livePatches(): { count: number; patches: { x: number; z: number; continues: boolean }[] } | null {
    if (!this.active) return null;
    return { count: this.count, patches: this.patches.filter((p) => p.active).map((p) => ({ x: p.x, z: p.z, continues: p.continues })) };
  }

  /**
   * PokeRadar_ClearIfAllOutOfView (no field task running): a patch off the screen stops being live; none left
   * clears the chain and fades the BGM back.
   */
  dropUnseen(visible: (x: number, z: number) => boolean): void {
    if (!this.active) return;
    for (const p of this.patches) if (p.active && !visible(p.x, p.z)) p.active = false;
    if (this.patches.every((p) => !p.active)) {
      this.clear();
      this.host.restoreBgm();
    }
  }

  /**
   * PokeRadar_ShouldDoRadarEncounter: the player stepped into a live patch. A chain going on (not the first patch)
   * that continues counts up, records it and keeps its species and level (maybe shiny); otherwise the patch's shake
   * becomes the chain's and the encounter draws a slot.
   */
  enter(x: number, z: number): RadarEncounter | null {
    const ring = this.patches.findIndex((p) => p.active && p.x === x && p.z === z);
    if (ring < 0) return null;
    this.fromPatch = true;
    const patch = this.patches[ring]!;
    if (!this.first) {
      if (patch.continues) {
        this.increment();
        return { shake: patch.shake, preserve: true, shiny: patch.shiny };
      }
    } else {
      this.first = false;
      this.recordSlot = radarRecordSlot(specialEncounters(this.state).radarRecords);
    }
    this.shake = patch.shake;
    return { shake: patch.shake, preserve: false, shiny: false };
  }

  /** The chain's species and level (GetRadarMon). */
  mon(): { species: Id | null; level: number } {
    return { species: this.species, level: this.level };
  }

  /**
   * CreateWildMon_FromRadarNoChain's chain rule: no species yet starts it at the drawn one; the same species counts up
   * at the chain's level; another clears the chain. Returns the Pokémon to battle.
   */
  drew(species: Id, level: number): { species: Id; level: number } {
    if (this.species === null) {
      this.species = species;
      this.level = level;
      this.increment();
      return { species, level };
    }
    if (species === this.species) {
      this.increment();
      return { species, level: this.level };
    }
    this.clear();
    return { species, level };
  }

  /** RadarChain_Increment: the count (capped at 999) and the record. */
  private increment(): void {
    this.count = Math.min(RADAR_CHAIN_MAX, this.count + 1);
    if (this.species === null) throw new Error('radar: a chain counts with no species');
    this.recordSlot = radarRecordChain(specialEncounters(this.state).radarRecords, this.recordSlot, this.species, this.count);
  }

  /**
   * FieldTask_WildEncounter after the battle: a chain not from a patch, or a patch battle neither won nor caught,
   * ends. Returns whether the patches shake again (SetupGrassPatches with the result).
   */
  afterBattle(outcome: string): boolean {
    if (!this.active) return false;
    if (!this.fromPatch || (outcome !== 'won' && outcome !== 'caught')) {
      this.clear();
      return false;
    }
    this.setup(outcome);
    this.startEffects();
    return true;
  }
}
