/**
 * The seal mart, the Ball Capsule editor (selection, placement, CONFIRM/CANCEL, SET/REMOVE/SHIFT) and the capsule
 * rules in the party and the PC, on the fixture pack (its own sticker tables).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLOCK, readPackFolder, type Button, type Id } from '@opensinnoh/core';
import { DEFAULT_DEVICE_OPTIONS, setupPokemon, type AppHost, type AppModel, type AppRequest, type BattleAnimData, type CapsuleEditorView, type GameState, type MartView, type ParticleEmitter, type ParticleSystem, type Registries, type StorageView, type PartyView } from '@opensinnoh/contracts';
import { loadGamePacks, newGameState } from '@opensinnoh/game';
import { capsuleHolder, sealsOwned } from '@opensinnoh/services';
import { createApp } from './index.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const pack = readPackFolder((p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined), 'packs/fixture');
const { registries, loaded } = loadGamePacks([pack]);
const record = [...registries.newGame.values()][0]!;
const id = (s: string) => `fixture:${s}` as Id;

function fresh(): GameState {
  const s = newGameState(record, registries, loaded.order, 1);
  s.party.push(setupPokemon(s, registries, 0, id('SPECIES_MOSSLET'), 12), setupPokemon(s, registries, 1, id('SPECIES_DRIPLING'), 9));
  return s;
}
function open(s: GameState, request: AppRequest, reg: Registries = registries, stub: (key: string, message: string) => void = () => {}): AppModel {
  const host: AppHost = { options: () => ({ ...DEFAULT_DEVICE_OPTIONS }), setOption: () => {}, save: () => {}, fieldMoveCheck: () => 'location', useFieldMove: () => {}, fieldItemCheck: () => null, useFieldItem: () => {}, clock: () => DEFAULT_CLOCK };
  return createApp(request, { registries: reg, state: s, log: { stub }, host });
}
const idle = { held: [] as Button[], pressed: [] as Button[], touch: null };
function press(app: AppModel, ...buttons: Button[]) {
  let result = null;
  for (const b of buttons) {
    result = app.step({ held: [b], pressed: [b], touch: null }) ?? result;
    result = app.step(idle) ?? result;
  }
  return result;
}
/** Holds a direction for `ticks` ticks (the first tick presses it). */
function hold(app: AppModel, b: Button, ticks: number) {
  for (let i = 0; i < ticks; i++) app.step({ held: [b], pressed: i === 0 ? [b] : [], touch: null });
  app.step(idle);
}
const tap = (app: AppModel, t: string) => app.step({ ...idle, tap: t });
/** A stylus stroke: down at the first point, through the rest, up. */
function stroke(app: AppModel, ...points: [number, number][]) {
  for (const [x, y] of points) tap(app, `seal:${x},${y}`);
  tap(app, 'seal-up');
}
const editor = (app: AppModel) => app.view() as CapsuleEditorView;

describe('the seal mart (MART_TYPE_SEAL)', () => {
  it('BUY / SEE YA! only; seals priced from the table, the owned count in "In Bag", money and RECORD_MONEY_SPENT', () => {
    const s = fresh();
    s.money = 1000;
    const app = open(s, { app: 'mart', seals: 2, greeting: null });
    const v = () => app.view() as MartView;
    expect(v()).toMatchObject({ seals: true, menu: ['PURCHASE', 'LEAVE'] });
    press(app, 'a');
    expect(v().rows.map((r) => r.item)).toEqual(['seal:3', 'seal:10', 'seal:17', 'seal:24']);
    expect(v().rows[0]).toMatchObject({ label: 'Sticker 3', right: '40c' });
    expect(v().item).toMatchObject({ name: 'Sticker 3', description: 'A plain sticker, number 2.' });
    press(app, 'a', 'up', 'up');
    expect(v().quantity).toMatchObject({ inBag: 'Carried: 0' });
    press(app, 'a');
    expect(v().yesNo).not.toBeNull();
    press(app, 'a');
    expect(v().message!.text).toBe('The Stickers 3 went into\nthe sticker book.');
    expect(sealsOwned(s.sealCase, 3)).toBe(3);
    expect(s.money).toBe(1000 - 120);
    expect(s.records.counts[35]).toBe(120);
  });

  it('refuses what would pass 99 owned (bank 543 #14) before asking', () => {
    const s = fresh();
    s.money = 100000;
    s.sealCase.counts[2] = 98;
    const app = open(s, { app: 'mart', seals: 2, greeting: null });
    press(app, 'a', 'a', 'up', 'a');
    expect((app.view() as MartView).message!.text).toBe('The sticker book has no room\nfor more of those.');
    expect(s.sealCase.counts[2]).toBe(98);
  });
});

