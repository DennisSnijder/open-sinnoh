/**
 * The Underground's drawn details on the ROM, tick by tick: the way down (the jump into the hole on the surface, the fall
 * in the Underground) and up (the rise, the jump out of the closing hole), and a laid Rock Trap: the '!' over the player,
 * the shadow growing under them until the boulder lands, the OK over them for 60 ticks once free.
 */
import { describe, expect, it } from 'vitest';
import type { EffectView, UndergroundTransitionView } from '@opensinnoh/contracts';
import { createGame, gameDriver, runReplay, type Game } from '@opensinnoh/game';
import { createWorld } from '@opensinnoh/world';
import { createScriptRunner } from '@opensinnoh/vm';
import { createBattle } from '@opensinnoh/battle';
import { createApp } from '@opensinnoh/menus';
import { romSlice } from '../rom.ts';
import { resolveReplay } from '../rom-replays/sys-replays.ts';

const UG = 'platinum:MAP_HEADER_UNDERGROUND';

async function gameAfter(text: string, name: string): Promise<Game> {
  const { pack } = romSlice();
  const game = createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, createApp, seed: 1, now: () => '2009-03-22T12:00:00Z' });
  const result = await runReplay(gameDriver(game), text, { name, resolve: resolveReplay, registries: game.registries, seed: 1, repeat: false });
  expect(result.error).toBeUndefined();
  return game;
}

/** One tick at a time until `done`, recording what `look` sees each tick. */
function ticks<T>(game: Game, done: () => boolean, look: () => T, max = 600): T[] {
  const seen: T[] = [];
  for (let i = 0; !done(); i++) {
    if (i === max) throw new Error(`still going after ${max} ticks`);
    game.advance(1);
    seen.push(look());
  }
  return seen;
}

