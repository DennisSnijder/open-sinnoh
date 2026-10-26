/**
 * The Town Map in fly mode (decomp applications/town_map: main.c TownMap_Main, graphics.c, fly_locations.c; the
 * data is `NewGame.townMap`), one DS frame per tick. Three frames of setup and two of graphics on black, the circle
 * wipe in (6 steps, SEQ_SE_DP_MEKURU), then the main loop; A or B starts the wipe out (SEQ_SE_DP_MEKURU2) and the
 * app ends two frames after it.
 *
 * The cursor starts on the player's cell (the zone's tile position on the main matrix, else the exit location;
 * (3, 27) when that is (0, 0)). A held d-pad moves it one cell, diagonals too, within x 1–28 and z 6–28: the move
 * takes three frames (DoZoomedMapMvt), and the next is read only then. The cell's name shows when tmap_block.dat
 * names it (and its hidden location, if any, is found): the main matrix's zone there, LoadMapName's few cells off
 * it, else MAP_HEADER_EVERYWHERE. The fly location under the cursor (TownMap_GetFlyLocationAtPos: the first of the
 * cell's zone; Pal Park, Victory Road and the League only on their own cell) blinks between palette 8 + its colour
 * and its own every 16 frames, once the d-pad is let go (UpdateBottomScreenText). A on an unlocked one picks it
 * (CanFlyToHoveredLocation, SEQ_SE_DP_DECIDE); B leaves (SEQ_SE_DP_DECIDE).
 *
 * The DS's touch screen only toggles the bottom screen's zoomed map, which this single screen does not show. Our
 * touch: a tap on an unlocked fly location's block moves the cursor to its cell and picks it, as A there would.
 *
 * With the objective option on (an OpenSinnoh addition), the current objective's destination town (its step's `to`:
 * the first fly location of that zone) blinks in the hovered palette every 32 frames, drawn even while locked.
 */
import type { Button } from '@opensinnoh/core';
import { newGameRecord, type GameState, type InputFrame, type Registries, type TownMap, type TownMapView } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import type { MenuContext } from './context.ts';
import { currentObjective } from './objective.ts';
import { tapIndex, type Screen, type Step } from './stack.ts';

/** TOWN_MAP_GRID_SPACING and its offsets: a cell's sprite position. */
const GRID = 7;
const GRID_X = 25;
const GRID_Y = -34;
export const cellPosition = (x: number, z: number) => ({ x: GRID * x + GRID_X, y: GRID * z + GRID_Y });
/** HandleInput's cursor bounds. */
const BOUNDS = { minX: 1, maxX: 28, minZ: 6, maxZ: 28 };
/** The map's matrix is 30 cells a row (MAP_MATRIX_MAX_WIDTH); a zone tile is 32 per cell. */
const CELL_TILES = 32;
const SETUP_FRAMES = 3 + 2;
const FADE_STEPS = 6;
const BLACK = 16;
/** TownMap_BlinkHoveredFlyLocation: the hovered block swaps palettes every 16 frames. */
const BLINK = 16;
/** The objective's destination blinks at half the hovered block's speed. */
const OBJECTIVE_BLINK = 32;
const DIRS: readonly Button[] = ['up', 'down', 'left', 'right'];

/** The cursor's first cell (TownMapContext_Init, TownMap_Init's InitDefaultAppResources). */
export function startCell(registries: Pick<Registries, 'zones' | 'matrices'>, state: GameState, map: TownMap): [number, number] {
  const zone = registries.zones.get(state.player.zone)!;
  const main = registries.matrices.get(map.matrix)!;
  const at = zone.matrix === main.id ? { x: state.player.x, z: state.player.z } : (state.escapeLocation ?? { x: 0, z: 0 });
  if (at.x === 0 && at.z === 0) return [3, 27];
  return [Math.trunc(at.x / CELL_TILES), Math.trunc(at.z / CELL_TILES)];
}

/** The main matrix's zone at a cell (MainMapMatrixData_GetMapHeaderIDAtCoords), null for MAP_HEADER_EVERYWHERE. */
export function cellZone(registries: Pick<Registries, 'matrices'>, map: TownMap, x: number, z: number): Id | null {
  const m = registries.matrices.get(map.matrix)!;
  return m.zones?.[x + z * m.width] ?? null;
}

/** TownMap_GetMapBlockAtPosition: the cell's tmap_block entry, if its hidden location (if any) is found. */
export function namedCell(map: TownMap, found: number, x: number, z: number): boolean {
  const c = map.cells.find((b) => b.x === x && b.z === z);
  return !!c && (c.hidden === 0 || (c.hidden & found) !== 0);
}

