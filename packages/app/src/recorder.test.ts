import { describe, expect, it, vi } from 'vitest';
import { parseReplay } from '@opensinnoh/core';
import type { BattleChoice, BattleLogEntry, InputFrame } from '@opensinnoh/contracts';
import type { Game } from '@opensinnoh/game';
import { ReplayRecorder } from './recorder.ts';

const empty: InputFrame = { held: [], pressed: [], touch: null };

/** Just what the recorder reads and wraps. */
function fakeGame() {
  const fake = {
    state: { player: { zone: 'fixture:ROOM', x: 1, z: 2, facing: 'down' } },
    battles: [] as BattleLogEntry[],
    appName: null as string | null,
    battling: false,
    prompt: undefined as string | undefined,
    app: () => (fake.appName ? { app: fake.appName } : null),
    inBattle: () => fake.battling,
    battle: { view: () => ({ prompt: fake.prompt ? { kind: fake.prompt } : null }) },
    battleChoose: vi.fn((c: BattleChoice) => {
      if (c.kind === 'fight') fake.prompt = 'fight';
    }),
    reset: vi.fn(),
    load: vi.fn(),
  };
  return fake;
}
const asGame = (g: ReturnType<typeof fakeGame>) => g as unknown as Game;

describe('dev replay recorder', () => {
  it('writes held-state changes and touches as +N lines, ending with the position', () => {
    const g = fakeGame();
    const r = new ReplayRecorder(['test'], asGame(g));
    const f = (held: string[], touch: { x: number; y: number } | null = null, pressed: string[] = []) => r.frame({ held: held as never, pressed: pressed as never, touch }, asGame(g));
    f([]);
    f(['a'], null, ['a']);
    f(['a']);
    f([]);
    f([], { x: 3, y: 4 });
    f([], { x: 3, y: 4 });
    f(['up', 'b'], null, ['up', 'b']);
    f([]);
    f([]);
    expect(r.text(asGame(g).state)).toBe(
      ['# test', '+0 assert map fixture:ROOM', '+1 press a', '+2 release a', '+1 touch 3 4', '+2 press up', '+0 press b', '+0 untouch', '+1 release up', '+0 release b', '+2 assert position fixture:ROOM 1 2', ''].join('\n'),
    );
    expect(parseReplay(r.text(asGame(g).state)).lines).toHaveLength(10);
  });

  it('records milestones: map and app changes, battle log entries by content', () => {
    const g = fakeGame();
    const r = new ReplayRecorder([], asGame(g));
    r.frame(empty, asGame(g));
    g.state.player.zone = 'fixture:TOWN';
    g.appName = 'start-menu';
    g.battles.push({ tick: 1, kind: 'trainer', trainers: ['fixture:TRAINER_HIKER'], species: [], result: 'won' });
    r.observe(asGame(g));
    g.battles.push({ tick: 2, kind: 'trainer', trainers: ['fixture:TRAINER_HIKER'], species: [], result: 'lost' });
    r.observe(asGame(g));
    const text = r.text(asGame(g).state);
    expect(text).toContain('+1 assert map fixture:TOWN\n+0 assert app start-menu\n+0 assert battles trainer 1\n+0 assert battle trainer fixture:TRAINER_HIKER won\n+0 assert battles trainer 2\n');
    // A rematch that ended otherwise: `assert battle` would check both entries, so only the count.
    expect(text).not.toContain('fixture:TRAINER_HIKER lost');
    expect(r.stopped).toBeNull();
  });

  it('records the battle card in the grammar, and stops loudly at what it cannot spell', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const g = fakeGame();
    const original = g.battleChoose;
    const r = ReplayRecorder.start(asGame(g), []);
    g.prompt = 'command';
    g.battleChoose({ kind: 'fight' });
    g.battleChoose({ kind: 'move', slot: 1 });
    g.battleChoose({ kind: 'forget', slot: 3 });
    g.battleChoose({ kind: 'answer', yes: false });
    r.frame(empty, asGame(g));
    g.battleChoose({ kind: 'nickname', give: true });
    expect(r.stopped).toMatch(/NICKNAME/);
    expect(g.battleChoose).toBe(original);
    const text = r.text(asGame(g).state);
    expect(parseReplay(text).lines.map((l) => l.action).filter((a) => a.type === 'battle')).toEqual([
      { type: 'battle', choice: { kind: 'move', slot: 1 } },
      { type: 'battle', choice: { kind: 'forget', slot: 3 } },
      { type: 'battle', choice: { kind: 'answer', yes: false } },
    ]);
    expect(text).toContain('# Recording stopped at tick 1');
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('stops at keys after a card-only step, main-screen touches, double presses and a reset', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cases: [string, (r: ReplayRecorder, g: ReturnType<typeof fakeGame>) => void, RegExp][] = [
      ['card then keys', (r, g) => {
        g.prompt = 'command';
        g.battleChoose({ kind: 'fight' });
        r.frame({ held: ['a'], pressed: ['a'], touch: null }, asGame(g));
      }, /move list/],
      ['main touch', (r, g) => r.frame({ ...empty, touch: { x: 1, y: 2, screen: 'main' } }, asGame(g)), /main-screen/],
      ['double press', (r, g) => {
        r.frame({ held: ['a'], pressed: ['a'], touch: null }, asGame(g));
        r.frame({ held: ['a'], pressed: ['a'], touch: null }, asGame(g));
      }, /released and pressed again/],
      ['reset', (_, g) => asGame(g).reset(), /reset/],
      ['load', (_, g) => asGame(g).load({} as never), /save was loaded/],
    ];
    for (const [name, act, reason] of cases) {
      const g = fakeGame();
      const r = ReplayRecorder.start(asGame(g), []);
      act(r, g);
      expect(r.stopped, name).toMatch(reason);
      // Whatever it recorded before still parses.
      expect(() => parseReplay(r.text(asGame(g).state))).not.toThrow();
    }
    error.mockRestore();
  });
});