const app = (game: Game) => (game.snapshot().app as { app: string } | null)?.app ?? null;

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('the Underground drawn (OPENSINNOH_NDS_ROM)', () => {
  it('draws the way down and up from the ROM sprites', async () => {
    // parts/underground-down.replay up to the Explorer Kit: out of the Underground Man's house into Eterna City.
    const walkOut = ['from sys-underground-enter.replay', '+0 press left', 'until position 4 6', '+0 release left', 'until idle', '+0 press down', 'until state player.zone "platinum:MAP_HEADER_ETERNA_CITY"', '+0 release down', 'until idle'];
    const game = await gameAfter(walkOut.join('\n'), 'underground-drawn.replay');
    const look = () => ({ zone: game.state.player.zone, view: game.world.undergroundTransition(), hero: game.world.view().actors[0]!.visible, idle: game.world.idle() });
    type Seen = ReturnType<typeof look>;
    ticks(game, () => game.world.idle() && !game.world.undergroundTransition(), () => null);
    const surface = game.state.player.zone;
    expect(surface).not.toBe(UG);

    game.press('y');
    game.advance(1);
    game.release('y');
    const down = ticks(game, () => game.state.player.zone === UG && game.world.idle(), look);
    const sprites = (s: Seen[], zone: (z: string) => boolean, part: 'player' | 'hole') => s.filter((t) => zone(t.zone) && t.view?.[part]).map((t) => t.view![part]!);
    // On the surface: the hole opens under the jumping player, who is hidden as a map object.
    const holeOpen = sprites(down, (z) => z !== UG, 'hole');
    expect(holeOpen.length).toBeGreaterThan(10);
    expect(holeOpen.every((h) => h.anim === 0 && h.x === 112 && h.y === 96)).toBe(true);
    expect(Math.min(...sprites(down, (z) => z !== UG, 'player').map((p) => p.y))).toBe(53);
    // (The map object comes back on the sprite's last tick, ENTER_ARRIVE_STATE_WAIT before _FREE.)
    expect(down.filter((t) => t.view?.player).slice(0, -1).every((t) => !t.hero)).toBe(true);
    // Below: the fall from above the screen to y 69; then the player stands as the map object again.
    const fall = sprites(down, (z) => z === UG, 'player');
    expect(fall[0]!.y).toBe(-24);
    expect(fall.at(-1)!.y).toBe(69);
    expect(down.at(-1)).toMatchObject({ view: null, hero: true });

    // GO UP: the rise and the jump out of the closing hole on the surface.
    game.press('x');
    game.advance(1);
    game.release('x');
    ticks(game, () => app(game) === 'ug-menu', () => null);
    game.tap('entry:5');
    game.advance(1);
    game.tap('yes');
    const up = ticks(game, () => game.state.player.zone === surface && game.world.idle() && !game.world.undergroundTransition(), look);
    const spin = sprites(up, (z) => z === UG, 'player');
    expect(spin.length).toBeGreaterThan(20);
    expect(spin.every((p) => p.anim === 1)).toBe(true);
    const closing = sprites(up, (z) => z !== UG, 'hole');
    expect(closing.every((h) => h.anim === 1)).toBe(true);
    expect(closing.at(-1)!.frame).toBe(8);
    expect(sprites(up, (z) => z !== UG, 'player').length).toBeGreaterThan(30);
    expect(up.at(-1)!.hero).toBe(true);
    const views: (UndergroundTransitionView | null)[] = up.map((t) => t.view);
    expect(views.some((v) => v?.gender === 'male')).toBe(true);
  }, 600000);

  it("draws the '!', the Rock Trap's shadow and the OK", async () => {
    const text = ['from parts/underground-down.replay', 'set state underground.placedTraps [{"trap":20,"x":168,"z":265}]', '+0 assert position platinum:MAP_HEADER_UNDERGROUND 168 264'].join('\n');
    const game = await gameAfter(text, 'underground-drawn.replay');
    const effects = () => game.world.view().effects.filter((e) => /UG_EMOTE|BLACK_CIRCLE/.test(e.effect));
    const named = (list: EffectView[], name: string) => list.filter((e) => e.effect.endsWith(name));
    game.press('down');
    ticks(game, () => app(game) === 'ug-trap', () => null);
    game.release('down');
    // The '!' while the trap's screen runs; the shadow from the boulder's start, growing 0.2 a tick, gone as it lands.
    const before = ticks(game, () => (game.snapshot().app as { game: string | null }).game === 'rock' && named(effects(), 'BLACK_CIRCLE').length === 0 && (game.snapshot().app as { sprites: unknown[] }).sprites.length > 0, effects);
    expect(before.every((list) => named(list, 'UG_EMOTE_EXCLAMATION').length === 1)).toBe(true);
    const sizes = before.flatMap((list) => named(list, 'BLACK_CIRCLE').map((e) => e.scale!));
    expect(sizes.length).toBeGreaterThan(20);
    expect(sizes[0]).toBe(0);
    expect(sizes[1]).toBeCloseTo(0.2, 5);
    expect(sizes.every((s, i) => i === 0 || s >= sizes[i - 1]!)).toBe(true);
    // The boulder broken: the OK replaces the '!' and stays 60 ticks.
    const hits = ticks(
      game,
      () => app(game) !== 'ug-trap',
      () => {
        const v = game.snapshot().app as { sprites: { y: number }[] } | null;
        if (v?.sprites[0]) game.tap(`hit:128,${v.sprites[0].y}`);
        return null;
      },
      2000,
    );
    expect(hits.length).toBeGreaterThan(0);
    const after = ticks(game, () => named(effects(), 'UG_EMOTE_OK').length === 0, effects, 200);
    expect(after.length).toBeGreaterThanOrEqual(58);
    expect(after.length).toBeLessThanOrEqual(62);
    expect(after.slice(0, -1).every((list) => named(list, 'UG_EMOTE_EXCLAMATION').length === 0 && named(list, 'UG_EMOTE_OK').length === 1)).toBe(true);
  }, 600000);

  it("holds the slide's pose: facing back, on a stand frame, until the OK", async () => {
    const text = ['from parts/underground-down.replay', 'set state underground.placedTraps [{"trap":1,"x":168,"z":265}]'].join('\n');
    const game = await gameAfter(text, 'underground-drawn.replay');
    game.press('down');
    ticks(game, () => app(game) === 'ug-trap', () => null);
    game.release('down');
    ticks(game, () => app(game) === null, () => null);
    // CommPlayer_StartSlideAnimation: LOCK_DIR and PAUSE_ANIMATION, the frame held through the walks of the slide (a turn
    // back would restart the walk loop at its first stand frame, ov5_021EB4AC).
    const hero = () => game.world.view().actors[0]!;
    const slide = ticks(game, () => game.world.view().effects.some((e) => e.effect.endsWith('UG_EMOTE_OK')), () => ({ z: game.state.player.z, ...hero() }));
    expect(slide.at(-1)!.z).toBe(262);
    expect(slide.filter((t) => t.anim === 'walk').length).toBeGreaterThan(1);
    // Facing back already (the step onto the trap was south), so no restart: the stand frame the step ended on holds.
    const frame = slide[0]!.animTick;
    expect(frame % 8).toBe(0);
    expect(slide.every((t) => t.facing === 'down' && t.animTick === frame)).toBe(true);
  }, 600000);
});
