/**
 * The start menu's objective (OpenSinnoh option `objective`, the importer's objectives.ts) on the real ROM
 * (OPENSINNOH_NDS_ROM): a new game, then the end of every story checkpoint (its chain anchor on seed 1), each with
 * the objective the player has next.
 */
import { describe, expect, it } from 'vitest';
import { GERMAN, type Id } from '@opensinnoh/core';
import { objectiveTexts } from '@opensinnoh/importer';
import { currentObjective } from '@opensinnoh/menus';
import { gameLanguage } from '@opensinnoh/services';
import { ROM } from '../rom.ts';
import { chainAnchor, storyGame } from './checkpoints-anchors.ts';

const objective = (name: string) => `platinum:OpenSinnoh_Objective_${name}` as Id;

/** Each checkpoint's end and the objective it leaves (docs/testing.md "Story checkpoints"). */
const CHECKPOINTS: [string, string][] = [
  ['opening.replay', 'RowanLab'],
  ['cp2.replay', 'Parcel'],
  ['cp3.replay', 'Oreburgh'],
  ['cp4.replay', 'Floaroma'],
  ['cp5.replay', 'Eterna'],
  ['cp6.replay', 'Bicycle'],
  ['cp7.replay', 'Veilstone'],
  ['cp8.replay', 'Pastoria'],
  ['cp9.replay', 'GruntChase'],
  ['cp10.replay', 'Canalave'],
  ['cp11.replay', 'LakeValor'],
  ['cp12.replay', 'Snowpoint'],
  ['cp13.replay', 'GalacticHq'],
  ['cp14.replay', 'SpearPillar'],
  ['cp15.replay', 'Sunyshore'],
  ['cp16.replay', 'VictoryRoad'],
  ['cp17.replay', 'Aaron'],
  ['cp18.replay', 'Cynthia'],
  ['cp19.replay', 'BattleZone'],
  ['cp20.replay', 'NationalDex'],
  ['cp21a.replay', 'NationalDex'],
  ['cp21f.replay', 'StarkMountain'],
  ['cp22.replay', 'Buck'],
  ['cp23a.replay', 'StarkDepths'],
  ['cp23b.replay', 'Explore'],
  ['cp24.replay', 'Explore'],
];

describe.skipIf(!ROM)('the objective through the story (OPENSINNOH_NDS_ROM)', () => {
  it('a new game: visit Barry next door, in our words', () => {
    const game = storyGame(1);
    const o = currentObjective(game.state, game.registries)!;
    expect(o.text).toBe(objective('VisitBarry'));
    // The importer's words in the ROM's language.
    const own = objectiveTexts(gameLanguage(game.registries) === GERMAN ? 'de' : 'en');
    const words = (id: Id) => own[id.replace(/^platinum:/, '')];
    expect(game.registries.texts.get(o.title)?.text).toBe(words(o.title));
    expect(game.registries.texts.get(o.text)?.text).toBe(words(o.text));
    expect(words(o.text)).toMatch(/\S/);
    // The Town Map marks its destination.
    expect(o.to).toBe('platinum:MAP_HEADER_TWINLEAF_TOWN');
  });

  it('each checkpoint ends with the next story beat as the objective', async () => {
    const seen: [string, Id][] = [];
    for (const [file] of CHECKPOINTS) {
      const game = storyGame(1);
      game.load(JSON.parse(await chainAnchor(file, 1)));
      seen.push([file, currentObjective(game.state, game.registries)!.text]);
    }
    expect(seen).toEqual(CHECKPOINTS.map(([file, name]) => [file, objective(name)]));
  }, 1_800_000);
});
