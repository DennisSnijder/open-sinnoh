/**
 * The field apps (decomp src/applications/poketch/{pedometer,dowsing_machine,marking_map,berry_searcher,
 * link_searcher}, poketch_map.c): they read the player's position, the zone's hidden items and the steps.
 */
import { POKETCH_DEFAULT_MARKERS } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { Buttons, digit, digitsOf, insideLcd, layers, rect, SE, type AppCtx, type PoketchApp, type Point } from './common.ts';

/** Decomp pedometer: five digits with leading zeros; the button resets the count on release inside it. */
export function pedometer(ctx: AppCtx): PoketchApp {
  const p = ctx.deps.state.poketch;
  const button = new Buttons([rect(82, 100, 146, 156)]);
  let down = false;
  return {
    step(tick) {
      const e = button.update(tick.touch);
      if (e?.event === 'touch') {
        down = true;
        ctx.se(SE.POKETCH_010);
      } else if (e) {
        down = false;
        if (e.event === 'tap') p.steps = 0;
      }
    },
    view() {
      const l = layers(['poketch/pedometer_bg']);
      l.sprites.push({ sheet: 'poketch/pedometer', anim: { seq: down ? 1 : 0, t: 0 }, x: 114, y: 128 });
      digitsOf(p.steps, 5).forEach((d, i) => l.sprites.push(digit(d, 80 + 16 * i, 64)));
      l.targets = button.rects;
      l.info = { steps: p.steps };
      return l;
    },
  };
}

/** Decomp FieldSystem_GetNearbyHiddenItems: hidden items not yet found within x ±7, z −7..+6 of the player. */
export function nearbyHiddenItems(ctx: AppCtx): { dx: number; dz: number; range: number }[] {
  const { state, registries } = ctx.deps;
  const zone = registries.zones.get(state.player.zone)!;
  const found = (flag: Id) => state.flags[flag] ?? registries.flags.get(flag)?.initial ?? false;
  return zone.events.bgs.flatMap((b) => {
    const dx = b.x - state.player.x;
    const dz = b.z - state.player.z;
    return b.hiddenItem && !found(b.hiddenItem.flag) && dx >= -7 && dx <= 7 && dz >= -7 && dz <= 6 ? [{ dx, dz, range: b.hiddenItem.range }] : [];
  });
}

/** Decomp dowsing machine: tap the map; a ping spreads; items within their range blink; far items keep it pinging. */
export function dowsingMachine(ctx: AppCtx): PoketchApp {
  const RADII = [8, 24, 48];
  let result: 'none' | 'far' | 'near' = 'none';
  let ping: { at: Point; since: number } | null = null;
  let blink: number | null = null;
  let items: { x: number; y: number; range: number }[] = [];
  let touchedAt: Point = { x: 0, y: 0 };
  let t = 0;
  const PING = 18;
  const BLINK = 31;
  const search = (at: Point) => {
    result = 'none';
    items = [];
    for (const h of nearbyHiddenItems(ctx)) {
      const x = 112 + 11 * h.dx;
      const y = 101 + 11 * h.dz;
      const d = Math.sqrt((x - at.x) ** 2 + (y - at.y) ** 2);
      if (d <= RADII[h.range]!) {
        if (items.length < 8) items.push({ x, y, range: h.range });
        result = 'near';
      } else if (d <= 48 && result === 'none') result = 'far';
    }
    touchedAt = at;
    ping = { at, since: t };
    blink = null;
    ctx.se(SE.POKETCH_009);
  };
  return {
    step(tick) {
      t++;
      const h = tick.touch.held;
      if (tick.touch.tapped && h && h.x >= 24 && h.x < 200 && h.y >= 24 && h.y < 168) return search(h);
      if ((ping || blink !== null) && (tick.moved || tick.busy)) {
        ping = null;
        blink = null;
        return;
      }
      if (ping && t - ping.since >= PING) {
        const at = ping.at;
        ping = null;
        if (result === 'far') ping = { at, since: t };
        else if (result === 'near') blink = t;
      } else if (blink !== null && t - blink >= BLINK) {
        blink = null;
        ping = { at: touchedAt, since: t };
      }
    },
    view() {
      const l = layers(['poketch/dowsing_machine_bg']);
      if (ping) l.sprites.push({ sheet: 'poketch/dowsing_machine', anim: { seq: 0, t: t - ping.since }, x: ping.at.x, y: ping.at.y });
      if (blink !== null) for (const it of items) l.sprites.push({ sheet: 'poketch/dowsing_machine', anim: { seq: 1 + Math.min(2, it.range), t: t - blink }, x: it.x, y: it.y });
      l.targets = [];
      l.info = { result, items: items.map((i) => `${i.x},${i.y}`) };
      return l;
    },
  };
}

