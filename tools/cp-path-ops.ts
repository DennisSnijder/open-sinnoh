/**
 * Regenerates packages/vm/src/cp-path.ts: the script ops the story scripts reach, per checkpoint chunk.
 * Needs the ROM (OPENSINNOH_NDS_ROM; the shared test import in .opensinnoh-cache); writes op names only.
 *
 * - CP_PATH_OPS: checkpoints 1–4 plus every trainer script and the shared
 *   trainer-approach script.
 * - CP_PATH_OPS_M5A/B/C: checkpoints 5–8, 9–13 and 14–19, from the zones the
 *   story map (docs/research/story-cp5-19.md S§5–19) walks through.
 * - CP_PATH_OPS_M6A/B: the post-game: M6A the CP20–24 zones, M6B the legendary
 *   branch zones. Their roots are every map script and event label of the zones.
 *
 * Roots per zone: the init, on-frame and coord scripts, every trainer object's script and the story NPCs
 * (by label name, plus the entries the story map names). Reachability follows label operands (branches,
 * calls, common scripts). OPTIONAL zones (side branches the story map lists as not required) are walked
 * too and printed, not written.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Id } from '@opensinnoh/core';
import type { NewGame, Zone } from '@opensinnoh/contracts';
import { prepareRomCache, romSlice } from '../tests/rom.ts';

const M1 = [
  'TWINLEAF_TOWN', 'TWINLEAF_TOWN_PLAYER_HOUSE_1F', 'TWINLEAF_TOWN_PLAYER_HOUSE_2F', 'TWINLEAF_TOWN_RIVAL_HOUSE_1F', 'TWINLEAF_TOWN_RIVAL_HOUSE_2F',
  'ROUTE_201', 'VERITY_LAKEFRONT', 'LAKE_VERITY_LOW_WATER', 'SANDGEM_TOWN', 'SANDGEM_TOWN_POKEMON_RESEARCH_LAB', 'ROUTE_202', 'JUBILIFE_CITY',
  'TRAINERS_SCHOOL', 'ROUTE_203', 'OREBURGH_GATE_1F', 'OREBURGH_CITY', 'OREBURGH_MINE_B1F', 'OREBURGH_MINE_B2F', 'OREBURGH_CITY_GYM',
];
const M1_STORY_NPC = /Mom|Rival|Counterpart|Rowan|Clown|Poketch|President|Roark|Dawn|Lucas|Cyrus|Looker|Assistant/;

interface Chunk {
  name: string;
  /** Zones on the required path, by checkpoint (S§n). */
  zones: string[];
  /** Side zones the story map names as optional. */
  optional: string[];
  /** Story entries the story map names (by label), on top of the name rule. */
  labels: string[];
  /**
   * Every script entry whose label matches: the Distortion World's events are not in its zones' event data
   * (its own object and coord system, decomp ov9), so its rooms' entries are roots by name.
   */
  entries?: RegExp;
  /** Every object, bg and coord label of the zones is a root (the post-game chunks), not only trainers and story NPCs. */
  allEvents?: boolean;
}

