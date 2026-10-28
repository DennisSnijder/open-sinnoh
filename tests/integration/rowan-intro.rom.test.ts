/**
 * Rowan's intro on the real ROM (OPENSINNOH_NDS_ROM), headless: the ROM's lines in the DS order, SEQ_OPENING from
 * Rowan's fade-in, Buneary's cry, the closing fade of the music, and the names and gender the new game starts
 * with (a typed player name, the preset rival name Barry).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { AppResult, AudioCommand, InputFrame } from '@opensinnoh/contracts';
import type { Button, Id, PackData } from '@opensinnoh/core';
import { CountingStubLog, createGame } from '@opensinnoh/game';
import { createBattle } from '@opensinnoh/battle';
import { createRowanIntro, plainPages, plainText } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;

describe.skipIf(!romPath)("Rowan's intro (OPENSINNOH_NDS_ROM)", () => {
  let pack: PackData;
  beforeAll(() => {
    ({ pack } = romSlice());
  }, 60_000);

  it('plays the ROM intro and returns the names and gender', () => {
    const log = new CountingStubLog(() => {});
    const game = createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, seed: 1, log, now: () => '2026-01-01T00:00:00.000Z' });
    const sent: AudioCommand[] = [];
    game.audioOutput = { send: (c) => void sent.push(c) };
    const app = createRowanIntro({ registries: game.registries, log, sound: game.sound, textDelay: 1, defaults: { player: 'A', rival: 'B' } });
    const seen: string[] = [];
    let result: AppResult | null = null;
    const step = (pressed: Button[] = [], tap?: string) => {
      const f: InputFrame = { held: pressed, pressed, touch: null, ...(tap ? { tap } : {}) };
      result = app.step(f) ?? result;
      game.sound.tick();
      const v = app.view();
      if (v.app === 'rowan-intro' && v.message && seen.at(-1) !== v.message.text) seen.push(v.message.text);
    };
    /** A on every other tick until a choice, the gender, the keyboard, the ball or the end. */
    const until = (stop: () => boolean) => {
      for (let i = 0; !stop(); i++) {
        if (i > 6000 || result) throw new Error(`stuck: ${JSON.stringify(app.view()).slice(0, 200)}`);
        step(i % 2 ? ['a'] : []);
      }
    };
    const intro = () => {
      const v = app.view();
      return v.app === 'rowan-intro' ? v : null;
    };
    /** The intro's own ROM text (RowanIntro_Text_<name>) as a label shows it. */
    const label = (name: string) => plainText(game.registries.texts.get(`platinum:RowanIntro_Text_${name}` as Id)!.text);
    const rival = label('RivalChoiceBarry');
    until(() => !!intro()?.menu);
    expect(intro()!.menu!.entries).toEqual([label('ChoiceAdventureInfo'), label('ChoiceNoInfo')]);
    step([], 'menu:1');
    // "You have a Poké Ball": its last page printed in full.
    const ballPage = plainPages(game.registries.texts.get('platinum:RowanIntro_Text_HavePokeBall' as Id)!.text).at(-1);
    until(() => intro()?.screen === 'touch' && intro()!.message !== null && !intro()!.message!.waiting && intro()!.message!.text === ballPage);
    for (let i = 0; i < 3; i++) step();
    step([], 'ball');
    until(() => intro()?.gender !== null && intro()?.gender !== undefined);
    step(['a']);
    until(() => !!intro()?.menu);
    step([], 'menu:0');
    until(() => app.view().app === 'naming');
    step();
    step([], 'type:Lucas');
    step([], 'ok');
    until(() => !!intro()?.menu);
    step([], 'menu:0');
    until(() => !!intro()?.menu);
    expect(intro()!.menu!.entries).toEqual(['RivalChoiceNew', 'RivalChoiceBarry', 'RivalChoiceNolan', 'RivalChoiceRoy', 'RivalChoiceGavin'].map(label));
    step([], 'menu:1');
    until(() => !!intro()?.menu);
    step([], 'menu:0');
    until(() => result !== null);
    expect(result).toEqual({ app: 'rowan-intro', names: { player: 'Lucas', rival }, gender: 'male' });
    /** One page of a ROM text by id (split at {clear}), its {var n} filled in. */
    const page = (id: Id, n: number, vars: string[] = []) =>
      game.registries.texts.get(id)!.text.split('{clear}')[n]!.replace(/\{var (\d+)\}/g, (_, i) => vars[Number(i)]!);
    const pages = [page('platinum:RowanIntro_Text_HelloThere', 0), page('platinum:RowanIntro_Text_HelloThere', 1), page('platinum:RowanIntro_Text_MyNameRowan', 0)];
    expect(pages.map((p) => seen.indexOf(p))).toEqual([...pages.map((p) => seen.indexOf(p))].sort((a, b) => a - b));
    for (const p of pages) expect(seen).toContain(p);
    expect(seen).toContain(page('platinum:RowanIntro_Text_ConfirmNameMale', 0, ['Lucas']));
    expect(seen).toContain(page('platinum:RowanIntro_Text_ConfirmRivalName', 0, ['', rival]));
    const starts = sent.flatMap((c) => (c.op === 'start' ? [c.seq] : []));
    expect(starts).toContain('platinum:SEQ_OPENING');
    expect(starts.some((s) => /PV/.test(s) || s.includes('cry'))).toBe(true);
    expect(sent.some((c) => c.op === 'volume' && c.volume === 0)).toBe(true);
  });
});
