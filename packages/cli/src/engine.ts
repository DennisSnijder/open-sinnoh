/** The real World, script VM, menu apps, the Pokétch, battle engine and contest move animations for headless runs. */
import type { CreateApp, CreateBattle, CreateContestMoveAnimation, CreatePoketch, CreateScriptRunner, CreateWorld } from '@opensinnoh/contracts';
import { createBattle, createContestMoveAnimation } from '@opensinnoh/battle';
import { createApp, createPoketch } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';

export interface Engine {
  createWorld: CreateWorld;
  createScriptRunner: CreateScriptRunner;
  createApp: CreateApp;
  createBattle: CreateBattle;
  createPoketch: CreatePoketch;
  createContestAnimation?: CreateContestMoveAnimation;
}

export function loadEngine(): Promise<Engine> {
  return Promise.resolve({ createWorld, createScriptRunner, createApp, createBattle, createPoketch, createContestAnimation: createContestMoveAnimation });
}