const CHUNKS: Chunk[] = [
  {
    name: 'M5A',
    zones: [
      // CP5 (S§5): Jubilife tag battle, Floaroma Meadow, Valley Windworks.
      'JUBILIFE_CITY', 'ROUTE_204_SOUTH', 'RAVAGED_PATH', 'ROUTE_204_NORTH', 'FLOAROMA_TOWN', 'FLOAROMA_MEADOW', 'FLOAROMA_MEADOW_HOUSE', 'ROUTE_205_SOUTH',
      'VALLEY_WINDWORKS_OUTSIDE', 'VALLEY_WINDWORKS_BUILDING',
      // CP6 (S§6): Eterna Forest with Cheryl, Gardenia, the Galactic building.
      'ROUTE_205_NORTH', 'ETERNA_FOREST', 'ETERNA_CITY', 'ETERNA_CITY_GYM', 'TEAM_GALACTIC_ETERNA_BUILDING_1F', 'TEAM_GALACTIC_ETERNA_BUILDING_2F',
      'TEAM_GALACTIC_ETERNA_BUILDING_3F', 'TEAM_GALACTIC_ETERNA_BUILDING_4F',
      // CP7 (S§7): Egg, Bicycle, Cycling Road, Hearthome, Fantina.
      'CYCLE_SHOP', 'ETERNA_CITY_UNDERGROUND_MAN_HOUSE', 'ROUTE_206_CYCLING_ROAD_NORTH_GATE', 'ROUTE_206', 'ROUTE_206_CYCLING_ROAD_SOUTH_GATE', 'ROUTE_207',
      'MT_CORONET_1F_SOUTH', 'ROUTE_208', 'ROUTE_208_GATE_TO_HEARTHOME_CITY', 'HEARTHOME_CITY', 'CONTEST_HALL_LOBBY', 'HEARTHOME_CITY_GYM_ENTRANCE_ROOM',
      'HEARTHOME_CITY_GYM_TRAINER_ROOM_1', 'HEARTHOME_CITY_GYM_TRAINER_ROOM_2', 'HEARTHOME_CITY_GYM_LEADER_ROOM', 'ROUTE_209_GATE_TO_HEARTHOME_CITY',
      // CP8 (S§8): Route 209, Solaceon, Maylene, the Veilstone tag battle and the warehouse.
      'ROUTE_209', 'SOLACEON_TOWN', 'ROUTE_210_SOUTH', 'ROUTE_215', 'VEILSTONE_CITY', 'VEILSTONE_CITY_GYM', 'VEILSTONE_CITY_GALACTIC_WAREHOUSE',
    ],
    optional: ['WAYWARD_CAVE_1F', 'ROUTE_209_LOST_TOWER_1F', 'SOLACEON_RUINS_ROOM_7'],
    labels: [
      'FloaromaMeadow_CoordEvent_Grunts', 'JubilifeCity_CoordEvent_TeamGalactic', 'Route205South_LittleGirl', 'ValleyWindworksOutside_Door', 'ValleyWindworksOutside_GruntM',
      'EternaCity_Gardenia', 'EternaGym_Gardenia', 'EternaGym_LassCaroline', 'TeamGalacticEternaBuilding4F_Jupiter', 'ContestHallLobby_Fantina', 'CycleShop_PokefanM',
      'EternaCity_Cynthia', 'HearthomeGym_Fantina', 'VeilstoneCity_Counterpart', 'VeilstoneGym_Maylene',
      'VisibleItems_VeilstoneCityGalacticWarehouse_HM02',
    ],
  },
  {
    name: 'M5B',
    zones: [
      // CP9 (S§9): Pastoria, Wake, the bomb.
      'ROUTE_214_GATE_TO_VEILSTONE_CITY', 'ROUTE_214', 'VALOR_LAKEFRONT', 'ROUTE_213', 'PASTORIA_CITY', 'PASTORIA_CITY_GYM',
      // CP10 (S§10): the grunt chase, the Psyduck, Celestic Town, Surf.
      'GRAND_LAKE_ROUTE_213_LOBBY', 'ROUTE_210_SOUTH', 'ROUTE_210_NORTH', 'CELESTIC_TOWN', 'CELESTIC_TOWN_CAVE', 'CELESTIC_TOWN_NORTH_HOUSE',
      // CP11 (S§11): Canalave, Iron Island, Byron, the library.
      'ROUTE_218_GATE_TO_JUBILIFE_CITY', 'ROUTE_218', 'ROUTE_218_GATE_TO_CANALAVE_CITY', 'CANALAVE_CITY', 'CANALAVE_CITY_GYM', 'IRON_ISLAND', 'IRON_ISLAND_HOUSE',
      'IRON_ISLAND_1F', 'IRON_ISLAND_B1F_LEFT_ROOM', 'IRON_ISLAND_B1F_RIGHT_ROOM', 'IRON_ISLAND_B2F_LEFT_ROOM', 'IRON_ISLAND_B2F_RIGHT_ROOM', 'IRON_ISLAND_B3F',
      'CANALAVE_LIBRARY_1F', 'CANALAVE_LIBRARY_2F', 'CANALAVE_LIBRARY_3F',
      // CP12 (S§12): Valor Cavern Saturn, Lake Verity Mars, the northward passage.
      'LAKE_VALOR_DRAINED', 'VALOR_CAVERN', 'LAKE_VERITY', 'ROUTE_211_WEST', 'ROUTE_211_EAST', 'MT_CORONET_1F_TUNNEL_ROOM', 'MT_CORONET_1F_NORTH_ROOM_1',
      'MT_CORONET_1F_NORTH_ROOM_2',
      // CP13 (S§13): Route 216/217, HM08, Candice, the Acuity scene.
      'ROUTE_216', 'ROUTE_217', 'ACUITY_LAKEFRONT', 'SNOWPOINT_CITY', 'SNOWPOINT_CITY_GYM', 'LAKE_ACUITY',
    ],
    optional: ['PASTORIA_CITY_OBSERVATORY_GATE_1F', 'GREAT_MARSH_1', 'GREAT_MARSH_2', 'GREAT_MARSH_3', 'GREAT_MARSH_4', 'GREAT_MARSH_5', 'GREAT_MARSH_6', 'SOLACEON_RUINS_ROOM_7'],
    labels: [
      'PastoriaGym_Wake', 'CelesticTownCave_Cyrus', 'CelesticTownCave_Painting', 'CelesticTown_GruntM', 'PastoriaCity_GruntM',
      'Route210South_Psyduck', 'ValorLakefront_GruntM', 'CanalaveCity_SailorEldritch', 'CanalaveGym_Byron', 'IronIsland_Riley',
      'LakeVerity_Mars', 'ValorCavern_Saturn', 'SnowpointGym_Candice', 'VisibleItems_Route217_HM08',
    ],
  },
  {
    name: 'M5C',
    zones: [
      // CP14 (S§14): the Storage Key, Galactic HQ, the release.
      'VEILSTONE_CITY', 'VEILSTONE_CITY_GALACTIC_WAREHOUSE', 'GALACTIC_HQ_1F', 'GALACTIC_HQ_2F', 'GALACTIC_HQ_3F', 'GALACTIC_HQ_4F', 'GALACTIC_HQ_B1F',
      'GALACTIC_HQ_B2F', 'GALACTIC_HQ_HALL', 'GALACTIC_HQ_LABORATORY', 'GALACTIC_HQ_CONTROL_ROOM',
      // CP15 (S§15): Mt. Coronet, Spear Pillar, the Distortion World, Sendoff Spring, Rowan.
      'CELESTIC_TOWN_NORTH_HOUSE', 'MT_CORONET_1F_SOUTH', 'MT_CORONET_1F_TUNNEL_ROOM', 'MT_CORONET_2F', 'MT_CORONET_3F', 'MT_CORONET_OUTSIDE_SOUTH',
      'MT_CORONET_OUTSIDE_NORTH', 'MT_CORONET_4F_ROOMS_1_AND_2', 'MT_CORONET_4F_ROOM_3', 'MT_CORONET_5F', 'MT_CORONET_6F', 'SPEAR_PILLAR', 'SPEAR_PILLAR_DISTORTED',
      'DISTORTION_WORLD_1F', 'DISTORTION_WORLD_B1F', 'DISTORTION_WORLD_B2F', 'DISTORTION_WORLD_B3F', 'DISTORTION_WORLD_B4F', 'DISTORTION_WORLD_B5F',
      'DISTORTION_WORLD_B6F', 'DISTORTION_WORLD_B7F', 'DISTORTION_WORLD_GIRATINA_ROOM', 'SENDOFF_SPRING', 'SANDGEM_TOWN_POKEMON_RESEARCH_LAB',
      // CP16 (S§16): Sunyshore, the lighthouse, Volkner, Waterfall.
      'ROUTE_222', 'ROUTE_222_GATE_TO_SUNYSHORE_CITY', 'SUNYSHORE_CITY', 'VISTA_LIGHTHOUSE', 'VISTA_LIGHTHOUSE_ELEVATOR', 'SUNYSHORE_CITY_GYM_ROOM_1',
      'SUNYSHORE_CITY_GYM_ROOM_2', 'SUNYSHORE_CITY_GYM_ROOM_3',
      // CP17 (S§17): Route 223, Victory Road, Barry in the League lobby.
      'ROUTE_223', 'POKEMON_LEAGUE', 'POKEMON_LEAGUE_SOUTH_POKECENTER_1F', 'VICTORY_ROAD_1F', 'VICTORY_ROAD_2F', 'VICTORY_ROAD_B1F', 'VICTORY_ROAD_1F_ROOM_1',
      'VICTORY_ROAD_1F_ROOM_2', 'VICTORY_ROAD_1F_ROOM_3', 'POKEMON_LEAGUE_NORTH_POKECENTER_1F',
      // CP18 (S§18): the Elite Four.
      'POKEMON_LEAGUE_ELEVATOR_TO_AARON_ROOM', 'POKEMON_LEAGUE_AARON_ROOM', 'POKEMON_LEAGUE_ELEVATOR_TO_BERTHA_ROOM', 'POKEMON_LEAGUE_BERTHA_ROOM',
      'POKEMON_LEAGUE_ELEVATOR_TO_FLINT_ROOM', 'POKEMON_LEAGUE_FLINT_ROOM', 'POKEMON_LEAGUE_ELEVATOR_TO_LUCIAN_ROOM', 'POKEMON_LEAGUE_LUCIAN_ROOM',
      'POKEMON_LEAGUE_ELEVATOR_TO_CHAMPION_ROOM',
      // CP19 (S§19): Cynthia, the Hall of Fame.
      'POKEMON_LEAGUE_CHAMPION_ROOM', 'POKEMON_LEAGUE_HALLWAY_TO_HALL_OF_FAME', 'POKEMON_LEAGUE_HALL_OF_FAME',
    ],
    optional: ['ACUITY_CAVERN', 'VALOR_CAVERN', 'VERITY_CAVERN', 'SPEAR_PILLAR_DIALGA', 'SPEAR_PILLAR_PALKIA', 'VALOR_LAKEFRONT'],
    labels: [
      'GalacticHQControlRoom_Button', 'GalacticHQControlRoom_Saturn', 'VeilstoneCity_GruntMStorageKey',
      'VisibleItems_GalacticHQB2F_GalacticKey', 'CelesticTownNorthHouse_Elder', 'MtCoronet2F_Looker', 'DistortionWorldGiratinaRoom_Giratina',
      'SpearPillarDistorted_Cynthia', 'SpearPillar_Cyrus', 'SunyshoreGymRoom3_Volkner', 'VistaLighthouse_Volkner', 'PokemonLeagueAaronRoom_Aaron',
      'PokemonLeagueBerthaRoom_Bertha', 'PokemonLeagueFlintRoom_Flint', 'PokemonLeagueLucianRoom_Lucian', 'PokemonLeagueNorthPokecenter1F_DoorGuard',
    ],
    entries: /^platinum:DistortionWorld(1F|B\dF|GiratinaRoom)_[^/]+$/,
  },
  {
    name: 'M6A',
    zones: [
      // CP20: Snowpoint's ship, the Fight Area.
      'SNOWPOINT_CITY', 'FIGHT_AREA', 'FIGHT_AREA_POKECENTER_1F', 'FIGHT_AREA_MART', 'FIGHT_AREA_MIDDLE_HOUSE', 'FIGHT_AREA_SOUTH_HOUSE',
      'ROUTE_225_GATE_TO_FIGHT_AREA',
      // CP21: the dex sweep (the Pokémon Mansion book, the Old Chateau, the lake caves) and Rowan's lab.
      'POKEMON_MANSION', 'POKEMON_MANSION_OFFICE', 'POKEMON_MANSION_MAIDS_ROOM', 'OLD_CHATEAU', 'OLD_CHATEAU_DINING_AREA', 'OLD_CHATEAU_SIDE_ROOMS',
      'OLD_CHATEAU_CORRIDOR', 'OLD_CHATEAU_BACK_WEST_ROOM', 'OLD_CHATEAU_BACK_MIDDLE_WEST_ROOM', 'OLD_CHATEAU_BACK_MIDDLE_ROOM',
      'OLD_CHATEAU_BACK_MIDDLE_EAST_ROOM', 'OLD_CHATEAU_BACK_EAST_ROOM', 'ACUITY_CAVERN', 'VALOR_CAVERN', 'VERITY_CAVERN', 'SANDGEM_TOWN_POKEMON_RESEARCH_LAB',
      // CP22: Route 225, the Survival Area, Routes 226/227, Stark Mountain.
      'ROUTE_225', 'ROUTE_225_HOUSE', 'SURVIVAL_AREA', 'SURVIVAL_AREA_MART', 'SURVIVAL_AREA_POKECENTER_1F', 'SURVIVAL_AREA_SOUTH_HOUSE', 'SURVIVAL_AREA_NORTH_HOUSE',
      'ROUTE_226', 'ROUTE_226_HOUSE', 'ROUTE_227', 'ROUTE_227_HOUSE', 'STARK_MOUNTAIN_OUTSIDE', 'STARK_MOUNTAIN_ROOM_1', 'STARK_MOUNTAIN_ROOM_2', 'STARK_MOUNTAIN_ROOM_3',
      // CP23: the Battleground, Snowpoint Temple, Routes 228–230, the Resort Area (no Villa), the Ribbon Syndicate.
      'BATTLEGROUND', 'SNOWPOINT_TEMPLE_1F', 'SNOWPOINT_TEMPLE_B1F', 'SNOWPOINT_TEMPLE_B2F', 'SNOWPOINT_TEMPLE_B3F', 'SNOWPOINT_TEMPLE_B4F', 'SNOWPOINT_TEMPLE_B5F',
      'ROUTE_228', 'ROUTE_228_GATE_TO_ROUTE_226', 'ROUTE_228_NORTH_HOUSE', 'ROUTE_228_SOUTH_HOUSE', 'ROUTE_229', 'ROUTE_230', 'RESORT_AREA',
      'RESORT_AREA_POKECENTER_1F', 'RESORT_AREA_HOUSE', 'RESORT_AREA_RIBBON_SYNDICATE_1F', 'RESORT_AREA_RIBBON_SYNDICATE_2F', 'RESORT_AREA_RIBBON_SYNDICATE_ELEVATOR',
      // CP24: the League rematch.
      'POKEMON_LEAGUE', 'POKEMON_LEAGUE_AARON_ROOM', 'POKEMON_LEAGUE_BERTHA_ROOM', 'POKEMON_LEAGUE_FLINT_ROOM', 'POKEMON_LEAGUE_LUCIAN_ROOM',
      'POKEMON_LEAGUE_CHAMPION_ROOM', 'POKEMON_LEAGUE_HALL_OF_FAME',
    ],
    // Out of scope for this chunk: the Battle Frontier and the Villa, printed for the boundary.
    optional: ['BATTLE_FRONTIER_GATE_TO_FIGHT_AREA', 'BATTLE_FRONTIER', 'BATTLE_TOWER', 'BATTLE_FACTORY', 'BATTLE_HALL', 'BATTLE_CASTLE', 'BATTLE_ARCADE', 'VILLA'],
    labels: [],
    allEvents: true,
  },
  {
    name: 'M6B',
    zones: [
      // Turnback Cave (Giratina) and the Distortion World room.
      'SPRING_PATH', 'SENDOFF_SPRING', 'TURNBACK_CAVE_ENTRANCE', 'TURNBACK_CAVE_PILLAR_ROOM', 'TURNBACK_CAVE_GIRATINA_ROOM',
      ...[1, 2, 3].flatMap((p) => [1, 2, 3, 4, 5, 6].map((r) => `TURNBACK_CAVE_PILLAR_${p}_ROOM_${r}`)), 'DISTORTION_WORLD_TURNBACK_CAVE_ROOM',
      // Dialga and Palkia.
      'CELESTIC_TOWN_NORTH_HOUSE', 'MT_CORONET_6F', 'SPEAR_PILLAR', 'SPEAR_PILLAR_DIALGA', 'SPEAR_PILLAR_PALKIA',
      // Cresselia and Mesprit.
      'CANALAVE_CITY_SAILOR_ELDRITCH_HOUSE', 'FULLMOON_ISLAND', 'FULLMOON_ISLAND_FOREST', 'VERITY_CAVERN',
      // The Regis (Regigigas is in Snowpoint Temple, M6A).
      'IRON_ISLAND_IRON_RUINS', 'IRON_RUINS', 'MT_CORONET_ICEBERG_RUINS', 'ICEBERG_RUINS', 'ROUTE_228_ROCK_PEAK_RUINS', 'ROCK_PEAK_RUINS',
      // Rotom.
      'OLD_CHATEAU_BACK_MIDDLE_WEST_ROOM', 'ROTOMS_ROOM', 'TEAM_GALACTIC_ETERNA_BUILDING_1F',
      // The event legendaries: Darkrai, Shaymin, Arceus.
      'CANALAVE_CITY_HARBOR_INN', 'NEWMOON_ISLAND', 'NEWMOON_ISLAND_FOREST', 'ROUTE_224', 'FLOWER_PARADISE', 'HALL_OF_ORIGIN',
    ],
    optional: [],
    labels: [],
    allEvents: true,
  },
];
/** Story NPCs of CP5–19 by label name: the rivals, Galactic, the professors, the leaders, the Elite Four and the partners. */
const M5_STORY_NPC =
  /Rival|Counterpart|Barry|Dawn|Lucas|Rowan|Looker|Cyrus|Mars|Jupiter|Saturn|Grunt|Cheryl|Riley|Mira|Buck|Marley|Gardenia|Fantina|Maylene|Wake|Byron|Candice|Volkner|Jasmine|Flint|Aaron|Bertha|Lucian|Cynthia|Elder|Giratina|Leader|Gym_/;

