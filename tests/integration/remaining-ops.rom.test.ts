/**
 * Offline commands outside the story path on the ROM: the trainer appearance at Oreburgh's Pokémon Center
 * (load_trainer_appearances, get_trainer_info_trainer_class, calculate/set_trainer_info_appearance,
 * buffer_trainer_class_from_appearance).
 */
import { describe, expect, it } from 'vitest';
import type { Id } from '@opensinnoh/core';
import { createBattle } from '@opensinnoh/battle';
import { CountingStubLog, createGame, gameDriver, runReplay } from '@opensinnoh/game';
import { createApp } from '@opensinnoh/menus';
import { appearanceTrainerClass, calculateAppearance, createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';
import { resolveReplay } from '../rom-replays/sys-replays.ts';

/** pl_msg TEXT_BANK_TRAINER_CLASS_NAMES_WITH_ARTICLES. */
const CLASS_NAMES_WITH_ARTICLES = 620;

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('trainer appearance at Oreburgh Pokémon Center (OPENSINNOH_NDS_ROM)', () => {
  it('the psychic offers four looks, saves the first, and names its class when talked to again', async () => {
    const log = new CountingStubLog(() => {});
    const game = createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, createBattle, createApp, seed: 1, log, now: () => '2009-03-22T12:00:00Z' });
    const replay = `warp platinum:MAP_HEADER_OREBURGH_CITY_POKECENTER_1F 6 9 left
until idle
+0 press a
+1 release a
advance text 2000
until menu 2000
+5 press a
+1 release a
advance text 2000
until yesno 2000
+5 press a
+1 release a
advance text 3000
until idle 600
+0 assert flag platinum:FLAG_CHOSE_UNION_ROOM_APPEARANCE true
+0 press a
+1 release a
until message 600
`;
    const r = await runReplay(gameDriver(game), replay, { name: 'inline', registries: game.registries, resolve: resolveReplay, seed: 1, repeat: false });
    expect(r.error).toBeUndefined();
    expect(game.state.appearance).toBe(calculateAppearance(game.state, 0));
    // WhatKindOfTrainerDoYouLike: the saved look's class, with its article.
    const bank = [...game.registries.textBanks.values()].find((b) => b.sourceIndex === CLASS_NAMES_WITH_ARTICLES)!;
    const name = game.registries.texts.get(bank.messages[appearanceTrainerClass(game.state, game.state.appearance!)] as Id)!.text;
    expect(game.scripts.view().message?.text).toContain(name);
    expect([...log.counts.keys()].filter((k) => /appearance|trainer_class|trainer_info/.test(k))).toEqual([]);
  });
});
