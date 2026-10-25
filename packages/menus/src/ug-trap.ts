/**
 * A trap gone off under the player (decomp src/underground/traps.c: Traps_NotifyTrapTriggered and the trap's client
 * task), one 30 Hz tick per step, drawn over the Underground's field in DS px (the field is on the touch screen there):
 * - every trap: "Oops! {trap}!" at once and the screen's flash (BrightnessController +10 and back), then:
 * - slide, hole, altered steps: the wait before the field's part (MOVE_TRAP_STATE_START_SLIDE's 30 ticks,
 *   HOLE_TRAP_STATE_DRAW_HOLE's 30, the altered task's 30); the app closes unescaped and the field takes over;
 * - the alerts: 30 ticks, then the player is free (escaped);
 * - the escape games (core `SmokeGame`, `BubbleGame`, `BoulderGame`, `LeafGame`, `FlameGame`), after 30 ticks and their
 *   tutorial ("Remove the Trap by touch!" / "Blow the Trap away!", erased 60 ticks later), the field dimmed (−4).
 * The rock trap's shadow grows on the field under the player until the boulder lands (`AppHost.undergroundTrapShadow`).
 * The microphone is held A or a held touch here (`blow:on`/`blow:off`): a sample of 100 (the DS's signed 8-bit).
 * Rolls (the bubbles, the leaves, the smoke's pattern) take the visit's generator (`AppHost.undergroundMiningRand`:
 * CommSys_Seed's; the smoke's pattern is LCRNG_Next's on the DS).
 */
import { BoulderGame, BubbleGame, FlameGame, LeafGame, SmokeGame, trapEffect, type Button, type TrapEffect } from '@opensinnoh/core';
import { newGameRecord, type InputFrame, type UndergroundTables, type UndergroundTrapView } from '@opensinnoh/contracts';
import { menuSe, type MenuContext } from './context.ts';
import { plainText } from './strings.ts';
import type { Screen, Step } from './stack.ts';

/** SEQ_SE_DP_UG_022–026, SEQ_SE_DP_FAWA, SEQ_SE_DP_FPASA2, SEQ_SE_DP_FW466, SEQ_SE_DP_FW452 (SDAT indexes). */
const SE = { pop: 1574, hit: 1575, fire: 1576, smoke: 1577, collapse: 1578, bubbles: 1632, smokeIn: 1633, shadow: 1630, land: 1629 };
const W = 256;
const H = 192;
/** The flash (ticks 1–2 at +10), the tasks' `timer > 30` (after the intro's states), the tutorial's 60 ticks. */
const FLASH = { up: 1, down: 3 };
const WAIT = 30;
const TUTORIAL = 60;
/** The microphone's |sample| a held A or touch stands for. */
const BLOW_SAMPLE = 100;
/** The keys' stylus: pixels a tick. */
const CURSOR_SPEED = 4;
/** A popped bubble's last frames (the pop animation) and the smoke's hiss's spacing. */
const POP_TICKS = 12;
const HISS_TICKS = 10;
/** The boulder's sprites (boulder_anim: the boulder, a dust cloud, a piece, the collapse's frames from 3). */
const ROCK_ANIM = { boulder: 0, dust: 1, debris: 2, collapse: 3 };
/** Traps_InitBoulderDebris: the pieces (x, y below the boulder's top, speeds), more the more broken. */
const DEBRIS = [
  [128, -30, 2, -3],
  [120, -30, -2, -3],
  [100, -10, -2, -3],
  [140, -10, 2, -3],
  [140, -20, -2, -3],
  [110, 0, -1, -2],
  [128, -5, 3, -4],
  [132, -15, -3, -4],
  [112, 0, 1, -2],
  [115, 2, 1, -2],
  [105, -5, 2, -4],
  [140, -15, -2, -4],
  [135, -20, -2, -2],
  [120, -11, 2, 0],
] as const;
const DEBRIS_BY_STAGE = [1, 3, 6, 10, 14];
/** ov5_DrawGrowingFloorTexture(…, 5, …) and ov5_021F4F8C: the shadow's float grows by 0.2 a frame while under 5. */
const SHADOW = { size: 5, growth: 0.2 };

type Game =
  | { kind: 'smoke'; game: SmokeGame; hiss: number }
  | { kind: 'bubble'; game: BubbleGame; pops: Map<number, number> }
  | { kind: 'rock'; game: BoulderGame; debris: { x: number; y: number; dx: number; dy: number }[]; shadow: number | null }
  | { kind: 'leaf'; game: LeafGame }
  | { kind: 'fire'; game: FlameGame };