await prepareRomCache();
const { pack } = romSlice();
const zones = new Map((pack.registries.zones as unknown as Zone[]).map((z) => [z.id, z]));
const newGame = (pack.registries.newGame as unknown as NewGame[])[0]!;
const labels = pack.scripts.labels;
const zoneId = (z: string) => `platinum:MAP_HEADER_${z}` as Id;
const labelId = (l: string) => `platinum:${l}` as Id;

function rootsOf(names: string[], story: RegExp, extra: string[], entries?: RegExp, allEvents = false): Set<Id> {
  const roots = new Set<Id>();
  if (newGame.trainerApproach) roots.add(newGame.trainerApproach);
  for (const name of names) {
    const z = zones.get(zoneId(name));
    if (!z) throw new Error(`no zone ${name}`);
    const m = z.mapScripts;
    for (const l of [m.onLoad, m.onTransition, m.onResume, ...m.onFrame.map((r) => r.label), ...z.events.coords.map((c) => c.label)]) if (l) roots.add(l);
    for (const o of z.events.objects) if (o.label && (allEvents || o.trainer || story.test(o.label))) roots.add(o.label);
    if (allEvents) for (const l of z.events.bgs.map((b) => b.label)) if (l) roots.add(l);
  }
  for (const l of extra) {
    if (!labels[labelId(l)]) throw new Error(`no label ${l}`);
    roots.add(labelId(l));
  }
  if (entries) for (const id of Object.keys(labels) as Id[]) if (entries.test(id)) roots.add(id);
  return roots;
}

