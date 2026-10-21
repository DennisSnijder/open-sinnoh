/**
 * The Pokémon apps (decomp src/applications/poketch/{party_status,friendship_checker,daycare_checker,
 * matchup_checker,pokemon_history,trainer_counter}). Icons are drawn in the LCD palette at 2× (decomp
 * poke_icon anims 4/6: SRT scale 2.0).
 */
import { dexOf, type PoketchView } from '@opensinnoh/contracts';
import { compatibility, COMPATIBILITY, daycareLevel, monGender, type Id, type Pokemon } from '@opensinnoh/core';
import { Buttons, digitsOf, insideLcd, layers, rect, SE, tile, type AppCtx, type PoketchApp, type Point } from './common.ts';

type Icon = PoketchView['icons'][number];
const icon = (mon: Pick<Pokemon, 'species' | 'form' | 'isEgg'>, x: number, y: number, extra: Partial<Icon> = {}): Icon => ({ species: mon.species, form: mon.form, egg: mon.isEgg, x, y, frame: 0, scale: 2, ...extra });
/** poke_icon anim 6: frames A and B, 20 frames (60 Hz) each. */
const wiggle = (t: number) => Math.floor(t / 10) % 2;

// ---------------------------------------------------------------- party status

const PARTY_AT: Point[] = [
  { x: 64, y: 36 }, { x: 160, y: 36 }, { x: 64, y: 84 }, { x: 160, y: 84 }, { x: 64, y: 132 }, { x: 160, y: 132 },
];
/** HP bar windows (8×1 tiles) per slot, in tiles. */
const BAR_AT = [[4, 8], [16, 8], [4, 14], [16, 14], [4, 20], [16, 20]] as const;

/** Decomp party status: HP bar pixels (of 64): 0, full, or 2 × the 32-step segment count (1–31). */
export function hpBarWidth(hp: number, max: number): number {
  if (hp <= 0) return 0;
  if (hp >= max) return 64;
  const seg = Math.floor((Math.floor((hp * 4096) / max) * 32) / 4096);
  return 2 * Math.min(31, Math.max(1, seg));
}

