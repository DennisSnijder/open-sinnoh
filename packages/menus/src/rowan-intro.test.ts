/**
 * Rowan's intro headless on the fixture pack (its own warden's words under the bank's names): the DS order, the
 * names and gender it returns (what the title's NEW GAME used to collect), and its branches.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPackFolder, type Button } from '@opensinnoh/core';
import type { AppModel, AppResult, AppView, InputFrame, NamingView, RowanIntroView, StubLog } from '@opensinnoh/contracts';
import { loadGamePacks } from '@opensinnoh/game';
import { createRowanIntro } from './index.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const { registries } = loadGamePacks([readPackFolder((p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined), 'packs/fixture')]);
const stubs: string[] = [];
const log = { stub: (key: string) => void stubs.push(key) } as unknown as StubLog;

class Driver {
  readonly app: AppModel;
  result: AppResult | null = null;
  ticks = 0;
  readonly seen: string[] = [];
  constructor(skip = false) {
    this.app = createRowanIntro({ registries, log, textDelay: 1, defaults: { player: 'Ari', rival: 'Bo' }, skip });
  }
  get view(): AppView {
    return this.app.view();
  }
  get intro(): RowanIntroView {
    const v = this.view;
    if (v.app !== 'rowan-intro') throw new Error(`expected the intro, got ${v.app}`);
    return v;
  }
  step(pressed: Button[] = [], tap?: string): void {
    const frame: InputFrame = { held: pressed, pressed, touch: null, ...(tap ? { tap } : {}) };
    this.result = this.app.step(frame) ?? this.result;
    this.ticks++;
    const v = this.view;
    if (v.app === 'rowan-intro' && v.message && this.seen.at(-1) !== v.message.text) this.seen.push(v.message.text);
  }
  /** A on every other tick (messages) until `done` holds. */
  until(done: (v: AppView) => boolean, max = 4000): void {
    for (let i = 0; !done(this.view); i++) {
      const v = this.view;
      if (v.app === 'naming' || (v.app === 'rowan-intro' && (v.menu || v.gender))) throw new Error(`stopped at a choice (seen ${JSON.stringify(this.seen.slice(-4))}): ${JSON.stringify(v).slice(0, 300)}`);
      if (i > max || this.result) throw new Error(`not reached in ${max} ticks (seen ${JSON.stringify(this.seen.slice(-8))}) (at ${JSON.stringify(this.view).slice(0, 300)})`);
      this.step(i % 2 ? ['a'] : []);
    }
  }
  menu(): RowanIntroView['menu'] {
    this.until((v) => v.app === 'rowan-intro' && v.menu !== null);
    return this.intro.menu;
  }
  name(text: string): void {
    this.until((v) => v.app === 'naming');
    this.step([], `type:${text}`);
    expect((this.view as NamingView).text).toBe(text);
    this.step([], 'ok');
  }
}

