/**
 * The start menu's objective table for Platinum (contracts `ObjectiveTables`; an OpenSinnoh addition). The texts are
 * our own words; the checks name the decomp's flags, vars and badges that mark each story beat (the story checkpoints
 * in docs/research/story-cp5-19.md and story-cp20-24.md). A step is done when any of its checks holds: each step also
 * lists a later beat the story cannot reach without it (the next badge, or the Champion's clear), so a marker that is
 * skipped or reset later never brings an old step back. Only markers the story sets once and never clears are used.
 */
import { asId, type Id } from '@opensinnoh/core';
import type { ObjectiveCheck, ObjectiveTables } from '@opensinnoh/contracts';
import type { RomLanguage } from '@opensinnoh/nds';

type Check = `FLAG_${string}` | `VAR_${string} ${number}` | `BADGE_${string}`;

/**
 * [text id suffix, our words, checks, the town or city the step leads to (a Town Map fly location's MAP_HEADER_ name,
 * where one is clear)]: in story order.
 */
const STEPS: [string, string, Check[], string?][] = [
  // The opening (Twinleaf, Route 201, Lake Verity, Sandgem).
  ['VisitBarry', 'Visit Barry in the house next door.', ['FLAG_RIVAL_LEFT_HOME', 'VAR_PLAYER_STARTER 1'], 'TWINLEAF_TOWN'],
  ['Route201', 'Catch up with Barry on Route 201.', ['VAR_PLAYER_STARTER 1']],
  ['HomeToMom', 'Head home and tell Mom what happened.', ['VAR_PLAYER_HOUSE_STATE 4', 'FLAG_HAS_POKEDEX'], 'TWINLEAF_TOWN'],
  ['LakeVerity', 'Go with Barry to Lake Verity.', ['VAR_VISITED_LAKE_VERITY_WITH_RIVAL 1', 'FLAG_HAS_POKEDEX']],
  ['RowanLab', "Visit Professor Rowan's lab in Sandgem Town.", ['FLAG_HAS_POKEDEX'], 'SANDGEM_TOWN'],
  ['MomParcel', 'Go home to Twinleaf Town and see Mom.', ['FLAG_RECEIVED_PARCEL', 'BADGE_ID_COAL'], 'TWINLEAF_TOWN'],
  ['Parcel', 'Deliver the Parcel to Barry in Jubilife City.', ['FLAG_TALKED_TO_TRAINERS_SCHOOL_RIVAL', 'BADGE_ID_COAL'], 'JUBILIFE_CITY'],
  ['Poketch', 'Get a Pokétch in Jubilife City.', ['FLAG_RECEIVED_POKETCH', 'BADGE_ID_COAL'], 'JUBILIFE_CITY'],
  // Coal Badge.
  ['Oreburgh', 'Head east to Oreburgh City.', ['FLAG_FIRST_ARRIVAL_OREBURGH_CITY', 'BADGE_ID_COAL'], 'OREBURGH_CITY'],
  ['RoarkMine', 'Find Roark in the Oreburgh Mine.', ['FLAG_ROARK_RETURNED_TO_OREBURGH_GYM', 'BADGE_ID_COAL'], 'OREBURGH_CITY'],
  ['Roark', 'Beat Roark at the Oreburgh Gym.', ['BADGE_ID_COAL'], 'OREBURGH_CITY'],
  // Forest Badge.
  ['Floaroma', 'Find out what Team Galactic is up to in Floaroma Town.', ['FLAG_OBTAINED_FLOAROMA_MEADOW_WORKS_KEY', 'BADGE_ID_FOREST'], 'FLOAROMA_TOWN'],
  ['Windworks', 'Free the Valley Windworks from Team Galactic.', ['VAR_VALLEY_WINDWORKS_STATE 2', 'BADGE_ID_FOREST']],
  ['Eterna', 'Go through Eterna Forest to Eterna City.', ['FLAG_FIRST_ARRIVAL_ETERNA_CITY', 'BADGE_ID_FOREST'], 'ETERNA_CITY'],
  ['Gardenia', 'Beat Gardenia at the Eterna Gym.', ['BADGE_ID_FOREST'], 'ETERNA_CITY'],
  // Relic Badge.
  ['EternaBuilding', 'Stop Team Galactic at their building in Eterna City.', ['FLAG_TEAM_GALACTIC_LEFT_ETERNA_BUILDING', 'BADGE_ID_RELIC'], 'ETERNA_CITY'],
  ['Bicycle', "Get a Bicycle at Eterna City's Cycle Shop.", ['FLAG_RECEIVED_BICYCLE', 'BADGE_ID_RELIC'], 'ETERNA_CITY'],
  ['Hearthome', 'Head south to Hearthome City.', ['FLAG_FIRST_ARRIVAL_HEARTHOME_CITY', 'BADGE_ID_RELIC'], 'HEARTHOME_CITY'],
  ['Fantina', 'Beat Fantina at the Hearthome Gym.', ['BADGE_ID_RELIC'], 'HEARTHOME_CITY'],
  // Cobble Badge.
  ['Veilstone', 'Head east through Solaceon Town to Veilstone City.', ['FLAG_FIRST_ARRIVAL_VEILSTONE_CITY', 'BADGE_ID_COBBLE'], 'VEILSTONE_CITY'],
  ['Maylene', 'Beat Maylene at the Veilstone Gym.', ['BADGE_ID_COBBLE'], 'VEILSTONE_CITY'],
  // Fen Badge.
  ['Warehouse', "Stop Team Galactic at their warehouse in Veilstone City.", ['VAR_PASTORIA_CITY_STATE 1', 'BADGE_ID_FEN'], 'VEILSTONE_CITY'],
  ['Pastoria', 'Head south to Pastoria City.', ['VAR_PASTORIA_CITY_STATE 2', 'BADGE_ID_FEN'], 'PASTORIA_CITY'],
  ['Wake', 'Beat Crasher Wake at the Pastoria Gym.', ['BADGE_ID_FEN'], 'PASTORIA_CITY'],
  // Mine Badge.
  ['GruntChase', 'Follow the Team Galactic Grunt to Valor Lakefront.', ['VAR_PASTORIA_CITY_STATE 6', 'BADGE_ID_MINE']],
  ['Psyduck', 'Use the SecretPotion on the Psyduck on Route 210.', ['FLAG_USED_SECRETPOTION', 'BADGE_ID_MINE']],
  ['OldCharm', 'Take the Old Charm to Celestic Town.', ['FLAG_DELIVERED_OLD_CHARM', 'BADGE_ID_MINE'], 'CELESTIC_TOWN'],
  ['Celestic', 'Stop Team Galactic in Celestic Town.', ['VAR_CELESTIC_TOWN_STATE 1', 'BADGE_ID_MINE'], 'CELESTIC_TOWN'],
  ['Canalave', 'Surf west from Jubilife City to Canalave City.', ['FLAG_FIRST_ARRIVAL_CANALAVE_CITY', 'BADGE_ID_MINE'], 'CANALAVE_CITY'],
  ['Byron', 'Beat Byron at the Canalave Gym.', ['BADGE_ID_MINE'], 'CANALAVE_CITY'],
  // Icicle Badge.
  ['Library', 'Meet Professor Rowan at the Canalave Library.', ['VAR_CANALAVE_LIBRARY_STATE 2', 'BADGE_ID_ICICLE'], 'CANALAVE_CITY'],
  ['LakeValor', 'Stop Team Galactic at Lake Valor.', ['FLAG_DEFEATED_COMMANDER_SATURN_VALOR_CAVERN', 'BADGE_ID_ICICLE']],
  ['VerityRescue', 'Hurry to Lake Verity.', ['FLAG_TEAM_GALACTIC_LEFT_LAKE_VERITY', 'BADGE_ID_ICICLE']],
  ['Snowpoint', 'Head through Mt. Coronet to Snowpoint City.', ['FLAG_FIRST_ARRIVAL_SNOWPOINT_CITY', 'BADGE_ID_ICICLE'], 'SNOWPOINT_CITY'],
  ['Candice', 'Beat Candice at the Snowpoint Gym.', ['BADGE_ID_ICICLE'], 'SNOWPOINT_CITY'],
  // Beacon Badge.
  ['LakeAcuity', 'Go to Lake Acuity.', ['VAR_LAKE_ACUITY_STATE 2', 'BADGE_ID_BEACON']],
  ['GalacticHq', "Break into Team Galactic's HQ in Veilstone City.", ['FLAG_FREED_GALACTIC_HQ_POKEMON', 'BADGE_ID_BEACON'], 'VEILSTONE_CITY'],
  ['SpearPillar', 'Climb Mt. Coronet to Spear Pillar and stop Cyrus.', ['VAR_SPEAR_PILLAR_STATE 3', 'BADGE_ID_BEACON']],
  ['DistortionWorld', 'Stop Cyrus in the Distortion World.', ['VAR_EXITED_DISTORTION_WORLD_STATE 1', 'BADGE_ID_BEACON']],
  ['RowanReturn', "Visit Professor Rowan's lab in Sandgem Town.", ['VAR_SANDGEM_TOWN_LAB_STATE 3', 'BADGE_ID_BEACON'], 'SANDGEM_TOWN'],
  ['Sunyshore', 'Head east to Sunyshore City.', ['FLAG_FIRST_ARRIVAL_SUNYSHORE_CITY', 'BADGE_ID_BEACON'], 'SUNYSHORE_CITY'],
  ['Lighthouse', 'Find Volkner at the Vista Lighthouse.', ['FLAG_VOLKNER_RETURNED_TO_GYM', 'BADGE_ID_BEACON'], 'SUNYSHORE_CITY'],
  ['Volkner', 'Beat Volkner at the Sunyshore Gym.', ['BADGE_ID_BEACON'], 'SUNYSHORE_CITY'],
  // The Pokémon League.
  ['VictoryRoad', 'Head north from Sunyshore City to Victory Road.', ['FLAG_FIRST_ARRIVAL_VICTORY_ROAD', 'FLAG_GAME_COMPLETED']],
  ['League', 'Make it through Victory Road to the Pokémon League.', ['FLAG_FIRST_ARRIVAL_POKEMON_LEAGUE', 'FLAG_GAME_COMPLETED'], 'POKEMON_LEAGUE'],
  ['Aaron', 'Take on the Elite Four, starting with Aaron.', ['FLAG_DEFEATED_AARON', 'FLAG_GAME_COMPLETED'], 'POKEMON_LEAGUE'],
  ['Bertha', 'Beat Bertha of the Elite Four.', ['FLAG_DEFEATED_BERTHA', 'FLAG_GAME_COMPLETED'], 'POKEMON_LEAGUE'],
  ['Flint', 'Beat Flint of the Elite Four.', ['FLAG_DEFEATED_FLINT', 'FLAG_GAME_COMPLETED'], 'POKEMON_LEAGUE'],
  ['Lucian', 'Beat Lucian of the Elite Four.', ['FLAG_DEFEATED_LUCIAN', 'FLAG_GAME_COMPLETED'], 'POKEMON_LEAGUE'],
  ['Cynthia', 'Beat Cynthia, the Champion.', ['FLAG_GAME_COMPLETED'], 'POKEMON_LEAGUE'],
  // The post-game: the Battle Zone, the National Pokédex (Route 225's blockade goes once both are done), Stark Mountain.
  ['BattleZone', 'Take the ship from Snowpoint City to the Battle Zone.', ['FLAG_SAILED_TO_BATTLE_ZONE'], 'SNOWPOINT_CITY'],
  ['FightArea', 'Meet Barry in the Fight Area.', ['VAR_FIGHT_AREA_STATE 2'], 'FIGHT_AREA'],
  ['NationalDex', 'See every Pokémon in the Sinnoh Pokédex, then visit Professor Rowan.', ['FLAG_HIDE_FIGHT_AREA_BLOCKADE'], 'SANDGEM_TOWN'],
  ['StarkMountain', 'Head north from the Fight Area to Stark Mountain.', ['FLAG_ARRESTED_CHARON_STARK_MOUNTAIN']],
  ['Buck', 'Find Buck at the Battleground in the Survival Area.', ['FLAG_TALKED_TO_BATTLEGROUND_BUCK'], 'SURVIVAL_AREA'],
  ['StarkDepths', 'Return to the depths of Stark Mountain.', ['FLAG_BATTLED_STARK_MOUNTAIN_ROOM_3_HEATRAN', 'FLAG_CAUGHT_HEATRAN']],
];