export function partyStatus(ctx: AppCtx): PoketchApp {
  type Entry = { mon: Pokemon; mail: boolean };
  const read = (): Entry[] => ctx.deps.state.party.map((mon) => ({ mon: structuredClone(mon), mail: mon.heldItem !== null && ctx.deps.registries.items.get(mon.heldItem)?.pocket === 'mail' }));
  let party = read();
  let bounce: { slot: number; since: number; wait: number; min: number } | null = null;
  let t = 0;
  const hit = (p: Point) => party.findIndex((_, i) => p.x >= PARTY_AT[i]!.x - 16 && p.x < PARTY_AT[i]!.x + 16 && p.y >= PARTY_AT[i]!.y - 8 && p.y < PARTY_AT[i]!.y + 24);
  return {
    step(tick) {
      t++;
      if (bounce) {
        const n = Math.floor((t - bounce.since) / (bounce.wait + 1));
        const h = tick.touch.held;
        if (n >= bounce.min && !(h && hit(h) === bounce.slot)) bounce = null;
      }
      if (bounce || !tick.touch.tapped || !tick.touch.held || !insideLcd(tick.touch.held)) return;
      const slot = hit(tick.touch.held);
      if (slot < 0) {
        party = read();
        ctx.se(SE.POKETCH_010);
        return;
      }
      const { mon } = party[slot]!;
      if (mon.hp === 0 || mon.isEgg) return;
      ctx.cry(mon.species, mon.form);
      const status = mon.status !== 'none';
      bounce = { slot, since: t, wait: status ? 2 : 1, min: status ? 4 : 8 };
    },
    view() {
      const l = layers();
      l.fill = 4;
      const bitmap = new Uint8Array(192 * 160);
      party.forEach(({ mon, mail }, i) => {
        const [wx, wy] = BAR_AT[i]!;
        const T = (n: number, x: number, y: number, h = false, v = false) => l.blits.push(tile('poketch/party_status_tiles', 5, n, x, y, { h, v }));
        T(1, wx - 1, wy - 1);
        T(1, wx + 8, wy - 1, true);
        T(1, wx - 1, wy + 1, false, true);
        T(1, wx + 8, wy + 1, true, true);
        for (let x = 0; x < 8; x++) {
          T(2, wx + x, wy - 1);
          T(2, wx + x, wy + 1, false, true);
        }
        T(6, wx - 1, wy);
        T(6, wx + 8, wy, true);
        const w = hpBarWidth(mon.hp, mon.stats.hp);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 64; x++) bitmap[(wy * 8 - 16 + y) * 192 + wx * 8 - 16 + x] = x < w ? 15 : 4;
        let dy = 0;
        if (bounce?.slot === i) {
          const n = Math.floor((t - bounce.since) / (bounce.wait + 1));
          dy = n % 2 === 0 ? 2 : -2;
        }
        const at = PARTY_AT[i]!;
        l.icons.push(icon(mon, at.x, at.y + dy, { silhouette: mon.hp === 0 || mon.status !== 'none' }));
        if (mon.heldItem !== null) l.sprites.push({ sheet: 'poketch/party_status', anim: { seq: mail ? 1 : 0, t: 0 }, x: at.x + 28, y: at.y + 21 });
      });
      l.bitmap = { x: 16, y: 16, width: 192, height: 160, scale: 1, data: Array.from(bitmap, (v) => v.toString(16)).join('') };
      l.targets = party.map((_, i) => rect(PARTY_AT[i]!.x - 16, PARTY_AT[i]!.y - 8, PARTY_AT[i]!.x + 16, PARTY_AT[i]!.y + 24));
      l.info = { hp: party.map(({ mon }) => `${mon.hp}/${mon.stats.hp}`), items: party.map(({ mon }) => mon.heldItem) };
      return l;
    },
  };
}

// ---------------------------------------------------------------- friendship checker

/** Decomp friendship checker tiers: friendship below 1, 35, 70, 150, 200, 255 → hate 3, 2, 1, neutral, like 1, 2; 255 like 3. */
export function friendshipMood(f: number): { kind: 'hate' | 'neutral' | 'like'; intensity: number } {
  const level = [1, 35, 70, 150, 200, 255].findIndex((tier) => f < tier);
  const l = level < 0 ? 6 : level;
  return l <= 2 ? { kind: 'hate', intensity: 3 - l } : l === 3 ? { kind: 'neutral', intensity: 0 } : { kind: 'like', intensity: l - 3 };
}

const FRIEND_AT: Point[] = [
  { x: 48, y: 44 }, { x: 176, y: 44 }, { x: 48, y: 92 }, { x: 176, y: 92 }, { x: 48, y: 140 }, { x: 176, y: 140 },
];

/**
 * Decomp friendship checker: the party wanders; a mon near a held touch comes closer (or runs away when it
 * dislikes the player) and shows hearts by its friendship; a double tap on empty space makes all jump. The
 * decomp's collision response between icons is left out (logged).
 */
