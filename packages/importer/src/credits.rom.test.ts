import { describe, expect, it } from 'vitest';
import type { NewGame, Prop, TextureAnimation, Ui2dSheet } from '@opensinnoh/contracts';
import { ROM, romSlice } from '../../../tests/rom.ts';

describe.skipIf(!ROM)('credits and Hall of Fame presentation resources', () => {
  it('imports the roadside models, native row tables, both riders and the one-shot machine pattern in the slice', () => {
    const { pack } = romSlice();
    const game = pack.registries.newGame![0] as unknown as NewGame;
    expect(game.creditsRide?.models).toHaveLength(7);
    expect(game.creditsRide?.rows.map(rows => rows.map(r => r.count))).toEqual([[14, 14], [14, 0], [16, 14]]);
    expect(game.creditsRide?.nightTrees).toHaveLength(28);
    for (const id of game.creditsRide!.models) expect(pack.registries.models!.some(m => m.id === id)).toBe(true);
    const sheets = pack.registries.ui2d as unknown as Ui2dSheet[];
    for (const gender of ['male', 'female']) {
      const sheet = sheets.find(s => s.id === `platinum:ui2d/credits/${gender}/bike`)!;
      expect(sheet.animations).toHaveLength(3);
      expect(sheet.animations![2]!.mode).toBe('loop');
      expect(sheets.find(s => s.id === `platinum:ui2d/credits/${gender}/bike_eyes_1`)!.cells).toHaveLength(sheet.cells.length);
    }
    expect(sheets.find(s => s.id === 'platinum:ui2d/credits/morning_bottom')!.cells[0]!.w).toBe(512);
    const ball = (pack.registries.props as unknown as Prop[]).find(p => p.id === game.healMachine!.ball)!;
    expect(ball.animations!.flash).toMatchObject({ ticks: 68 });
    expect(ball.animations!.flash!.loop).toBeUndefined();
    const pattern = (pack.registries.textureAnimations as unknown as TextureAnimation[]).find(a => a.id === ball.animations!.flash!.clip)!;
    expect(pattern.kind).toBe('frames');
    if (pattern.kind === 'frames') expect(pattern.frames.reduce((sum, f) => sum + f.ticks, 0)).toBe(68);
    // The Pokémon Center machine's screen (pokecenter_healing_machine_tv): its own 73-frame one-shot.
    const screen = (pack.registries.props as unknown as Prop[]).find(p => p.id === game.healMachine!.screen)!;
    expect(screen.animations!.flash).toMatchObject({ ticks: 73 });
    expect(screen.animations!.flash!.loop).toBeUndefined();
    expect(pack.registries.chunks!.some(c => (c as unknown as { props: { prop: string }[] }).props.some(p => p.prop === screen.id))).toBe(true);
  });
});
