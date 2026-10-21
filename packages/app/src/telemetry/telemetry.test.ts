import type { Event } from '@sentry/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Game } from '@opensinnoh/game';
import { gameSecrets } from './game.ts';
import { addContextSource, breadcrumb, captureError, initTelemetry, reportText, reportsSending, resetTelemetryForTests, sendSummary, setReportsEnabled, setSecretsSource, setTag, vmFrame, type AdapterConfig, type Report, type TelemetryAdapter } from './index.ts';
import { MAX_TEXT, scrubEvent, scrubText, scrubUrl } from './scrub.ts';
import { REPORTS_KEY } from './settings.ts';

/** Fake player data and game text: none of it may survive a scrub. */
const PLAYER = 'Zelphyr';
const RIVAL = 'Quorbin';
const NICK = 'Fluffbutt';
const GAME_TEXT = 'Welcome to the world of Pokémon!';
const ROM_FILE = 'Pokemon - Platinum Version (USA).nds';
const SECRETS = [PLAYER, RIVAL, NICK];
const SAVE = JSON.stringify({ state: { names: { player: PLAYER, rival: RIVAL }, party: [{ nickname: NICK }] } });

describe('scrubText', () => {
  it('removes names, quoted game text, file names and paths', () => {
    const cases: [string, string][] = [
      [`player ${PLAYER} met ${RIVAL}`, 'player [name] met [name]'],
      [`message "${GAME_TEXT}" overflows`, 'message "[text]" overflows'],
      [`message “${GAME_TEXT}” and ‘x’ and «y» and \`z\``, 'message "[text]" and "[text]" and "[text]" and "[text]"'],
      [`label '${GAME_TEXT}' failed`, 'label "[text]" failed'],
      [`can't load it`, `can't load it`],
      [`cannot read: ${ROM_FILE}`, 'cannot read: [file]'],
      ['loaded my save 2.json ok', '[file] ok'],
      ['open /Users/me/Downloads/platinum.nds now', 'open [path] now'],
      ['open C:\\Users\\me\\rom.nds now', 'open [path] now'],
      ['at file:///home/me/x.js:1:2', 'at [path]'],
      ['script fixture:a[3] give_mon: no species 7', 'script fixture:a[3] give_mon: no species 7'],
    ];
    for (const [input, out] of cases) expect(scrubText(input, SECRETS), input).toBe(out);
  });

  it('cuts long values and leaves one-letter names', () => {
    const long = scrubText('x'.repeat(5000));
    expect(long.length).toBe(MAX_TEXT);
    expect(long.endsWith('…')).toBe(true);
    expect(scrubText('A pressed', ['A'])).toBe('A pressed');
  });
});

describe('scrubUrl', () => {
  it('keeps only the debug flags', () => {
    expect(scrubUrl('https://opensinnoh.app/?time=12:00&name=Zelphyr&clock=2009-03-22T10:00#save')).toBe('https://opensinnoh.app/?time=12%3A00&clock=2009-03-22T10%3A00');
    expect(scrubUrl('https://opensinnoh.app/assets/index-abc.js?v=1')).toBe('https://opensinnoh.app/assets/index-abc.js');
    expect(scrubUrl('blob:https://opensinnoh.app/1234')).toBe('[path]');
  });
});