export function undergroundTrapScreen(ctx: MenuContext, trap: number): Screen {
  const tables: UndergroundTables | undefined = newGameRecord(ctx.registries).underground;
  if (!tables) throw new Error('trap: the packs have no Underground (NewGame.underground)');
  const effect: TrapEffect = trapEffect(trap);
  const se = (n: number) => menuSe(ctx, n);
  const rand = () => {
    const r = ctx.host.undergroundMiningRand?.();
    if (!r) throw new Error('trap: no Underground generator (AppHost.undergroundMiningRand)');
    return r;
  };
  const trapName = (() => {
    const id = ctx.registries.textBanks.get(ctx.text.id('TEXT_BANK_UNDERGROUND_TRAPS'))?.messages[trap];
    if (!id) throw new Error(`trap: TEXT_BANK_UNDERGROUND_TRAPS has no trap ${trap}`);
    return plainText(ctx.registries.texts.get(id)!.text);
  })();
  const isGame = effect.kind === 'smoke' || effect.kind === 'bubble' || effect.kind === 'rock' || effect.kind === 'leaf' || effect.kind === 'fire';

  let tick = 0;
  let message: string | null = ctx.text.message('UndergroundCommon_Text_TriggeredTrap', trapName);
  let tutorialAt = -1;
  let game: Game | null = null;
  let cursor = { x: W / 2, y: H / 2 };
  let keys = false;
  let blowTap = false;
  let blowing = false;
  let done: boolean | null = null;

  const startGame = (): Game => {
    switch (effect.kind) {
      case 'smoke': {
        se(SE.smokeIn);
        const pattern = effect.big ? tables.traps.bigSmoke : tables.traps.smoke[rand().next(tables.traps.smoke.length)]!;
        return { kind: 'smoke', game: new SmokeGame(pattern), hiss: 0 };
      }
      case 'bubble':
        se(SE.bubbles);
        return { kind: 'bubble', game: new BubbleGame(effect.foam, rand()), pops: new Map() };
      case 'rock':
        se(SE.shadow);
        ctx.host.undergroundTrapShadow?.(0);
        return { kind: 'rock', game: new BoulderGame(effect.fall), debris: [], shadow: 0 };
      case 'leaf':
        return { kind: 'leaf', game: new LeafGame(effect.flower, rand()) };
      case 'fire':
        return { kind: 'fire', game: new FlameGame(effect.big) };
    }
    throw new Error(`trap ${trap} has no escape game`);
  };

  /** A stylus press at a DS point: a bubble pops, the boulder is hit. */
  const press = (g: Game, x: number, y: number): void => {
    if (g.kind === 'bubble') {
      const b = g.game.press(x, y);
      if (b) {
        se(SE.pop);
        g.pops.set(g.game.bubbles.indexOf(b), 0);
      }
    } else if (g.kind === 'rock') {
      const hit = g.game.press(x, y);
      if (hit) se(SE.hit);
      if (hit === 'cracked') g.debris = DEBRIS.slice(0, DEBRIS_BY_STAGE[Math.min(Math.floor(g.game.damage / 3), 4)]).map(([dx0, dy0, dx, dy]) => ({ x: dx0, y: g.game.y + dy0, dx, dy }));
    }
  };

  /** One tick of the game, after the stylus; true once it is won. */
  const play = (g: Game): boolean => {
    switch (g.kind) {
      case 'smoke':
        return g.game.won;
      case 'bubble':
        for (const [i, t] of g.pops) g.pops.set(i, t + 1);
        g.game.step();
        return false;
      case 'rock': {
        const event = g.game.step();
        if (g.shadow !== null) {
          // Traps_ProcessBoulder: the shadow goes as the boulder lands.
          g.shadow = event === 'landed' ? null : g.shadow < SHADOW.size ? Math.fround(g.shadow + SHADOW.growth) : g.shadow;
          ctx.host.undergroundTrapShadow?.(g.shadow);
        }
        if (event === 'landed') se(SE.land);
        if (event === 'collapsed') se(SE.collapse);
        if (g.game.phase === 'debris') {
          for (const d of g.debris) {
            d.x += d.dx;
            d.y += d.dy;
            d.dy += g.game.t;
          }
          g.debris = g.debris.filter((d) => d.y <= g.game.y + 35);
        } else g.debris = [];
        return g.game.won;
      }
      case 'leaf':
        g.game.step(blowing ? BLOW_SAMPLE : 0);
        return false;
      case 'fire':
        if (g.game.step(blowing ? BLOW_SAMPLE : 0)) se(SE.fire);
        return g.game.won;
    }
  };

  const sprites = (): UndergroundTrapView['sprites'] => {
    const g = game;
    if (!g) return [];
    switch (g.kind) {
      case 'smoke':
        return [];
      case 'bubble':
        return g.game.bubbles.flatMap((b, i) => {
          const popped = g.pops.get(i);
          if (popped !== undefined && popped > POP_TICKS) return [];
          return [{ sheet: 'trap_bubble', anim: b.size * 2 + (b.popped ? 1 : 0), x: Math.round(b.x), y: Math.round(b.y), scale: BubbleGame.wobble(b), tick: popped ?? tick + i * 4, translucent: true as const }];
        });
      case 'rock': {
        const r = g.game;
        if (r.phase === 'shadow' || r.phase === 'gone') return [];
        const sheet = r.stage === 0 ? 'trap_boulder' : `trap_boulder_${r.stage}`;
        const anim = r.phase === 'collapse' && r.t % 8 ? ROCK_ANIM.collapse + Math.min(9, Math.floor(r.t / 8)) : ROCK_ANIM.boulder;
        const out: UndergroundTrapView['sprites'] = [{ sheet, anim, x: 128 + r.shake, y: r.y, scale: 1, tick: r.t }];
        for (const d of g.debris) out.push({ sheet, anim: ROCK_ANIM.debris, x: d.x, y: d.y, scale: 1, tick: r.t });
        if (r.phase === 'collapse') for (let i = 1; i < 9; i++) out.push({ sheet, anim: ROCK_ANIM.dust, x: 70 + 12 * i, y: r.y + 39 + (i % 2), scale: 1, tick: r.t });
        return out;
      }
      case 'leaf': {
        const sheet = effect.kind === 'leaf' && effect.flower ? 'trap_petal' : 'trap_leaf';
        return g.game.leaves.flatMap((l) => (l ? [{ sheet, anim: 0, ...LeafGame.drawn(l), scale: 1, tick: 0 }] : []));
      }
      case 'fire':
        return [{ sheet: effect.kind === 'fire' && effect.big ? 'trap_fire' : 'trap_ember', anim: g.game.t ? 1 : 0, x: 128, y: 84, scale: g.game.scale(), tick, translucent: true as const }];
    }
  };

  const DIRS: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

  const tickScreen = (f: InputFrame): Step => {
    if (done !== null) return { close: { app: 'ug-trap', trap, escaped: done } };
    tick++;
    // The field's traps wait through the intro, then the field takes over.
    if (!isGame) {
      const wait = effect.kind === 'alert' ? WAIT + 6 : effect.kind === 'altered' ? WAIT : WAIT + 4;
      if (tick > wait) {
        message = null;
        done = effect.kind === 'alert';
      }
      return;
    }
    if (!game) {
      if (tick > WAIT + 5) {
        game = startGame();
        message = ctx.text.message(effect.kind === 'leaf' || effect.kind === 'fire' ? 'UndergroundCommon_Text_BlowTrapAway' : 'UndergroundCommon_Text_RemoveTrapByTouch');
        tutorialAt = tick;
      }
      return;
    }
    if (message && tick - tutorialAt >= TUTORIAL) message = null;
    // Traps_ProcessBubbles and the leaves check the last pop or leaf at the start of their next tick.
    if ((game.kind === 'bubble' || game.kind === 'leaf') && game.game.won) {
      done = true;
      return;
    }
    // The stylus: taps from the screen; the keys move their own cursor.
    const tap = f.tap;
    if (tap === 'blow:on') blowTap = true;
    else if (tap === 'blow:off') blowTap = false;
    blowing = blowTap || f.held.includes('a');
    const hit = tap?.match(/^hit:(\d+),(\d+)$/);
    if (hit) press(game, Number(hit[1]), Number(hit[2]));
    const g = game;
    const rub = (x: number, y: number) => {
      if (g.kind !== 'smoke' || !g.game.rub(x, y) || tick < g.hiss) return;
      se(SE.smoke);
      g.hiss = tick + HISS_TICKS;
    };
    const rubAt = tap?.match(/^rub:(\d+),(\d+)$/);
    if (rubAt) rub(Number(rubAt[1]), Number(rubAt[2]));
    else if (tap === 'rub:end' && g.kind === 'smoke') g.game.lift();
    const dir = (['up', 'down', 'left', 'right'] as Button[]).find((d) => f.held.includes(d));
    if (dir) {
      if (!keys && g.kind === 'smoke') g.game.lift();
      if (!keys && g.kind === 'smoke') g.game.rub(cursor.x, cursor.y);
      keys = true;
      const [dx, dy] = DIRS[dir]!;
      cursor = { x: Math.max(0, Math.min(W - 1, cursor.x + dx * CURSOR_SPEED)), y: Math.max(0, Math.min(H - 1, cursor.y + dy * CURSOR_SPEED)) };
      rub(cursor.x, cursor.y);
    }
    if (f.pressed.includes('a') && keys) press(g, cursor.x, cursor.y);
    if (play(g)) done = true;
    return;
  };

  const view = (): UndergroundTrapView => ({
    app: 'ug-trap',
    trap,
    game: game?.kind ?? null,
    tick,
    brightness: tick >= FLASH.up && tick < FLASH.down ? 10 : game || (effect.kind === 'alert' && tick > WAIT) ? -4 : 0,
    message: message ? { text: message, waiting: false } : null,
    smoke: game?.kind === 'smoke' ? [...game.game.tiles] : null,
    sprites: sprites(),
    cursor: keys && game && game.kind !== 'leaf' && game.kind !== 'fire' ? { ...cursor } : null,
    blowing,
  });

  return { view, input: () => undefined, tick: tickScreen };
}
