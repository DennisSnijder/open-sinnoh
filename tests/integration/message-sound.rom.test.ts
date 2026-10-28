/**
 * The message boxes' SE_CONFIRM on the real ROM (OPENSINNOH_NDS_ROM), through the game's sound system: the DS
 * plays it when an A/B press (or, in battle, a touch) ends a {clear}/{scroll} wait (render_text.c
 * TextPrinter_Continue). The closing wait_button (ScriptContext_CheckABXPadPress), pressing to speed up the
 * printing, a battle message's auto-scroll running out and the battle's post-message wait are silent.
 */
import { describe, expect, it } from 'vitest';
import { parseIR, type Button, type Id, type PackData } from '@opensinnoh/core';
import type { InputFrame } from '@opensinnoh/contracts';
import { CountingStubLog, createGame, gameDriver, runReplay, type Game } from '@opensinnoh/game';
import { createBattle } from '@opensinnoh/battle';
import { createApp } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { audioTrace } from '../fixtures/audio.ts';
import { ROM, romSlice } from '../rom.ts';

const SE_CONFIRM = 1500;
const IDLE: InputFrame = { held: [], pressed: [], touch: null };
const press = (b: Button): InputFrame => ({ held: [b], pressed: [b], touch: null });
/** Several page breaks ({clear} or {scroll}), no template slots. */
const PAGES = 'platinum:TwinleafTownSouthwestHouse_Text_PokemonProfessorReturned';

describe.skipIf(!ROM)('message box sound (OPENSINNOH_NDS_ROM)', () => {
  const testPack = (pack: PackData): PackData =>
    ({
      manifest: { id: 'msg-test', name: 'Message sound test scripts', version: '0.1.0', engine: '^0.1.0', base: pack.manifest.id, dependencies: { [pack.manifest.id]: `^${pack.manifest.version}` }, loadAfter: [pack.manifest.id] },
      registries: {},
      // The decomp's NPCMessage macro: PlaySE SE_CONFIRM, the message, WaitButton, CloseMessage.
      scripts: parseIR(`msg-test:Talk::
  play_se ${SE_CONFIRM}
  message text(${PAGES})
  wait_button
  close_message
  end
`),
      patches: [],
      remove: [],
      provenance: 'original',
    }) as unknown as PackData;

  const newGame = async (): Promise<{ game: Game; confirms: () => number[] }> => {
    const { pack } = romSlice();
    const game = createGame({ packs: [pack, testPack(pack)], createWorld, createScriptRunner, createBattle, createApp, seed: 1, log: new CountingStubLog(() => {}), now: () => '2026-01-01T00:00:00.000Z' });
    await game.loadBattleEngine();
    const setup = await runReplay(gameDriver(game), 'party 0 platinum:SPECIES_PIPLUP 5 platinum:MOVE_POUND\nwarp platinum:MAP_HEADER_ROUTE_201 110 853 down\nuntil idle\n', { registries: game.registries, seed: 1, repeat: false });
    expect(setup.error).toBeUndefined();
    const sounds = audioTrace(game.sound, game.registries, () => game.state.tick);
    return { game, confirms: () => sounds.filter((s) => s.op === 'start' && s.source === SE_CONFIRM).map((s) => s.tick) };
  };

  it('a field message: one SE_CONFIRM per page break pressed through; the closing press is silent', async () => {
    const { game, confirms } = await newGame();
    const pageBreaks = game.registries.texts.get(PAGES as Id)!.text.match(/\{(clear|scroll)\}/g)!.length;
    expect(pageBreaks).toBeGreaterThanOrEqual(2);
    game.scripts.start({ label: 'msg-test:Talk' as Id, zone: game.state.player.zone, source: 'test' });
    // Speed-up presses while the first page prints.
    game.step(IDLE);
    for (let i = 0; i < 6; i++) game.step(i % 2 ? IDLE : press('a'));
    expect(game.scripts.view().message?.waitingForInput).toBe(false);
    const talk = confirms();
    expect(talk).toHaveLength(1);
    const presses: number[] = [];
    for (let i = 0; game.scripts.running() && i < 2000; i++) {
      const waiting = game.scripts.view().message?.waitingForInput === true;
      if (waiting) presses.push(game.state.tick);
      game.step(waiting ? press('a') : IDLE);
    }
    expect(game.scripts.running()).toBe(false);
    expect(presses).toHaveLength(pageBreaks + 1);
    expect(confirms()).toEqual([...talk, ...presses.slice(0, pageBreaks)]);
  }, 120_000);

  /** The start of the wild line ("A wild {var 0} appeared!"), before its slot. */
  const wildLine = (game: Game) => game.registries.texts.get('platinum:BattleStrings_Text_AWildPokemonAppeared' as Id)!.text.split('{')[0]!;
  /** Starts a wild Bidoof battle and steps it to the wild line's {clear} wait; `input` on the steps before. */
  const toWildWait = async () => {
    const g = await newGame();
    g.game.world.startBattle({ kind: 'wild', trainers: [], wild: [{ species: 'platinum:SPECIES_BIDOOF' as Id, level: 3 }] });
    for (let i = 0; i < 3000; i++) {
      const m = g.game.battle?.view().message;
      if (m?.done && m.text.startsWith(wildLine(g.game))) return g;
      g.game.step(IDLE);
    }
    throw new Error('the wild line never reached its wait');
  };
  /** Steps the battle until its message is no longer the wild line. */
  const pastWildLine = (game: Game, input: (n: number) => InputFrame) => {
    for (let n = 0; n < 500; n++) {
      if (!game.battle!.view().message?.text.startsWith(wildLine(game))) return;
      game.step(input(n));
    }
    throw new Error('the wild line never ended');
  };

  it('a battle message: a press that ends the {clear} wait plays SE_CONFIRM once; the auto-scroll and the post-message wait are silent', async () => {
    const pressed = await toWildWait();
    expect(pressed.confirms()).toEqual([]);
    const at = pressed.game.state.tick;
    // The press ends the printer's wait; the second one (the post-message wait, BtlCmd_WaitButtonABTime) ends that.
    pastWildLine(pressed.game, (n) => (n === 0 || n === 4 ? press('a') : IDLE));
    expect(pressed.confirms()).toEqual([at]);

    const idle = await toWildWait();
    pastWildLine(idle.game, () => IDLE);
    expect(idle.confirms()).toEqual([]);
  }, 120_000);
});
