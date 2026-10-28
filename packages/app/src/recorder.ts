/**
 * Replay recorder, dev builds only (game-view loads it under `import.meta.env.DEV`): the input frames the
 * loop feeds the game, and the battle card's direct choices, as a `.replay` in the current grammar (core
 * `replay.ts`), with map, app and battle-log asserts as milestones. A recording starts at a reset with the
 * replay seed, default names and the frozen replay clock, so `opensinnoh test` plays it back from the same state.
 *
 * Every line is parsed back as it is written. Input the grammar cannot spell (a main-screen touch, a
 * release and press within one tick, the card's BAG/POKéMON/CANCEL/nickname buttons) stops the recording
 * there, loudly: the replay up to that tick stays valid.
 */
import { BUTTONS, parseReplay, type Button, type ReplayAction } from '@opensinnoh/core';
import type { BattleChoice, GameState, InputFrame } from '@opensinnoh/contracts';
import type { Game } from '@opensinnoh/game';

type Watched = Pick<Game, 'state' | 'battles' | 'app' | 'inBattle'>;

/** One timed action as the grammar spells it. */
function spell(a: ReplayAction): string {
  switch (a.type) {
    case 'press':
    case 'release':
      return `${a.type} ${a.button}`;
    case 'touch':
      return `touch ${a.x} ${a.y}`;
    case 'untouch':
      return 'untouch';
    case 'tap':
      return `tap ${a.id}`;
    case 'battle': {
      const c = a.choice;
      const actor = 'battler' in c && c.battler !== undefined ? `${c.battler === 0 ? 1 : 2} ` : '';
      if (c.kind === 'move') return `battle ${actor}move ${c.slot + 1}${c.target === undefined ? '' : ` target ${c.target}`}`;
      if (c.kind === 'switch') return `battle ${actor}switch ${c.slot + 1}`;
      if (c.kind === 'item') return `battle ${actor}item ${c.item}${c.target === undefined ? '' : ` ${c.target + 1}`}${c.move === undefined ? '' : ` ${c.move + 1}`}`;
      if (c.kind === 'run') return `battle ${actor}run`;
      if (c.kind === 'forget') return `battle forget ${c.slot + 1}`;
      if (c.kind === 'answer') return `battle answer ${c.yes ? 'yes' : 'no'}`;
      if (c.kind === 'safari') return `battle safari ${c.action}`;
      return `battle ${c.kind}`;
    }
    case 'assert':
      if (a.what === 'map') return `assert map ${a.id}`;
      if (a.what === 'app') return `assert app ${a.app ?? 'none'}`;
      if (a.what === 'battle') return `assert battle ${a.kind} ${a.match ?? '*'} ${a.result}`;
      if (a.what === 'battles') return `assert battles ${a.kind} ${a.count}`;
      if (a.what === 'position') return `assert position ${a.zone} ${a.x} ${a.z}`;
  }
  throw new Error(`recorder: no spelling for ${JSON.stringify(a)}`);
}

/** Key-order-independent JSON, to compare an action with its parse. */
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => p.localeCompare(q))) : x));

export class ReplayRecorder {
  private readonly lines: string[];
  private held = new Set<Button>();
  private touch: InputFrame['touch'] = null;
  /** Ticks recorded so far, and the tick of the last written line. */
  private ticks = 0;
  private lastLine = 0;
  private zone: string | null = null;
  private app: string | null = null;
  private inBattle = false;
  private battleCount = 0;
  /**
   * A card choice only moved the card (FIGHT, a move opening the target screen, the target screen's
   * CANCEL): the replay's `battle move` answers from the command prompt, so a key or touch now would
   * replay at another prompt.
   */
  private navigating = false;
  /** Why the recording stopped, or null while it records. */
  stopped: string | null = null;
  private end: GameState['player'] | null = null;
  private restore: () => void = () => {};

  constructor(header: string[], game: Watched) {
    this.lines = header.map((h) => `# ${h}`);
    this.observe(game);
  }

