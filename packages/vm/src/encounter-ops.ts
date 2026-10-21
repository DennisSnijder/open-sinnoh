/**
 * The special encounters' script commands (decomp scrcmd.c ScrCmd_SlatherHoneyTree, ScrCmd_GetHoneyTreeStatus,
 * ScrCmd_StartHoneyTreeBattle, ScrCmd_StopHoneyTreeShaking, ScrCmd_EnableSwarms, ScrCmd_GetSwarmMapAndSpecies,
 * ScrCmd_AddTrophyGardenMon, ScrCmd_GetTrophyGardenSlot1Species). The rules are core's (special-encounters.ts); the
 * rolls take the field stream (the DS's LCRNG), so they move nothing else.
 */
import { newGameRecord, type SpecialEncounterTables } from '@opensinnoh/contracts';
import {
  addTrophyGardenMon, honeyTreeLevel, honeyTreeSpecies, honeyTreeStatus, nextFieldRandom, readSpecialEncounters, slatherHoneyTree, specialEncounters, swarmDailyOf, swarmIndex, type Arg, type Id,
} from '@opensinnoh/core';
import { scriptBattle } from './m2a-ops.ts';
import type { Handler, Runner, Thread } from './runner.ts';

export function encounterHandlers(r: Runner): Record<string, Handler> {
  const tables = (op: string): SpecialEncounterTables => {
    const t = newGameRecord(r.registries).specialEncounters;
    if (!t) throw new Error(`${op}: the packs have no special encounters (NewGame.specialEncounters)`);
    return t;
  };
  const rand = (n: number) => nextFieldRandom(r.state) % n;
  const dest = (t: Thread, a: Arg | undefined, v: number) => r.setVar(t, r.ref(a, 'var'), v);
  /** GetTreeIDFromMapHeaderID on the current map (the handlers assert a tree is there). */
  const treeId = (op: string): number => {
    const id = tables(op).honeyTrees.zones.indexOf(r.state.player.zone);
    if (id < 0) throw new Error(`${op}: ${r.state.player.zone} has no honey tree`);
    return id;
  };
  const sourceOf = (kind: 'zones' | 'species', id: Id): number => {
    const n = r.registries[kind].get(id)?.sourceIndex;
    if (n === undefined) throw new Error(`${kind} ${id} has no sourceIndex`);
    return n;
  };
  return {
    /** HoneyTree_GetTreeSlatherStatus: TREE_STATUS_BARE (1), _SLATHERED (2) or _ENCOUNTER (3). */
    get_honey_tree_status: (t, _c, a) => {
      const id = treeId('get_honey_tree_status');
      dest(t, a[0], honeyTreeStatus(readSpecialEncounters(r.state).honeyTrees[id]!));
      return 'continue';
    },
    /** HoneyTree_SlatherTree: a day of honey, the group, slot and shakes rolled (Munchlax trees by the 32-bit trainer id). */
    slather_honey_tree: () => {
      slatherHoneyTree(specialEncounters(r.state), treeId('slather_honey_tree'), r.state.trainerId, rand);
      return 'continue';
    },
    /**
     * Encounter_NewVsHoneyTree: the radar chain cleared (the world's battle start), the tree's species at level 5–15
     * (CreateWildMon_HoneyTree), the tree bare again before the battle (HoneyTree_Unslather), PLAIN backdrop and
     * terrain. The script waits for the battle.
     */
    start_honey_tree_battle: (t, c) => {
      const id = treeId('start_honey_tree_battle');
      const tree = specialEncounters(r.state).honeyTrees[id]!;
      const species = honeyTreeSpecies(tables('start_honey_tree_battle').honeyTrees.tables, tree);
      const lead = r.state.party[0];
      const ability = lead && !lead.isEgg && lead.ability ? lead.ability.slice(lead.ability.indexOf(':') + 1).replace(/^ABILITY_/, '') : null;
      const level = honeyTreeLevel(ability, rand);
      tree.minutes = 0;
      r.field.stopHoneyTreeShaking();
      return scriptBattle(r, t, c, { kind: 'static', trainers: [], wild: [{ species, level }], honeyTree: true });
    },
    /** HoneyTree_StopShaking: the tree's shake stops (the battle already left it bare). */
    stop_honey_tree_shaking: () => {
      treeId('stop_honey_tree_shaking');
      r.field.stopHoneyTreeShaking();
      return 'continue';
    },
    /** SpecialEncounter_EnableSwarms. */
    enable_swarms: () => {
      specialEncounters(r.state).swarms = true;
      return 'continue';
    },
    /** Swarm_GetMapIdAndSpecies: the day's swarm zone (map header) and its first swarm species. */
    get_swarm_map_and_species: (t, _c, a) => {
      const zone = tables('get_swarm_map_and_species').swarms[swarmIndex(swarmDailyOf(r.state))]!;
      const table = r.registries.zones.get(zone)?.encounters;
      const species = table && r.registries.encounters.get(table)?.variants.swarm?.find((v) => v.slot === 0)?.species;
      if (!species) throw new Error(`get_swarm_map_and_species: ${zone} has no swarm species`);
      dest(t, a[0], sourceOf('zones', zone));
      dest(t, a[1], sourceOf('species', species));
      return 'continue';
    },
    /** TrophyGarden_AddNewMon: a new species in slot 1, slot 1 to slot 2. */
    add_trophy_garden_mon: () => {
      addTrophyGardenMon(specialEncounters(r.state), tables('add_trophy_garden_mon').trophyGarden.species, rand);
      return 'continue';
    },
    /** TrophyGarden_GetSlot1Species (asserts a species is there). */
    get_trophy_garden_slot1_species: (t, _c, a) => {
      const slot = readSpecialEncounters(r.state).trophyGarden[0];
      if (slot === null) throw new Error('get_trophy_garden_slot1_species: the Trophy Garden has no species yet');
      dest(t, a[0], sourceOf('species', tables('get_trophy_garden_slot1_species').trophyGarden.species[slot]!));
      return 'continue';
    },
  };
}
