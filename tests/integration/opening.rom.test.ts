/**
 * The real Platinum opening, headless (OPENSINNOH_NDS_ROM): import → createGame with the real World and
 * VM → tests/rom-replays/opening.replay, from new game to the Lake Verity Cyrus scene.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBattle } from '@opensinnoh/battle';
import { CountingStubLog, createGame, gameDriver, runReplay, type ReplayResolver } from '@opensinnoh/game';
import { romSlice } from '../rom.ts';
import { actorKeys } from '../../packages/render/src/index.ts';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';

const romPath = process.env.OPENSINNOH_NDS_ROM;

describe.skipIf(!romPath)('Platinum opening (OPENSINNOH_NDS_ROM)', () => {
  it('plays new game → Mom → rival → Rowan → starter → shoes → rival follows → Cyrus', async () => {
    // The slice is enough: the headless game reads no models.
    const { pack } = romSlice();
    const log = new CountingStubLog(() => {});
    const game = createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, seed: 1, log, now: () => '2026-01-01T00:00:00.000Z' });
    const read = (file: string) => readFileSync(join(import.meta.dirname, '../rom-replays', file), 'utf8');
    const resolve: ReplayResolver = (file) => ({ name: file, text: read(file) });
    const replay = read('opening.replay');
    // The battle log is not saved (the round trip resets it): keep the one the run built, read at the last reset.
    const driver = gameDriver(game);
    let battles = game.battles;
    const result = await runReplay({ ...driver, reset: (seed) => ((battles = game.battles), driver.reset(seed)) }, replay, { registries: game.registries, seed: 1, resolve });
    console.log(`opening: ${result.ticks} ticks, ${result.assertions} asserts, round trip ${JSON.stringify(result.roundTrip)}; stubs ${log.report().map((s) => `${s.key}×${s.count}`).join(', ')}`);
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.roundTrip).toBe('identical');
    // The round trip reloads the save; the state after it is the end of the opening.
    expect(game.state.runningShoes).toBe(true);
    // The starter is a real Pokémon: level 5 → 6 in the first battle (Turtwig L5: 64 · 5 / 7 = 45, ×1.5 for a
    // trainer = 67 exp on top of 135), its level-up moves, the player as OT; HealParty after the battle.
    expect(game.state.party).toHaveLength(1);
    const starter = game.state.party[0]!;
    expect(starter).toMatchObject({ species: 'platinum:SPECIES_PIPLUP', level: 6, exp: 135 + 67, moves: ['platinum:MOVE_POUND', 'platinum:MOVE_GROWL'], pp: [35, 40], otName: game.state.names.player, otId: game.state.trainerId, ball: 'platinum:ITEM_POKE_BALL', ability: 'platinum:ABILITY_TORRENT' });
    expect(starter.hp).toBe(starter.stats.hp);
    // TRAINER_RIVAL_ROUTE_201_PIPLUP (named after your starter) has Turtwig: a real first battle, won;
    // the prize is Turtwig's level 5 · 4 · the rival class's multiplier.
    expect(battles).toEqual([{ tick: expect.any(Number), kind: 'trainer', trainers: ['platinum:TRAINER_RIVAL_ROUTE_201_PIPLUP'], species: [], result: 'won', turns: expect.any(Number), topology: 'single' }]);
    expect(game.state.money).toBe(3000 + 5 * 4 * game.registries.trainers.get('platinum:TRAINER_RIVAL_ROUTE_201_PIPLUP')!.classPrize);
    expect(game.state.player.zone).toBe('platinum:MAP_HEADER_LAKE_VERITY_LOW_WATER');
    // Every stub the opening hits is a known stand-in (audio, battles, doors, unmodelled movement types).
    for (const { key } of log.report()) expect(key).toMatch(/^(audio|stub|door|movement-type|zone-connection|duplicate-local-id|battle):?/);
  }, 120_000);

  // Route 201 lists the Sandgem signboard clone with local id 5, Rowan's: the renderer once keyed its
  // drawables by local id alone, so Rowan never showed. The replay's screenshot lines are the checks.
  it.each([
    { gender: 'male', counterpart: 'platinum:OBJ_EVENT_GFX_PLAYER_F', says: 'platinum:Route201_Text_DawnYouLeftYourBriefcase' },
    { gender: 'female', counterpart: 'platinum:OBJ_EVENT_GFX_PLAYER_M', says: 'platinum:Route201_Text_LucasYouLeftYourBriefcase' },
  ] as const)('Route 201 starter scene ($gender): Rowan and the counterpart are drawn, the counterpart speaks', async ({ gender, counterpart, says }) => {
    const { pack } = romSlice();
    const game = createGame({ packs: [pack], createWorld, createScriptRunner, seed: 1, log: new CountingStubLog(() => {}), now: () => '2026-01-01T00:00:00.000Z' });
    game.reset(1, { names: { ...game.state.names }, gender });
    const lines = readFileSync(join(import.meta.dirname, '../rom-replays/opening-rival.replay'), 'utf8').split('\n');
    const replay = lines.slice(0, lines.findIndex((l) => l.includes('screenshot route201-counterpart')) + 1).join('\n');
    /** The actors the renderer draws: one key each, visible, with a sprite record. */
    const drawn = () => {
      const actors = game.world.view().actors;
      expect(new Set(actorKeys(actors)).size).toBe(actors.length);
      for (const a of actors) expect(game.registries.sprites.has(a.sprite), a.sprite).toBe(true);
      return actors.filter((a) => a.visible).map((a) => ({ sprite: a.sprite, x: Math.floor(a.cur[0] / 16), z: Math.floor(a.cur[2] / 16) }));
    };
    const seen: string[] = [];
    const result = await runReplay(
      {
        ...gameDriver(game),
        async screenshot(name) {
          if (name === 'route201-rowan-speaks') {
            expect(drawn()).toEqual(expect.arrayContaining([{ sprite: 'platinum:OBJ_EVENT_GFX_PROF_ROWAN', x: 113, z: 853 }, { sprite: 'platinum:OBJ_EVENT_GFX_BARRY', x: 114, z: 853 }]));
            expect(game.scripts.view().message?.text).toMatch(/^Professor:/);
          }
          if (name === 'route201-counterpart') {
            // A row west of the rival: counterpart, Rowan, rival; the player one tile south of the rival.
            expect(drawn()).toEqual(
              expect.arrayContaining([
                { sprite: counterpart, x: 112, z: 853 },
                { sprite: 'platinum:OBJ_EVENT_GFX_PROF_ROWAN', x: 113, z: 853 },
                { sprite: 'platinum:OBJ_EVENT_GFX_BARRY', x: 114, z: 853 },
                { sprite: gender === 'male' ? 'platinum:OBJ_EVENT_GFX_PLAYER_M' : 'platinum:OBJ_EVENT_GFX_PLAYER_F', x: 114, z: 854 },
              ]),
            );
            // The first page of the counterpart's line, printed.
            expect(game.scripts.view().message?.text).toBe(game.registries.texts.get(says)!.text.split('{clear}')[0]);
          }
          seen.push(name);
          return name;
        },
      },
      replay,
      { registries: game.registries, seed: 1, repeat: false },
    );
    expect(result.error).toBeUndefined();
    expect(seen).toEqual(['bedroom-message', 'route201-rowan', 'route201-rowan-speaks', 'route201-counterpart']);
  }, 120_000);
});
