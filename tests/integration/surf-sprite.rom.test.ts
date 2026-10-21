import { describe, expect, it } from 'vitest';
import type { BillboardSprite, NewGame } from '@opensinnoh/contracts';
import { romSlice } from '../rom.ts';

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('the surf avatar sprite (OPENSINNOH_NDS_ROM)', () => {
  it('shows one still frame per facing, standing and moving (BILLBOARD_FRAME_SEQ_SURF, ov5_021EC3F0)', () => {
    const { pack } = romSlice();
    const reg = pack.registries as unknown as { newGame: NewGame[]; sprites: BillboardSprite[] };
    const { male, female } = reg.newGame[0]!.playerSurfSprite;
    for (const id of [male, female]) {
      const sprite = reg.sprites.find((s) => s.id === id)!;
      const still = (['up', 'down', 'left', 'right'] as const).map((dir) => {
        const stand = sprite.animations[`stand-${dir}`]!;
        expect(stand).toHaveLength(1);
        expect(sprite.animations[`walk-${dir}`]).toEqual(stand);
        return stand[0]!.frame;
      });
      expect(new Set(still).size).toBe(4);
    }
  });
});