  /** Writes a timed action after checking it parses back to itself; stops the recording otherwise. */
  private write(a: ReplayAction, game: Watched): boolean {
    const text = spell(a);
    let parsed: unknown;
    try {
      parsed = parseReplay(`+0 ${text}`).lines[0]?.action;
    } catch {
      parsed = undefined;
    }
    if (canonical(parsed) !== canonical(a)) {
      this.stop(`"${text}" does not parse back as recorded`, game);
      return false;
    }
    this.lines.push(`+${this.ticks - this.lastLine} ${text}`);
    this.lastLine = this.ticks;
    return true;
  }

  /** Ends the recording at this tick: the replay so far stays valid, the reason is a comment and an error. */
  stop(reason: string, game: Pick<Game, 'state'>): void {
    if (this.stopped) return;
    this.stopped = reason;
    this.end = structuredClone(game.state.player);
    this.lines.push(`# Recording stopped at tick ${this.ticks}: ${reason}.`);
    this.restore();
    console.error(`replay recorder: stopped at tick ${this.ticks}: ${reason}`);
  }

  /** The frame about to be stepped (call before the tick runs it). */
  frame(f: InputFrame, game: Watched): void {
    if (this.stopped) return;
    const held = new Set(f.held);
    const out: ReplayAction[] = [];
    for (const b of BUTTONS) {
      // The game's input has a press edge only where the button was up the tick before.
      if (this.held.has(b) && held.has(b) && f.pressed.includes(b)) return this.stop(`${b} released and pressed again within one tick (no replay spelling)`, game);
      if (this.held.has(b) && !held.has(b)) out.push({ type: 'release', button: b });
      if (!this.held.has(b) && held.has(b)) out.push({ type: 'press', button: b });
    }
    const t = f.touch;
    if (t?.screen === 'main') return this.stop('a main-screen touch (a scripted menu) has no replay spelling: use the keys', game);
    if (t && (!this.touch || t.x !== this.touch.x || t.y !== this.touch.y)) out.push({ type: 'touch', x: t.x, y: t.y });
    if (!t && this.touch) out.push({ type: 'untouch' });
    if (f.tap !== undefined) out.push({ type: 'tap', id: f.tap });
    if (this.navigating && out.some((a) => a.type === 'press' || a.type === 'touch' || a.type === 'tap')) {
      return this.stop('input after the battle card moved to the move list or target screen (no replay spelling): pick the move on the card, or use the keys from the command prompt', game);
    }
    for (const a of out) if (!this.write(a, game)) return;
    this.held = held;
    this.touch = t ? { ...t } : null;
    this.ticks++;
  }

  /** After each tick: the map, the open app and new battle-log entries, as asserts. */
  observe(game: Watched): void {
    if (this.stopped) return;
    const zone = game.state.player.zone;
    if (zone !== this.zone && !this.write({ type: 'assert', what: 'map', id: zone }, game)) return;
    this.zone = zone;
    const app = game.app()?.app ?? null;
    if (app !== this.app && !this.write({ type: 'assert', what: 'app', app }, game)) return;
    this.app = app;
    const active = game.inBattle();
    if (active !== this.inBattle) this.lines.push(`# tick ${this.ticks}: battle ${active ? 'start' : 'end'}`);
    this.inBattle = active;
    for (const entry of game.battles.slice(this.battleCount)) {
      const kind = entry.kind;
      if (!this.write({ type: 'assert', what: 'battles', kind, count: game.battles.filter((b) => b.kind === kind).length }, game)) return;
      // `assert battle` checks every entry with that id: only when all of them ended the same way.
      const match = entry.trainers[0] ?? entry.species[0];
      const same = game.battles.filter((b) => b.kind === kind && match !== undefined && (b.trainers.includes(match) || b.species.includes(match)));
      if (match !== undefined && same.every((b) => b.result === entry.result) && !this.write({ type: 'assert', what: 'battle', kind, match, result: entry.result }, game)) return;
    }
    this.battleCount = game.battles.length;
  }

