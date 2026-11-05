/**
 * A canvas that is cleared only when something is on it. Clearing an empty canvas still hands the compositor a new
 * frame of it. The drawers of a layer that is mostly empty do not need to say whether they drew: every call that puts
 * pixels on the canvas is seen here, so a new drawer cannot leave anything behind.
 */
const WRITES = ['fillRect', 'strokeRect', 'fill', 'stroke', 'fillText', 'strokeText', 'drawImage', 'putImageData'] as const;

export function clearsWhenWritten(ctx: CanvasRenderingContext2D): () => void {
  let written = false;
  const own = ctx as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of WRITES) {
    const write = own[name]!;
    own[name] = (...args) => {
      written = true;
      return write.apply(ctx, args);
    };
  }
  return () => {
    if (!written) return;
    written = false;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  };
}