/** Decomp PoketchMap_GetPositionOnMap: a main-matrix chunk's spot on the Pokétch map. */
export function mapPosition(cx: number, cz: number): Point {
  const x = cx >= 0 && cx < 30 ? 26 + 6 * cx : 26;
  const y = cz >= 5 && cz < 33 ? 24 + 6 * (cz - 5) : 0;
  return { x, y };
}

/** Decomp Pokétch map hidden locations (Fullmoon Island, Newmoon Island, Spring Path, Seabreak Path) and their spots. */
const HIDDEN = [
  { overlay: 'map_fullmoon_island', x: 32, y: 42 },
  { overlay: 'map_newmoon_island', x: 50, y: 42 },
  { overlay: 'map_spring_path', x: 168, y: 122 },
  { overlay: 'map_seabreak_path', x: 194, y: 58 },
];

/** The player's chunk on the main matrix (decomp: the exit location while inside); remembered across zones. */
class MapCursor {
  private last: Point | null = null;
  constructor(private readonly ctx: AppCtx) {}
  get(): Point | null {
    const { state, registries } = this.ctx.deps;
    const zone = registries.zones.get(state.player.zone)!;
    if (registries.matrices.get(zone.matrix)?.sourceIndex === 0) this.last = mapPosition(Math.floor(state.player.x / 32), Math.floor(state.player.z / 32));
    return this.last;
  }
}

function hiddenLocations(ctx: AppCtx): Point[] {
  const { registries, state } = ctx.deps;
  const map = [...registries.newGame.values()][0]?.pokedexMap;
  if (!map) return [];
  return HIDDEN.flatMap((h) => {
    const rec = map.hidden.find((x) => x.overlay.endsWith(`/${h.overlay}`));
    if (!rec) return [];
    const value = state.vars[rec.var] ?? registries.vars.get(rec.var)?.initial ?? 0;
    return value === rec.value ? [{ x: h.x, y: h.y }] : [];
  });
}

/**
 * Decomp PoketchMap_GetPositionFromMapID for the roaming routes, in RoamerRouteIndex order (`GameState.roamers.routes`):
 * where the Marking Map draws a roamer.
 */
const ROAMER_SPOTS: readonly Point[] = [
  [47, 150], [56, 144], [65, 132], [50, 126], [50, 120], [62, 108], [74, 90], [80, 111], [83, 126], [101, 126], [125, 126], [128, 102], [122, 90],
  [92, 90], [104, 90], [110, 138], [119, 150], [152, 147], [152, 120], [140, 102], [86, 66], [80, 51], [41, 132], [56, 156], [59, 162], [74, 162],
  [170, 138], [68, 114], [56, 102],
].map(([x, y]) => ({ x: x!, y: y! }));
/** Decomp ANIMATION_INDEX_ROAMER (marking_map/graphics.c). */
const ROAMER_ANIM = 18;