/** TownMap_GetFlyLocationAtPos: the fly location for the cell's zone (special ones on their own cell). */
export function flyLocationAt(map: TownMap, zone: Id | null, x: number, z: number): number | null {
  for (let i = 0; i < map.locations.length; i++) {
    const l = map.locations[i]!;
    if (l.zone !== zone) continue;
    if (!l.cell || (l.cell[0] === x && l.cell[1] === z)) return i;
  }
  return null;
}

/** The fly locations unlocked now (sTownMapFlyLocationUnlockFlags: their FLAG_FIRST_ARRIVAL_* set). */
export function unlockedLocations(registries: Pick<Registries, 'flags'>, state: GameState, map: TownMap): boolean[] {
  return map.locations.map((l) => state.flags[l.flag] ?? registries.flags.get(l.flag)!.initial);
}

/** The hidden locations found (bit i: decomp enum HiddenLocation i). */
export function foundHidden(registries: Pick<Registries, 'vars'>, state: GameState, map: TownMap): number {
  return map.hidden.reduce((bits, h, i) => ((state.vars[h.var] ?? registries.vars.get(h.var)!.initial) === h.value ? bits | (1 << i) : bits), 0);
}

/** The cell a fly location is picked on by touch: its own cell, else the cell its block's sprite position names. */
export function locationCell(map: TownMap, i: number): [number, number] {
  const l = map.locations[i]!;
  return l.cell ?? [Math.trunc(l.sprite[0] / GRID), Math.trunc(l.sprite[1] / GRID)];
}

/**
 * `pick(location)` runs when a fly location is chosen, `cancel()` on B (both after the wipe out): the party menu
 * flies or goes back to itself.
 */
