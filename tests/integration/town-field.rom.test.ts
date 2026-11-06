/**
 * The town extras' field commands on the ROM: Dr. Footstep's reading and ribbon (get_party_mon_footprint_type), the
 * Solaceon Ruins' Unown inscriptions (message_unown), the Vista Lighthouse binoculars and the Vs. Seeker's task, plus
 * their replays (each twice on seeds 1–3 with the save round trip).
 */
import { describe, expect, it } from 'vitest';
import type { Font, NewGame, Species } from '@opensinnoh/contracts';
import type { Button, Id } from '@opensinnoh/core';
import { createBattle } from '@opensinnoh/battle';
import { CountingStubLog, createGame, gameDriver, runReplay, type Game } from '@opensinnoh/game';
import { createApp } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

const ng = () => (romSlice().pack.registries.newGame as unknown as NewGame[])[0]!;
const newGame = (seed = 1) => createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, createBattle, createApp, seed, log: new CountingStubLog(() => {}), now: () => '2009-03-22T12:00:00Z' });
const play = async (game: Game, text: string) => {
  const r = await runReplay(gameDriver(game), text, { name: 'inline', registries: game.registries, resolve: resolveReplay, seed: 1, repeat: false });
  expect(r.error).toBeUndefined();
};
/** A text record's text, by its name in the ROM's banks. */
const text = (game: Game, name: string) => game.registries.texts.get(`platinum:${name}` as Id)!.text;
const step = (game: Game, b?: Button) => game.step({ held: b ? [b] : [], pressed: b ? [b] : [], touch: null });
/** A on every waiting message until the script ends and the field is idle; the texts read, in order. */
function talkThrough(game: Game, max = 6000): string[] {
  const read: string[] = [];
  for (let i = 0; i < max; i++) {
    const m = game.scripts.view().message;
    if (m?.waitingForInput) {
      read.push(m.text);
      step(game, 'a');
    } else step(game);
    if (!game.scripts.running() && game.world.idle() && i > 10) return read;
  }
  throw new Error(`still running after ${max} ticks: ${JSON.stringify(game.scripts.view().message)}`);
}
/** RECORD_CHECKED_FOOTPRINTS (generated/game_records.txt); RIBBON_FOOTPRINT. */
const RECORD_CHECKED_FOOTPRINTS = 116;
const RIBBON_FOOTPRINT = 69;

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('town field commands (OPENSINNOH_NDS_ROM)', () => {
  it('imports sFootprintTypes onto the species and the Unown font', () => {
    const species = romSlice().pack.registries.species as unknown as Species[];
    const by = (name: string) => species.find((s) => s.id === `platinum:${name}`)!.footprintType;
    expect(by('SPECIES_BULBASAUR')).toEqual({ type: 1, hasPrint: true });
    // The ROM's table gives Spiritomb a print (the decomp's data.json has none).
    expect(by('SPECIES_SPIRITOMB')).toEqual({ type: 3, hasPrint: true });
    const read = species.filter((s) => s.footprintType);
    expect(read).toHaveLength(494);
    expect(read.every((s) => s.footprintType!.type <= 5)).toBe(true);
    expect(read.filter((s) => !s.footprintType!.hasPrint).length).toBeGreaterThan(50);
    const fonts = romSlice().pack.registries.fonts as unknown as Font[];
    const unown = fonts.find((f) => f.id === ng().unownFont)!;
    expect(unown.widths.every((w) => w > 0)).toBe(true);
    for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ!?') expect(unown.chars).toContain(c);
  });

  it('Dr. Footstep reads a Bulbasaur at friendship 100 as cute with prints (level 2) and counts the check', async () => {
    const game = newGame();
    await play(game, 'party 0 platinum:SPECIES_BULBASAUR 20 platinum:MOVE_TACKLE\nset state party[0].friendship 100\nwarp platinum:MAP_HEADER_FOOTSTEP_HOUSE 5 7 up\nuntil idle\n+0 press a\n+1 release a\n');
    const read = talkThrough(game);
    // FootstepHouse_Text_Cute_WithPrint_Level2: its words up to the first control code.
    const reading = text(game, 'FootstepHouse_Text_Cute_WithPrint_Level2').split('{')[0]!;
    expect(read.some((t) => t.startsWith(reading))).toBe(true);
    expect(game.state.records.counts[RECORD_CHECKED_FOOTPRINTS]).toBe(1);
    expect(game.state.party[0]!.ribbons).not.toContain(RIBBON_FOOTPRINT);
  });

  it('at friendship 255 Dr. Footstep gives the Footprint Ribbon once', async () => {
    const game = newGame();
    await play(game, 'party 0 platinum:SPECIES_BULBASAUR 20 platinum:MOVE_TACKLE\nset state party[0].friendship 255\nwarp platinum:MAP_HEADER_FOOTSTEP_HOUSE 5 7 up\nuntil idle\n+0 press a\n+1 release a\n');
    talkThrough(game);
    expect(game.state.party[0]!.ribbons).toContain(RIBBON_FOOTPRINT);
  });

  it('the Solaceon Ruins inscription prints in the Unown font, every letter drawable', async () => {
    const game = newGame();
    await play(game, 'warp platinum:MAP_HEADER_SOLACEON_RUINS_ROOM_1 5 2 up\nuntil idle\n+0 press a\n+1 release a\n');
    for (let i = 0; i < 400 && !game.scripts.view().message?.waitingForInput; i++) step(game);
    const m = game.scripts.view().message!;
    expect(m.font).toBe('unown');
    const unown = (romSlice().pack.registries.fonts as unknown as Font[]).find((f) => f.id === ng().unownFont)!;
    const letters = m.text.replace(/[\s\n]/g, '');
    expect(letters.length).toBeGreaterThan(5);
    for (const c of letters) expect(unown.chars, c).toContain(c);
    talkThrough(game);
    expect(game.scripts.view().message).toBeNull();
  });

  it('the Vista Lighthouse binoculars look at the League with their camera until A, then the player is back facing north', async () => {
    const game = newGame();
    await play(game, 'warp platinum:MAP_HEADER_VISTA_LIGHTHOUSE 6 4 up\nuntil idle\n+0 press a\n+1 release a\n');
    let sawView = false;
    for (let i = 0; i < 600; i++) {
      const m = game.scripts.view().message;
      if (m?.waitingForInput) step(game, 'a');
      else step(game);
      const v = game.world.view();
      if (v.viewCamera && game.world.lookoutView()?.iris === 1) {
        sawView = true;
        expect(v.zone).toBe('platinum:MAP_HEADER_POKEMON_LEAGUE');
        expect(v.actors[0]!.visible).toBe(false);
        expect(game.state.flags['platinum:FLAG_POKETCH_HIDDEN' as Id]).toBe(true);
        expect(v.viewCamera.camera.near).toBe(12);
        expect(v.viewCamera.target[0]).toBeCloseTo(13573.14, 1);
        break;
      }
    }
    expect(sawView).toBe(true);
    // The view stays without input.
    for (let i = 0; i < 120; i++) step(game);
    expect(game.world.view().viewCamera).toBeDefined();
    step(game, 'b');
    talkThrough(game);
    expect(game.state.player).toMatchObject({ zone: 'platinum:MAP_HEADER_VISTA_LIGHTHOUSE', x: 6, z: 4, facing: 'up' });
    expect(game.world.view().viewCamera).toBeUndefined();
    expect(game.world.view().actors[0]!.visible).toBe(true);
    expect(game.state.flags['platinum:FLAG_POKETCH_HIDDEN' as Id] ?? false).toBe(false);
  });

  it('the Vs. Seeker raises the avatar, the beaten trainer turns south with "!!" and spins; without charge it tells what is missing', async () => {
    const game = newGame();
    const setup = 'party 0 platinum:SPECIES_CHARIZARD 80 platinum:MOVE_FLAMETHROWER\ngive item platinum:ITEM_VS_SEEKER 1\nset state registeredItem "platinum:ITEM_VS_SEEKER"\nset state fieldRng {"seed":0}\nset flag platinum:FLAG_DEFEATED_TRAINER_YOUNGSTER_TRISTAN true\nset flag platinum:FLAG_UNLOCKED_VS_SEEKER_LVL_1 true\n';
    await play(game, `${setup}set var platinum:VAR_VS_SEEKER_BATTERY_LEVEL 40\nwarp platinum:MAP_HEADER_ROUTE_202 166 814 up\nuntil idle\n+0 press y\n+1 release y\n`);
    const read = talkThrough(game);
    // VsSeeker_Text_BatteryIsntChargedEnough with 60 steps missing: one wait a page (or scrolled line), the last
    // ending on the count.
    const missing = text(game, 'VsSeeker_Text_BatteryIsntChargedEnough').replace('{var 0}', '60');
    expect(read).toHaveLength(missing.split(/\{(?:clear|scroll)\}/).length);
    expect(read[0]).toBe(missing.split('{clear}')[0]);
    expect(read.at(-1)!.endsWith(missing.split(/\{[^}]*\}/).at(-1)!)).toBe(true);
    game.state.vars['platinum:VAR_VS_SEEKER_BATTERY_LEVEL' as Id] = 100;
    step(game, 'y');
    const seeker = ng().playerVsSeekerSprite![game.state.gender];
    let raised = false;
    let double = false;
    for (let i = 0; i < 400 && (game.scripts.running() || i < 5); i++) {
      step(game);
      const v = game.world.view();
      raised ||= v.actors[0]!.sprite === seeker && v.actors[0]!.pose === 'vs-seeker';
      double ||= v.actors.some((a) => a.localId === 0 && a.emoteDouble === true);
    }
    expect(raised, 'raised').toBe(true);
    expect(double, 'double').toBe(true);
    expect(game.state.objects.find((o) => o.localId === 0)!.movementType).toBe(49);
    expect(game.world.view().actors[0]!.sprite).not.toBe(seeker);
  });

  for (const file of ['sys-vs-seeker']) for (const seed of [1, 2, 3]) {
    it(`${file}: twice on seed ${seed}, save round trip`, async () => {
      const game = newGame(seed);
      const result = await runReplay(gameDriver(game), readReplay(`${file}.replay`), { name: `${file}.replay`, resolve: resolveReplay, registries: game.registries, seed, repeat: true });
      expect(result.error).toBeUndefined();
      expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
    }, 120000);
  }
});