const textId = (name: string) => `OpenSinnoh_Objective_${name}`;

/** The steps' words in German (our words; the names of places, people and items as the German game has them). */
const GERMAN_STEPS: Record<string, string> = {
  VisitBarry: 'Besuche Barry im Haus nebenan.',
  Route201: 'Folge Barry zur Route 201.',
  HomeToMom: 'Geh nach Hause und erzähl deiner Mutter, was passiert ist.',
  LakeVerity: 'Geh mit Barry zum See der Wahrheit.',
  RowanLab: 'Besuche Professor Eibes Labor in Sandgemme.',
  MomParcel: 'Geh zurück nach Zweiblattdorf zu deiner Mutter.',
  Parcel: 'Bring Barry das Paket nach Jubelstadt.',
  Poketch: 'Hol dir in Jubelstadt einen Pokétch.',
  Oreburgh: 'Reise nach Osten bis Erzelingen.',
  RoarkMine: 'Suche Veit in der Erzelingen-Mine.',
  Roark: 'Besiege Veit in der Arena Erzelingen.',
  Floaroma: 'Finde heraus, was Team Galaktik in Flori vorhat.',
  Windworks: 'Befreie das Windkraftwerk von Team Galaktik.',
  Eterna: 'Geh durch den Ewigwald nach Ewigenau.',
  Gardenia: 'Besiege Silvana in der Arena Ewigenau.',
  EternaBuilding: 'Halte Team Galaktik im Galaktik-Gebäude in Ewigenau auf.',
  Bicycle: 'Hol dir im Fahrradladen in Ewigenau ein Fahrrad.',
  Hearthome: 'Reise nach Süden bis Herzhofen.',
  Fantina: 'Besiege Lamina in der Arena Herzhofen.',
  Veilstone: 'Reise über Trostu nach Osten bis Schleiede.',
  Maylene: 'Besiege Hilda in der Arena Schleiede.',
  Warehouse: 'Halte Team Galaktik in seinem Lagerhaus in Schleiede auf.',
  Pastoria: 'Reise nach Süden bis Weideburg.',
  Wake: 'Besiege Wellenbrecher Marinus in der Arena Weideburg.',
  GruntChase: 'Folge dem Rüpel von Team Galaktik zum Kühnheitsufer.',
  Psyduck: 'Gib den Enton auf Route 210 den Geheimtrank.',
  OldCharm: 'Bring den Talisman nach Elyses.',
  Celestic: 'Halte Team Galaktik in Elyses auf.',
  Canalave: 'Surfe von Jubelstadt nach Westen bis Fleetburg.',
  Byron: 'Besiege Adam in der Arena Fleetburg.',
  Library: 'Triff Professor Eibe in der Bibliothek von Fleetburg.',
  LakeValor: 'Halte Team Galaktik am See der Kühnheit auf.',
  VerityRescue: 'Eile zum See der Wahrheit.',
  Snowpoint: 'Reise über den Kraterberg bis Blizzach.',
  Candice: 'Besiege Frida in der Arena Blizzach.',
  LakeAcuity: 'Geh zum See der Stärke.',
  GalacticHq: 'Dring in die Galakti-Zentrale in Schleiede ein.',
  SpearPillar: 'Erklimm den Kraterberg bis zur Speersäule und halte Zyrus auf.',
  DistortionWorld: 'Halte Zyrus in der Zerrwelt auf.',
  RowanReturn: 'Besuche Professor Eibes Labor in Sandgemme.',
  Sunyshore: 'Reise nach Osten bis Sonnewik.',
  Lighthouse: 'Suche Volkner im Leuchtturm von Sonnewik.',
  Volkner: 'Besiege Volkner in der Arena Sonnewik.',
  VictoryRoad: 'Reise von Sonnewik nach Norden zur Siegesstraße.',
  League: 'Durchquere die Siegesstraße bis zur Pokémon Liga.',
  Aaron: 'Fordere die Top Vier heraus, zuerst Herbaro.',
  Bertha: 'Besiege Teresa von den Top Vier.',
  Flint: 'Besiege Ignaz von den Top Vier.',
  Lucian: 'Besiege Lucian von den Top Vier.',
  Cynthia: 'Besiege den Champ, Cynthia.',
  BattleZone: 'Nimm in Blizzach das Schiff zur Kampfzone.',
  FightArea: 'Triff Barry im Kampfareal.',
  NationalDex: 'Sieh alle Pokémon des Sinnoh-Pokédex und besuche dann Professor Eibe.',
  StarkMountain: 'Reise vom Kampfareal nach Norden zum Kahlberg.',
  Buck: 'Finde Buck im Duellareal im Überlebensareal.',
  StarkDepths: 'Kehre in die Tiefen des Kahlbergs zurück.',
};