/** `view`: the Town Map to look at (`open_region_map`, the Town Map item): no prompt, A flies nowhere, B closes. */
export function townMapScreen(ctx: MenuContext, pick: (location: number) => Step, cancel: () => Step, view = false): Screen {
  const map = newGameRecord(ctx.registries).townMap;
  if (!map) throw new Error('menus: the Town Map needs NewGame.townMap');
  const reg = ctx.registries;
  const unlocked = unlockedLocations(reg, ctx.state, map);
  const found = foundHidden(reg, ctx.state, map);
  const objectiveZone = ctx.host.options().objective === 0 ? (currentObjective(ctx.state, reg)?.to ?? null) : null;
  const objective = objectiveZone === null ? -1 : map.locations.findIndex((l) => l.zone === objectiveZone);
  const se = (name: string) => {
    const id = ctx.text.id(name);
    if (reg.sequences.has(id)) ctx.host.sound?.playSe(id);
    else ctx.log.stub('audio:sequence-missing', `no sequence ${id} in the packs: not played`);
  };
  const [startX, startZ] = startCell(reg, ctx.state, map);
  let cursorX = startX;
  let cursorZ = startZ;
  let zone = cellZone(reg, map, cursorX, cursorZ);
  let prevZone: Id | null | -1 = -1;
  let named = namedCell(map, found, cursorX, cursorZ);
  let name: string | null = null;
  /** DoZoomedMapMvt's countdown (3 at a move) and the move's bits, HandleInput's held-release step (unk_15_0). */
  let stage = 0;
  let queued = false;
  let released = 0;
  let moveDone = false;
  let hovered: number | null = null;
  let blinkTimer = 0;
  let blinkOn = false;
  let phase: 'setup' | 'fade-in' | 'main' | 'fade-out' | 'cleanup' = 'setup';
  let frames = 0;
  let fade = BLACK;
  let exit: (() => Step) | null = null;
  let tick = 0;

  const nameOf = (): string | null => {
    if (!named) return null;
    const z = zone ?? map.names.find((n) => n.x === cursorX && n.z === cursorZ)?.zone ?? map.everywhere;
    return reg.zones.get(z)!.name;
  };
  const updateHoveredLocation = () => {
    prevZone = zone;
    zone = cellZone(reg, map, cursorX, cursorZ);
    named = namedCell(map, found, cursorX, cursorZ);
  };
  /** TownMap_UpdateHoveredFlyLocation. */
  const updateHoveredFly = (z: Id | null | -1) => {
    const at = z === -1 ? null : flyLocationAt(map, z, cursorX, cursorZ);
    if (at === null || !unlocked[at]) {
      hovered = null;
      return;
    }
    if (hovered === null) [blinkTimer, blinkOn] = [0, false];
    hovered = at;
  };
  const updateText = () => {
    name = nameOf();
    updateHoveredFly(zone);
  };
  updateHoveredLocation();
  updateText();

  /** CanFlyToHoveredLocation. */
  const canFly = (): number | null => {
    if (!named) return null;
    const at = flyLocationAt(map, zone, cursorX, cursorZ);
    return at !== null && unlocked[at] ? at : null;
  };
  const leave = (then: () => Step) => {
    se('SEQ_SE_DP_DECIDE');
    se('SEQ_SE_DP_MEKURU2');
    exit = then;
    phase = 'fade-out';
    frames = 0;
  };
  const choose = () => {
    if (view) return false;
    const at = canFly();
    if (at === null) return false;
    leave(() => pick(at));
    return true;
  };

  /** HandleInput (the held d-pad). */
  const handleInput = (held: readonly Button[]) => {
    const dirs = DIRS.filter((d) => held.includes(d));
    if (queued || !dirs.length) {
      if (!dirs.length && released === 1) released = 2;
      return;
    }
    if (dirs.includes('up') && cursorZ > BOUNDS.minZ) cursorZ--;
    if (dirs.includes('down') && cursorZ < BOUNDS.maxZ) cursorZ++;
    if (dirs.includes('right') && cursorX < BOUNDS.maxX) cursorX++;
    if (dirs.includes('left') && cursorX > BOUNDS.minX) cursorX--;
    stage = 3;
    queued = true;
    moveDone = false;
    released = 1;
  };
  /** TownMap_UpdateBottomScreen, then DoZoomedMapMvt. */
  const updateBottomScreen = () => {
    if (moveDone && released >= 2) {
      updateText();
      moveDone = false;
      released = 0;
    }
    if (!stage) return;
    if (stage-- === 3) {
      updateHoveredLocation();
      name = nameOf();
    }
    if (stage > 0) return;
    moveDone = true;
    queued = false;
    if (prevZone !== zone) updateHoveredFly(-1);
  };
  /** TownMap_BlinkHoveredFlyLocation. */
  const blink = () => {
    if (hovered === null) return;
    if (++blinkTimer === BLINK) [blinkTimer, blinkOn] = [0, !blinkOn];
  };

  const stepFade = (to: number): boolean => {
    frames++;
    const k = to ? frames : FADE_STEPS - frames;
    fade = Math.round((BLACK * k) / FADE_STEPS);
    return frames === FADE_STEPS;
  };

  return {
    view: (): TownMapView => ({
      app: 'town-map',
      hidden: map.hidden.flatMap((_, i) => (found & (1 << i) ? [i] : [])),
      blocks: map.locations.flatMap((l, i) => {
        // TownMap_LoadFlyLocations: Pal Park's and Victory Road's blocks are not drawn until unlocked.
        if (i !== objective && !unlocked[i] && l.cell && !(l.cell[0] === 26 && l.cell[1] === 17)) return [];
        const marked = i === objective && Math.trunc(tick / OBJECTIVE_BLINK) % 2 === 0;
        const blinking = (hovered === i && !blinkOn) || marked;
        const palette = blinking ? 8 + l.palette : 5 + l.palette + (unlocked[i] ? 1 : 0);
        return [{ location: i, palette, shape: l.shape, x: l.sprite[0] + GRID_X, y: l.sprite[1] + GRID_Y, unlocked: unlocked[i]!, ...(i === objective ? { objective: true as const } : {}) }];
      }),
      player: { ...cellPosition(startX, startZ), gender: ctx.state.gender },
      cursor: cellPosition(cursorX, cursorZ),
      tick,
      prompt: view ? '' : ctx.text.text(map.flyToWhere),
      name,
      fade,
    }),
    input: () => undefined,
    tick(f: InputFrame): Step {
      tick++;
      switch (phase) {
        case 'setup':
          if (++frames === SETUP_FRAMES) {
            se('SEQ_SE_DP_MEKURU');
            [phase, frames] = ['fade-in', 0];
          }
          return;
        case 'fade-in':
          if (stepFade(0)) phase = 'main';
          blink();
          return;
        case 'main': {
          const tap = f.tap === undefined ? null : f.tap === 'back' ? -1 : tapIndex(f.tap, 'town');
          if (tap !== null && tap >= 0 && tap < map.locations.length && unlocked[tap]) {
            [cursorX, cursorZ] = locationCell(map, tap);
            stage = 0;
            queued = false;
            updateHoveredLocation();
            updateText();
            choose();
          } else if (f.pressed.includes('a')) choose();
          else if (f.pressed.includes('b') || tap === -1) leave(cancel);
          else handleInput(f.held);
          if (phase === 'main') updateBottomScreen();
          blink();
          return;
        }
        case 'fade-out':
          if (stepFade(BLACK)) [phase, frames] = ['cleanup', 0];
          return;
        case 'cleanup':
          if (++frames < 2) return;
          return exit!();
      }
    },
  };
}