export function friendshipChecker(ctx: AppCtx): PoketchApp {
  const rng = () => (ctx.deps.rng() >>> 0) / 0x100000000;
  const randomVelocity = () => {
    const a = rng() * Math.PI * 2;
    return { vx: Math.cos(a), vy: Math.sin(a) };
  };
  const mons = ctx.deps.state.party
    .filter((m) => !m.isEgg)
    .map((m, i) => ({ mon: m, ...FRIEND_AT[i]!, ...randomVelocity(), ...friendshipMood(m.friendship), action: 'wander' as 'wander' | 'gather' | 'run' | 'like' | 'dislike', jump: 0 }));
  ctx.deps.log.stub('poketch:friendship-collisions', 'the friendship checker icons do not collide with each other');
  let t = 0;
  let touched = -1;
  let tap: { state: 'idle' | 'first' | 'released'; since: number } = { state: 'idle', since: 0 };
  return {
    step(tick) {
      t++;
      const h = tick.touch.held && insideLcd(tick.touch.held) ? { x: tick.touch.held.x, y: tick.touch.held.y - 8 } : null;
      const onIcon = h ? mons.findIndex((m) => (h.x - m.x) ** 2 + (h.y - m.y) ** 2 < 256) : -1;
      if (onIcon >= 0 && onIcon !== touched) ctx.cry(mons[onIcon]!.mon.species, mons[onIcon]!.mon.form);
      touched = onIcon;
      // The double tap on empty space.
      if (tick.touch.tapped && h) {
        if (tap.state === 'released' && onIcon < 0 && t - tap.since <= 7) {
          for (const m of mons) m.jump = 8;
          ctx.se(SE.POKETCH_010);
          tap = { state: 'idle', since: t };
        } else tap = { state: 'first', since: t };
      } else if (tap.state === 'first' && !tick.touch.held) tap = onIcon < 0 && t - tap.since <= 6 ? { state: 'released', since: t } : { state: 'idle', since: t };
      else if (tap.state === 'released' && t - tap.since > 7) tap = { state: 'idle', since: t };
      for (const [i, m] of mons.entries()) {
        if (m.jump) {
          m.jump += 8;
          if (m.jump >= 180) {
            m.jump = 0;
            Object.assign(m, randomVelocity(), { action: 'wander' });
          }
          continue;
        }
        const d = h ? Math.hypot(h.x - m.x, h.y - m.y) : Infinity;
        const hate = m.kind === 'hate';
        if (h && d < 8 && (onIcon === i || m.action !== 'wander')) m.action = hate ? 'dislike' : 'like';
        else if (h && d < (m.action === 'wander' ? 48 : 64) && onIcon < 0) m.action = hate ? 'run' : 'gather';
        else if (m.action !== 'wander') {
          if (m.vx === 0 && m.vy === 0) Object.assign(m, randomVelocity());
          m.action = 'wander';
        }
        if ((m.action === 'gather' || m.action === 'run') && h) {
          const speed = [100, 150, 175, 200][m.intensity]! / 100;
          const k = (m.action === 'gather' ? speed : -speed) / Math.max(1, d);
          m.vx = (h.x - m.x) * k;
          m.vy = (h.y - m.y) * k;
        } else if (m.action === 'like' || m.action === 'dislike') {
          m.vx = 0;
          m.vy = 0;
        }
        m.x += m.vx;
        m.y += m.vy;
        if (m.x < -10 || m.x > 217) m.vx = -m.vx;
        if (m.y < -22 || m.y > 183) m.vy = -m.vy;
        m.x = Math.min(217, Math.max(-10, m.x));
        m.y = Math.min(183, Math.max(-22, m.y));
      }
    },
    view() {
      const l = layers();
      l.fill = 4;
      for (const m of mons) {
        const x = Math.round(m.x);
        const y = Math.round(m.y);
        const lift = m.jump ? Math.round(20 * Math.sin((m.jump * Math.PI) / 180)) : 0;
        if (m.jump && m.jump <= 140) l.sprites.push({ sheet: 'poketch/friendship_checker', anim: { seq: 3, t: 0 }, x, y: y + 8 });
        l.icons.push(icon(m.mon, x, y - lift, { frame: wiggle(t), hFlip: m.vx > 0 }));
        if (m.action === 'like' && m.kind === 'like') l.sprites.push({ sheet: 'poketch/friendship_checker', anim: { seq: m.intensity - 1, t }, x, y: y + 8 });
      }
      l.info = { moods: mons.map((m) => `${m.kind}${m.intensity}`), actions: mons.map((m) => m.action) };
      return l;
    },
  };
}

