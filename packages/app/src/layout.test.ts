import { describe, expect, it } from 'vitest';
import { RENDER_DPR_CAP, renderPixelRatio } from './layout.ts';

describe('renderPixelRatio (the field 3D resolution cap)', () => {
  it('Auto caps coarse pointers at 2 device px per CSS px', () => {
    expect(RENDER_DPR_CAP).toBe(2);
    expect(renderPixelRatio(3, true, 'auto')).toBe(2);
    expect(renderPixelRatio(2.75, true, 'auto')).toBe(2);
    expect(renderPixelRatio(2, true, 'auto')).toBe(2);
    expect(renderPixelRatio(1.5, true, 'auto')).toBe(1.5);
  });

  it('leaves fine pointers (desktop, a laptop at DPR 3) and Full at the device ratio', () => {
    expect(renderPixelRatio(3, false, 'auto')).toBe(3);
    expect(renderPixelRatio(3, true, 'full')).toBe(3);
    expect(renderPixelRatio(1, true, 'full')).toBe(1);
  });
});
