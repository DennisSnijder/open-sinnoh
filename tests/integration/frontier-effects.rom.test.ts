/**
 * The Frontier Brains' cut-ins on the real ROM (frontier_brain_encounter_effect.c): the art the importer reads from
 * field_encounteffect.narc for all five, and Palmer's cut-in as sys-tower-palmer meets it, sampled per tick.
 */
import { describe, expect, it } from 'vitest';
import { newGameRecord, type NewGame, type Registries, type Ui2dSheet } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { romSlice } from '../rom.ts';
import { sampleFrontier } from './frontier-effects.ts';

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Frontier Brain cut-ins (OPENSINNOH_NDS_ROM)', () => {
  it('imports each Brain\'s banner in 8 palettes, its mugshot and name, and the shared VS', () => {
    const { pack } = romSlice();
    const effects = (pack.registries.newGame as unknown as NewGame[])[0]!.frontier!.effects!;
    const sheets = new Map((pack.registries.ui2d as unknown as Ui2dSheet[]).map((s) => [s.id, s]));
    const texts = new Map((pack.registries.texts as unknown as { id: Id; text: string }[]).map((t) => [t.id, t.text]));
    const names = Object.fromEntries(Object.entries(effects.brains).map(([f, b]) => [f, texts.get(b.name)]));
    expect(names).toEqual({ tower: 'Palmer', factory: 'Thorton', castle: 'Darach', hall: 'Argenta', arcade: 'Dahlia' });
    for (const b of Object.values(effects.brains)) {
      expect(b.banner).toHaveLength(8);
      expect(new Set(b.banner).size).toBe(8);
      expect(sheets.get(b.banner[0]!)!.cells[0]).toMatchObject({ w: 256 });
      expect(sheets.get(b.mugshot)!.animations?.length).toBeGreaterThan(0);
    }
    expect(sheets.get(effects.vs)!.animations!.length).toBeGreaterThanOrEqual(2);
    expect(effects.nameColors.fg).toMatch(/^#[0-9a-f]{6}$/);
    expect(effects.factoryDoorLights).toHaveLength(5);
  });

  it("Palmer's cut-in: the flashes, the banner, the VS, the mugshot sliding in, then lit with his name, before the battle", async () => {
    const { game, views, bgm, log } = await sampleFrontier('sys-tower-palmer');
    const cut = views.flatMap((v) => (v.brainCutIn ? [v.brainCutIn] : []));
    expect(cut.length).toBeGreaterThan(100);
    expect(cut.length).toBeLessThan(130);
    expect(cut.every((c) => c.facility === 'tower')).toBe(true);
    expect(cut.some((c) => c.band?.y1 === 46 && c.band.y2 === 114)).toBe(true);
    const last = cut.at(-1)!;
    expect(last.mugshot).toMatchObject({ x: 208, y: 80, dark: false });
    expect(last.vs).toHaveLength(4);
    expect(last.name?.text).toBe('Palmer');
    expect(last.roomDark).toBe(true);
    expect(cut.some((c) => c.mugshot?.dark)).toBe(true);
    // Sound_SetSceneAndPlayBGM: the Frontier Brain music from the cut-in on.
    const brainMusic = [...(game.registries as Registries).sequences.values()].find((s) => s.sourceIndex === 1202)!.id;
    const first = views.findIndex((v) => v.brainCutIn);
    expect(bgm[first]).toBe(brainMusic);
    expect(log.report().filter((s) => s.key.startsWith('frontier:brain'))).toEqual([]);
    expect(newGameRecord(game.registries).frontier?.effects).toBeDefined();
  }, 600_000);
});
