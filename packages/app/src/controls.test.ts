import { describe, expect, it } from 'vitest';
import { ActivePad, gamepadButtons } from './input.ts';
import { bindKey, bindPad, bindingText, Controls, CONTROLS_KEY, defaultBindings, keyLabel, keyMapOf, KEY_MAP, padLabel, parseBindings } from './controls.ts';

const pad = (mapping: string, down: number[] = [], axes: number[] = []) => ({ mapping, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i) })), axes });

describe('bindings', () => {
  it('the defaults are the game as it ships', () => {
    expect(keyMapOf(defaultBindings())).toEqual(KEY_MAP);
    expect(defaultBindings().keys.fast).toEqual(['Tab']);
  });

  it('a key moves to the action it is bound to and swaps with the action that had it', () => {
    const b = defaultBindings();
    expect(bindKey(b, 'a', 'KeyQ')).toEqual({ holder: 'l' });
    expect(b.keys.a).toEqual(['KeyQ']);
    // L had only Q and Page Up: it keeps Page Up and takes A's first old key.
    expect(b.keys.l).toEqual(['PageUp']);
    const only = defaultBindings();
    expect(bindKey(only, 'start', 'KeyC')).toEqual({ holder: 'x' });
    expect(only.keys.x).toEqual(['Enter']);
    expect(only.keys.start).toEqual(['KeyC']);
  });

  it('keys the game uses cannot be bound', () => {
    const b = defaultBindings();
    for (const code of ['Escape', 'KeyP', 'Backquote', 'ControlLeft', 'MetaRight']) expect(() => bindKey(b, 'a', code)).toThrow(/cannot be bound/);
    expect(b).toEqual(defaultBindings());
  });

  it('pad bindings swap exactly', () => {
    const b = defaultBindings();
    expect(bindPad(b, false, 'a', 'b0')).toEqual({ holder: 'b' });
    expect(b.pad.a).toBe('b0');
    expect(b.pad.b).toBe('b1');
    expect(bindPad(b, true, 'a', 'b3')).toEqual({ holder: null });
    expect(b.raw.a).toBe('b3');
  });

  it('names keys and pad buttons', () => {
    expect(['KeyZ', 'ArrowUp', 'Digit4', 'Numpad2', 'F5', 'ShiftRight'].map(keyLabel)).toEqual(['Z', 'Up', '4', 'Num 2', 'F5', 'Right Shift']);
    expect([padLabel('b1', false), padLabel('b1', true), padLabel('a2-', true), padLabel(null, true)]).toEqual(['Right button', 'Button 1', 'Axis 2 -', 'Unbound']);
    expect(bindingText(defaultBindings(), 'a', false)).toBe('Z, J, Space · Right button');
  });
});

describe('stored bindings', () => {
  it('missing storage is the defaults', () => {
    expect(parseBindings(null)).toEqual({ bindings: defaultBindings(), problems: [] });
  });

  it('keeps good entries and falls back, entry by entry, with the reasons', () => {
    const stored = JSON.stringify({ keys: { a: ['KeyG'], b: 'KeyH', start: ['Escape'] }, pad: { a: 'b9', b: 'nope' }, raw: { a: 'a1-' }, deadZone: 5, extra: 1 });
    const { bindings, problems } = parseBindings(stored);
    expect(bindings.keys.a).toEqual(['KeyG']);
    expect(bindings.keys.b).toEqual(defaultBindings().keys.b);
    expect(bindings.keys.start).toEqual(['Enter']);
    expect(bindings.pad.a).toBe('b9');
    expect(bindings.pad.b).toBe('b0');
    expect(bindings.raw.a).toBe('a1-');
    expect(bindings.deadZone).toBe(50);
    expect(problems).toHaveLength(5);
    expect(parseBindings('{').problems[0]).toMatch(/not JSON/);
    expect(parseBindings('[]').problems).toEqual(['not an object']);
  });

  it('is stored and read back, and a bad entry logs a warning', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const warnings: string[] = [];
    const c = new Controls(storage, (m) => warnings.push(m));
    c.edit((b) => bindKey(b, 'a', 'KeyG'));
    expect(c.keyMap().KeyG).toBe('a');
    expect(new Controls(storage, () => {}).keyMap().KeyG).toBe('a');
    mem.set(CONTROLS_KEY, JSON.stringify({ keys: { a: [] } }));
    const bad = new Controls(storage, (m) => warnings.push(m));
    expect(bad.keyMap().KeyZ).toBe('a');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/keys\.a/);
    expect(c.reset()).toBeNull();
    expect(JSON.parse(mem.get(CONTROLS_KEY)!)).toEqual(defaultBindings());
  });
});

describe('gamepads', () => {
  it('a standard pad uses the positional table and the stick', () => {
    expect(gamepadButtons(pad('standard', [1, 9], [-0.9, 0.2]))).toEqual(['left', 'a', 'start']);
  });

  it('a pad with another mapping has nothing until it is bound, then reads raw indices and axes', () => {
    expect(gamepadButtons(pad('', [0, 1], [-1, 0]))).toEqual([]);
    const b = defaultBindings();
    bindPad(b, true, 'a', 'b5');
    bindPad(b, true, 'left', 'a0-');
    expect(gamepadButtons(pad('', [5], [-1, 0]), b)).toEqual(['left', 'a']);
    expect(gamepadButtons(pad('', [], [-0.3, 0]), b)).toEqual([]);
  });

  it('the dead zone applies to the stick', () => {
    const b = defaultBindings();
    b.deadZone = 80;
    expect(gamepadButtons(pad('standard', [], [0.7, 0]), b)).toEqual([]);
    expect(gamepadButtons(pad('standard', [], [0.85, 0]), b)).toEqual(['right']);
  });

  it('one pad is active: the one pressed last, until it is unplugged', () => {
    const active = new ActivePad();
    const b = defaultBindings();
    const one = pad('standard');
    const two = pad('standard');
    expect(active.pick([one, two], b)).toBeNull();
    const oneDown = pad('standard', [1]);
    expect(active.pick([oneDown, two], b)).toBe(oneDown);
    // The second pad is pressed while the first is idle: it takes over.
    const twoDown = pad('standard', [0]);
    expect(active.pick([one, twoDown], b)).toBe(twoDown);
    // Both held: the active one stays.
    expect(active.pick([oneDown, twoDown], b)).toBe(twoDown);
    active.gone(1);
    expect(active.pick([one, null], b)).toBeNull();
  });
});