function walk(roots: Set<Id>): { ops: Set<string>; seen: Set<Id> } {
  const ops = new Set<string>();
  const seen = new Set<Id>();
  const work = [...roots];
  while (work.length) {
    const id = work.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const cmds = labels[id];
    if (!cmds) throw new Error(`no label ${id}`);
    for (const c of cmds) {
      ops.add(c.op);
      for (const a of c.args) if (a.kind === 'label') work.push(a.id);
    }
  }
  return { ops, seen };
}

const list = (name: string, doc: string, ops: Set<string>) =>
  `/** ${doc} */\nexport const ${name}: readonly string[] = [\n${[...ops].sort().map((o) => `  '${o}',`).join('\n')}\n];\n`;

const m1Roots = rootsOf(M1, M1_STORY_NPC, []);
const m1 = walk(m1Roots);
const parts = [
  list('CP_PATH_OPS', `Checkpoints 1–4 and the trainer scripts (${m1Roots.size} root labels, ${m1.seen.size} labels).`, m1.ops),
];
for (const c of CHUNKS) {
  const roots = rootsOf(c.zones, M5_STORY_NPC, c.labels, c.entries, c.allEvents);
  const { ops, seen } = walk(roots);
  const opt = walk(rootsOf(c.optional, M5_STORY_NPC, [], undefined, c.allEvents));
  const optOnly = [...opt.ops].filter((o) => !ops.has(o)).sort();
  parts.push(list(`CP_PATH_OPS_${c.name}`, `Chunk ${c.name.slice(0, 2)}${c.name[2]!.toLowerCase()} (${c.zones.length} zones, ${roots.size} root labels, ${seen.size} labels).`, ops));
  console.log(`${c.name}: ${ops.size} ops from ${roots.size} roots (${seen.size} labels); optional zones add: ${optOnly.join(', ') || 'none'}`);
}
const out = join(import.meta.dirname, '../packages/vm/src/cp-path.ts');
writeFileSync(out, `/**\n * Ops the story scripts reach, per checkpoint chunk (generated by tools/cp-path-ops.ts; op names only).\n */\n${parts.join('\n')}`);
console.log(`CP1–4: ${m1.ops.size} ops from ${m1Roots.size} roots (${m1.seen.size} labels) → ${out}`);
