/**
 * The Hall of Fame (docs/research/hall-of-fame-credits.md §3).
 *
 * `record`: the Champion's induction (decomp cutscenes/hall_of_fame.c HallOfFameManager_Main), one decomp
 * frame per tick. Its slides are VBlank tasks (two steps a tick: the main loop waits two vblanks); its text
 * printer and the party's entry are main-loop tasks (one step a tick). Fade in (16), then each non-Egg member
 * alone: picture and frame slide in, 20 frames, the cry and the text rows 20 frames apart, 30 frames, the text
 * and frame slide away, 30 frames. Then the player rises with the frame, 20 frames, the frame widens, the
 * lines, 20 frames, the party slides in one by one, 20 frames, confetti, and A or B; the inward wipe and the
 * 2-frame fade with the 30-frame music fade. The Pokémon's own animation is not played (no wait for it).
 *
 * `pc`: the PC viewer (decomp applications/pc_hall_of_fame): the newest entry first; Left an older entry, Right
 * a newer one (wrapping), Up/Down the member (crossing into the next entry), A the moves, B closes. Read only.
 */
import { dexOf, HALL_OF_FAME_ENTRIES, type HallOfFameMon, type HallOfFamePcView, type HallOfFameRecordView, type HallOfFameSprite, type SceneLine } from '@opensinnoh/contracts';
import { genderOf, isShiny, type Button, type Gender, type Id, type Pokemon } from '@opensinnoh/core';
import type { MenuContext } from './context.ts';
import type { Screen, Step } from './stack.ts';
import { plainText } from './strings.ts';

type Input = { button: Button } | { tap: string };

/** The bank's messages (decomp TEXT_BANK_HALL_OF_FAME, TEXT_BANK_PC_HALL_OF_FAME), checked when a screen opens. */
const RECORD_TEXT = ['Welcome', 'PokemonInfoMale', 'PokemonInfoFemale', 'PokemonInfoGenderless', 'OT', 'MetAt', 'HatchedAt', 'ObtainedInLinkTrade', 'ObtainedInFatefulEncounter', 'LeagueChampionCongratulations', 'PlayerInfo'].map((n) => `HallOfFame_Text_${n}`);
const PC_TEXT = ['Title', 'Level', 'OT', 'MaleSign', 'FemaleSign'].map((n) => `PCHallOfFame_Text_${n}`);

/** A HallOfFameMovement: `steps` steps from `start` to `end`, done one run after the last step. */
class Movement {
  private i = 0;
  done = false;
  value: number;
  constructor(
    private readonly start: number,
    private readonly end: number,
    private readonly steps: number,
  ) {
    this.value = start;
  }
  run(): number {
    if (this.i < this.steps) this.value = this.start + ((this.end - this.start) * ++this.i) / this.steps;
    else [this.value, this.done] = [this.end, true];
    return this.value;
  }
}

/** Decomp pokemonMovements and frameMovements by side (monIndex & 1); the picture's y is 96. */
const MON_SLIDE = [{ start: 192, end: 72 }, { start: 64, end: 184 }];
const FRAME_SLIDE = [{ start: -96, end: 24 }, { start: 352, end: 136 }];
/** Decomp textAdder xPosition by side, in a 136-px column; rows of 16 px. */
const TEXT_X = [120, 0];
const TEXT_W = 136;
const ROW = 16;
const FRAME_Y = 32;
/** Decomp HallOfFame_ShowPartySprites initialPositions and endPositionsX. */
const PARTY_START = [[-40, 96], [296, 96], [-40, 88], [296, 88], [-40, 80], [296, 80]] as const;
const PARTY_END = [160, 96, 192, 64, 224, 32];
/** Decomp sequence SEQ_BLD_EV_DENDO2 (the induction's music). */
const MUSIC = 'SEQ_BLD_EV_DENDO2';

export function hallOfFameSprite(ctx: MenuContext, m: Pick<Pokemon, 'species' | 'form' | 'pid' | 'otId'>): HallOfFameSprite {
  return { species: m.species, form: m.form, shiny: isShiny(m.otId, m.pid), female: monGenderOf(ctx, m) === 'female' };
}

function monGenderOf(ctx: MenuContext, m: Pick<Pokemon, 'species' | 'form' | 'pid'>): Gender {
  return genderOf(dexOf(ctx.registries).form(m.species, m.form).genderRatio, m.pid);
}

function checkTexts(ctx: MenuContext, names: string[]): void {
  const missing = names.filter((n) => !ctx.registries.texts.has(ctx.text.id(n)));
  if (missing.length) throw new Error(`hall of fame: the ${ctx.text.ns} pack has no text for ${missing.join(', ')}`);
}

const speciesName = (ctx: MenuContext, species: Id) => plainText(ctx.registries.species.get(species)!.name);
const nickname = (ctx: MenuContext, m: { species: Id; nickname: string | null }) => m.nickname ?? speciesName(ctx, m.species);

