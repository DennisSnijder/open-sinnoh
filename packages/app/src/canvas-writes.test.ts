import { describe, expect, it, vi } from 'vitest';
import { clearsWhenWritten } from './canvas-writes.ts';

const fakeContext = () => {
  const ctx = { canvas: { width: 8, height: 4 }, clearRect: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(), fill: vi.fn(), stroke: vi.fn(), fillText: vi.fn(), strokeText: vi.fn(), drawImage: vi.fn(), putImageData: vi.fn(), save: vi.fn() };
  return ctx;
};

describe('clearsWhenWritten', () => {
  it('leaves an empty canvas alone', () => {
    const ctx = fakeContext();
    const clear = clearsWhenWritten(ctx as unknown as CanvasRenderingContext2D);
    clear();
    (ctx as unknown as CanvasRenderingContext2D).save();
    clear();
    expect(ctx.clearRect).not.toHaveBeenCalled();
  });

  it.each(['fillRect', 'strokeRect', 'fill', 'stroke', 'fillText', 'strokeText', 'drawImage', 'putImageData'] as const)('clears once after %s, which still draws', (name) => {
    const ctx = fakeContext();
    const draw = ctx[name];
    const clear = clearsWhenWritten(ctx as unknown as CanvasRenderingContext2D);
    (ctx[name] as unknown as (...a: number[]) => void)(1, 2);
    expect(draw).toHaveBeenCalledWith(1, 2);
    clear();
    clear();
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 8, 4);
  });
});