describe('scrubEvent', () => {
  it('sends nothing of the player, the ROM, the save or the game text', () => {
    const event: Event = {
      message: `crash after "${GAME_TEXT}"`,
      exception: {
        values: [
          {
            type: 'Error',
            value: `nickname ${NICK} too long in ${ROM_FILE}`,
            stacktrace: { frames: [{ filename: 'https://opensinnoh.app/assets/index.js?x=1', function: 'tick', lineno: 1, colno: 2, vars: { save: SAVE }, context_line: `const name = "${PLAYER}"`, pre_context: [GAME_TEXT] }] },
          },
        ],
      },
      breadcrumbs: [
        { category: 'console', message: `${GAME_TEXT} said ${PLAYER}` },
        { category: 'ui.click', message: `button[aria-label="${RIVAL}"]` },
        { category: 'fetch', data: { url: '/upload?file=rom.nds' } },
        { category: 'app.zone', message: 'fixture:ZONE_A', data: { note: `"${GAME_TEXT}"` } },
      ],
      request: { url: `https://opensinnoh.app/?time=10:00&player=${PLAYER}`, data: SAVE, cookies: { s: '1' }, query_string: `player=${PLAYER}`, headers: { 'User-Agent': 'UA', Referer: `https://x/?n=${PLAYER}` } },
      extra: { save: SAVE, file: ROM_FILE },
      contexts: { app: { zone: 'fixture:ZONE_A', rival: RIVAL } },
      tags: { where: 'loop', who: PLAYER },
      user: { id: 'u', ip_address: '1.2.3.4', username: PLAYER },
      server_name: 'host',
    };
    const out = scrubEvent(event, SECRETS);
    const json = JSON.stringify(out);
    for (const s of [PLAYER, RIVAL, NICK, GAME_TEXT, ROM_FILE, 'rom.nds', '1.2.3.4', 'cookies', 'query_string', 'Referer', 'vars', 'context_line', 'pre_context', 'server_name']) expect(json, s).not.toContain(s);
    expect(out.breadcrumbs!.map((b) => b.category)).toEqual(['app.zone']);
    expect(out.request).toEqual({ url: 'https://opensinnoh.app/?time=10%3A00', headers: { 'User-Agent': 'UA' } });
    expect(out.exception!.values![0]!.stacktrace!.frames![0]).toEqual({ filename: 'https://opensinnoh.app/assets/index.js', function: 'tick', lineno: 1, colno: 2 });
    expect(out.exception!.values![0]!.value).toBe('[file]'); // A file name runs back to the last quote, colon or slash: over-redacted, never leaked.
    expect(out.tags).toEqual({ where: 'loop', who: '[name]' });
    expect(out.user).toBeUndefined();
  });
});