/** Decomp marking map: the player's spot blinks; six markers to drag around (saved); each active roamer on its route. */
export function markingMap(ctx: AppCtx): PoketchApp {
  const p = ctx.deps.state.poketch;
  const cursor = new MapCursor(ctx);
  /** Front to back. */
  const order = [0, 1, 2, 3, 4, 5];
  let moving: number | null = null;
  let t = 0;
  const roamers = () => ctx.deps.state.roamers.slots.flatMap((r, slot) => (r ? [ROAMER_SPOTS[ctx.deps.state.roamers.routes[slot]!]!] : []));
  return {
    step(tick) {
      t++;
      const h = tick.touch.held;
      if (moving !== null) {
        if (!h || !insideLcd(h)) moving = null;
        else p.markers[moving] = { x: h.x - 16, y: h.y - 16 };
        return;
      }
      if (!tick.touch.tapped || !h || !insideLcd(h)) return;
      const hit = order.find((i) => Math.abs(p.markers[i]!.x + 16 - h.x) <= 8 && Math.abs(p.markers[i]!.y + 16 - h.y) <= 8);
      if (hit === undefined) return;
      order.splice(order.indexOf(hit), 1);
      order.unshift(hit);
      moving = hit;
      p.markers[hit] = { x: h.x - 16, y: h.y - 16 };
    },
    view() {
      const l = layers(['poketch/marking_map_bg']);
      for (const h of hiddenLocations(ctx)) l.sprites.push({ sheet: 'poketch/map', anim: { seq: 14 + HIDDEN.findIndex((x) => x.x === h.x && x.y === h.y), t: 0 }, ...h });
      // Decomp priority: hidden locations 9, roamers 8, the player and the markers in front.
      const spots = roamers();
      for (const r of spots) l.sprites.push({ sheet: 'poketch/map', anim: { seq: ROAMER_ANIM, t }, ...r });
      const at = cursor.get();
      if (at) l.sprites.push({ sheet: 'poketch/map', anim: { seq: 0, t }, ...at });
      for (const i of [...order].reverse()) l.sprites.push({ sheet: 'poketch/map', anim: { seq: (moving === i ? 8 : 1) + i, t: 0 }, x: p.markers[i]!.x + 16, y: p.markers[i]!.y + 16 });
      l.targets = [];
      l.info = { player: at ? `${at.x},${at.y}` : null, roamers: spots.map((r) => `${r.x},${r.y}`), markers: p.markers.map((m) => `${m.x},${m.y}`), moved: p.markers.some((m, i) => m.x !== POKETCH_DEFAULT_MARKERS[i]!.x || m.y !== POKETCH_DEFAULT_MARKERS[i]!.y) };
      return l;
    },
  };
}

/** Decomp MAX_MAP_BERRIES and ANIM_INDEX_BERRY (berry_searcher/graphics.h, graphics.c). */
const MAX_MAP_BERRIES = 64;
const BERRY_ANIM = 7;

/**
 * GetReadyBerryPatches: the growing patches in fruit, in patch order, at their map spots (sBerryPositions, a main-matrix
 * chunk each); a run of patches on the same spot shows once; at most 64.
 */
export function readyBerrySpots(ctx: AppCtx): Point[] {
  const tables = [...ctx.deps.registries.newGame.values()][0]?.berries;
  const spots = tables?.searcher;
  if (!spots) return [];
  const patches = ctx.deps.state.berryPatches;
  const out: Point[] = [];
  for (let i = 0; i < spots.length; i++) {
    const p = patches[i];
    if (!p?.growing || p.stage !== 'fruit') continue;
    const at = spots[i]!;
    while (i + 1 < spots.length && spots[i + 1]!.x === at.x && spots[i + 1]!.y === at.y) i++;
    out.push(mapPosition(at.x, at.y));
    if (out.length >= MAX_MAP_BERRIES) break;
  }
  return out;
}

