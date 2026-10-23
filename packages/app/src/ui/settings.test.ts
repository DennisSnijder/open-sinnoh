import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_OPTIONS, DEVICE_OPTION_COUNTS, type DeviceOptions, type OptionsView } from '@opensinnoh/contracts';
import type { RenderScale } from '../layout.ts';
import type { Visuals } from '../visuals.ts';
import type { Zoom } from '../zoom.ts';
import { DEFAULT_OPTIONS, OPENSINNOH_OPTIONS, playerDefaults } from './options.ts';
import { allSettings, pages, SECTIONS, SETTINGS, stepSetting, type DataActions, type SettingsEnv } from './settings.ts';

/** An env over a fake OPTIONS view (rows in the app's order) and in-memory app settings; taps and data calls are recorded. */
function fakeEnv(opts: { app?: boolean; where?: 'title' | 'game'; rom?: boolean } = {}) {
  const { app: withApp = true, where = 'game', rom = true } = opts;
  const keys = Object.keys(DEVICE_OPTION_COUNTS) as (keyof DeviceOptions)[];
  const view: OptionsView = {
    app: 'options',
    title: 'OPTIONS',
    rows: keys.map((key) => ({ key, label: key.toUpperCase(), values: Array.from({ length: DEVICE_OPTION_COUNTS[key] }, (_, i) => (key === 'battleScene' ? ['ON', 'OFF'][i]! : `${key}${i}`)), value: DEFAULT_DEVICE_OPTIONS[key], description: `${key} help` })),
    close: 'CLOSE',
    closeDescription: 'close help',
    description: '',
    cursor: 0,
  };
  const taps: string[] = [];
  const calls: string[] = [];
  const app = { audio: { volume: 80, muted: false }, zoom: 'auto' as Zoom, renderScale: 'auto' as RenderScale, visuals: { style: 'ds', angledCamera: false } as Visuals, speed: 2, reports: true, addon: 'HeartGold (US, rev 0)' as string | null, phone: { size: 1, opacity: 100, haptics: true, keepAwake: true } };
  const mods = [{ id: 'demo', name: 'Demo', on: false }];
  const data: DataActions = {
    exportSave: async () => (calls.push('export'), 'Exported.'),
    importSave: async () => (calls.push('import'), 'Loaded.'),
    rom: rom
      ? {
          get addon() {
            return app.addon;
          },
          storage: { line: () => 'The browser keeps your game.\n10 MB used.', keep: async () => (calls.push('keep'), 'Done.') },
          reimport: async () => (calls.push('reimport'), ''),
          addAddon: async () => (calls.push('addAddon'), ''),
          removeAddon: async () => (calls.push('removeAddon'), ''),
          remove: async () => (calls.push('remove'), ''),
        }
      : null,
    mods: { list: () => mods, set: async (id, on) => (calls.push(`mod ${id} ${on}`), 'ok') },
  };
  const env: SettingsEnv = {
    where,
    view,
    tap: (id) => taps.push(id),
    ask: async () => true,
    audio: withApp ? { get: () => ({ volume: app.audio.volume, muted: app.audio.muted }), set: (s) => (app.audio = s) } : null,
    zoom: withApp ? { get: () => app.zoom, choices: () => ['auto', 3, 4, 5], set: (z) => (app.zoom = z) } : null,
    renderScale: withApp ? { get: () => app.renderScale, set: (s) => (app.renderScale = s) } : null,
    visuals: withApp ? { get: () => app.visuals, set: (v) => (app.visuals = v), phone: true } : null,
    speed: withApp ? { get: () => app.speed, choices: () => [2, 3, 4, 8], set: (n) => (app.speed = n) } : null,
    data,
    reports: withApp ? { get: () => app.reports, set: (on) => (app.reports = on) } : null,
    phone: withApp ? { get: () => app.phone, set: (p) => (app.phone = p), touch: true, haptics: true, wakeLock: true } : null,
    install: null,
    update: null,
  };
  return { env, taps, calls, app, view };
}

const byId = (id: string) => allSettings(fakeEnv().env).find((s) => s.id === id)!;

