import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
vi.stubGlobal('localStorage', storage);

const load = async () => {
  vi.resetModules();
  return import('./menu-style.ts');
};

describe('the menu style', () => {
  beforeEach(() => store.clear());

  it('is Original until chosen, and an unknown value is Original', async () => {
    const m = await load();
    expect(m.readMenuStyle()).toBe('original');
    expect(m.menuStyleChosen()).toBe(false);
    store.set(m.MENU_STYLE_KEY, 'neon');
    expect((await load()).readMenuStyle()).toBe('original');
  });

  it('stores the choice under its key', async () => {
    const m = await load();
    expect(m.storeMenuStyle('modern')).toBeNull();
    expect(store.get('lantern-nds:menu-style')).toBe('modern');
    expect(m.menuStyleChosen()).toBe(true);
    expect((await load()).readMenuStyle()).toBe('modern');
  });

  it('keeps the choice for the visit when storage refuses', async () => {
    const m = await load();
    const write = storage.setItem;
    storage.setItem = () => {
      throw new Error('quota');
    };
    expect(m.storeMenuStyle('modern')).toBe('quota');
    expect(m.readMenuStyle()).toBe('modern');
    storage.setItem = write;
  });
});
