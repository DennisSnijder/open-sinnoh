/**
 * The Jubilife TV gallery (docs/research/tv.md): the dress-up app and the frames' photo viewer on the ROM, and the
 * `sys-tv-gallery` replay twice on seeds 1–3 with the save round trip.
 */
import { describe, expect, it } from 'vitest';
import type { Ui2dSheet } from '@opensinnoh/contracts';
import { createGame, CountingStubLog } from '@opensinnoh/game';
import { createWorld } from '@opensinnoh/world';
import { createScriptRunner } from '@opensinnoh/vm';
import { createBattle } from '@opensinnoh/battle';
import { createApp } from '@opensinnoh/menus';
import { romSlice } from '../rom.ts';
import { poffinReplay } from './poffin-replays.ts';

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Jubilife TV gallery (OPENSINNOH_NDS_ROM)', () => {
  it('imports the gallery photo frame, the dress-up photo background and the touch YES/NO', () => {
    const { pack } = romSlice();
    const sheets = new Map((pack.registries.ui2d as unknown as Ui2dSheet[]).map((s) => [s.id, s]));
    const sheet = (n: string) => sheets.get(`platinum:ui2d/${n}` as Ui2dSheet['id']);
    expect(sheet('contest/gallery_photo_bg')?.cells[0]).toMatchObject({ w: 256, h: 192 });
    expect(sheet('contest/dress_photo_bg')?.cells[0]).toMatchObject({ w: 256, h: 192 });
    expect(sheet('gallery/yes_no')?.cells.map((c) => [c.w, c.h])).toEqual(Array.from({ length: 8 }, () => [48, 32]));
    const game = createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, createApp, seed: 1, log: new CountingStubLog(() => {}), now: () => '2009-03-22T12:00:00Z' });
    expect(game.state.dressUpPhotos).toEqual(Array.from({ length: 11 }, () => null));
  });

  poffinReplay('sys-tv-gallery');
});