// ---------------------------------------------------------------- day-care checker

/** Decomp daycare checker: both Pokémon with their level (after the steps' experience) and gender, and the egg. */
export function daycareChecker(ctx: AppCtx): PoketchApp {
  const dex = dexOf(ctx.deps.registries);
  const read = () => {
    const d = structuredClone(ctx.deps.state.daycare);
    const mons = d.mons.flatMap((m, slot) => (m ? [{ mon: m.mon, level: daycareLevel(dex, d, slot) }] : []));
    return { mons, egg: d.offspring !== 0 };
  };
  let data = read();
  let refresh: number | null = null;
  let t = 0;
  return {
    step(tick) {
      t++;
      if (refresh !== null && t - refresh > 40) refresh = null;
      if (refresh !== null || !tick.touch.tapped || !tick.touch.held || !insideLcd(tick.touch.held)) return;
      ctx.se(SE.DENSI12);
      refresh = t;
      data = read();
    },
    view() {
      const l = layers(['poketch/daycare_checker_bg']);
      data.mons.forEach((m, i) => {
        l.icons.push(icon(m.mon, i === 0 ? 56 : 168, 128, { frame: wiggle(t), hFlip: i === 0 }));
        digitsOf(m.level, 3).forEach((d, k) => l.sprites.push({ sheet: 'poketch/daycare_checker', anim: { seq: d, t: 0 }, x: (i === 0 ? 48 : 152) + 16 * k, y: 40 }));
        const g = monGender(dex, m.mon);
        l.sprites.push({ sheet: 'poketch/daycare_checker', anim: { seq: g === 'male' ? 10 : g === 'female' ? 11 : 12, t: 0 }, x: i === 0 ? 96 : 200, y: 40 });
      });
      if (data.egg) l.icons.push({ species: `${ctx.ns}:SPECIES_EGG` as Id, form: 0, egg: true, x: 112, y: 136, frame: 0, scale: 2 });
      // The refresh: mosaic 10, then one smaller every 4 ticks.
      l.mosaic = refresh === null ? 0 : Math.max(0, 10 - Math.floor((t - refresh) / 4));
      l.info = { mons: data.mons.map((m) => m.mon.species), levels: data.mons.map((m) => m.level), egg: data.egg };
      return l;
    },
  };
}

// ---------------------------------------------------------------- matchup checker

/** Decomp BoxMon_GetPairDaycareCompatibilityLevel: 0 max, 1 medium, 2 low, 3 incompatible (core `compatibility`). */
export function compatibilityLevelOf(ctx: AppCtx, a: Pokemon, b: Pokemon): number {
  return { [COMPATIBILITY.incompatible]: 3, [COMPATIBILITY.low]: 2, [COMPATIBILITY.medium]: 1, [COMPATIBILITY.max]: 0 }[compatibility(dexOf(ctx.deps.registries), a, b)]!;
}

