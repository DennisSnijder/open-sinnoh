/**
 * The Underground's mining game (decomp src/underground/mining.c: Mining_ProcessMiningSpotInteract's prompt, then
 * Mining_GameTask), one 30 Hz tick per step. The board's rules and rolls are core's `MiningBoard` (its generator also
 * rolls the shakes, the sparkles and the spheres' sizes, in the decomp's order, so they follow the strikes' timing).
 * - The prompt over the field: "The wall is bulging…" and YES/NO. YES takes the spot away (Mining_ProcessConfirmStart
 *   MiningResult), sets FLAG_DIGGING_FOR_FOSSILS and starts the board on a seed from the field stream.
 * - The board: the circle fade, the ping (SEQ_SE_PL_UG_006), 20 ticks, "Something pinged in the wall! n confirmed!" for
 *   80 ticks, the first board's tutorial (A or a touch per page), then the strikes until every item is bare (25 ticks of
 *   shine, "Everything was dug up!") or the wall is gone (45 ticks of shaking, the fade down, "The wall collapsed!").
 *   Each item uncovered then is named and put away, or the bag is full; a message waits 60 ticks, or A or a touch.
 * - Input (the DS's is the stylus only): `hit:<x>,<y>` strikes at that DS px of the board, `hammer`/`pickaxe` press the
 *   side buttons; the keys move a board cursor (an addition), A strikes there, L, R or SELECT switch the tool.
 */
import { isMiningFossil, isMiningSphere, MINING, MiningBoard, setPlateMined, tryAddMinedSphere, tryAddTreasure, underground, UNDERGROUND_LIMITS } from '@opensinnoh/core';
import { newGameRecord, type InputFrame, type MiningView, type UndergroundTables, JOURNAL_EVENT, journalEvent } from '@opensinnoh/contracts';
import { incrementTrainerScore } from '@opensinnoh/services';
import { menuSe, type MenuContext } from './context.ts';
import { plainText } from './strings.ts';
import type { Screen, Step } from './stack.ts';

/** Sounds (SDAT sequence indexes): SE_CONFIRM, SEQ_SE_DP_UG_001..004, SEQ_SE_DP_KIRAKIRA3/4, SEQ_SE_DP_PIRORIRO2, SEQ_SE_PL_UG_006. */
const SE = { confirm: 1500, collapse: 1697, pickaxe: 1698, hammer: 1699, rock: 1700, found: 1701, shine: 1703, done: 1507, ping: 1354 };
/** StartScreenFade(…, 6, 1) circle fades; the collapse's downward fade (15 steps). */
const FADE = 6;
const COLLAPSE_FADE = 15;
/** Mining_GameTask's waits. */
const WAIT = { ping: 20, pinged: 80, text: 60, shine: 25, collapse: 45 };
/** The board's place on the touch screen: 16 px cells from y 32; the side buttons from x 208 (MINING_GAME_WIDTH · 16). */
const CELL = 16;
const BOARD_TOP = 32;
/** Mining_ButtonTouchCheck's hit boxes (strictly inside). */
const HAMMER = { x0: 26 * 8 + 6, x1: 31 * 8 + 4, y0: 5 * 8 + 3, y1: 13 * 8 + 6 };
const PICKAXE = { x0: 26 * 8 + 6, x1: 31 * 8 + 4, y0: 14 * 8 + 2, y1: 21 * 8 + 6 };
/** enum MiningAnimation (ug_anim.narc's animations). */
const ANIM = { pickaxeSwing: 0, hammerSwing: 1, rockImpact: 2, pickaxeImpact: 3, hammerImpact: 4, itemSparkle: 5, hammerButton: 6, pickaxeButton: 7, dugUp: 8 };
/** sItemShineAnimSequence: the item's palette, one step every second tick (the delays), ending on palette 0. */
const SHINE = [1, 1, 2, 2, 1, 1, 0, 0, 1, 1, 2, 2, 1, 1, 0];
/** Decomp RECORD_SPHERES_BURIED is the menu's; TRAINER_SCORE_EVENT_UNDERGROUND_UNCOVER_FOSSIL. */
const SCORE_UNCOVER = 30;