/** Decomp berry searcher: the ripe berry patches on the map, the player and the legend; a tap refreshes (mosaic, re-read). */
export function berrySearcher(ctx: AppCtx): PoketchApp {
  const cursor = new MapCursor(ctx);
  let refresh: number | null = null;
  let t = 0;
  let berries = readyBerrySpots(ctx);
  return {
    step(tick) {
      t++;
      if (refresh !== null && t - refresh > 19) refresh = null;
      if (refresh === null && tick.touch.tapped && tick.touch.held && insideLcd(tick.touch.held)) {
        refresh = t;
        berries = readyBerrySpots(ctx);
        ctx.se(SE.DENSI12);
      }
    },
    view() {
      const l = layers(['poketch/berry_searcher_bg']);
      for (const h of hiddenLocations(ctx)) l.sprites.push({ sheet: 'poketch/map', anim: { seq: 14 + HIDDEN.findIndex((x) => x.x === h.x && x.y === h.y), t: 0 }, ...h });
      for (const b of berries) l.sprites.push({ sheet: 'poketch/map', anim: { seq: BERRY_ANIM, t: 0 }, ...b });
      const at = cursor.get();
      if (at) l.sprites.push({ sheet: 'poketch/map', anim: { seq: 0, t }, ...at });
      l.text.push({ text: ctx.text('PoketchBerrySearcher_Text_Berries'), x: 144, y: 160 });
      l.mosaic = refresh === null ? 0 : Math.max(0, 6 - Math.floor((t - refresh - 1) / 3));
      l.info = { berries: berries.length, spots: berries.map((b) => `${b.x},${b.y}`) };
      return l;
    },
  };
}

/**
 * Decomp link searcher, without wireless: a tap searches for 60 ticks, then shows every link count as 00
 * (moving stops it); Pokémon Center 2F floors say the search is unusable.
 */
export function linkSearcher(ctx: AppCtx): PoketchApp {
  let screen: 'intro' | 'searching' | 'results' | 'unusable' | 'dont-move' = 'intro';
  let since = 0;
  let t = 0;
  const lines = (name: string) => ctx.text(`LinkSearcher_Text_${name}`).split('\n');
  return {
    step(tick) {
      t++;
      const tapped = tick.touch.tapped && tick.touch.held !== null && insideLcd(tick.touch.held);
      if (screen === 'intro') {
        if (!tapped) return;
        ctx.se(SE.POKETCH_003);
        screen = 'searching';
        since = t;
      } else if (screen === 'searching' || screen === 'results') {
        if (tick.moved || tick.busy) {
          ctx.se(SE.BEEP);
          screen = 'dont-move';
        } else if (screen === 'results' && tapped) {
          ctx.se(SE.POKETCH_003);
          screen = 'intro';
        } else if (screen === 'searching' && t - since >= 60) {
          const pc2f = ctx.deps.state.player.zone.endsWith('POKECENTER_2F');
          if (pc2f) ctx.se(SE.BEEP);
          else ctx.se(SE.POKETCH_003);
          screen = pc2f ? 'unusable' : 'results';
        }
      } else if (tapped) screen = 'intro';
    },
    view() {
      const l = layers();
      l.fill = 4;
      // The decomp's text window covers the LCD (colour 4).
      const center = (text: string[], y: number) => text.forEach((s, i) => l.text.push({ text: s, x: 112, y: 16 + y + 16 * i, align: 'center' }));
      const S = (seq: number) => l.sprites.push({ sheet: 'poketch/link_searcher', anim: { seq, t }, x: 112, y: seq === 1 || seq === 2 ? 102 : 150 });
      if (screen === 'intro') {
        center(lines('Title'), 8);
        const touch = lines('TouchToBegin');
        center(touch, 64 - 8 * touch.length);
        S(3);
      } else if (screen === 'searching') {
        center(lines('Searching'), 16);
        S(3);
        S(1);
      } else if (screen === 'results') {
        center(lines('Status'), 8);
        ['UnionRoom', 'Underground', 'Colosseum', 'OtherLinks'].forEach((n, i) => l.text.push({ text: lines(n)[0]!, x: 24, y: 48 + 16 * i }, { text: '00', x: 176, y: 48 + 16 * i }));
        S(0);
      } else {
        center(lines('Error'), 8);
        if (screen === 'unusable') l.text.push({ text: lines('Unusable')[0]!, x: 32, y: 40 });
        else center(lines('DontMove'), 24);
        S(3);
        S(2);
      }
      l.info = { screen };
      return l;
    },
  };
}