/** Decomp matchup checker: two party Pokémon (tap an icon to pick another), CHECK runs the Luvdisc show of their compatibility. */
export function matchupChecker(ctx: AppCtx): PoketchApp {
  const party = ctx.deps.state.party.filter((m) => !m.isEgg);
  const buttons = new Buttons([rect(92, 128, 132, 168), rect(24, 130, 72, 164), rect(152, 130, 200, 164)]);
  let left = 0;
  let right = party.length > 1 ? 1 : 0;
  let checking: { level: number; since: number } | null = null;
  let down = false;
  let t = 0;
  let meter = 0;
  /** Show steps: forward 16 px over 16 ticks per step; the incompatible pair turns away; the best pair kisses. */
  const show = (k: number, level: number): { offset: number; turned: boolean; kiss: boolean; done: boolean } => {
    if (level === 3) {
      if (k <= 16) return { offset: k, turned: false, kiss: false, done: false };
      if (k <= 33) return { offset: 16, turned: false, kiss: false, done: false };
      const back = Math.min(16, k - 33);
      return { offset: 16 - back, turned: true, kiss: false, done: back >= 16 };
    }
    const steps = 3 - level;
    const move = Math.min(16 * steps, k);
    if (level !== 0) return { offset: move, turned: false, kiss: false, done: k >= 16 * steps };
    return { offset: move, turned: false, kiss: k > 48 + 17, done: k >= 48 + 34 };
  };
  return {
    step(tick) {
      t++;
      if (checking) {
        const k = t - checking.since;
        if (checking.level < 3 && k > 0 && k % 16 === 0 && k <= 16 * (3 - checking.level)) ctx.se(SE.POKETCH_012);
        if (checking.level === 3 && k === 33) ctx.se(SE.POKETCH_013);
        if (checking.level === 0 && k === 48 + 17) ctx.se(SE.POKETCH_014);
        if (show(k, checking.level).done) checking = null;
        else return;
      }
      const e = buttons.update(tick.touch);
      if (!e) return;
      if (e.id === 0) {
        if (e.event === 'touch') {
          if (party.length <= 1) return ctx.se(SE.BEEP);
          down = true;
          ctx.se(SE.POKETCH_010);
        } else if (down && (e.event === 'tap' || e.event === 'drag')) {
          down = false;
          if (e.event === 'tap') {
            const level = compatibilityLevelOf(ctx, party[left]!, party[right]!);
            meter = [3, 2, 1, 0][level]!;
            checking = { level, since: t };
          }
        }
      } else if (e.event === 'touch' && party.length > 2) {
        const step = (i: number, other: number) => {
          let n = i;
          do n = (n + 1) % party.length;
          while (n === other);
          return n;
        };
        if (e.id === 1) left = step(left, right);
        else right = step(right, left);
        const m = party[e.id === 1 ? left : right]!;
        ctx.cry(m.species, m.form);
        meter = 0;
      }
    },
    view() {
      const l = layers(['poketch/matchup_checker_bg']);
      const s = checking ? show(t - checking.since, checking.level) : { offset: 0, turned: false, kiss: false, done: true };
      const S = (seq: number, x: number, y: number) => l.sprites.push({ sheet: 'poketch/matchup_checker', anim: { seq, t }, x, y });
      S(meter === 3 && s.kiss ? 4 : meter, 112, 32);
      S(s.kiss ? 7 : s.turned ? 6 : 5, 48 + s.offset, 88);
      if (party.length > 1) S(s.kiss ? 8 : s.turned ? 5 : 6, 176 - s.offset, 88);
      S(down || party.length <= 1 ? 10 : 9, 112, 148);
      if (party[left]) l.icons.push(icon(party[left]!, 48, 140, { frame: wiggle(t), hFlip: true }));
      if (party.length > 1) l.icons.push(icon(party[right]!, 176, 140, { frame: wiggle(t) }));
      l.targets = buttons.rects;
      l.info = { pair: [party[left]?.species ?? null, party.length > 1 ? party[right]!.species : null], level: checking?.level ?? null };
      return l;
    },
  };
}

// ---------------------------------------------------------------- history, trainer counter

/** Decomp Pokémon history: the last 12 Pokémon obtained, oldest top left; touching one plays its cry. */
export function pokemonHistory(ctx: AppCtx): PoketchApp {
  const at = (k: number) => ({ x: 48 + 40 * (k % 4), y: 48 + 48 * Math.floor(k / 4) });
  const h = () => ctx.deps.state.poketch.history;
  const buttons = new Buttons(Array.from({ length: 12 }, (_, k) => rect(at(k).x - 24, at(k).y - 18, at(k).x + 24, at(k).y + 18)));
  return {
    step(tick) {
      const e = buttons.update(tick.touch);
      if (e?.event === 'touch' && e.id < h().length) ctx.cry(h()[e.id]!.species, h()[e.id]!.form);
    },
    view() {
      const l = layers();
      l.fill = 4;
      l.text.push({ text: ctx.text('PokemonHistory_Text_ObtainedPokemon'), x: 112, y: 16, align: 'center' });
      h().forEach((m, k) => l.icons.push({ species: m.species, form: m.form, egg: false, ...at(k), frame: 0, scale: 2 }));
      l.targets = buttons.rects.slice(0, h().length);
      l.info = { history: h().map((m) => m.species) };
      return l;
    },
  };
}

