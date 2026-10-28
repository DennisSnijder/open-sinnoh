/**
 * Service replays, headless (OPENSINNOH_NDS_ROM): the Pokémon Center heal,
 * the Jubilife Mart at 0, 1 and 3 badges (chained with `from`) and the Veilstone Department Store. Each
 * runs twice from seed 1 (determinism) and ends with a save round trip; seeds 2 and 3 run once more.
 * Menu apps are the real models (packages/menus), driven by the replay's buttons and taps.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Id, PackData, ReplayLine } from '@opensinnoh/core';
import { soundFramesToTicks, type ScriptView } from '@opensinnoh/contracts';
import { CountingStubLog, createGame, gameDriver, runReplay, type ReplayResolver } from '@opensinnoh/game';
import { romSlice } from '../rom.ts';
import { InputState } from '../../packages/app/src/input.ts';
import { runTicks } from '../../packages/app/src/loop.ts';
import { createApp, MenuText } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';

const romPath = process.env.OPENSINNOH_NDS_ROM;
const dir = join(import.meta.dirname, '../rom-replays');
const read = (file: string) => readFileSync(join(dir, file), 'utf8');
export const SERVICE_REPLAYS = ['svc-pokecenter', 'svc-mart', 'svc-mart-badge1', 'svc-mart-badge3', 'svc-dept-store', 'svc-dept-store-2f', 'svc-dept-store-3f', 'svc-dept-store-b1f'];

describe.skipIf(!romPath)('service replays (OPENSINNOH_NDS_ROM)', () => {
  let pack: PackData;
  beforeAll(async () => {
    ({ pack } = romSlice());
  }, 60_000);

  const play = (name: string, seed: number, repeat: boolean) => {
    const log = new CountingStubLog(() => {});
    const game = createGame({ packs: [pack], createWorld, createScriptRunner, createApp, seed, log, now: () => '2026-01-01T00:00:00.000Z' });
    const resolve: ReplayResolver = (file) => ({ name: file, text: read(file) });
    return runReplay(gameDriver(game), read(`${name}.replay`), { registries: game.registries, seed, name: `${name}.replay`, resolve, repeat });
  };

  it('svc-pokecenter: the healing machine gets one ball per Pokémon in the party, the egg not counted', async () => {
    const balls: number[] = [];
    let party: { isEgg: boolean }[] = [];
    const log = new CountingStubLog(() => {});
    const game = createGame({
      packs: [pack],
      createWorld: (deps) => {
        const world = createWorld(deps);
        const heal = world.healAnimation.bind(world);
        world.healAnimation = (n) => {
          balls.push(n);
          party = deps.state.party.map((m) => ({ isEgg: m.isEgg }));
          heal(n);
        };
        return world;
      },
      createScriptRunner,
      createApp,
      seed: 1,
      log,
      now: () => '2026-01-01T00:00:00.000Z',
    });
    const r = await runReplay(gameDriver(game), read('svc-pokecenter.replay'), { registries: game.registries, seed: 1, name: 'svc-pokecenter.replay', repeat: false });
    expect(r.error).toBeUndefined();
    // Three Pokémon, the third an egg: two balls.
    expect(party.map((m) => m.isEgg)).toEqual([false, false, true]);
    expect(balls).toEqual([2]);
  }, 120_000);

  it('svc-pokecenter: a sound per ball, the heal jingle with the balls\' and the screen\'s one-shots, the heal after the jingle', async () => {
    // Decomp FieldTask_PlayHealingAnimation_Pokecenter: SEQ_SE_DP_BOWA on each ADD_POKEBALL (17 ticks apart),
    // SEQ_ASA with the one-shots on PLAY_FINAL_ANIMATION, then the task waits for the one-shots and the jingle.
    const started: { tick: number; seq: string }[] = [];
    const frames: number[] = [];
    let done = -1;
    let healed = -1;
    let tick = 0;
    const game = createGame({
      packs: [pack],
      createWorld: (deps) => {
        const world = createWorld(deps);
        const step = world.step.bind(world);
        world.step = (...args) => {
          const r = step(...args);
          const v = world.view().healMachine;
          if (v?.frame !== undefined) frames.push(v.frame);
          return r;
        };
        const isDone = world.healAnimationDone.bind(world);
        world.healAnimationDone = () => {
          const d = isDone();
          if (d && done < 0) done = deps.state.tick;
          return d;
        };
        return world;
      },
      createScriptRunner,
      createApp,
      seed: 1,
      log: new CountingStubLog(() => {}),
      now: () => '2026-01-01T00:00:00.000Z',
      audio: { send: (c) => { if (c.op === 'start') started.push({ tick, seq: c.seq }); } },
    });
    const driver = gameDriver(game);
    const step = game.step.bind(game);
    game.step = (...args) => {
      tick = game.state.tick;
      const r = step(...args);
      if (healed < 0 && game.state.party[0]?.hp === 30) healed = game.state.tick;
      return r;
    };
    const r = await runReplay(driver, read('svc-pokecenter.replay'), { registries: game.registries, seed: 1, name: 'svc-pokecenter.replay', repeat: false });
    expect(r.error).toBeUndefined();
    const balls = started.filter((s) => s.seq === 'platinum:SEQ_SE_DP_BOWA');
    const jingle = started.filter((s) => s.seq === 'platinum:SEQ_ASA');
    expect(balls).toHaveLength(2);
    expect(balls[1]!.tick - balls[0]!.tick).toBe(17);
    expect(jingle).toHaveLength(1);
    expect(jingle[0]!.tick - balls[1]!.tick).toBe(17);
    // Both one-shots play through (the ball's 68 frames, the screen's 73) from the jingle's tick.
    expect(frames[0]).toBe(0);
    expect(Math.max(...frames)).toBeGreaterThanOrEqual(73);
    // The jingle (SEQ_ASA's length in ticks) and the 15 checks after it end before the machine is done,
    // and the party is healed only after that.
    const asa = game.registries.sequences.get('platinum:SEQ_ASA' as never)!;
    expect(done - jingle[0]!.tick).toBeGreaterThanOrEqual(soundFramesToTicks(asa.frames!));
    expect(healed).toBeGreaterThan(done);
  }, 120_000);

  it('svc-pokecenter: one A per prompt ends the nurse conversation without talking again, at 1x and 8x', async () => {
    // The A that closes the goodbye must not also talk to the nurse again (one edge consumed twice).
    // The app's input path (InputState sampled once per tick, runTicks at the loop's speed): a tap is one A edge.
    // The turn-away (m3a-ops.ts, not DS) is left out here: the player keeps facing the nurse as on
    // the DS, so a duplicated edge would talk to her again.
    const replay = read('svc-pokecenter.replay');
    const head = replay.slice(0, replay.indexOf('+0 assert state party[0].pp'));
    for (const speed of [1, 8]) {
      const game = createGame({
        packs: [pack],
        createWorld: (deps) => Object.assign(createWorld(deps), { turnPlayer: () => {} }),
        createScriptRunner,
        createApp,
        seed: 1,
        log: new CountingStubLog(() => {}),
        now: () => '2026-01-01T00:00:00.000Z',
      });
      const r = await runReplay(gameDriver(game), head, { registries: game.registries, seed: 1, name: 'svc-pokecenter.replay', repeat: false });
      expect(r.error).toBeUndefined();
      const input = new InputState();
      const texts: string[] = [];
      let starts = 0;
      let running = game.scripts.running();
      for (let frame = 0; frame < 600; frame++) {
        const message = game.snapshot().view.message;
        if (message?.waitingForInput) {
          texts.push(message.text);
          // A tap between two display frames: down and up before the next sample.
          input.set('keyboard', 'a', true);
          input.set('keyboard', 'a', false);
        }
        runTicks(speed, speed, () => {
          game.step(input.frame());
          const now = game.scripts.running();
          if (now && !running) starts++;
          running = now;
        }, () => 0);
      }
      expect(texts.at(-1), `${speed}x`).toBe(new MenuText(game.registries).text('platinum:CommonStrings_Text_PokecenterHopeToSeeYouAgain1' as Id));
      expect(starts, `${speed}x: the last A must not talk to the nurse again`).toBe(0);
      expect(running).toBe(false);
      expect(game.state.player.facing).toBe('up');
    }
  }, 120_000);

  it('svc-dept-store(-2f, -3f, -b1f): each vendor sells its decomp stock (mart_items.h VeilstoneDeptStoreStock_*); the money window', async () => {
    const items = (...names: string[]) => names.map((n) => `platinum:ITEM_${n}`);
    const want: Record<string, string[]> = {
      'dept-medicine': items('POTION', 'SUPER_POTION', 'HYPER_POTION', 'MAX_POTION', 'REVIVE', 'ANTIDOTE', 'PARLYZ_HEAL', 'BURN_HEAL', 'ICE_HEAL', 'AWAKENING', 'FULL_HEAL'),
      'dept-2f-up': items('X_SPEED', 'X_ATTACK', 'X_DEFENSE', 'GUARD_SPEC', 'DIRE_HIT', 'X_ACCURACY', 'X_SPECIAL', 'X_SP_DEF'),
      'dept-2f-mid': items('PROTEIN', 'IRON', 'CALCIUM', 'ZINC', 'CARBOS', 'HP_UP'),
      'dept-3f-up': items('TM83', 'TM17', 'TM54', 'TM20', 'TM33', 'TM16', 'TM70'),
      'dept-3f-down': items('TM38', 'TM25', 'TM14', 'TM22', 'TM52', 'TM15'),
      'dept-b1f': items('FIGY_BERRY', 'WIKI_BERRY', 'MAGO_BERRY', 'AGUAV_BERRY', 'IAPAPA_BERRY'),
    };
    const seen: Record<string, string[]> = {};
    const money: Record<string, ScriptView['moneyWindow']> = {};
    let menu: MenuText | undefined;
    for (const name of ['svc-dept-store', 'svc-dept-store-2f', 'svc-dept-store-3f', 'svc-dept-store-b1f']) {
      const game = createGame({ packs: [pack], createWorld, createScriptRunner, createApp, seed: 1, log: new CountingStubLog(() => {}), now: () => '2026-01-01T00:00:00.000Z' });
      menu = new MenuText(game.registries);
      const r = await runReplay(gameDriver(game), read(`${name}.replay`), {
        registries: game.registries,
        seed: 1,
        name: `${name}.replay`,
        repeat: false,
        beforeLine(line: ReplayLine) {
          if (line.action.type !== 'screenshot') return;
          if (line.action.name.startsWith('lava-cookie')) {
            money[line.action.name] = game.snapshot().view.moneyWindow;
            return;
          }
          const app = game.snapshot().app;
          if (app?.app !== 'mart' || app.mode !== 'buy') throw new Error(`${line.action.name}: the mart's stock is not open`);
          seen[line.action.name] = app.rows.map((row) => row.item);
        },
      });
      expect(r.error, name).toBeUndefined();
    }
    expect(seen).toEqual(want);
    // The Lava Cookie vendor's money window (ShowMoney 20, 2): "Money" and the amount, reprinted after paying, then closed.
    // Bank 543's label (18) and amount (19, the money padded to 6 digits with spaces), e.g. "Money" and "$ 19980" in English.
    const text = (n: number, ...slots: string[]) => menu!.text(`platinum:pl_msg_00000543_000${n}` as Id, ...slots);
    const window = (amount: number) => ({ x: 160, y: 16, width: 80, height: 32, label: text(18), amount: text(19, String(amount).padStart(6, ' ')) });
    expect(money).toEqual({ 'lava-cookie-menu': window(19980), 'lava-cookie-paid': window(19780), 'lava-cookie-closed': undefined });
  }, 120_000);

  for (const name of SERVICE_REPLAYS) {
    it(`${name}.replay passes twice from seed 1 with a save round trip, and on seeds 2–3`, async () => {
      const result = await play(name, 1, true);
      expect(result.error).toBeUndefined();
      expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
      for (const seed of [2, 3]) {
        const r = await play(name, seed, false);
        expect(r.error, `seed ${seed}`).toBeUndefined();
        expect(r.roundTrip, `seed ${seed}`).toBe('identical');
      }
    }, 120_000);
  }
});
