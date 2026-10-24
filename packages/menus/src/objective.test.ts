import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLOCK, readPackFolder, type Id, type RegistryRecord } from '@opensinnoh/core';
import { DEFAULT_DEVICE_OPTIONS, type AppHost, type GameState, type NewGame, type StartMenuView } from '@opensinnoh/contracts';
import { loadGamePacks, newGameState } from '@opensinnoh/game';
import { createApp, createOptions, currentObjective } from './index.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const pack = readPackFolder((p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined), 'packs/fixture');
const { registries, loaded } = loadGamePacks([pack]);
const record = [...registries.newGame.values()][0]!;
const id = (s: string) => `fixture:${s}` as Id;
const fresh = (): GameState => newGameState(record, registries, loaded.order, 1);
const objective = (s: GameState) => currentObjective(s, registries)?.text;

function host(objectiveOn: boolean): AppHost {
  const options = { ...DEFAULT_DEVICE_OPTIONS, objective: objectiveOn ? 0 : 1 };
  return { options: () => options, setOption: (k, v) => void (options[k] = v), save: () => {}, fieldMoveCheck: () => null, useFieldMove: () => {}, fieldItemCheck: () => null, useFieldItem: () => {}, clock: () => DEFAULT_CLOCK };
}

describe('the objective (OpenSinnoh option `objective`, NewGame.objectives)', () => {
  it('is the first step not done, and the explore text once every step is done', () => {
    const s = fresh();
    expect(objective(s)).toBe(id('OpenSinnoh_Objective_WakeUp'));
    s.vars[id('VAR_ROOM_INTRO')] = 1;
    expect(objective(s)).toBe(id('OpenSinnoh_Objective_FindGuide'));
    s.flags[id('FLAG_FIRST_ARRIVAL_ETERNA_CITY')] = true;
    expect(objective(s)).toBe(id('OpenSinnoh_Objective_CoalToken'));
    s.badges.push(id('BADGE_ID_COAL'));
    expect(objective(s)).toBe(id('OpenSinnoh_Objective_Explore'));
  });

  it('a later step done does not skip an earlier one that is not', () => {
    const s = fresh();
    s.vars[id('VAR_ROOM_INTRO')] = 1;
    s.badges.push(id('BADGE_ID_COAL'));
    expect(objective(s)).toBe(id('OpenSinnoh_Objective_FindGuide'));
  });

  it('a var check needs at least its value; any one check of a step marks it done', () => {
    const r = loadGamePacks([structuredClone(pack)]).registries;
    const game = [...r.newGame.values()][0]! as RegistryRecord & NewGame;
    game.objectives = {
      title: id('OpenSinnoh_Objective_Title'),
      explore: id('OpenSinnoh_Objective_Explore'),
      steps: [
        { text: id('OpenSinnoh_Objective_WakeUp'), done: [{ kind: 'var', var: id('VAR_ROOM_INTRO'), atLeast: 2 }, { kind: 'flag', flag: id('FLAG_GAME_COMPLETED') }] },
        { text: id('OpenSinnoh_Objective_FindGuide'), done: [{ kind: 'badge', badge: id('BADGE_ID_COAL') }] },
      ],
    };
    const s = fresh();
    s.vars[id('VAR_ROOM_INTRO')] = 1;
    expect(currentObjective(s, r)?.text).toBe(id('OpenSinnoh_Objective_WakeUp'));
    s.vars[id('VAR_ROOM_INTRO')] = 2;
    expect(currentObjective(s, r)?.text).toBe(id('OpenSinnoh_Objective_FindGuide'));
    s.vars[id('VAR_ROOM_INTRO')] = 0;
    s.flags[id('FLAG_GAME_COMPLETED')] = true;
    expect(currentObjective(s, r)?.text).toBe(id('OpenSinnoh_Objective_FindGuide'));
  });

  it('packs without a table have no objective', () => {
    const r = loadGamePacks([structuredClone(pack)]).registries;
    delete ([...r.newGame.values()][0]! as RegistryRecord & NewGame).objectives;
    expect(currentObjective(fresh(), r)).toBeNull();
  });

  it('the start menu shows it with the option on, in the pack words, and not with it off (the DS default)', () => {
    const s = fresh();
    s.vars[id('VAR_ROOM_INTRO')] = 1;
    const view = (on: boolean) => createApp({ app: 'start-menu' }, { registries, state: s, log: { stub: () => {} }, host: host(on) }).view() as StartMenuView;
    expect(view(true).objective).toEqual({ title: 'PURPOSE', text: 'Find the guide east of here.' });
    expect(view(false).objective).toBeUndefined();
    expect(DEFAULT_DEVICE_OPTIONS.objective).toBe(1);
  });

  it('OPTIONS lists the toggle', () => {
    const app = createOptions(registries, host(true), { stub: () => {} });
    const rows = (app.view() as { rows: { key: string; label: string; value: number }[] }).rows;
    expect(rows.find((r) => r.key === 'objective')).toMatchObject({ label: 'PURPOSE', value: 0 });
  });
});
