import { describe, expect, it } from 'vitest';
import { ActivePad, gamepadButtons } from './input.ts';
import { bindKey, bindPad, bindingText, Controls, CONTROLS_KEY, defaultBindings, keyLabel, keyMapOf, KEY_MAP, padFace, padKind, padLabel, padTable, parseBindings, type Action, type PadKind } from './controls.ts';

const pad = (mapping: string, down: number[] = [], axes: number[] = [], id?: string) => ({ mapping, ...(id ? { id } : {}), buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i) })), axes });

const XBOX = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)';
const DUALSENSE = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';
const PRO = 'Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)';
/** What a save wrote for every player before layouts: the positional table. */
const POSITIONAL: Record<Action, string> = { up: 'b12', down: 'b13', left: 'b14', right: 'b15', a: 'b1', b: 'b0', x: 'b3', y: 'b2', l: 'b4', r: 'b5', start: 'b9', select: 'b8', fast: 'b7', poketch: 'b6' };

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
    for (const code of ['Escape', 'Backquote', 'ControlLeft', 'MetaRight']) expect(() => bindKey(b, 'a', code)).toThrow(/cannot be bound/);
    expect(b).toEqual(defaultBindings());
  });

  it('pad bindings swap exactly', () => {
    const b = defaultBindings();
    expect(bindPad(b, false, 'xbox', 'a', 'b1')).toEqual({ holder: 'b' });
    expect(b.pad.a).toBe('b1');
    expect(b.pad.b).toBe('b0');
    expect(bindPad(b, true, 'xbox', 'a', 'b13')).toEqual({ holder: null });
    expect(b.raw.a).toBe('b13');
  });

  it('names keys and pad buttons', () => {
    expect(['KeyZ', 'ArrowUp', 'Digit4', 'Numpad2', 'F5', 'ShiftRight'].map(keyLabel)).toEqual(['Z', 'Up', '4', 'Num 2', 'F5', 'Right Shift']);
    expect([padLabel('b1', false), padLabel('b1', true), padLabel('a2-', true), padLabel(null, true)]).toEqual(['Right button', 'Button 1', 'Axis 2 -', 'Unbound']);
    expect(bindingText(defaultBindings(), 'a', false)).toBe('Z, J, Space · Bottom button');
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
    expect(bindings.pad.b).toBe('b0'); // A rejected entry keeps its old default.
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

describe('stored bindings from before layouts', () => {
  const parse = (o: object) => parseBindings(JSON.stringify(o));

  it('the positional table every save wrote is untouched, and no layout is auto', () => {
    const { bindings, problems } = parse({ keys: { a: ['KeyG'] }, pad: POSITIONAL, raw: {}, deadZone: 40 });
    expect(problems).toEqual([]);
    expect(bindings.pad).toEqual(defaultBindings().pad);
    expect(bindings.layout).toBe('auto');
    expect(bindings.keys.a).toEqual(['KeyG']);
    expect(gamepadButtons(pad('standard', [0], [], XBOX), bindings)).toEqual(['a']);
  });

  it('a table saved before the Pokétch had a button is the positional one too', () => {
    const before: Partial<Record<Action, string>> = { ...POSITIONAL };
    delete before.poketch;
    expect(parse({ pad: before }).bindings.pad).toEqual(defaultBindings().pad);
  });

  it('one change from it is a real rebinding, and it is kept', () => {
    const { bindings } = parse({ pad: { ...POSITIONAL, start: 'b8', select: 'b9' } });
    expect(bindings.pad).toEqual({ ...POSITIONAL, start: 'b8', select: 'b9' });
    expect(gamepadButtons(pad('standard', [1], [], XBOX), bindings)).toEqual(['a']);
  });

  it('next to a layout the same table was bound on purpose', () => {
    expect(parse({ pad: POSITIONAL, layout: 'auto' }).bindings.pad).toEqual(POSITIONAL);
  });

  it('what is saved now reads back the same', () => {
    const b = defaultBindings();
    expect(parse(b)).toEqual({ bindings: b, problems: [] });
    b.layout = 'nintendo';
    bindPad(b, false, 'nintendo', 'a', 'b0');
    expect(parse(b)).toEqual({ bindings: b, problems: [] });
  });

  it('a bad layout is rejected', () => {
    for (const layout of ['gamecube', 'AUTO', 1, null]) {
      const { bindings, problems } = parse({ layout });
      expect(bindings.layout).toBe('auto');
      expect(problems).toEqual([`layout is ${JSON.stringify(layout)}`]);
    }
  });
});

describe('layouts', () => {
  const faces = (id: string) => {
    const b = defaultBindings();
    const t = padTable(b, false, padFace(b, id));
    return [t.a, t.b, t.x, t.y];
  };

  it('each kind has its own table, the same but for the face', () => {
    expect(faces(XBOX)).toEqual(['b0', 'b1', 'b2', 'b3']);
    expect(faces(DUALSENSE)).toEqual(['b0', 'b1', 'b2', 'b3']);
    expect(faces('Some pad')).toEqual(['b0', 'b1', 'b2', 'b3']);
    expect(faces(PRO)).toEqual(['b1', 'b0', 'b3', 'b2']);
    const xbox = padTable(defaultBindings(), false, 'xbox');
    expect(padTable(defaultBindings(), false, 'nintendo')).toEqual({ ...xbox, a: 'b1', b: 'b0', x: 'b3', y: 'b2' });
    expect(xbox.start).toBe('b9');
  });

  it('a pad confirms with its printed A, and names it', () => {
    expect(gamepadButtons(pad('standard', [0], [], XBOX))).toEqual(['a']);
    expect(gamepadButtons(pad('standard', [1], [], XBOX))).toEqual(['b']);
    expect(gamepadButtons(pad('standard', [0], [], DUALSENSE))).toEqual(['a']);
    expect(gamepadButtons(pad('standard', [0], [], 'Some pad'))).toEqual(['a']);
    expect(gamepadButtons(pad('standard', [1], [], PRO))).toEqual(['a']);
    expect(gamepadButtons(pad('standard', [0], [], PRO))).toEqual(['b']);
    const name = (kind: PadKind) => bindingText(defaultBindings(), 'a', false, kind);
    expect((['xbox', 'playstation', 'nintendo', 'generic'] as const).map(name)).toEqual(['Z, J, Space · A', 'Z, J, Space · Cross', 'Z, J, Space · A', 'Z, J, Space · Bottom button']);
  });

  it('a pad without a layout confirms with its first button', () => {
    expect(gamepadButtons(pad('', [0]))).toEqual(['a']);
    expect(gamepadButtons(pad('', [0], [], PRO))).toEqual(['b']);
  });

  it('two kinds at once each read their own table', () => {
    const b = defaultBindings();
    expect(gamepadButtons(pad('standard', [0], [], XBOX), b)).toEqual(['a']);
    expect(gamepadButtons(pad('standard', [0], [], PRO), b)).toEqual(['b']);
  });

  it('a forced layout sets the table and the names, also for a pad detected as something else', () => {
    const b = defaultBindings();
    b.layout = 'nintendo';
    expect(padFace(b, XBOX)).toBe('nintendo');
    expect(gamepadButtons(pad('standard', [1], [], XBOX), b)).toEqual(['a']);
    b.layout = 'xbox';
    expect(gamepadButtons(pad('standard', [0], [], PRO), b)).toEqual(['a']);
    b.layout = 'playstation';
    expect(bindingText(b, 'a', false, padFace(b, 'Some pad'))).toBe('Z, J, Space · Cross');
  });

  it('the first binding copies the table in use; from then on it is the one every standard pad reads', () => {
    const xbox = defaultBindings();
    expect(bindPad(xbox, false, 'xbox', 'start', 'b0')).toEqual({ holder: 'a' });
    expect([xbox.pad.start, xbox.pad.a, xbox.pad.b]).toEqual(['b0', 'b9', 'b1']);
    expect(gamepadButtons(pad('standard', [1], [], PRO), xbox)).toEqual(['b']);

    const pro = defaultBindings();
    expect(bindPad(pro, false, 'nintendo', 'start', 'b1')).toEqual({ holder: 'a' });
    expect([pro.pad.start, pro.pad.a, pro.pad.b]).toEqual(['b1', 'b9', 'b0']);

    const forced = defaultBindings();
    forced.layout = 'nintendo';
    bindPad(forced, false, padFace(forced, XBOX), 'l', 'b4');
    expect(forced.pad.a).toBe('b1');
  });

  it('reset is untouched, the layout auto', () => {
    const c = new Controls(null, () => {});
    c.setLayout('nintendo');
    c.edit((b) => bindPad(b, false, 'nintendo', 'a', 'b0'));
    c.reset();
    expect(c.bindings).toEqual(defaultBindings());
  });

  it('a press while binding reports the face of the pad that pressed it', async () => {
    const c = new Controls(null, () => {});
    const got = c.capture(new EventTarget() as unknown as Window, () => [pad('standard', [], [], XBOX), pad('standard', [], [], PRO)]);
    c.pollCapture([pad('standard', [], [], XBOX), pad('standard', [3], [], PRO)]);
    expect(await got).toEqual({ kind: 'pad', token: 'b3', raw: false, face: 'nintendo' });
  });

  it('the pad in use: its face, what it says it is, its confirm button', () => {
    const c = new Controls(null, () => {});
    expect(c.detected).toBeNull();
    c.pad = pad('standard', [], [], DUALSENSE);
    expect([c.face, c.detected, c.confirmLabel]).toEqual(['playstation', 'playstation', 'Cross']);
    c.pad = pad('standard', [], [], PRO);
    expect(c.confirmLabel).toBe('A');
    c.setLayout('xbox');
    expect([c.face, c.detected, c.confirmLabel]).toEqual(['xbox', 'nintendo', 'A']);
    c.pad = pad('', [], [], XBOX);
    expect(c.confirmLabel).toBe('Button 0');
  });
});

describe('gamepads', () => {
  it('a standard pad uses its table and the stick', () => {
    expect(gamepadButtons(pad('standard', [0, 9], [-0.9, 0.2]))).toEqual(['left', 'a', 'start']);
  });

  it('a pad with another mapping runs on a guess until it is bound, then reads raw indices and axes', () => {
    expect(gamepadButtons(pad('', [0, 1], [-1, 0]))).toEqual(['left', 'a', 'b']);
    const b = defaultBindings();
    bindPad(b, true, 'generic', 'a', 'b5');
    expect(b.raw.up).toBe('a1-');
    expect(gamepadButtons(pad('', [5], [-1, 0]), b)).toEqual(['left', 'a']);
    expect(gamepadButtons(pad('', [], [-0.3, 0]), b)).toEqual([]);
  });

  it('the stick is one direction at a time, its dead zone round', () => {
    expect(gamepadButtons(pad('standard', [], [0.8, 0.6]))).toEqual(['right']);
    expect(gamepadButtons(pad('standard', [], [0.6, -0.8]))).toEqual(['up']);
    // Neither axis reaches the dead zone alone; together they do.
    expect(gamepadButtons(pad('standard', [], [0.4, 0.4]))).toEqual(['down']);
    expect(gamepadButtons(pad('standard', [], [0.3, 0.3]))).toEqual([]);
  });

  it('names buttons as the connected pad prints them', () => {
    expect(padKind('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)')).toBe('xbox');
    expect(padKind('054c-09cc-Wireless Controller')).toBe('playstation');
    expect(padKind('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)')).toBe('nintendo');
    expect(padKind('Some pad')).toBe('generic');
    expect(['xbox', 'playstation', 'nintendo', 'generic'].map((k) => padLabel('b1', false, k as PadKind))).toEqual(['B', 'Circle', 'A', 'Right button']);
    expect(padLabel('b12', false, 'xbox')).toBe('D-pad up');
    expect(padLabel('b6', false, 'playstation')).toBe('L2');
    expect(padLabel('b1', true, 'xbox')).toBe('Button 1');
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