describe('the settings registry', () => {
  it('has unique ids, a known section each, and every DS option once', () => {
    const ids = allSettings(fakeEnv().env).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SETTINGS) expect(SECTIONS.map((x) => x.id)).toContain(s.section);
    for (const key of Object.keys(DEVICE_OPTION_COUNTS)) expect(ids).toContain(key);
    // GAME is the DS's six options in its order, then the QoL additions that change what the game offers.
    expect(SETTINGS.filter((s) => s.section === 'game').map((s) => s.id)).toEqual(['textSpeed', 'sound', 'battleScene', 'battleStyle', 'buttonMode', 'frame', 'repelPrompt', 'followerTalk', 'statView', 'summaryRename', 'dexNameSearch', 'spiritombVendors', 'introSkip']);
  });

  it('keeps where each setting is stored', () => {
    const storage = Object.fromEntries(SETTINGS.map((s) => [s.id, s.storage]));
    expect(storage).toEqual({
      textSpeed: 'device', sound: 'save', battleScene: 'save', battleStyle: 'save', buttonMode: 'save', frame: 'save',
      introSkip: 'device', suspend: 'device', repelPrompt: 'device', followerTalk: 'device', statView: 'device', summaryRename: 'device', dexNameSearch: 'device', spiritombVendors: 'device', character: 'device', autoRun: 'device', itemWheel: 'device',
      zoom: 'device', renderScale: 'device', visualStyle: 'device', angledCamera: 'device', speed: 'device', followers: 'device', followerStyle: 'device', autoLowercase: 'device', volume: 'device', mute: 'device', tradeEvolution: 'device', theme: 'device', uiFrame: 'device', reduceFlashing: 'device',
      controlSize: 'device', controlOpacity: 'device', haptics: 'device', keepAwake: 'device',
      ...Object.fromEntries(['up', 'down', 'left', 'right', 'a', 'b', 'x', 'y', 'l', 'r', 'start', 'select', 'fast'].map((a) => [`bind/${a}`, 'device'])), deadZone: 'device', resetControls: 'none',
      exportSave: 'none', importSave: 'none', install: 'none', update: 'none', storage: 'none', reimport: 'none', addon: 'none', deleteRom: 'none',
      reports: 'device',
    });
  });

  it('pages: the four sections in order; DEVICE is the one list longer than the DS window', () => {
    const { env } = fakeEnv();
    const p = pages(env);
    expect(p.map((x) => x.section.id)).toEqual(['game', 'device', 'controls', 'data', 'privacy']);
    expect(p.map((x) => x.settings.map((s) => s.id))).toEqual([
      ['textSpeed', 'sound', 'battleScene', 'battleStyle', 'buttonMode', 'frame', 'repelPrompt', 'followerTalk', 'statView', 'summaryRename', 'dexNameSearch', 'spiritombVendors', 'introSkip'],
      ['zoom', 'renderScale', 'speed', 'followers', 'followerStyle', 'character', 'autoLowercase', 'volume', 'mute', 'tradeEvolution', 'theme', 'uiFrame', 'reduceFlashing', 'visualStyle', 'angledCamera', 'controlSize', 'controlOpacity', 'haptics', 'keepAwake'],
      ['autoRun', 'itemWheel', ...['up', 'down', 'left', 'right', 'a', 'b', 'x', 'y', 'l', 'r', 'start', 'select', 'fast'].map((a) => `bind/${a}`), 'deadZone', 'resetControls'],
      ['exportSave', 'importSave', 'suspend', 'storage', 'reimport', 'addon', 'deleteRom', 'mod/demo'],
      ['reports'],
    ]);
    // Without the app's hooks and the imported ROM only what does not need them is left, and the sections stay.
    expect(pages(fakeEnv({ app: false, rom: false }).env).map((x) => [x.section.id, x.settings.map((s) => s.id)])).toEqual([
      ['game', ['textSpeed', 'sound', 'battleScene', 'battleStyle', 'buttonMode', 'frame', 'repelPrompt', 'followerTalk', 'statView', 'summaryRename', 'dexNameSearch', 'spiritombVendors', 'introSkip']],
      ['device', ['followers', 'followerStyle', 'character', 'autoLowercase', 'tradeEvolution', 'theme', 'uiFrame', 'reduceFlashing']],
      ['controls', ['autoRun', 'itemWheel', ...['up', 'down', 'left', 'right', 'a', 'b', 'x', 'y', 'l', 'r', 'start', 'select', 'fast'].map((a) => `bind/${a}`), 'deadZone', 'resetControls']],
      ['data', ['exportSave', 'importSave', 'suspend', 'mod/demo']],
    ]);
  });

  it('DS options read the app view and change through its taps (relative steps)', () => {
    const { env, taps } = fakeEnv();
    const frame = byId('frame');
    expect([frame.label(env), frame.description(env), frame.get(env), frame.values(env).length]).toEqual(['FRAME', 'frame help', 0, 20]);
    frame.set(env, 7);
    stepSetting(env, frame, -1);
    stepSetting(env, byId('textSpeed'), 1);
    expect(taps).toEqual(['value:5:7', 'step:5:-1', 'step:0:1']);
  });

  it('Auto lowercase is a device row in DEVICE, taps a DS-model value, and defaults on for players only', () => {
    const { env, taps } = fakeEnv();
    const row = byId('autoLowercase');
    expect([row.section, row.storage, row.kind]).toEqual(['device', 'device', 'choice']);
    expect(row.label(env)).toBe('AUTOLOWERCASE');
    expect(row.values(env)).toHaveLength(2);
    stepSetting(env, row, 1);
    expect(taps.at(-1)).toMatch(/^step:\d+:1$/);
    // The app's stored default is on (0); the contract default, which replays and tests run, is off (1).
    expect([DEFAULT_OPTIONS.autoLowercase, DEFAULT_DEVICE_OPTIONS.autoLowercase]).toEqual([0, 1]);
  });

  it('the quality-of-life rows: DS-model device rows in their sections; contract default the DS, a separate player default', () => {
    const { env } = fakeEnv();
    const where = Object.fromEntries(['repelPrompt', 'followerTalk', 'statView', 'summaryRename', 'dexNameSearch', 'character', 'autoRun', 'itemWheel'].map((id) => [id, [byId(id).section, byId(id).storage]]));
    expect(where).toEqual({
      repelPrompt: ['game', 'device'], followerTalk: ['game', 'device'], statView: ['game', 'device'], summaryRename: ['game', 'device'], dexNameSearch: ['game', 'device'],
      character: ['device', 'device'], autoRun: ['controls', 'device'], itemWheel: ['controls', 'device'],
    });
    expect(byId('repelPrompt').disabled?.(env)).toBeNull();
    // On for players: the repeat-Repel prompt, the item wheel, follower talk, the name search; auto-run on touch screens. Off: EV/IV, RENAME, the HGSS look.
    const on = (o: typeof DEFAULT_OPTIONS) => Object.entries(o).filter(([k, v]) => (OPENSINNOH_OPTIONS as readonly string[]).includes(k) && k !== 'character' && v === 0).map(([k]) => k);
    expect(on(DEFAULT_OPTIONS)).toEqual(['autoLowercase', 'repelPrompt', 'itemWheel', 'followerTalk', 'dexNameSearch']);
    expect(on(playerDefaults(true))).toEqual(['autoLowercase', 'autoRun', 'repelPrompt', 'itemWheel', 'followerTalk', 'dexNameSearch']);
    expect([DEFAULT_OPTIONS.character, DEFAULT_OPTIONS.statView, DEFAULT_OPTIONS.summaryRename]).toEqual([0, 1, 1]);
    for (const key of OPENSINNOH_OPTIONS) expect(DEFAULT_DEVICE_OPTIONS[key], key).toBe(key === 'character' ? 0 : 1);
  });

  it('app settings apply at once: slider stops at its ends, choices and toggles wrap', () => {
    const { env, app } = fakeEnv();
    const volume = byId('volume');
    stepSetting(env, volume, 1);
    stepSetting(env, volume, 1);
    stepSetting(env, volume, 1);
    expect(app.audio.volume).toBe(100);
    volume.set(env, 0);
    stepSetting(env, volume, -1);
    expect(app.audio.volume).toBe(0);
    const mute = byId('mute');
    expect(mute.values(env)).toEqual(['ON', 'OFF']);
    expect(mute.get(env)).toBe(1);
    stepSetting(env, mute, 1);
    expect(app.audio.muted).toBe(true);
    const zoom = byId('zoom');
    expect(zoom.values(env)).toEqual(['AUTO', '3x', '4x', '5x']);
    stepSetting(env, zoom, -1);
    expect(app.zoom).toBe(5);
    // A stored scale this window cannot show is listed as it is.
    app.zoom = 9;
    expect(zoom.values(env)).toEqual(['AUTO', '3x', '4x', '5x', '9x']);
    expect(zoom.get(env)).toBe(4);
    const speed = byId('speed');
    stepSetting(env, speed, -1);
    expect(app.speed).toBe(8);
    const reports = byId('reports');
    stepSetting(env, reports, 1);
    expect(app.reports).toBe(false);
    expect(reports.get(env)).toBe(1);
  });

  it('every description fits the message window: at most two lines', () => {
    const { env } = fakeEnv();
    for (const where of ['game', 'title'] as const) {
      for (const s of allSettings({ ...env, where })) {
        expect(s.description(env).split('\n').length, s.id).toBeLessThanOrEqual(2);
        expect((s.disabled?.({ ...env, where }) ?? '').split('\n').length, s.id).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('the title and the game share the screen', () => {
  it('the title lists every setting; what is kept in the save, and the mods, are muted there with a reason', () => {
    const game = fakeEnv({ where: 'game' }).env;
    const title = fakeEnv({ where: 'title' }).env;
    expect(pages(title).map((p) => p.settings.map((s) => s.id))).toEqual(pages(game).map((p) => p.settings.map((s) => s.id)));
    const off = (env: SettingsEnv) => allSettings(env).filter((s) => s.disabled?.(env)).map((s) => s.id);
    expect(off(game)).toEqual([]);
    expect(off(title)).toEqual(['sound', 'battleScene', 'battleStyle', 'buttonMode', 'frame', 'mod/demo']);
    // A muted setting does not step.
    const { env, taps } = fakeEnv({ where: 'title' });
    stepSetting(env, byId('frame'), 1);
    stepSetting(env, byId('textSpeed'), 1);
    expect(taps).toEqual(['step:0:1']);
  });
});

describe('the data actions', () => {
  it('each row runs its action; the add-on row adds or removes by what is imported', async () => {
    const { env, calls, app } = fakeEnv();
    for (const id of ['exportSave', 'importSave', 'reimport', 'deleteRom']) await byId(id).run!(env);
    expect(calls).toEqual(['export', 'import', 'reimport', 'remove']);
    const addon = byId('addon');
    expect(addon.values(env)).toEqual(['REMOVE']);
    expect(addon.description(env)).toContain('HeartGold');
    await addon.run!(env);
    app.addon = null;
    expect(addon.values(env)).toEqual(['ADD']);
    await addon.run!(env);
    expect(calls.slice(4)).toEqual(['removeAddon', 'addAddon']);
  });

  it('the destructive ones ask first; a mod flips by what is on', async () => {
    const { env, calls, app } = fakeEnv();
    expect(byId('deleteRom').confirm!(env)).toMatch(/Delete the imported game data/);
    expect(byId('addon').confirm!(env)).toMatch(/Remove the HeartGold/);
    app.addon = null;
    expect(byId('addon').confirm!(env)).toBeNull();
    expect(byId('exportSave').confirm).toBeUndefined();
    const mod = byId('mod/demo');
    expect(mod.confirm!(env)).toMatch(/restarts/);
    expect(mod.values(env)).toEqual(['OFF']);
    await mod.run!(env);
    expect(calls).toEqual(['mod demo true']);
  });

  it('an action only runs on A: stepping does nothing', () => {
    const { env, calls } = fakeEnv();
    stepSetting(env, byId('exportSave'), 1);
    expect(calls).toEqual([]);
  });
});

describe('the visual style', () => {
  it('is the DS look by default, and Cinematic on a phone says it is heavier', () => {
    const { env, app } = fakeEnv();
    const style = allSettings(env).find((s) => s.id === 'visualStyle')!;
    const camera = allSettings(env).find((s) => s.id === 'angledCamera')!;
    expect(style.values(env)[style.get(env)]).toBe('DS');
    expect(camera.get(env)).toBe(1);
    style.set(env, 2);
    camera.set(env, 0);
    expect(app.visuals).toEqual({ style: 'cinematic', angledCamera: true });
    expect(style.description(env)).toMatch(/Heavier/);
  });
});
