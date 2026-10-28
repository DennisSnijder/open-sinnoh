/**
 * NPCs whose messages read template slots that once only stubs filled, on the ROM: the Snowpoint east house's expert
 * (scripts_snowpoint_city_east_house.s: CheckAllToughWordsUnlocked and TryBufferAndUnlockRandomToughWord unlock one
 * tough word a day and print it) and the Jubilife City groups man (scripts_group_connection.s: DoGroupConnectionAction
 * with no record-mixing group).
 */
import { describe, expect, it } from 'vitest';
import type { Button, Id } from '@opensinnoh/core';
import { createBattle } from '@opensinnoh/battle';
import { CountingStubLog, createGame, gameDriver, runReplay, type Game } from '@opensinnoh/game';
import { createApp } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';
import { resolveReplay } from '../rom-replays/sys-replays.ts';

const FLAG = 'platinum:FLAG_DAILY_HEARD_TRENDY_SAYING_SNOWPOINT_CITY_EAST_HOUSE' as Id;
const newGame = () => createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, createBattle, createApp, seed: 1, log: new CountingStubLog(() => {}), now: () => '2009-03-22T12:00:00Z' });
const step = (game: Game, b?: Button) => game.step({ held: b ? [b] : [], pressed: b ? [b] : [], touch: null });
const play = async (game: Game, text: string) => {
  const r = await runReplay(gameDriver(game), text, { name: 'inline', registries: game.registries, resolve: resolveReplay, seed: 1, repeat: false });
  expect(r.error).toBeUndefined();
};
/** Talks to the NPC the player faces, pressing A every fourth tick (pages, yes/no: YES, menus: the first entry); the texts shown. */
function talk(game: Game): string {
  for (let i = 0; i < 600 && !game.world.idle(); i++) step(game);
  step(game, 'a');
  const read: string[] = [];
  for (let i = 0; i < 6000; i++) {
    const m = game.scripts.view().message;
    // A page prints a character at a time: keep its full text once.
    if (m && read.length && m.text.startsWith(read.at(-1)!)) read[read.length - 1] = m.text;
    else if (m) read.push(m.text);
    step(game, game.scripts.running() && i % 4 === 3 ? 'a' : undefined);
    if (!game.scripts.running() && game.world.idle() && i > 10) return read.join('\n');
  }
  throw new Error('the NPC is still talking');
}
const bits = (n: number) => [...Array(32).keys()].filter((i) => (n >>> i) & 1);

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('NPC template slots (OPENSINNOH_NDS_ROM)', () => {
  it('the expert unlocks and prints one word a day, then asks whether the player uses them once all are unlocked', async () => {
    const game = newGame();
    const bank = game.registries.textBanks.get('platinum:TEXT_BANK_TOUGH_WORDS' as Id)!.messages;
    expect(bank).toHaveLength(32);
    const words = bank.map((id) => game.registries.texts.get(id)!.text);

    // Below the expert (5,5), facing him.
    await play(game, 'warp platinum:MAP_HEADER_SNOWPOINT_CITY_EAST_HOUSE 5 6 up\nuntil idle\n');
    expect(game.state.unlockedToughWords).toBe(0);
    const first = talk(game);
    expect(first).toMatch(/would you like to hear/i);
    const [entry] = bits(game.state.unlockedToughWords);
    expect(bits(game.state.unlockedToughWords)).toHaveLength(1);
    expect(first).toContain(`${words[entry!]}!`);
    expect(game.state.flags[FLAG]).toBe(true);

    // The same day: no new word.
    expect(talk(game)).toMatch(/use trendy sayings\s+in a trendy way/);
    expect(bits(game.state.unlockedToughWords)).toEqual([entry]);

    // The next day the daily flag is clear: a second, different word.
    game.setClock('2009-03-23');
    step(game);
    expect(game.state.flags[FLAG] ?? false).toBe(false);
    const second = talk(game);
    const now = bits(game.state.unlockedToughWords);
    expect(now).toHaveLength(2);
    const added = now.find((i) => i !== entry)!;
    expect(second).toContain(`${words[added]}!`);

    // All unlocked: the check skips the question.
    game.state.unlockedToughWords = 0xffffffff;
    delete game.state.flags[FLAG];
    expect(talk(game)).toMatch(/are you using trendy\s+sayings\?/i);
    expect(game.state.flags[FLAG] ?? false).toBe(false);
  });

  it('the Jubilife groups man offers no group to join, and MAKE GROUP ends at "That\'s too bad" without naming one', async () => {
    const game = newGame();
    // Below the groups man (164,761), facing him.
    await play(game, 'warp platinum:MAP_HEADER_JUBILIFE_CITY 164 762 up\nuntil idle\n');
    const read = talk(game);
    expect(read).toMatch(/would you like to join a group\?/);
    expect(read).toMatch(/What do you want to name\s+your group\?/);
    expect(read).toMatch(/That’s too bad\.$/);
    expect(read).not.toMatch(/great name|leader/);
  });
});