export function hallOfFameRecordScreen(ctx: MenuContext): Screen {
  checkTexts(ctx, RECORD_TEXT);
  const t = ctx.text;
  const sound = ctx.host.sound;
  const party = ctx.state.party.filter((m) => !m.isEgg);
  const sprites = party.map((m) => hallOfFameSprite(ctx, m));
  const lines = (m: Pokemon): string[][] => {
    const gender = monGenderOf(ctx, m);
    const info = t.message(`HallOfFame_Text_PokemonInfo${gender === 'male' ? 'Male' : gender === 'female' ? 'Female' : 'Genderless'}`, speciesName(ctx, m.species), String(m.level));
    // Decomp HallOfFame_GetMetStringIndex: another trainer's Pokémon was traded; else where it hatched or was met.
    const own = m.otId === ctx.state.trainerId && m.otName === ctx.state.names.player;
    const place = (zone: Id | null) => (zone ? (ctx.registries.zones.get(zone)?.name ?? '') : '');
    const met = !own ? t.message('HallOfFame_Text_ObtainedInLinkTrade') : m.met.egg ? t.message('HallOfFame_Text_HatchedAt', place(m.met.zone)) : m.met.zone ? t.message('HallOfFame_Text_MetAt', place(m.met.zone)) : t.message('HallOfFame_Text_ObtainedInFatefulEncounter');
    return [[t.message('HallOfFame_Text_Welcome')], [nickname(ctx, m), info], [t.message('HallOfFame_Text_OT', m.otName), met]];
  };

  let phase: 'fade-in' | 'members' | 'group' | 'wipe' | 'fade-out' | 'done' = 'fade-in';
  let state = 0;
  let delay = 0;
  let fade = 0;
  let tick = 0;
  let index = 0;
  /** VBlank tasks (two steps a tick) and main-loop tasks (one); each returns true while it runs. */
  let vblank: (() => boolean)[] = [];
  let main: (() => boolean)[] = [];
  const member = { x: 0, frame: null as { x: number; y: number } | null, rows: [] as SceneLine[], textOffset: 0, shown: false };
  const group = { playerY: 232, frame: { left: 88, right: 168, top: -144 }, lines: [] as SceneLine[], party: [] as { x: number; y: number }[], partyShown: 0, confetti: false, shown: false };
  let wipe: { top: number; bottom: number } | null = null;
  const tasksBusy = () => vblank.length > 0 || main.length > 0;
  const run = (list: (() => boolean)[], n: number) => {
    for (let k = 0; k < n; k++) list = list.filter((task) => task());
    return list;
  };

  const startMember = () => {
    const side = index & 1;
    const mon = new Movement(MON_SLIDE[side]!.start, MON_SLIDE[side]!.end, 28);
    const frame = new Movement(FRAME_SLIDE[side]!.start, FRAME_SLIDE[side]!.end, 28);
    member.shown = true;
    member.x = MON_SLIDE[side]!.start;
    member.frame = { x: FRAME_SLIDE[side]!.start, y: FRAME_Y };
    member.rows = [];
    member.textOffset = 0;
    vblank.push(() => ((member.x = mon.run()), !mon.done));
    vblank.push(() => ((member.frame!.x = frame.run()), !frame.done));
  };
  const showText = () => {
    const side = index & 1;
    const text = lines(party[index]!);
    let step = 0;
    let wait = 0;
    // Decomp HallOfFame_PrintPokemonText: rows 1, then 3–4, then 6–7, 20 frames apart.
    const rows = [[ROW], [ROW * 3, ROW * 4], [ROW * 6, ROW * 7]];
    main.push(() => {
      if (wait) return (wait--, true);
      if (step === 3) return false;
      text[step]!.forEach((line, i) => line.split('\n').forEach((l, j) => member.rows.push({ text: l, x: TEXT_X[side]!, y: rows[step]![i]! + j * ROW, width: TEXT_W })));
      if (step < 2) wait = 20;
      step++;
      return true;
    });
  };

  const step = (): Step => {
    tick++;
    vblank = run(vblank, 2);
    main = run(main, 1);
    switch (phase) {
      case 'fade-in':
        if (state === 0) {
          if (sound) sound.playBgm(ctx.registries.sequences.has(t.id(MUSIC)) ? t.id(MUSIC) : (ctx.log.stub('menus:hall-of-fame-music', `the pack has no ${MUSIC}`), null));
          state = 1;
        }
        if (++fade >= 16) [phase, state, delay] = ['members', 0, 0];
        return;
      case 'members':
        if (delay) return void delay--;
        if (party.length === 0) return void ([phase, state] = ['group', 0]);
        if (state === 0) [index, state] = [0, 1];
        if (state === 1) {
          startMember();
          state = 2;
        } else if (state === 2) {
          // The picture's task (the frame's ends on the same step).
          if (!vblank.length) [delay, state] = [20, 3];
        } else if (state === 3) {
          const m = party[index]!;
          if (sound) sound.playCry(m.species, m.form);
          showText();
          state = 4;
        } else if (state === 4) {
          if (!tasksBusy()) [delay, state] = [30, 5];
        } else if (state === 5) {
          const text = new Movement(0, 256, 28);
          const frame = new Movement(32, -160, 28);
          vblank.push(() => ((member.textOffset = text.run()), !text.done));
          vblank.push(() => ((member.frame!.y = frame.run()), !frame.done));
          state = 6;
        } else if (state === 6 && !vblank.length) {
          member.shown = false;
          if (++index < party.length) [delay, state] = [30, 1];
          else [phase, state, delay] = ['group', 0, 0];
        }
        return;
      case 'group':
        if (delay) return void delay--;
        if (state === 0) state = 1;
        else if (state === 1) {
          group.shown = true;
          const player = new Movement(232, 104, 28);
          const frame = new Movement(-144, 24, 28);
          vblank.push(() => ((group.playerY = player.run()), !player.done));
          vblank.push(() => ((group.frame.top = frame.run()), !frame.done));
          state = 2;
        } else if (state === 2) {
          if (!vblank.length) [delay, state] = [20, 3];
        } else if (state === 3) {
          const left = new Movement(88, 0, 12);
          const right = new Movement(168, 255, 12);
          vblank.push(() => ((group.frame.left = left.run()), (group.frame.right = right.run()), !left.done));
          state = 4;
        } else if (state === 4) {
          if (!vblank.length) {
            const p = ctx.state.playTime;
            const id = String(ctx.state.trainerId & 0xffff).padStart(5, '0');
            group.lines = [
              { text: t.message('HallOfFame_Text_LeagueChampionCongratulations'), x: 0, y: 4, width: 256 },
              { text: t.message('HallOfFame_Text_PlayerInfo', ctx.state.names.player, id, String(p.hours), String(p.minutes).padStart(2, '0')), x: 0, y: 172, width: 256 },
            ];
            [delay, state] = [20, 5];
          }
        } else if (state === 5) {
          const moves = PARTY_START.map(([x], i) => new Movement(x, PARTY_END[i]!, 8));
          group.party = PARTY_START.slice(0, party.length).map(([x, y]) => ({ x, y }));
          let started = 0;
          let wait = 0;
          main.push(() => {
            for (let i = 0; i < started; i++) {
              const x = moves[i]!.run();
              if (i < party.length) group.party[i]!.x = x;
            }
            group.partyShown = party.length;
            if (wait) wait--;
            else if (started < PARTY_START.length) [wait, started] = [4, started + 1];
            else if (moves[party.length - 1]!.done) return false;
            return true;
          });
          state = 6;
        } else if (state === 6) {
          if (!main.length) [delay, state] = [20, 7];
        } else if (state === 7) {
          group.confetti = true;
          state = 8;
        }
        return;
      case 'wipe':
        if (state === 0) {
          const top = new Movement(24, 96, 24);
          const bottom = new Movement(24 + 144, 96, 24);
          wipe = { top: 24, bottom: 168 };
          vblank.push(() => ((wipe!.top = top.run()), (wipe!.bottom = bottom.run()), !top.done));
          state = 1;
        } else if (!vblank.length) [phase, state] = ['fade-out', 0];
        return;
      case 'fade-out':
        if (state === 0) {
          fade = 2;
          if (sound) sound.fadeOutBgm(0, 30);
          state = 1;
        } else {
          if (fade > 0) fade--;
          if (fade === 0 && !sound?.fadeActive()) return { close: { app: 'hall-of-fame' } };
        }
        return;
    }
    return;
  };

  const brightness = () => (phase === 'fade-in' ? fade / 16 : phase === 'fade-out' && state === 1 ? fade / 2 : 1);
  return {
    tick: (f) => {
      // Decomp HallOfFame_State_ShowPartyAndPlayer state 8: only the final screen takes A or B.
      if (phase === 'group' && state === 8 && (f.pressed.includes('a') || f.pressed.includes('b') || f.tap === 'next')) [phase, state] = ['wipe', 0];
      return step();
    },
    input: () => undefined,
    view(): HallOfFameRecordView {
      return {
        app: 'hall-of-fame',
        mode: 'record',
        brightness: brightness(),
        member: member.shown && phase === 'members' ? { mon: sprites[index]!, x: Math.round(member.x), frame: member.frame && { x: Math.round(member.frame.x), y: Math.round(member.frame.y) }, lines: member.rows.map((r) => ({ ...r, y: r.y - Math.round(member.textOffset) })).filter((r) => r.y > -ROW) } : null,
        group: group.shown
          ? {
              player: { gender: ctx.state.gender, y: Math.round(group.playerY) },
              frame: { left: Math.round(group.frame.left), right: Math.round(group.frame.right), top: Math.round(group.frame.top) },
              lines: group.lines,
              party: group.party.slice(0, group.partyShown).map((p, i) => ({ mon: sprites[i]!, x: Math.round(p.x), y: p.y })),
              confetti: group.confetti,
            }
          : null,
        wipe: wipe && { top: Math.round(wipe.top), bottom: Math.round(wipe.bottom) },
        waiting: phase === 'group' && state === 8,
        tick,
      };
    },
  };
}