/** Decomp trainer_counter/graphics.c SetupSprites: the live chain's icon, then the best three; each chain's three digits. */
const COUNTER_ICONS: Point[] = [{ x: 96, y: 32 }, { x: 112, y: 80 }, { x: 176, y: 96 }, { x: 48, y: 104 }];
const COUNTER_DIGITS: Point[] = [{ x: 144, y: 40 }, { x: 100, y: 144 }, { x: 164, y: 160 }, { x: 36, y: 168 }];
/** Decomp trainer_counter/main.c Init: the best chains' touch boxes (left, top, right, bottom). */
const COUNTER_BOXES = [rect(88, 62, 136, 98), rect(152, 78, 200, 114), rect(24, 86, 72, 122)];

/**
 * Decomp trainer counter: the live Poké Radar chain (its species and count, refreshed when the species changes) and
 * the best three saved chains, highest first; touching a best chain plays its cry while the icon jumps (16 frames of
 * a sine, 24 px high). Counts show 1–3 digits, hidden leading zeros.
 */
export function trainerCounter(ctx: AppCtx): PoketchApp {
  const live = () => ctx.deps.radarChain?.() ?? null;
  const records = () => [...(ctx.deps.state.encounters?.radarRecords ?? [])].sort((a, b) => b.count - a.count);
  /** RadarChainRecords_GetNumFilledSlots counts record 0 three times: all three or none. */
  const filled = () => (records()[0]?.count ? 3 : 0);
  const buttons = new Buttons(COUNTER_BOXES);
  let crying: { slot: number; since: number } | null = null;
  let t = 0;
  return {
    step(tick) {
      t++;
      if (crying && t - crying.since > 16) crying = null;
      const e = buttons.update(tick.touch);
      if (crying || e?.event !== 'touch' || e.id >= filled()) return;
      const r = records()[e.id];
      if (!r?.count || !r.species) return;
      crying = { slot: e.id, since: t };
      ctx.cry(r.species, 0);
    },
    view() {
      const l = layers(['poketch/trainer_counter_bg']);
      const chains: ({ species: Id; count: number } | null)[] = [live(), ...records().map((r) => (r.species ? { species: r.species, count: r.count } : null))];
      chains.forEach((c, i) => {
        if (!c) return;
        const at = COUNTER_ICONS[i]!;
        const jumping = crying && i === crying.slot + 1 ? t - crying.since : null;
        const y = jumping === null ? at.y : at.y - Math.round(Math.sin((Math.round((180 / 16) * jumping) * Math.PI) / 180) * 24);
        l.icons.push({ species: c.species, form: 0, egg: false, x: at.x, y, frame: jumping === null ? 0 : wiggle(jumping), scale: 2 });
        const n = Math.min(999, c.count);
        const digits = [Math.floor(n / 100), Math.floor(n / 10) % 10, n % 10];
        digits.forEach((d, k) => {
          if (k < 2 && digits.slice(0, k + 1).every((x) => x === 0)) return;
          l.sprites.push({ sheet: 'poketch/trainer_counter', anim: { seq: d, t: 0 }, x: COUNTER_DIGITS[i]!.x + 8 * k, y: COUNTER_DIGITS[i]!.y });
        });
      });
      l.targets = buttons.rects.slice(0, filled());
      l.info = { chain: live()?.count ?? 0, species: live()?.species ?? null, records: records().map((r) => `${r.species ?? '-'}:${r.count}`) };
      return l;
    },
  };
}
