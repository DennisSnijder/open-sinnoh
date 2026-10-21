/**
 * Mystery Gift on the ROM (docs/decisions.md "Mystery Gift with gift codes"): the questionnaire's unlock, gifts by
 * (test-only) gift code with the refusals, the Wonder Cards, and the Poké Mart deliveryman's item and Pokémon gifts.
 * Each `sys-` replay runs twice on seeds 1–3 with the driver's save round trip.
 */
import { describe, expect, it } from 'vitest';
import { createGame, CountingStubLog, gameDriver, runReplay } from '@opensinnoh/game';
import { createWorld } from '@opensinnoh/world';
import { createScriptRunner } from '@opensinnoh/vm';
import { createBattle } from '@opensinnoh/battle';
import { createApp, RECEIVE_TICKS, SEARCH_TICKS } from '@opensinnoh/menus';
import { allowTestGiftCodes, TEST_GIFT_CODES } from '@opensinnoh/services';
import { DEFAULT_DEVICE_OPTIONS, type AppHost } from '@opensinnoh/contracts';
import { DEFAULT_CLOCK, type Button } from '@opensinnoh/core';
import { audioTrace, fixtureAudio } from '../fixtures/audio.ts';
import { romSlice } from '../rom.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

const REPLAYS = ['sys-mystery-gift-unlock', 'sys-mystery-gift-receive', 'sys-mystery-gift-regigigas'];
/** The stand-ins each replay meets: the questionnaire's wallpaper passwords are not checked (no wallpaper). */
const STUBS: Record<string, string[]> = { 'sys-mystery-gift-unlock': ['stub:get_wallpaper_from_custom_message_words'] };

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Mystery Gift (OPENSINNOH_NDS_ROM)', () => {
  it('imports the vars and texts the gifts use', () => {
    const { pack } = romSlice();
    const vars = pack.registries.vars as { id: string; sourceIndex?: number }[];
    // The Shaymin gift's VAR_SHAYMIN_EVENT_STATE (contracts SHAYMIN_EVENT_STATE_VAR).
    expect(vars.find((v) => v.id === 'platinum:VAR_SHAYMIN_EVENT_STATE')?.sourceIndex).toBe(0x4057);
  });

  for (const file of REPLAYS)
    for (const seed of [1, 2, 3])
      it(`${file}: twice on seed ${seed}, save round trip`, async () => {
        const { pack } = romSlice();
        const log = new CountingStubLog(() => {});
        const game = createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, createApp, seed, log, now: () => '2009-03-22T12:00:00Z' });
        const result = await runReplay(gameDriver(game), readReplay(`${file}.replay`), { name: `${file}.replay`, resolve: resolveReplay, registries: game.registries, seed, repeat: true });
        expect(result.error).toBeUndefined();
        expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
        expect(log.report().map((s) => s.key).sort()).toEqual(STUBS[file] ?? []);
      }, 180000);

  /** The Mystery Gift app over a new game's state, with the sound system's starts traced by sequence number. */
  function mysteryGift() {
    const { pack } = romSlice();
    const game = createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, createApp, seed: 1, log: new CountingStubLog(() => {}), now: () => '2009-03-22T12:00:00Z' });
    const { state, registries } = game;
    const audio = fixtureAudio(registries, state);
    const sounds = audioTrace(audio, registries, () => state.tick);
    const host: AppHost = { sound: audio, options: () => ({ ...DEFAULT_DEVICE_OPTIONS }), setOption: () => {}, save: () => {}, fieldMoveCheck: () => null, useFieldMove: () => {}, fieldItemCheck: () => null, useFieldItem: () => {}, clock: () => DEFAULT_CLOCK };
    const app = createApp({ app: 'mystery-gift' }, { registries, state, host, log: { stub: () => {} } });
    const step = (button?: Button, tap?: string) => {
      app.step({ held: button ? [button] : [], pressed: button ? [button] : [], touch: null, ...(tap ? { tap } : {}) });
      audio.tick();
      state.tick++;
    };
    const heard = (from = 0) => sounds.filter((s) => s.op === 'start').map((s) => [s.tick - from, s.source]);
    return { state, step, sounds, heard };
  }

  it('sounds: list moves, choices and cancel confirm; "no gift" confirms as it shows', () => {
    const g = mysteryGift();
    g.step('down'); // RECEIVE GIFT → EXIT
    g.step('up');
    g.step('a'); // RECEIVE GIFT: the code keyboard
    expect(g.heard()).toEqual([[0, 1500], [1, 1500], [2, 1500]]);
    g.step(undefined, 'type:QQQQQQQQ'); // SEQ_SE_DP_BOX02
    g.step(undefined, 'ok'); // SEQ_SE_DP_PIRORIRO
    expect(g.heard().slice(3).map(([, s]) => s)).toEqual([1515, 1506]);
    g.sounds.length = 0;
    const at = g.state.tick;
    for (let i = 0; i < SEARCH_TICKS + 2; i++) g.step();
    expect(g.heard(at)).toEqual([[SEARCH_TICKS - 1, 1500]]);
    g.sounds.length = 0;
    g.step('a'); // the message goes
    g.step('b'); // EXIT by cancel
    expect(g.heard().map(([, s]) => s)).toEqual([1500, 1500]);
  });

  it('sounds: a received gift plays SEQ_SE_DP_UG_020 as "received" shows', () => {
    allowTestGiftCodes(true);
    try {
      const g = mysteryGift();
      g.step('a');
      g.step(undefined, `type:${TEST_GIFT_CODES.darkrai}`);
      g.step(undefined, 'ok');
      for (let i = 0; i < SEARCH_TICKS + 2; i++) g.step();
      g.sounds.length = 0;
      const at = g.state.tick;
      g.step('a'); // YES
      for (let i = 0; i < RECEIVE_TICKS + 2; i++) g.step();
      expect(g.heard(at)).toEqual([[0, 1500], [RECEIVE_TICKS, 1572]]);
    } finally {
      allowTestGiftCodes(false);
    }
  });
});