export function hallOfFamePcScreen(ctx: MenuContext): Screen {
  checkTexts(ctx, PC_TEXT);
  const t = ctx.text;
  const sound = ctx.host.sound;
  const hof = ctx.state.hallOfFame;
  // Decomp: the PC menu offers it only after the game is completed, so a valid team is there.
  if (!hof.entries.length) throw new Error('hall of fame PC: no entry (the PC offers it only after a clear)');
  /** UI entry 0 is the newest. */
  let entry = 0;
  let member = 0;
  let panel: 'info' | 'moves' = 'info';
  let fade = 0;
  let closing = false;
  const current = () => hof.entries[hof.entries.length - 1 - entry]!;
  const cry = () => {
    const m = current().party[member]!;
    if (sound) sound.playCry(m.species, m.form);
  };
  cry();
  const title = () => {
    const e = current();
    const [y, mo, d] = e.date.split('-').map(Number);
    return t.message('PCHallOfFame_Text_Title', String(hof.total - entry), String(y), t.month(mo! - 1), String(d));
  };
  const info = (m: HallOfFameMon): SceneLine[] => {
    const gender = genderOf(dexOf(ctx.registries).form(m.species, m.form).genderRatio, m.pid);
    const sign = gender === 'male' ? t.message('PCHallOfFame_Text_MaleSign') : gender === 'female' ? t.message('PCHallOfFame_Text_FemaleSign') : '';
    return [
      { text: nickname(ctx, m), x: 16, y: 136 },
      { text: `${speciesName(ctx, m.species)}${sign}`, x: 104, y: 136 },
      { text: t.message('PCHallOfFame_Text_Level', String(m.level)), x: 184, y: 136 },
      { text: `${t.message('PCHallOfFame_Text_OT')}${m.otName}`, x: 16, y: 160 },
    ];
  };
  const moves = (m: HallOfFameMon): SceneLine[] => m.moves.map((id, i) => ({ text: plainText(ctx.registries.moves.get(id)!.name), x: i % 2 ? 136 : 16, y: 136 + Math.floor(i / 2) * 24 }));
  const count = Math.min(hof.total, HALL_OF_FAME_ENTRIES);
  const select = (e: number, m: number) => {
    entry = (e + count) % count;
    member = m < 0 ? current().party.length - 1 : m;
    panel = 'info';
    cry();
  };
  const input = (i: Input): Step => {
    if (closing || fade < 6) return;
    const key = 'button' in i ? i.button : i.tap;
    if (key === 'b' || key === 'back') {
      closing = true;
      fade = 6;
      const se = t.id('SEQ_SE_DP_PC_LOGOFF');
      if (sound && ctx.registries.sequences.has(se)) sound.playSe(se);
      return;
    }
    if (key === 'a' || key === 'toggle') {
      panel = panel === 'info' ? 'moves' : 'info';
      const se = t.id('SEQ_SE_CONFIRM');
      if (sound && ctx.registries.sequences.has(se)) sound.playSe(se);
      return;
    }
    if (key === 'left' || key === 'older') return void select(entry + 1, 0);
    if (key === 'right' || key === 'newer') return void select(entry - 1, 0);
    if (key === 'up') return void (member > 0 ? select(entry, member - 1) : select(entry + 1, -1));
    if (key === 'down') return void (member < current().party.length - 1 ? select(entry, member + 1) : select(entry - 1, 0));
    const tap = /^member:(\d)$/.exec(key);
    if (tap && Number(tap[1]) < current().party.length) select(entry, Number(tap[1]));
    return;
  };
  return {
    tick: () => {
      // Decomp: 6-frame fades in and out.
      if (!closing && fade < 6) fade++;
      else if (closing && --fade <= 0) return { close: { app: 'hall-of-fame' } };
      return;
    },
    input,
    view(): HallOfFamePcView {
      const m = current().party[member]!;
      return {
        app: 'hall-of-fame',
        mode: 'pc',
        brightness: fade / 6,
        title: title(),
        party: current().party.map((p) => hallOfFameSprite(ctx, p)),
        selected: member,
        panel,
        lines: panel === 'info' ? info(m) : moves(m),
      };
    },
  };
}