type Phase =
  | { kind: 'prompt' }
  | { kind: 'fade-in'; t: number }
  | { kind: 'ping'; t: number }
  | { kind: 'pinged'; t: number }
  | { kind: 'tutorial'; page: number }
  | { kind: 'main' }
  | { kind: 'everything'; t: number }
  | { kind: 'collapse'; t: number }
  | { kind: 'collapse-fade'; t: number }
  | { kind: 'message'; text: string; t: number; then: () => void }
  | { kind: 'fade-out'; t: number };

interface Effect {
  anim: number;
  x: number;
  y: number;
  t: number;
}

export function miningScreen(ctx: MenuContext, spot: number): Screen {
  const tables: UndergroundTables | undefined = newGameRecord(ctx.registries).underground;
  if (!tables) throw new Error('mining: the packs have no Underground (NewGame.underground)');
  const u = underground(ctx.state);
  const at = u.spots[spot];
  if (!at) throw new Error(`mining: no mining spot ${spot}`);
  const text = (name: string, ...slots: string[]) => ctx.text.message(`Underground${name}`, ...slots);
  const bank = (b: string, i: number) => {
    const id = ctx.registries.textBanks.get(ctx.text.id(b))?.messages[i];
    if (!id) throw new Error(`mining: ${b} has no message ${i}`);
    return plainText(ctx.registries.texts.get(id)!.text);
  };
  const itemName = (id: number) => bank('TEXT_BANK_UNDERGROUND_ITEM_NAMES_WITH_ARTICLES', id);
  const se = (n: number) => menuSe(ctx, n);

  let tick = 0;
  let phase: Phase = { kind: 'prompt' };
  let cursor = 0;
  let board: MiningBoard | null = null;
  let pickaxe = true;
  /** sidebarTouchState: 2 the press, 3 the button settles (then 0). */
  let sidebar = 0;
  let shakeTimer = 0;
  let shake = { x: 0, y: 0 };
  let soundTimer = 0;
  let fade = 0;
  let collapsed = false;
  const shines = new Map<number, number>();
  const effects: Effect[] = [];
  let pageTexts: string[] = [];
  let boardCursor = { x: 6, y: 5 };
  /** Items uncovered still to name and put away (Mining_PrintNextDugUpItem's order: object order). */
  let pending: number[] = [];

  const view = (): MiningView => {
    const message =
      phase.kind === 'prompt' ? { text: text('Common_Text_WallIsBulging'), waiting: false }
      : phase.kind === 'pinged' ? { text: text('Common_Text_SomethingPingedInWall', String(board!.items)), waiting: false }
      : phase.kind === 'tutorial' ? { text: pageTexts[phase.page]!, waiting: true }
      : phase.kind === 'message' ? { text: phase.text, waiting: true }
      : null;
    return {
      app: 'mining',
      tick,
      phase: phase.kind === 'prompt' ? 'prompt' : 'board',
      fade,
      shake: { ...shake },
      crack: board?.wall ?? MINING.wall,
      objects: (board?.objects ?? []).map((o, i) => ({
        sprite: o.object.sprite,
        palette: o.object.palette,
        x: o.x,
        y: o.y,
        width: o.object.width,
        height: o.object.height,
        shape: o.object.shape,
        shine: i < (board?.items ?? 0) ? SHINE[Math.min(shines.get(i) ?? SHINE.length - 1, SHINE.length - 1)]! : 0,
      })),
      dirt: board ? [...board.dirt] : [],
      tool: pickaxe ? 'pickaxe' : 'hammer',
      effects: effects.map((e) => ({ anim: e.anim, x: e.x, y: e.y, tick: e.t })),
      cursor: phase.kind === 'main' ? { ...boardCursor } : null,
      message,
      yesNo: phase.kind === 'prompt' ? { yes: ctx.text.t('bagYes'), no: ctx.text.t('bagNo'), cursor: cursor as 0 | 1 } : null,
    };
  };

  const effect = (anim: number, x: number, y: number) => {
    effects.push({ anim, x, y, t: 0 });
    if (effects.length > 8) effects.shift();
  };

  /** Mining_RemoveDirt's hit at board cell (x, y): the animations and sounds, then the wall's damage and the redraw. */
  const strike = (x: number, y: number) => {
    const b = board!;
    const hit = b.strike(x, y, pickaxe);
    const px = x * CELL + 8;
    const py = (y + 2) * CELL + 8;
    effect(pickaxe ? ANIM.pickaxeSwing : ANIM.hammerSwing, px, py);
    if (hit.rock) {
      effect(ANIM.rockImpact, px, py);
      se(SE.rock);
    } else if (pickaxe) {
      effect(ANIM.pickaxeImpact, px, py);
      se(SE.pickaxe);
    } else {
      effect(ANIM.hammerImpact, px, py);
      se(SE.hammer);
    }
    if (hit.item) {
      effect(ANIM.itemSparkle, px, py);
      soundTimer = 15;
    }
    shakeTimer = 1;
  };

  const setTool = (toPickaxe: boolean) => {
    pickaxe = toPickaxe;
    sidebar = 2;
    se(SE.confirm);
    effect(toPickaxe ? ANIM.pickaxeButton : ANIM.hammerButton, 232, toPickaxe ? 152 : 80);
  };

  /** Mining_QueueScreenShake's rolls: two a tick while the shake lasts ((196 − wall) / 15 ticks). */
  const queueShake = () => {
    const b = board!;
    if (shakeTimer === 0) return;
    const duration = Math.floor((MINING.wall - b.wall) / 15);
    const size = 3 + Math.floor((MINING.wall - b.wall) / 50);
    shakeTimer++;
    if (shakeTimer > duration) shake = { x: 0, y: 0 };
    else shake = { x: b.rand.next(size) - Math.floor(size / 2), y: b.rand.next(size) - Math.floor(size / 2) };
    // Mining_ShakeScreen (the vblank): the shake ends after (196 − wall) / 10.
    if (shakeTimer > Math.floor((MINING.wall - b.wall) / 10)) shakeTimer = 0;
  };

  /** Mining_DrawUncoveredItemShines: a newly bare item's three sparkles (two rolls each) and its palette steps. */
  const drawShines = () => {
    const b = board!;
    for (const [i, step] of shines) {
      if (step !== 0) continue;
      se(SE.shine);
      const o = b.objects[i]!;
      for (let j = 0; j < 3; j++) {
        const x = b.rand.next(o.object.width * 2 * 8) + o.x * CELL;
        const y = b.rand.next(o.object.height * 2 * 8) + o.y * CELL + BOARD_TOP;
        effect(ANIM.dugUp + j, x, y);
      }
    }
    for (const [i, step] of shines) if (step < SHINE.length) shines.set(i, step + 1);
  };

  const say = (message: string, then: () => void) => {
    phase = { kind: 'message', text: message, t: 0, then };
  };

  /** Mining_PrintNextDugUpItem then Mining_ProcessNextDugUpItem, item by item, then the fade out. */
  const nextItem = (): void => {
    const b = board!;
    const i = pending.shift();
    if (i === undefined) {
      phase = { kind: 'fade-out', t: 0 };
      return;
    }
    const id = b.objects[i]!.object.id;
    const size = b.sphereSize(id);
    const name = itemName(id);
    const shown = isMiningSphere(id) ? text('Common_Text_YouObtainedSphere', '', String(size), name) : text('Common_Text_ItemWasObtained', '', '', name.charAt(0).toUpperCase() + name.slice(1));
    say(shown, () => {
      // Mining_ProcessNextDugUpItem: the records first, then the bag (or "Your Bag is full!").
      if (isMiningSphere(id)) u.records.spheresDug++;
      else {
        ctx.log.stub('tv:underground-treasures', 'the Underground treasures TV segment is not recorded yet');
        if (isMiningFossil(id)) {
          u.records.fossilsDug++;
          const v = tables.vars.fossilsUnearthed;
          ctx.state.vars[v] = Math.min(0xffff, (ctx.state.vars[v] ?? ctx.registries.vars.get(v)?.initial ?? 0) + 1);
        } else u.records.otherDug++;
      }
      const room = isMiningSphere(id) ? u.spheres.length < UNDERGROUND_LIMITS.spheres : u.treasures.length < UNDERGROUND_LIMITS.treasures;
      if (!room) return say(text('Common_Text_TooBadBagIsFull3'), nextItem);
      if (isMiningSphere(id)) tryAddMinedSphere(u, id, size);
      else {
        tryAddTreasure(u, id);
        setPlateMined(u, id);
      }
      nextItem();
    });
  };

  const startItems = (all: boolean) => {
    const b = board!;
    pending = b.objects.slice(0, b.items).flatMap((o, i) => (o.dugUp ? [i] : []));
    say(all ? text('Common_Text_EverythingDugUp') : text('Common_Text_WallCollapsed'), nextItem);
  };

  /** Mining_MainGameLoop and the tick's draws. */
  const mainTick = (f: InputFrame) => {
    const b = board!;
    if (sidebar === 3) sidebar = 0;
    const hit = f.tap?.startsWith('hit:') ? f.tap.slice(4).split(',').map(Number) : null;
    if (hit && hit.length === 2 && hit.every(Number.isFinite)) {
      const [tx, ty] = hit as [number, number];
      if (tx < MINING.width * CELL && ty >= BOARD_TOP) strike(Math.floor(tx / CELL), Math.floor(ty / CELL) - 2);
      else if (tx >= MINING.width * CELL) {
        if (tx > HAMMER.x0 && tx < HAMMER.x1 && ty > HAMMER.y0 && ty < HAMMER.y1) setTool(false);
        else if (tx > PICKAXE.x0 && tx < PICKAXE.x1 && ty > PICKAXE.y0 && ty < PICKAXE.y1) setTool(true);
      }
    } else if (f.tap === 'hammer' || f.tap === 'pickaxe') setTool(f.tap === 'pickaxe');
    else if (f.pressed.includes('a')) strike(boardCursor.x, boardCursor.y);
    else if (f.pressed.some((p) => p === 'l' || p === 'r' || p === 'select')) setTool(!pickaxe);
    for (const [dir, dx, dy] of [['left', -1, 0], ['right', 1, 0], ['up', 0, -1], ['down', 0, 1]] as const) {
      if (!f.pressed.includes(dir)) continue;
      boardCursor = { x: Math.min(MINING.width - 1, Math.max(0, boardCursor.x + dx)), y: Math.min(MINING.height - 1, Math.max(0, boardCursor.y + dy)) };
    }
    if (soundTimer && --soundTimer === 0) se(SE.found);
    if (sidebar >= 2) sidebar++;
    const { all, fresh } = b.uncover();
    for (const i of fresh) shines.set(i, 0);
    if (all) {
      u.mined = true;
      incrementTrainerScore(ctx.state, ctx.registries, SCORE_UNCOVER);
      phase = { kind: 'everything', t: WAIT.shine };
    } else if (b.wall === 0) {
      u.mined = true;
      phase = { kind: 'collapse', t: WAIT.collapse };
    }
    queueShake();
    drawShines();
  };

  const start = () => {
    // Mining_ProcessConfirmStartMiningResult: the spot is gone; Mining_StartGameTask: FLAG_DIGGING_FOR_FOSSILS.
    u.spots.splice(spot, 1);
    ctx.state.flags[tables.flags.digging] = true;
    // Mining_StartGameTask: the journal's "dug underground" entry.
    journalEvent(ctx.registries, ctx.state, JOURNAL_EVENT.dugUnderground);
    const rand = ctx.host.undergroundMiningRand?.();
    if (!rand) throw new Error('mining: no mining generator (the board opens in the Underground only)');
    board = new MiningBoard(tables.miningObjects, u, (ctx.state.trainerId & 1) === 1, ctx.state.pokedex.national, rand);
    fade = 16;
    phase = { kind: 'fade-in', t: 0 };
  };

  const tickPhase = (f: InputFrame): Step => {
    const advance = f.pressed.includes('a') || f.tap === 'next' || (f.tap?.startsWith('hit:') ?? false);
    switch (phase.kind) {
      case 'prompt': {
        let answer: boolean | null = null;
        if (f.tap === 'yes') answer = true;
        else if (f.tap === 'no' || f.tap === 'back') answer = false;
        else if (f.pressed.includes('up') || f.pressed.includes('down')) {
          cursor = cursor ? 0 : 1;
          se(SE.confirm);
        } else if (f.pressed.includes('a')) answer = cursor === 0;
        else if (f.pressed.includes('b')) answer = false;
        if (answer === null) return;
        se(SE.confirm);
        if (!answer) return { close: { app: 'mining', dug: false } };
        start();
        return;
      }
      case 'fade-in':
        fade = Math.max(0, 16 - Math.round(((phase.t + 1) * 16) / FADE));
        if (++phase.t >= FADE) {
          se(SE.ping);
          phase = { kind: 'ping', t: 0 };
        }
        return;
      case 'ping':
        if (++phase.t > WAIT.ping) phase = { kind: 'pinged', t: 0 };
        return;
      case 'pinged':
        if (++phase.t <= WAIT.pinged) return;
        if (u.mined) phase = { kind: 'main' };
        else {
          pageTexts = ctx.text.messagePages('UndergroundCommon_Text_MiningTutorial');
          phase = { kind: 'tutorial', page: 0 };
        }
        return;
      case 'tutorial':
        if (!advance) return;
        if (phase.page + 1 < pageTexts.length) phase.page++;
        else phase = { kind: 'main' };
        return;
      case 'main':
        mainTick(f);
        return;
      case 'everything':
        drawShines();
        if (--phase.t === 0) {
          se(SE.done);
          startItems(true);
        }
        return;
      case 'collapse':
        // MINING_STATE_COLLAPSE_SHAKE: the shake every tick, then the fade down with SEQ_SE_DP_UG_001.
        shakeTimer = 1;
        queueShake();
        if (--phase.t === 0) {
          se(SE.collapse);
          phase = { kind: 'collapse-fade', t: 0 };
        }
        return;
      case 'collapse-fade':
        fade = Math.min(16, Math.round(((phase.t + 1) * 16) / COLLAPSE_FADE));
        if (++phase.t >= COLLAPSE_FADE) {
          collapsed = true;
          effects.length = 0;
          startItems(false);
        }
        return;
      case 'message':
        // Mining's text printer: once printed, A, a touch or 60 ticks.
        if (advance || ++phase.t >= WAIT.text) {
          const then = phase.then;
          then();
        }
        return;
      case 'fade-out':
        fade = Math.min(16, Math.round(((phase.t + 1) * 16) / FADE));
        if (++phase.t >= FADE) return { close: { app: 'mining', dug: true } };
        return;
    }
  };

  return {
    view: () => {
      const v = view();
      if (collapsed && phase.kind !== 'fade-out') v.fade = 16;
      return v;
    },
    input: () => undefined,
    tick(f: InputFrame): Step {
      tick++;
      for (const e of effects) e.t++;
      return tickPhase(f);
    },
  };
}