describe("Rowan's intro (fixture pack)", () => {
  it('runs the DS order and returns the names and gender, as the old new-game form did', () => {
    const d = new Driver();
    // Black, 6 frames of fade and 41 of delay, then the welcome on black.
    expect(d.intro).toMatchObject({ screen: 'main', backdrop: null, layers: [], brightness: -16 });
    d.until((v) => v.app === 'rowan-intro' && v.message !== null);
    expect(d.ticks).toBe(6 + 41 + 1);
    expect(d.intro.backdrop).toBeNull();
    // Rowan fades in with the backdrop: the first frame that has them is black (no flash of the scene before the fade).
    d.until((v) => v.app === 'rowan-intro' && v.backdrop !== null);
    expect(d.intro.brightness).toBe(-16);
    // Then he moves right for the info choice.
    const info = d.menu();
    expect(info!.entries).toEqual(['THE ROAD', 'NO THANKS']);
    expect(d.intro.layers).toEqual([{ cell: 'rowan', x: 48, y: 0, alpha: 16 }]);
    d.step([], 'menu:1');
    // The Poké Ball on the touch screen; B is "not that button", the button opens it.
    d.until((v) => v.app === 'rowan-intro' && v.screen === 'touch' && v.message?.text.includes('button in its middle') === true && !v.message.waiting);
    expect(d.intro.ball).toBe('button-0');
    for (let i = 0; i < 3; i++) d.step();
    d.step(['b']);
    for (let i = 0; i < 60; i++) d.step();
    expect(d.intro.message!.text).toBe('Not that one!\nThe button on the capsule.');
    d.step([], 'ball');
    d.until((v) => v.app === 'rowan-intro' && v.flash > 0);
    d.until((v) => v.app === 'rowan-intro' && v.screen === 'main' && v.flash === 0);
    // The gender choice: both avatars, left/right picks (the other dims), A confirms, YES.
    d.until((v) => v.app === 'rowan-intro' && v.gender !== null);
    expect(d.intro.layers.map((l) => l.cell)).toEqual(['boy-0', 'girl-0']);
    d.step(['right']);
    expect(d.intro.gender).toBe('female');
    expect(d.intro.layers.map((l) => l.alpha)).toEqual([6, 16]);
    d.step(['a']);
    expect(d.menu()!.entries).toEqual(['YES', 'NO']);
    expect(d.intro.layers).toEqual([{ cell: expect.stringMatching(/^girl-/), x: 0, y: 0, alpha: 16 }]);
    d.step([], 'menu:0');
    d.name('Kai');
    d.until((v) => v.app === 'rowan-intro' && v.message?.text === 'You are Kai?');
    d.menu();
    d.step([], 'menu:0');
    // The rival: a new name on the keyboard.
    const rivals = d.menu();
    expect(rivals!.entries).toEqual(['Another!', 'Wren', 'Oak', 'Sol', 'Fen']);
    expect(d.intro.layers.map((l) => l.cell)).toEqual(['rival']);
    d.step([], 'menu:0');
    d.name('Mo');
    d.until((v) => v.app === 'rowan-intro' && v.message?.text === 'Mo, right?');
    d.menu();
    d.step([], 'menu:0');
    d.until(() => d.result !== null, 6000);
    expect(d.result).toEqual({ app: 'rowan-intro', names: { player: 'Kai', rival: 'Mo' }, gender: 'female' });
    expect(d.seen).toContain('Welcome, Kai!');
    expect(d.seen).toContain('Off you go, Kai.');
    expect(stubs).toContain('menus:intro-buneary');
  });

  it('the intro skip (OpenSinnoh): from the first fade to the boy and the girl, the names, then out', () => {
    const d = new Driver(true);
    d.until((v) => v.app === 'rowan-intro' && v.gender !== null);
    // Straight to the question: no welcome, no info choice, no Poké Ball.
    expect(d.seen.every((t) => d.intro.message!.text.startsWith(t))).toBe(true);
    expect(d.intro.backdrop).toBe('plain');
    d.step(['a']);
    d.menu();
    d.step([], 'menu:0');
    d.name('Kai');
    d.menu();
    d.step([], 'menu:0');
    d.menu();
    d.step([], 'menu:1');
    d.menu();
    d.step([], 'menu:0');
    d.until(() => d.result !== null);
    expect(d.result).toEqual({ app: 'rowan-intro', names: { player: 'Kai', rival: 'Wren' }, gender: 'male' });
    expect(d.seen).not.toContain('Off you go, Kai.');
  });

  it('ADVENTURE INFO shows its six blocks; NO on the name goes back to the gender; a preset rival name; empty names keep the defaults', () => {
    const d = new Driver();
    d.menu();
    d.step([], 'menu:0');
    const blocks: string[] = [];
    d.until((v) => {
      if (v.app === 'rowan-intro' && v.block && blocks.at(-1) !== v.block.text) blocks.push(v.block.text);
      return v.app === 'rowan-intro' && v.menu !== null;
    });
    expect(blocks).toHaveLength(6);
    expect(blocks[0]).toBe('The road starts at your door.');
    d.step([], 'menu:1');
    d.until((v) => v.app === 'rowan-intro' && v.screen === 'touch' && v.message !== null && !v.message.waiting && v.message.text.includes('middle'));
    for (let i = 0; i < 3; i++) d.step();
    d.step(['a']);
    d.until((v) => v.app === 'rowan-intro' && v.gender !== null);
    d.step(['a']);
    d.menu();
    d.step([], 'menu:0');
    d.until((v) => v.app === 'naming');
    d.step([], 'ok');
    d.until((v) => v.app === 'rowan-intro' && v.message?.text === 'You are Ari?');
    d.menu();
    d.step([], 'menu:1');
    // Back to both avatars and the question.
    d.until((v) => v.app === 'rowan-intro' && v.gender !== null);
    d.step(['a']);
    d.menu();
    d.step([], 'menu:0');
    d.name('Lu');
    d.menu();
    d.step([], 'menu:0');
    d.menu();
    d.step([], 'menu:1');
    d.until((v) => v.app === 'rowan-intro' && v.message?.text === 'Wren, right?');
    d.menu();
    d.step([], 'menu:0');
    d.until(() => d.result !== null, 6000);
    expect(d.result).toEqual({ app: 'rowan-intro', names: { player: 'Lu', rival: 'Wren' }, gender: 'male' });
  });
});