  /** A choice the battle card made directly (`Game.battleChoose`), with the battle's prompt before and after it. */
  battleChoice(c: BattleChoice, before: string | undefined, after: string | undefined, game: Watched): void {
    if (this.stopped) return;
    // A move the list refused closes it while its message prints (no prompt after): navigation too.
    if (c.kind === 'fight' || (c.kind === 'cancel' && before === 'target') || (c.kind === 'move' && before === 'fight' && (after === 'target' || after === undefined))) {
      this.navigating = true;
      this.lines.push(`# tick ${this.ticks}: battle card ${c.kind}`);
      return;
    }
    if (c.kind === 'bag' || c.kind === 'party' || c.kind === 'cancel' || c.kind === 'nickname') {
      return this.stop(`the battle card's ${c.kind === 'party' ? 'POKéMON' : c.kind.toUpperCase()} button has no replay spelling: use the keys for it`, game);
    }
    this.navigating = false;
    this.write({ type: 'battle', choice: c }, game);
  }

  /** The replay so far, ending with the player's position after the last recorded tick. */
  text(state: GameState): string {
    const p = this.end ?? state.player;
    return [...this.lines, `+${this.ticks - this.lastLine} ${spell({ type: 'assert', what: 'position', zone: p.zone, x: p.x, z: p.z })}`, ''].join('\n');
  }

  /**
   * Starts recording `game` (just reset): the battle card's direct choices are recorded, and a reset or a
   * load ends the recording. The game's methods are wrapped only while it records.
   */
  static start(game: Game, header: string[]): ReplayRecorder {
    const r = new ReplayRecorder(header, game);
    const { battleChoose, reset, load } = game;
    game.battleChoose = (choice) => {
      const before = game.battle?.view().prompt?.kind;
      battleChoose.call(game, choice);
      r.battleChoice(choice, before, game.battle?.view().prompt?.kind, game);
    };
    game.reset = (...args) => {
      r.stop('the game was reset', game);
      reset.apply(game, args);
    };
    game.load = (...args) => {
      r.stop('a save was loaded', game);
      load.apply(game, args);
    };
    r.restore = () => Object.assign(game, { battleChoose, reset, load });
    return r;
  }
}

declare global {
  interface Window {
    /** Dev builds: opens the Developer dialog (no button: the player's screens have none). */
    openSinnohDeveloper?: { open(): void };
  }
}

/** The Developer dialog (dev builds, opened by `window.openSinnohDeveloper.open()`): start a recording, download it as a `.replay`. */
export function attachRecorderMenu(deps: { start(): Promise<void>; recording(): string | null; stopped(): string | null }): void {
  const dialog = document.createElement('dialog');
  dialog.id = 'developer';
  dialog.innerHTML = `<form method="dialog" class="menu-head"><h2>Developer</h2><button value="close" aria-label="Close developer tools">✕</button></form>
    <section id="developer-section">
    <p class="small">Record from a new game with seed 1 and default names. Starting again replaces the recording.</p>
    <div class="row"><button id="record-start">Record replay</button>
    <button id="record-download" disabled>Download replay</button></div>
    <p id="record-status" class="small" role="status"></p>
    </section>`;
  document.body.append(dialog);
  const status = document.getElementById('record-status')!;
  const download = document.getElementById('record-download') as HTMLButtonElement;
  const refresh = () => {
    download.disabled = deps.recording() === null;
    const stopped = deps.stopped();
    if (stopped) status.textContent = `Recording stopped: ${stopped}. The replay up to there can be downloaded.`;
  };
  window.openSinnohDeveloper = {
    open: () => {
      refresh();
      dialog.showModal();
    },
  };
  document.getElementById('record-start')!.addEventListener('click', async () => {
    if (deps.recording() !== null && !confirm('Start a new recording? The current one is lost unless you downloaded it.')) return;
    await deps.start();
    status.textContent = 'Recording from a new game. Close the menu and play; download the replay here.';
    refresh();
  });
  download.addEventListener('click', () => {
    const text = deps.recording();
    if (text === null) return;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `recording-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.replay` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = `Downloaded ${text.split('\n').filter((l) => l.startsWith('+')).length} lines.`;
  });
}