describe('the Ball Capsule editor', () => {
  it('selection: the D-pad moves within the grid, A opens EDIT, SHIFT, QUIT on an empty capsule, B leaves', () => {
    const app = open(fresh(), { app: 'capsule-editor' });
    expect(editor(app)).toMatchObject({ screen: 'select', cursor: 0, message: { text: 'Pick a shell.' } });
    press(app, 'left');
    expect(editor(app).cursor).toBe(11);
    press(app, 'down');
    expect(editor(app).cursor).toBe(11);
    press(app, 'up', 'right');
    expect(editor(app).cursor).toBe(8);
    press(app, 'a');
    expect(editor(app).menu!.entries.map((e) => e.label)).toEqual(['DESIGN', 'SWAP', 'DONE']);
    press(app, 'b');
    expect(press(app, 'b')).toEqual({ app: 'capsule-editor' });
  });

  it('places a seal by stylus inside the circle (no snapping), returns one dropped outside, CONFIRM saves', () => {
    const s = fresh();
    s.sealCase.counts[0] = 2;
    s.sealCase.counts[4] = 1;
    const app = open(s, { app: 'capsule-editor' });
    press(app, 'a', 'a');
    expect(editor(app).screen).toBe('edit');
    expect(editor(app).list).toMatchObject([{ count: '  2' }, { count: '  1' }]);
    stroke(app, [16, 24], [150, 60], [173, 61]);
    expect(editor(app).seals).toEqual([{ cell: 0, x: 173, y: 61, ghost: false }]);
    expect(s.sealCase.counts[0]).toBe(1);
    // Dragged outside the circle it is translucent, and dropped there it goes back to the case.
    tap(app, 'seal:72,24');
    tap(app, 'seal:120,150');
    expect(editor(app).seals[1]).toMatchObject({ ghost: true });
    tap(app, 'seal-up');
    expect(editor(app).seals).toHaveLength(1);
    expect(s.sealCase.counts[4]).toBe(1);
    // A placed seal is picked up within 10 px and moved; nothing is saved before CONFIRM.
    stroke(app, [180, 70], [200, 80]);
    expect(editor(app).seals[0]).toMatchObject({ x: 200, y: 80 });
    expect(s.sealCase.capsules[0]).toEqual([]);
    const score = s.records.score;
    stroke(app, [104, 171]);
    expect(editor(app)).toMatchObject({ screen: 'select', message: { text: 'Shell saved.' } });
    expect(s.sealCase.capsules[0]).toEqual([{ seal: 1, x: 200, y: 80 }]);
    expect(s.records.score).toBeGreaterThan(score);
    for (let i = 0; i < 25; i++) app.step(idle);
    expect(editor(app)).toMatchObject({ message: { text: 'Pick a shell.' } });
    expect(editor(app).capsules[0]!.sealed).toBe(true);
  });

  it('refuses a ninth seal and a seal with none left', () => {
    const s = fresh();
    s.sealCase.counts[0] = 20;
    s.sealCase.counts[1] = 1;
    s.sealCase.capsules[0] = Array.from({ length: 8 }, (_, i) => ({ seal: 1, x: 170 + i * 5, y: 70 }));
    s.sealCase.capsules[1] = [{ seal: 2, x: 190, y: 70 }];
    s.sealCase.counts[1] = 0;
    const app = open(s, { app: 'capsule-editor' });
    press(app, 'a', 'down', 'a');
    stroke(app, [16, 24]);
    expect(editor(app).status).toBe('The shell is full!');
    expect(s.sealCase.counts[0]).toBe(20);
    stroke(app, [104, 171]);
    for (let i = 0; i < 25; i++) app.step(idle);
    press(app, 'right', 'a', 'down', 'a');
    stroke(app, [72, 24]);
    expect(editor(app).status).toBe('None of those left.');
  });

  it('CANCEL after a change asks; YES puts the capsule and every loose count back', () => {
    const s = fresh();
    s.sealCase.counts[0] = 3;
    s.sealCase.capsules[0] = [{ seal: 1, x: 190, y: 70 }];
    const app = open(s, { app: 'capsule-editor' });
    press(app, 'a', 'down', 'a');
    expect(editor(app).screen).toBe('edit');
    stroke(app, [16, 24], [160, 50]);
    stroke(app, [190, 70], [10, 150]);
    expect(s.sealCase.counts[0]).toBe(3);
    stroke(app, [192, 171]);
    expect(editor(app)).toMatchObject({ dim: 10 / 16, message: { text: 'Drop the new design?' }, yesNo: { cursor: 0 } });
    tap(app, 'no');
    expect(editor(app).screen).toBe('edit');
    stroke(app, [192, 171]);
    tap(app, 'yes');
    expect(s.sealCase.counts[0]).toBe(3);
    expect(s.sealCase.capsules[0]).toEqual([{ seal: 1, x: 190, y: 70 }]);
    expect(editor(app).screen).toBe('select');
  });

  it('the keys: the hand picks a list seal, the D-pad moves it a pixel at a time, A drops it', () => {
    const s = fresh();
    s.sealCase.counts[0] = 1;
    const app = open(s, { app: 'capsule-editor' });
    press(app, 'a', 'a');
    press(app, 'up');
    expect(editor(app).hand).toMatchObject({ x: 19, y: 23, grabbing: false });
    press(app, 'a');
    expect(editor(app).hand).toMatchObject({ x: 190, y: 70, grabbing: true });
    hold(app, 'right', 3);
    expect(editor(app).seals[0]).toMatchObject({ x: 193, y: 70 });
    hold(app, 'up', 12);
    expect(editor(app).seals[0]).toMatchObject({ x: 193, y: 70 - 8 - 4 * 2 });
    press(app, 'a');
    expect(editor(app).hand!.grabbing).toBe(false);
    press(app, 'start');
    expect(s.sealCase.capsules[0]).toEqual([{ seal: 1, x: 193, y: 54 }]);
  });

  it('Test: the ball opens, the seals play and the Pokémon comes out; held 30 frames, taken back; the capsule on screen, nothing saved', () => {
    // The fixture has no particle data: one small `ball_particle.narc` system per seal and the recall's (member 36), and
    // the battler type positions, all at the origin.
    const emitter: ParticleEmitter = { flags: 1 << 14, basePos: [0, 0, 0], count: 4096, radius: 0, length: 0, axis: [0, 4096, 0], color: 0x7fff, velPos: 0, velAxis: 0, scale: 4096, aspect: 4096, startDelay: 0, minRotation: 0, maxRotation: 0, initAngle: 0, emitterLife: 4, particleLife: 6, attenuation: [0, 0, 0], interval: 1, alpha: 31, air: 255, texture: 0, loopFrames: 0, dbbScale: 0, tileS: 0, tileT: 0, scaleDir: 0, faceEmitter: false, flipS: false, flipT: false, polygonX: 0, polygonY: 0 };
    const system = (n: number): ParticleSystem => ({ id: id(`ball_particles/${n}`), sourceIndex: n, archive: 'ball', textures: id('ui2d/p'), textureParams: [0], emitters: [emitter, emitter] });
    const data: BattleAnimData = { id: id('battle_anim'), positions: Array.from({ length: 8 }, () => [[[0, 0, 0], [0, 0, 0]]]), axes: [], backgrounds: [], statChange: [] };
    const reg: Registries = { ...registries, particleSystems: new Map([36, 37, 38].map((n) => [id(`ball_particles/${n}`), system(n)])), battleAnimData: new Map([[data.id, data]]) };
    const s = fresh();
    s.sealCase.counts[0] = 1;
    s.sealCase.counts[1] = 1;
    const sounds: string[] = [];
    const app = open(s, { app: 'capsule-editor' }, reg, (key, message) => key === 'audio:sequence-missing' && sounds.push(message));
    press(app, 'a', 'a');
    stroke(app, [16, 24], [190, 70]);
    stroke(app, [72, 24], [240, 70]);
    const counts = [...s.sealCase.counts];
    const run = () => {
      sounds.length = 0;
      stroke(app, [32, 171]);
      const frames: CapsuleEditorView[] = [editor(app)];
      while (frames.length < 1000 && (editor(app).screen !== 'edit' || editor(app).message)) {
        app.step(idle);
        frames.push(editor(app));
      }
      return frames;
    };
    const frames = run();
    expect(frames[0]).toMatchObject({ screen: 'edit', message: { text: expect.any(String) }, test: null });
    // The editor dims first (10/16, two steps a frame), then the top screen shows the throw.
    const top = frames.filter((f) => f.screen === 'test');
    expect(frames.slice(0, 6).map((f) => f.dim * 16)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(top[0]).toMatchObject({ dim: 0, seals: [], test: { species: id('SPECIES_MOSSLET'), sprite: null, ball: { x: 192, y: 86, anim: 0 } } });
    // The ball opens: the Pokémon at scale 0 and SEQ_SE_DP_CUSTOM05, then 0x20 a frame up to full size.
    const out = top.findIndex((f) => f.test!.sprite);
    expect(top.slice(out, out + 9).map((f) => f.test!.sprite!.scale * 8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(top[out]!.test!.ball).toMatchObject({ anim: 1 });
    expect(sounds.filter((m) => m.includes('1734'))).toHaveLength(1);
    // The seals' particles (the centre seal's at once, the outer one's after the fixture's delay for its distance).
    expect(top.some((f) => f.test!.particles.length > 0)).toBe(true);
    // Then the ball takes it back: the opening frames held, the sprite shrinking, and the editor undims.
    const back = top.findIndex((f, i) => i > out && f.test!.ball !== null && f.test!.ball.frame !== null);
    expect(back).toBeGreaterThan(out + 30);
    expect(top[top.length - 1]!.test!.sprite).toMatchObject({ scale: 0 });
    expect(frames.slice(-7, -1).map((f) => f.dim * 16)).toEqual([10, 8, 6, 4, 2, 0]);
    expect(frames).toHaveLength(125);
    // Nothing saved: the capsule, the counts and the party as they were; the editor goes on with the seals on screen.
    expect(s.sealCase.capsules[0]).toEqual([]);
    expect(s.sealCase.counts).toEqual(counts);
    expect(s.party[0]!.capsule).toBeUndefined();
    expect(editor(app)).toMatchObject({ screen: 'edit', dim: 0, seals: [{ x: 190, y: 70 }, { x: 240, y: 70 }] });
    // THROW_WAIT_AFTER_ANIMS_END's counter is never reset while the app runs: a second Test does not hold.
    expect(run()).toHaveLength(125 - 29);
  });

  it('SET puts the capsule on a party Pokémon (one each), REMOVE takes it off, SHIFT swaps and the holder follows', () => {
    const s = fresh();
    s.sealCase.capsules[0] = [{ seal: 1, x: 190, y: 70 }];
    s.sealCase.capsules[1] = [{ seal: 2, x: 180, y: 60 }];
    const app = open(s, { app: 'capsule-editor' });
    press(app, 'a');
    expect(editor(app).menu!.entries.map((e) => e.label)).toEqual(['FIT', 'DESIGN', 'SWAP', 'DONE']);
    press(app, 'a');
    const party = () => app.view() as PartyView;
    expect(party()).toMatchObject({ app: 'party', mode: 'ball-seal' });
    press(app, 'a');
    expect(party().menu!.entries.map((e) => e.label)).toEqual(['FIT', expect.any(String)]);
    press(app, 'a');
    expect(party().message!.text).toBe('The shell is fitted.');
    expect(party().slots[0]!.capsule).toBe(true);
    press(app, 'a');
    expect(editor(app).screen).toBe('select');
    expect(editor(app).capsules.slice(0, 2)).toMatchObject([{ holder: { species: id('SPECIES_MOSSLET') } }, { holder: null }]);
    expect(s.party[0]!.capsule).toEqual({ id: 1, seals: [{ seal: 1, x: 190, y: 70 }] });
    // A second capsule on the same Pokémon is refused.
    press(app, 'right', 'a', 'a', 'a', 'a');
    expect(party().message!.text).toBe('One shell per companion.');
    press(app, 'a');
    expect(capsuleHolder(s.party, 1)).toBe(-1);
    // SHIFT capsule 1 with capsule 0: the holder's id follows its capsule.
    press(app, 'a', 'down', 'down', 'a', 'left', 'a');
    expect(editor(app).message!.text).toBe('Swapped.');
    press(app, 'a');
    expect(s.party[0]!.capsule!.id).toBe(2);
    expect(s.sealCase.capsules[1]![0]!.seal).toBe(1);
    // REMOVE on capsule 1 (the cursor stayed there).
    press(app, 'a');
    expect(editor(app).menu!.entries[0]!.label).toBe('TAKE OFF');
    press(app, 'a');
    expect(editor(app).message!.text).toBe('The shell came off.');
    expect(s.party[0]!.capsule).toBeUndefined();
  });
});

describe('capsule rules elsewhere', () => {
  it('the PC refuses to store a Pokémon with a capsule; a trade and the Day-Care STORE ask to detach it', () => {
    const s = fresh();
    s.party[1]!.capsule = { id: 1, seals: [{ seal: 1, x: 190, y: 70 }] };
    const pc = open(s, { app: 'storage', mode: 'deposit' });
    press(pc, 'down', 'a', 'a');
    expect((pc.view() as StorageView).message?.text).toBe('Take the shell off first.');

    const trade = open(s, { app: 'party', mode: 'trade' });
    press(trade, 'right', 'a');
    expect((trade.view() as PartyView).message!.text).toBe('The shell comes off first.\nIs that fine?');
    tap(trade, 'no');
    expect(s.party[1]!.capsule).toBeDefined();
    press(trade, 'a');
    expect(tap(trade, 'yes')).toEqual({ app: 'party', slot: 1 });
    expect(s.party[1]!.capsule).toBeUndefined();

    s.party[0]!.capsule = { id: 2, seals: [{ seal: 1, x: 190, y: 70 }] };
    const daycare = open(s, { app: 'daycare-select' });
    press(daycare, 'a', 'a');
    expect(tap(daycare, 'yes')).toEqual({ app: 'daycare-select', slot: 0 });
    expect(s.party[0]!.capsule).toBeUndefined();
  });
});
