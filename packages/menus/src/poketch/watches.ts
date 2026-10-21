/**
 * The time apps (decomp src/applications/poketch/{digital_watch,analog_watch,alarm_clock,stopwatch,
 * kitchen_timer,calendar}): they read the game clock (the DS RTC). The stopwatch and kitchen timer count
 * game ticks (the DS reads a hardware timer): headless runs stay deterministic, and they pause while the
 * Pokétch does not run (menus, battles).
 */
import type { PoketchSprite } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { Buttons, daysInMonth, digit, digitsOf, layers, rect, SE, tile, weekday, type AppCtx, type AppTick, type PoketchApp } from './common.ts';

const LCD = rect(16, 16, 207, 175);

/** Hold to light the screen (decomp digital/analog watch: PRESSED → backlight palette, RELEASED → normal). */
class Backlight {
  on = false;
  private readonly button = new Buttons([LCD]);
  step(t: AppTick): void {
    const e = this.button.update(t.touch);
    if (e?.event === 'touch') this.on = true;
    else if (e) this.on = false;
  }
}

export function digitalWatch(ctx: AppCtx): PoketchApp {
  const light = new Backlight();
  return {
    step: (t) => light.step(t),
    view() {
      const { hour, minute } = ctx.deps.clock();
      const l = layers(['poketch/digital_watch_bg']);
      // Decomp DrawClockDigits: 4×9-tile copies of digit d (x = 32d of the digits strip), 24-hour with a leading zero.
      [...digitsOf(hour, 2), ...digitsOf(minute, 2)].forEach((d, i) => l.blits.push({ sheet: 'poketch/digital_watch_digits', from: { x: 32 * d, y: 0, width: 32, height: 72 }, x: [24, 64, 120, 160][i]!, y: 56 }));
      l.backlight = light.on;
      l.info = { time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
      return l;
    },
  };
}

export function analogWatch(ctx: AppCtx): PoketchApp {
  const light = new Backlight();
  return {
    step: (t) => light.step(t),
    view() {
      const { hour, minute } = ctx.deps.clock();
      const l = layers(['poketch/analog_watch_bg']);
      // Decomp analog_watch_anim: sequence m = the minute hand at m × 6°; 60 + n = the hour hand at n° (it moves every 2 minutes).
      l.sprites.push({ sheet: 'poketch/analog_watch', cell: 0, x: 116, y: 100, angle: minute * 6 });
      l.sprites.push({ sheet: 'poketch/analog_watch', cell: 1, x: 116, y: 100, angle: (hour % 12) * 30 + Math.floor(minute / 2) });
      l.backlight = light.on;
      l.info = { time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
      return l;
    },
  };
}

/** Decomp alarm_clock: SET and EDIT halves of the switch, hour and minute arrows (repeat every 4 ticks). */
export function alarmClock(ctx: AppCtx): PoketchApp {
  const p = ctx.deps.state.poketch;
  const buttons = new Buttons([rect(176, 72, 208, 104), rect(176, 104, 208, 136), rect(64, 112, 80, 128), rect(64, 160, 80, 176), rect(112, 112, 128, 128), rect(112, 160, 128, 176)], { repeat: { 2: 4, 3: 4, 4: 4, 5: 4 } });
  let mode: 'set' | 'edit' | 'ring' = p.alarm.on ? 'set' : 'edit';
  let hour = p.alarm.hour;
  let minute = p.alarm.minute;
  let t = 0;
  let ringSince = 0;
  const now = () => ctx.deps.clock();
  const SPECIES_LOUDRED = `${ctx.ns}:SPECIES_LOUDRED` as Id;
  return {
    step(tick) {
      t++;
      const e = buttons.update(tick.touch);
      const press = e && (e.event === 'touch' || e.event === 'repeat') ? e.id : -1;
      if (mode === 'edit') {
        if (press === 2 || press === 3) hour = (hour + (press === 2 ? 1 : 23)) % 24;
        else if (press === 4 || press === 5) minute = (minute + (press === 4 ? 1 : 59)) % 60;
        else if (press === 1) ctx.se(SE.BEEP);
        else if (press === 0) {
          p.alarm = { on: true, hour, minute };
          ctx.se(SE.POKETCH_003);
          mode = 'set';
        }
      } else if (mode === 'set') {
        const c = now();
        if (c.hour === hour && c.minute === minute) {
          mode = 'ring';
          ringSince = t;
          ctx.se(SE.POKETCH_003);
        } else if (press === 1) {
          // Decomp: the app turns the alarm off but never saves it (Poketch_SetAlarm(FALSE) is not called).
          ctx.se(SE.POKETCH_003);
          mode = 'edit';
        } else if (press === 0) ctx.se(SE.BEEP);
      } else {
        if (!ctx.deps.sound?.cryPlaying()) ctx.cry(SPECIES_LOUDRED, 0);
        const c = now();
        if (press === 1) mode = 'edit';
        else if (c.hour !== hour || c.minute !== minute) {
          ctx.se(SE.POKETCH_003);
          mode = 'set';
        }
      }
    },
    view() {
      const l = layers(['poketch/alarm_clock_bg']);
      const s = (cell: number, x: number, y: number, extra: Partial<PoketchSprite> = {}): PoketchSprite => ({ sheet: 'poketch/alarm_clock', anim: { seq: cell, t }, x, y, ...extra });
      const eyes = mode === 'ring' ? [4, 4] : mode === 'set' ? [5, 5] : [5, 4];
      l.sprites.push(s(mode === 'set' || mode === 'ring' ? 3 : 2, 192, 104));
      l.sprites.push(s(mode === 'ring' ? 1 : 0, 48, 48), s(mode === 'ring' ? 1 : 0, 144, 48, { hFlip: true }));
      l.sprites.push(s(eyes[0]!, 56, 80), s(eyes[1]!, 136, 80, { hFlip: true }));
      if (mode === 'edit') l.sprites.push(s(6, 72, 120), s(6, 72, 164, { vFlip: true }), s(6, 120, 120), s(6, 120, 164, { vFlip: true }));
      const c = now();
      const shown = mode === 'edit' ? [hour, minute] : [c.hour, c.minute];
      // Ringing: the digits blink, hidden first 15 ticks in.
      const blinkOff = mode === 'ring' && Math.floor((t - ringSince) / 15) % 2 === 1;
      if (!blinkOff) [...digitsOf(shown[0]!, 2), ...digitsOf(shown[1]!, 2)].forEach((d, i) => l.sprites.push(digit(d, [64, 80, 112, 128][i]!, 144)));
      l.targets = buttons.rects;
      l.info = { mode, alarm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, on: p.alarm.on };
      return l;
    },
  };
}

const TICKS_PER_SECOND = 30;

/** Decomp stopwatch: the Voltorb button (a circle, r 39): tap starts and pauses, hold 15 ticks then 75 resets. */
export function stopwatch(ctx: AppCtx): PoketchApp {
  const button = new Buttons([rect(73, 73, 152, 152)], { timers: { 0: [15, 75] }, circles: { 0: { x: 112, y: 112, r: 39 } } });
  let state: 'inactive' | 'active' | 'held' | 'reset' = 'inactive';
  let heldFrom: 'inactive' | 'active' = 'inactive';
  let running = false;
  let elapsed = 0;
  let seq = 0;
  let seqSince = 0;
  let t = 0;
  let resetAt = 0;
  const setSeq = (n: number) => {
    seq = n;
    seqSince = t;
    if (n === 1) ctx.se(SE.POKETCH_010);
    if (n === 5) ctx.se(SE.POKETCH_006);
  };
  /** The button's tile group (decomp UpdateButtonTiles groups: 0 up, 1 pressed, 2–4 blink, 5–6 exploding). */
  const group = (): number => {
    const k = t - seqSince;
    if (seq === 1) return 1;
    if (seq === 3 || seq === 4) return [3, 4, 2][Math.floor(k / (seq === 3 ? 7 : 4)) % 3]!;
    if (seq === 5) return Math.floor(k / 3) % 2 === 0 ? 5 : 6;
    if (seq === 6) return 6;
    return 0;
  };
  return {
    step(tick) {
      t++;
      if (running) elapsed++;
      // The blink cycles click on every change.
      if ((seq === 3 || seq === 4) && (t - seqSince) % (seq === 3 ? 7 : 4) === 0) ctx.se(SE.POKETCH_010);
      // The button keeps tracking the finger; its events are ignored during the reset.
      const e = button.update(tick.touch);
      if (state === 'reset') {
        const k = t - resetAt;
        if (k === 90) setSeq(5);
        else if (k === 150) {
          setSeq(6);
          running = false;
          elapsed = 0;
        } else if (k === 150 + 81) {
          setSeq(0);
          state = 'inactive';
        }
        return;
      }
      if (!e) return;
      if (state === 'inactive' || state === 'active') {
        if (e.event === 'touch') {
          heldFrom = state;
          if (state === 'active') running = false;
          setSeq(1);
        } else if (e.event === 'tap') {
          if (heldFrom === 'inactive') {
            running = true;
            state = 'active';
            setSeq(2);
          } else {
            state = 'inactive';
            setSeq(0);
          }
        } else if (e.event === 'drag') {
          state = 'inactive';
          setSeq(0);
        } else if (e.event === 'timer0') {
          state = 'held';
          setSeq(3);
        }
      } else if (state === 'held') {
        if (e.event === 'tap' && heldFrom === 'inactive') {
          running = true;
          state = 'active';
          setSeq(2);
        } else if (e.event === 'tap' || e.event === 'drag') {
          state = 'inactive';
          setSeq(0);
        } else if (e.event === 'timer1') {
          state = 'reset';
          resetAt = t;
          setSeq(4);
        }
      }
    },
    view() {
      const l = layers(['poketch/stopwatch_bg']);
      const g = group();
      // Decomp UpdateButtonTiles: a 10×11-tile Voltorb at tile (9, 9), its right half the mirror of the left.
      if (g !== 0)
        for (let y = 0; y < 11; y++)
          for (let x = 0; x < 5; x++) {
            const n = g * 5 + 2 + y * 37 + x;
            l.blits.push(tile('poketch/stopwatch_tiles', 37, n, 9 + x, 9 + y), tile('poketch/stopwatch_tiles', 37, n, 18 - x, 9 + y, { h: true }));
          }
      if (seq !== 0) l.sprites.push({ sheet: 'poketch/stopwatch', anim: { seq: [10, 11, 12, 13, 14, 15, 16][seq]!, t: t - seqSince }, x: 112, y: 96 });
      const ms = Math.floor((elapsed * 1000) / TICKS_PER_SECOND);
      const s = Math.floor(ms / 1000);
      const fields = [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60, Math.floor((ms % 1000) / 10)];
      fields.flatMap((v) => digitsOf(v, 2)).forEach((d, i) => l.sprites.push(digit(d, [32, 48, 80, 96, 128, 144, 176, 192][i]!, 40)));
      l.targets = button.rects;
      l.info = { time: fields.map((v) => String(v).padStart(2, '0')).join(':'), running, state };
      return l;
    },
  };
}

/** Decomp kitchen_timer: digit arrows (repeat 4) while editing; START, STOP, RESET; the hands beat while it rings. */
export function kitchenTimer(ctx: AppCtx): PoketchApp {
  const arrows = [
    [72, 88, 80, 96], [88, 104, 80, 96], [120, 136, 80, 96], [136, 152, 80, 96],
    [72, 88, 128, 144], [88, 104, 128, 144], [120, 136, 128, 144], [136, 152, 128, 144],
  ].map(([l, r, t, b]) => rect(l!, t!, r!, b!));
  const buttons = new Buttons([rect(16, 144, 80, 176), rect(80, 144, 144, 176), rect(144, 144, 208, 176), ...arrows], { repeat: Object.fromEntries(arrows.map((_, i) => [i + 3, 4])) });
  let mode: 'edit' | 'running' | 'paused' | 'sounding' | 'sounding-paused' = 'edit';
  const digits = [0, 0, 0, 0];
  /** START, STOP, RESET: latched down when false (inert, drawn pressed). */
  const live = [true, false, true];
  const down = [false, false, false];
  let setSeconds = 0;
  let elapsedTicks = 0;
  let t = 0;
  let beatSince = 0;
  let beat = 0;
  const MAX = [9, 9, 5, 9];
  const show = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    digits.splice(0, 4, Math.floor(m / 10), m % 10, Math.floor(s / 10), s % 10);
  };
  const toEdit = () => {
    mode = 'edit';
    live.splice(0, 3, true, false, true);
    show(0);
  };
  return {
    step(tick) {
      t++;
      if (mode === 'running') {
        elapsedTicks++;
        const left = setSeconds - Math.floor(elapsedTicks / TICKS_PER_SECOND);
        show(Math.max(0, left));
        if (left <= 0) {
          live[0] = false;
          mode = 'sounding';
          beatSince = t;
          beat = 0;
        }
      }
      if (mode === 'sounding' && (t - beatSince) % 8 === 0 && t > beatSince) {
        beat ^= 1;
        ctx.se(SE.DENSI11);
      }
      const e = buttons.update(tick.touch);
      if (!e) return;
      if (e.id >= 3) {
        if (mode !== 'edit' || (e.event !== 'touch' && e.event !== 'repeat')) return;
        const k = (e.id - 3) % 4;
        const up = e.id < 7;
        digits[k] = (digits[k]! + (up ? 1 : MAX[k]!)) % (MAX[k]! + 1);
        return;
      }
      const b = e.id;
      if (!live[b]) {
        if (e.event === 'touch') ctx.se(SE.BEEP);
        return;
      }
      if (e.event === 'touch') {
        down[b] = true;
        return;
      }
      down[b] = false;
      if (e.event !== 'tap') return;
      ctx.se(SE.POKETCH_003);
      if (b === 2) return toEdit();
      if (mode === 'edit' && b === 0) {
        setSeconds = (digits[0]! * 10 + digits[1]!) * 60 + digits[2]! * 10 + digits[3]!;
        if (setSeconds === 0) return;
        live.splice(0, 3, false, true, true);
        elapsedTicks = 0;
        mode = 'running';
      } else if (mode === 'running' && b === 1) {
        live.splice(0, 3, true, false, true);
        mode = 'paused';
      } else if (mode === 'paused' && b === 0) {
        live.splice(0, 3, false, true, true);
        mode = 'running';
      } else if (mode === 'sounding' && b === 1) {
        live.splice(0, 3, true, false, true);
        mode = 'sounding-paused';
      } else if (mode === 'sounding-paused' && b === 0) {
        live.splice(0, 3, false, true, true);
        mode = 'sounding';
        beatSince = t;
      }
    },
    view() {
      const l = layers(['poketch/kitchen_timer_bg']);
      const s = (seq: number, x: number, y: number, extra: Partial<PoketchSprite> = {}): PoketchSprite => ({ sheet: 'poketch/kitchen_timer', anim: { seq, t }, x, y, ...extra });
      // Hands: up while editing, down while counting, beating while it rings (left up + right down, then the other way).
      const ringing = mode === 'sounding' || mode === 'sounding-paused';
      const [left, right] = mode === 'edit' ? [2, 0] : ringing ? (beat ? [3, 0] : [2, 1]) : [3, 1];
      l.sprites.push(s(left, 48, 56), s(right, 176, 56));
      [0, 1, 2].forEach((b) => l.sprites.push(s(5 + 2 * b + (down[b] || !live[b] ? 1 : 0), [48, 112, 176][b]!, 160)));
      if (mode === 'edit') for (const x of [80, 96, 128, 144]) l.sprites.push(s(4, x, 88), s(4, x, 136, { vFlip: true }));
      digits.forEach((d, i) => l.sprites.push(digit(d, [80, 96, 128, 144][i]!, 112)));
      l.targets = buttons.rects;
      l.info = { mode, time: `${digits[0]}${digits[1]}:${digits[2]}${digits[3]}` };
      return l;
    },
  };
}

/** Decomp calendar: the month of the game clock's date; tap a day to mark or unmark it (saved, one month only). */
export function calendar(ctx: AppCtx): PoketchApp {
  const c = ctx.deps.clock();
  const [year, month, day] = c.date.split('-').map(Number) as [number, number, number];
  const days = daysInMonth(year, month);
  const first = (weekday(c.date) + 7 - ((day - 1) % 7)) % 7;
  const cells = Array.from({ length: 37 }, (_, i) => rect(32 + 24 * (i % 7), 40 + 24 * Math.floor(i / 7), 48 + 24 * (i % 7), 56 + 24 * Math.floor(i / 7)));
  const buttons = new Buttons(cells);
  const cal = () => ctx.deps.state.poketch.calendar;
  const marked = (d: number) => cal().month === month && ((cal().marks >>> (d - 1)) & 1) === 1;
  return {
    step(tick) {
      const e = buttons.update(tick.touch);
      if (e?.event !== 'touch') return;
      const d = e.id - first + 1;
      if (d < 1 || d > days) return;
      // Decomp Poketch_SetCalendarMark / ClearCalendarMark: another month replaces the stored one.
      const p = ctx.deps.state.poketch;
      if (marked(d)) p.calendar = { month, marks: p.calendar.month === month ? p.calendar.marks & ~(1 << (d - 1)) : 0 };
      else p.calendar = { month, marks: (p.calendar.month === month ? p.calendar.marks : 0) | (1 << (d - 1)) };
    },
    view() {
      const l = layers(['poketch/calendar_bg']);
      const T = (n: number, tx: number, ty: number) => tile('poketch/calendar_tiles', 12, n, tx, ty);
      for (let d = 1; d <= days; d++) {
        const cell = first + d - 1;
        const [col, row] = [cell % 7, Math.floor(cell / 7)];
        if (marked(d)) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) l.blits.push(T(143, 4 + 3 * col + dx, 5 + 3 * row + dy));
      }
      const base = [0, 4, 8, 24, 28, 32, 48, 52, 56, 72, 76, 80][month - 1]!;
      for (let i = 0; i < 4; i++) l.blits.push(T(base + i, 12 + i, 2), T(base + 12 + i, 12 + i, 3));
      for (let d = 1; d <= days; d++) {
        const cell = first + d - 1;
        const [col, row] = [cell % 7, Math.floor(cell / 7)];
        const top = (n: number) => (col === 0 ? 120 : 96) + n;
        if (d >= 10) l.blits.push(T(top(Math.floor(d / 10)), 4 + 3 * col, 5 + 3 * row), T(top(Math.floor(d / 10)) + 12, 4 + 3 * col, 6 + 3 * row));
        l.blits.push(T(top(d % 10), 5 + 3 * col, 5 + 3 * row), T(top(d % 10) + 12, 5 + 3 * col, 6 + 3 * row));
      }
      const today = first + day - 1;
      l.sprites.push({ sheet: 'poketch/calendar', anim: { seq: 0, t: 0 }, x: 40 + 24 * (today % 7), y: 48 + 24 * Math.floor(today / 7) });
      l.targets = cells.slice(first, first + days);
      l.info = { month, marked: Array.from({ length: days }, (_, i) => i + 1).filter(marked) };
      return l;
    },
  };
}