const OWN_TEXTS: Record<RomLanguage, { title: string; explore: string; option: string; optionDescription: string; step(name: string, english: string): string }> = {
  en: {
    title: 'OBJECTIVE',
    explore: 'Explore Sinnoh.',
    option: 'OBJECTIVE',
    optionDescription: 'The START menu shows what to\ndo next in the story.',
    step: (_, english) => english,
  },
  de: {
    title: 'ZIEL',
    explore: 'Erkunde Sinnoh.',
    option: 'ZIEL',
    optionDescription: 'Das START-Menü zeigt, was in der\nGeschichte als Nächstes kommt.',
    step: (name) => {
      const words = GERMAN_STEPS[name];
      if (words === undefined) throw new Error(`objectives: no German words for step ${name}`);
      return words;
    },
  },
};

/** Our texts for the table and its option (text id → words) in the game's language, added to the pack's texts. */
export function objectiveTexts(language: RomLanguage): Record<string, string> {
  const own = OWN_TEXTS[language];
  return {
    OpenSinnoh_Options_Objective: own.option,
    OpenSinnoh_Options_ObjectiveDescription: own.optionDescription,
    [textId('Title')]: own.title,
    [textId('Explore')]: own.explore,
    ...Object.fromEntries(STEPS.map(([name, words]) => [textId(name), own.step(name, words)])),
  };
}

/**
 * The table, with every flag and var resolved through the names (an unknown name fails the import); a destination must
 * be one of the Town Map's fly locations (`towns`).
 */
export function objectiveTables(names: { flag(name: string): Id; var(name: string): Id }, towns: readonly Id[]): ObjectiveTables {
  const town = (name: string): Id => {
    const id = asId(`platinum:MAP_HEADER_${name}`);
    if (!towns.includes(id)) throw new Error(`objectives: ${name} is not a Town Map fly location`);
    return id;
  };
  const check = (c: Check): ObjectiveCheck => {
    if (c.startsWith('BADGE_')) return { kind: 'badge', badge: asId(`platinum:${c}`) };
    if (c.startsWith('FLAG_')) return { kind: 'flag', flag: names.flag(c) };
    const [name, atLeast] = c.split(' ') as [string, string];
    return { kind: 'var', var: names.var(name), atLeast: Number(atLeast) };
  };
  return {
    title: asId(`platinum:${textId('Title')}`),
    explore: asId(`platinum:${textId('Explore')}`),
    steps: STEPS.map(([name, , checks, to]) => ({ text: asId(`platinum:${textId(name)}`), done: checks.map(check), ...(to ? { to: town(to) } : {}) })),
  };
}