describe('error reports', () => {
  const store = new Map<string, string>();
  let captured: { error: Error; report: Report }[];
  let summaries: { name: string; data: Record<string, unknown>; tags: Record<string, string> }[];
  let configs: AdapterConfig[];
  const loadAdapter = vi.fn(async () => (config: AdapterConfig): TelemetryAdapter => {
    configs.push(config);
    return { capture: (error, report) => captured.push({ error, report }), summary: (name, data, tags) => summaries.push({ name, data, tags }) };
  });
  const start = (dsn: string | undefined) => initTelemetry({ dsn, release: 'abc123', environment: 'preview', loadAdapter });
  const settle = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    resetTelemetryForTests();
    store.clear();
    captured = [];
    summaries = [];
    configs = [];
    loadAdapter.mockClear();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetTelemetryForTests();
  });

  it('sends nothing without a DSN', async () => {
    start(undefined);
    captureError(new Error('boom'), 'loop');
    await settle();
    expect(reportsSending()).toBe(false);
    expect(loadAdapter).not.toHaveBeenCalled();
  });

  it('sends nothing with a DSN before the player answers the setup question', async () => {
    start('https://key@example.invalid/1');
    captureError(new Error('boom'), 'loop');
    await settle();
    expect(reportsSending()).toBe(false);
    expect(loadAdapter).not.toHaveBeenCalled();
  });

  it('with a DSN and the setting on: loads the adapter on the first error and sends each error once', async () => {
    store.set(REPORTS_KEY, 'true');
    start('https://key@example.invalid/1');
    expect(loadAdapter).not.toHaveBeenCalled();
    captureError(new Error('boom'), 'loop', { fatal: true });
    captureError(new Error('boom'), 'loop');
    await settle();
    captureError(new Error('other'), 'audio.worklet');
    expect(loadAdapter).toHaveBeenCalledTimes(1);
    expect(captured.map((c) => [c.error.message, c.report.where, c.report.fatal])).toEqual([
      ['boom', 'loop', true],
      ['other', 'audio.worklet', false],
    ]);
    expect(configs[0]).toMatchObject({ dsn: 'https://key@example.invalid/1', release: 'abc123', environment: 'preview' });
  });

  it('the toggle applies at once, also to queued and in-flight events, and is stored', async () => {
    store.set(REPORTS_KEY, 'true');
    start('https://key@example.invalid/1');
    captureError(new Error('queued'), 'loop');
    expect(setReportsEnabled(false)).toBeNull();
    expect(store.get(REPORTS_KEY)).toBe('false');
    await settle();
    captureError(new Error('off'), 'loop');
    await settle();
    expect(captured).toEqual([]);
    setReportsEnabled(true);
    await settle();
    expect(configs[0]!.enabled()).toBe(true);
    captureError(new Error('on again'), 'loop');
    expect(captured.map((c) => c.error.message)).toEqual(['on again']);
    setReportsEnabled(false);
    // The adapter's beforeSend asks again before an event leaves.
    expect(configs[0]!.enabled()).toBe(false);
  });

  it('the performance summary goes once per page load, only while reports are on', async () => {
    start('https://key@example.invalid/1');
    sendSummary('perf', { frameP95: 5 });
    await settle();
    expect(loadAdapter).not.toHaveBeenCalled();
    setReportsEnabled(true);
    setTag('importer', 'platinum-74');
    sendSummary('perf', { frameP95: 6 });
    sendSummary('perf', { frameP95: 7 });
    await settle();
    expect(summaries).toEqual([{ name: 'perf', data: { frameP95: 6 }, tags: { importer: 'platinum-74' } }]);
  });

  it('a stored "off" holds from the start', async () => {
    store.set(REPORTS_KEY, 'false');
    start('https://key@example.invalid/1');
    captureError(new Error('boom'), 'loop');
    await settle();
    expect(reportsSending()).toBe(false);
    expect(loadAdapter).not.toHaveBeenCalled();
  });

  it('reports carry the context, the VM frame and our breadcrumbs; the copied text is scrubbed', () => {
    vi.stubGlobal('location', { href: `https://opensinnoh.app/?time=10:00&n=${PLAYER}` });
    vi.stubGlobal('navigator', { userAgent: 'TestBrowser/1' });
    start(undefined);
    setSecretsSource(() => SECRETS);
    addContextSource(() => ({ zone: 'fixture:ZONE_A', mode: 'script', speed: 1, behind: false, missing: undefined }));
    breadcrumb('zone', 'fixture:ZONE_A');
    const error = new Error(`script fixture:intro[12] message: text "${GAME_TEXT}" for ${PLAYER}`);
    const report = captureError(error, 'loop', { fatal: true });
    expect(vmFrame(error.message)).toEqual({ script: 'fixture:intro', op: 'message' });
    expect(report.tags).toMatchObject({ where: 'loop', script: 'fixture:intro', op: 'message', mode: 'script' });
    expect(report.context).toEqual({ zone: 'fixture:ZONE_A', mode: 'script', speed: 1, behind: false, script: 'fixture:intro', op: 'message' });
    const text = reportText(error, report);
    for (const s of [PLAYER, GAME_TEXT]) expect(text).not.toContain(s);
    expect(text).toContain('error: Error: script fixture:intro[12] message: text "[text]" for [name]');
    expect(text).toContain('url: https://opensinnoh.app/?time=10%3A00\n');
    expect(text).toContain('app.zone fixture:ZONE_A');
  });
});

describe('gameSecrets', () => {
  it('lists the names, nicknames, OT names and box names', () => {
    const mon = (nickname: string | null, otName: string) => ({ nickname, otName });
    const game = { state: { names: { player: PLAYER, rival: RIVAL }, party: [mon(NICK, PLAYER), mon(null, 'Other')], boxes: [{ name: 'Box Uno', slots: [mon('Boxy', PLAYER), null] }] } } as unknown as Game;
    expect(gameSecrets(game)).toEqual([PLAYER, RIVAL, 'Box Uno', NICK, PLAYER, 'Other', 'Boxy', PLAYER]);
  });
});
