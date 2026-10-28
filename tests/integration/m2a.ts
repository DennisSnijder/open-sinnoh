/**
 * Trainer battles on the real ROM (OPENSINNOH_NDS_ROM): the imported battle tables, and the system
 * replays, each twice from seeds 1–3 with a save round trip:
 * - m2-first-battle-lost: the Route 201 rival wins; the script's loss branch (Route201_RivalWonLetsGoHome)
 *   goes home without a blackout;
 * - m2-blackout: a lost trainer battle pays the penalty and BlackOutFromBattle warps to the last Pokémon
 *   Center, where the nurse heals;
 * - m2-trainer-items: Roark's AI drinks both of its Potions.
 * The checkpoints with real battles are checkpoints*.rom.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Id, PackData } from '@opensinnoh/core';
import { parseTextMarkup, type Registries } from '@opensinnoh/contracts';
import { BattleText, createBattle, pages } from '@opensinnoh/battle';
import { CountingStubLog, createGame, gameDriver, loadGamePacks, runReplay, type ReplayResolver } from '@opensinnoh/game';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { ROM, romSlice } from '../rom.ts';

const dir = join(import.meta.dirname, '../rom-replays');
const read = (file: string) => readFileSync(join(dir, file), 'utf8');
const P = (n: string) => `platinum:${n}` as Id;

/** The blackout scene's Pokémon Center line from the ROM's bank, as the game prints it (no ROM text here). */
function blackOutLine(reg: Registries, player: string): string {
  const id = reg.textBanks.get(P('TEXT_BANK_BLACK_OUT_SCENE'))!.messages[3]!;
  let out = '';
  for (const t of parseTextMarkup(reg.texts.get(id)!.text)) {
    if (t.kind === 'chars') out += t.value;
    else if (t.kind === 'var') out += t.slot === 0 ? player : '';
    else if (t.kind === 'newline' || t.kind === 'clear' || t.kind === 'scroll') out += '\n';
  }
  return out;
}

export function describeM2a(seeds: readonly (1 | 2 | 3)[]): void {
  describe.skipIf(!ROM)('trainer battles (OPENSINNOH_NDS_ROM)', () => {
    let pack: PackData;
    beforeAll(() => {
      ({ pack } = romSlice());
    });

    /** Plays a replay twice from `seed` with a round trip; every finished battle message along the way. */
    const play = async (file: string, seed: number) => {
      const log = new CountingStubLog(() => {});
      const game = createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, seed, log, now: () => '2026-01-01T00:00:00.000Z' });
      const messages: string[] = [];
      const blackOuts: { text: string; alpha: number }[] = [];
      const tick = game.tick.bind(game);
      let last = '';
      game.tick = () => {
        tick();
        const m = game.battle?.view().message;
        if (m?.done && m.text !== last) messages.push((last = m.text));
        const b = game.blackOutScreen();
        if (b) blackOuts.push({ text: b.text, alpha: b.alpha });
      };
      const resolve: ReplayResolver = (f) => ({ name: f, text: read(f) });
      const result = await runReplay(gameDriver(game), read(file), { registries: game.registries, seed, name: file, resolve, repeat: true });
      expect(result.error).toBeUndefined();
      expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
      return { game, messages, blackOuts };
    };

    if (seeds.includes(1)) it('imports the type chart, the class prize multipliers and the blackout spawns', () => {
      const { registries: reg } = loadGamePacks([pack]);
      const mul = (a: string, d: string) => reg.types.get(P(`TYPE_${a}`))!.matchups.find((m) => m.type === P(`TYPE_${d}`));
      expect(mul('WATER', 'ROCK')).toEqual({ type: P('TYPE_ROCK'), multiplier: 20, foresight: false });
      expect(mul('NORMAL', 'GHOST')).toEqual({ type: P('TYPE_GHOST'), multiplier: 0, foresight: true });
      expect(mul('GROUND', 'FLYING')?.multiplier).toBe(0);
      expect([...reg.types.values()].reduce((n, t) => n + t.matchups.length, 0)).toBe(110);
      expect(reg.trainers.get(P('TRAINER_YOUNGSTER_TRISTAN'))!.classPrize).toBe(4);
      expect(reg.trainers.get(P('TRAINER_LEADER_ROARK'))!.classPrize).toBeGreaterThan(4);
      // His class's row of the class-name bank (TEXT_BANK_TRAINER_CLASS_NAMES, 619).
      expect(reg.trainers.get(P('TRAINER_LEADER_ROARK'))!.className).toBe(P('pl_msg_00000619_00062'));
      expect(reg.texts.get(P('pl_msg_00000619_00062'))!.text).toMatch(/\S/);
      expect(reg.zones.get(P('MAP_HEADER_TWINLEAF_TOWN_PLAYER_HOUSE_1F'))!.blackOut).toEqual({ spawn: 1, x: 8, z: 8, label: P('CommonScript_PlayerHouseBlackOutRecover') });
      expect(reg.zones.get(P('MAP_HEADER_SANDGEM_TOWN_POKECENTER_1F'))!.blackOut).toEqual({ spawn: 2, x: 8, z: 6, label: P('CommonScript_PokecenterBlackOutRecover') });
      expect([...reg.zones.values()].filter((z) => z.blackOut).length).toBe(19);
    });

    for (const seed of seeds) {
      it(`m2-first-battle-lost: the rival wins, no blackout, home as after a win (seed ${seed})`, async () => {
        const { game } = await play('m2-first-battle-lost.replay', seed);
        expect(game.state.player.zone).toBe(P('MAP_HEADER_TWINLEAF_TOWN_PLAYER_HOUSE_1F'));
      }, 120_000);

      it(`m2-blackout: penalty, warp to the Sandgem center, the nurse heals (seed ${seed})`, async () => {
        const { game, messages, blackOuts } = await play('m2-blackout.replay', seed);
        // The black screen (decomp FieldTask_BlackOutFromBattle): the text fades in, waits for A, fades out.
        expect(new Set(blackOuts.map((b) => b.text))).toEqual(new Set([blackOutLine(game.registries, game.state.names.player)]));
        expect(blackOuts.some((b) => b.alpha === 1)).toBe(true);
        expect(blackOuts.at(-1)!.alpha).toBeLessThan(1);
        const piplup = game.state.party[0]!;
        // cp2 ends with $3500; the penalty is the highest level · 4 · 2 (no badges).
        expect(game.state.money).toBe(3500 - piplup.level * 4 * 2);
        expect(piplup.hp).toBe(piplup.stats.hp);
        expect(game.state.player).toMatchObject({ zone: P('MAP_HEADER_SANDGEM_TOWN_POKECENTER_1F'), x: 8, z: 6 });
        expect(messages).toContain(pages(new BattleText(game.registries).get('PlayerPaidOutMoneyToTheWinner', [game.state.names.player, String(piplup.level * 8)]), [])[0]);
      }, 120_000);

      it(`m2-trainer-items: Roark's AI uses both Potions (seed ${seed})`, async () => {
        const { game, messages } = await play('m2-trainer-items.replay', seed);
        // Two Potions in each of the two runs ("{class} {name} used one {item}!" from the ROM's battle strings).
        const reg = game.registries;
        const roark = reg.trainers.get(P('TRAINER_LEADER_ROARK'))!;
        const text = new BattleText(reg);
        const line = pages(text.get('TrUsedOneItem', [pages(reg.texts.get(roark.className)!.text, [])[0]!, roark.name, reg.items.get(P('ITEM_POTION'))!.name]), [])[0];
        expect(messages.filter((m) => m === line)).toHaveLength(4);
      }, 120_000);
    }
  });
}
