/**
 * Writes SPA particle files (the layout `spa.ts` reads) from emitter records and textures: our own bytes
 * for tests of the reader and the particle import, never ROM data.
 */
import type { ParticleEmitter } from '@opensinnoh/contracts';
import { SPA_BLOCKS, SPA_EMITTER_HEADER, SPA_HEADER, SPA_TEXTURE_HEADER } from './spa.ts';

export interface SpaTextureSource {
  /** SPLTextureParam: format (bits 0–3), log2 width − 3 (4–7), log2 height − 3 (8–11), colour 0 transparent (16). */
  param: number;
  texels: Uint8Array;
  palette: Uint8Array;
}

export function writeSpa(emitters: ParticleEmitter[], textures: SpaTextureSource[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let emitterBytes = 0;
  for (const e of emitters) {
    const sizes = Object.entries(SPA_BLOCKS).filter(([name]) => e[name as keyof ParticleEmitter] !== undefined);
    const b = new DataView(new ArrayBuffer(SPA_EMITTER_HEADER + sizes.reduce((n, [, [, size]]) => n + size, 0)));
    let flags = e.flags;
    for (const [, [bit]] of Object.entries(SPA_BLOCKS)) flags &= ~(1 << bit);
    for (const [, [bit]] of sizes) flags |= 1 << bit;
    b.setUint32(0, flags >>> 0, true);
    e.basePos.forEach((v, i) => b.setInt32(4 + i * 4, v, true));
    b.setInt32(0x10, e.count, true);
    b.setInt32(0x14, e.radius, true);
    b.setInt32(0x18, e.length, true);
    e.axis.forEach((v, i) => b.setInt16(0x1c + i * 2, v, true));
    b.setUint16(0x22, e.color, true);
    b.setInt32(0x24, e.velPos, true);
    b.setInt32(0x28, e.velAxis, true);
    b.setInt32(0x2c, e.scale, true);
    b.setInt16(0x30, e.aspect, true);
    b.setUint16(0x32, e.startDelay, true);
    b.setInt16(0x34, e.minRotation, true);
    b.setInt16(0x36, e.maxRotation, true);
    b.setUint16(0x38, e.initAngle, true);
    b.setUint16(0x3c, e.emitterLife, true);
    b.setUint16(0x3e, e.particleLife, true);
    b.setUint32(0x40, e.attenuation[0] | (e.attenuation[1] << 8) | (e.attenuation[2] << 16), true);
    b.setUint32(0x44, (e.interval | (e.alpha << 8) | (e.air << 16) | (e.texture << 24)) >>> 0, true);
    b.setUint32(0x48, (e.loopFrames | (e.dbbScale << 8) | (e.tileS << 24) | (e.tileT << 26) | (e.scaleDir << 28) | (Number(e.faceEmitter) << 31)) >>> 0, true);
    b.setUint32(0x4c, Number(e.flipS) | (Number(e.flipT) << 1), true);
    b.setInt16(0x50, e.polygonX, true);
    b.setInt16(0x52, e.polygonY, true);
    let o = SPA_EMITTER_HEADER;
    for (const [name, [, size]] of sizes) {
      writeBlock(b, e, name as keyof typeof SPA_BLOCKS, o);
      o += size;
    }
    parts.push(new Uint8Array(b.buffer));
    emitterBytes += b.byteLength;
  }
  for (const t of textures) {
    const b = new DataView(new ArrayBuffer(SPA_TEXTURE_HEADER + t.texels.length + t.palette.length));
    b.setUint32(4, t.param >>> 0, true);
    b.setUint32(8, t.texels.length, true);
    b.setUint32(12, SPA_TEXTURE_HEADER + t.texels.length, true);
    b.setUint32(16, t.palette.length, true);
    b.setUint32(28, b.byteLength, true);
    const bytes = new Uint8Array(b.buffer);
    bytes.set(t.texels, SPA_TEXTURE_HEADER);
    bytes.set(t.palette, SPA_TEXTURE_HEADER + t.texels.length);
    parts.push(bytes);
  }
  const out = new Uint8Array(SPA_HEADER + parts.reduce((n, p) => n + p.length, 0));
  const h = new DataView(out.buffer);
  out.set([0x20, 0x41, 0x50, 0x53], 0);
  h.setUint16(8, emitters.length, true);
  h.setUint16(10, textures.length, true);
  h.setUint32(0x18, SPA_HEADER + emitterBytes, true);
  let o = SPA_HEADER;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function writeBlock(b: DataView, e: ParticleEmitter, name: keyof typeof SPA_BLOCKS, o: number): void {
  switch (name) {
    case 'scaleAnim': {
      const s = e.scaleAnim!;
      b.setInt16(o, s.start, true);
      b.setInt16(o + 2, s.mid, true);
      b.setInt16(o + 4, s.end, true);
      b.setUint16(o + 6, s.in | (s.out << 8), true);
      b.setUint16(o + 8, Number(s.loop), true);
      return;
    }
    case 'colorAnim': {
      const c = e.colorAnim!;
      b.setUint16(o, c.start, true);
      b.setUint16(o + 2, c.end, true);
      b.setUint32(o + 4, c.in | (c.peak << 8) | (c.out << 16), true);
      b.setUint16(o + 8, Number(c.randomStart) | (Number(c.loop) << 1) | (Number(c.interpolate) << 2), true);
      return;
    }
    case 'alphaAnim': {
      const a = e.alphaAnim!;
      b.setUint16(o, a.start | (a.mid << 5) | (a.end << 10), true);
      b.setUint16(o + 2, a.random | (Number(a.loop) << 8), true);
      b.setUint16(o + 4, a.in | (a.out << 8), true);
      return;
    }
    case 'texAnim': {
      const t = e.texAnim!;
      t.textures.forEach((v, i) => b.setUint8(o + i, v));
      b.setUint32(o + 8, t.textures.length | (t.step << 8) | (Number(t.randomStart) << 16) | (Number(t.loop) << 17), true);
      return;
    }
    case 'child': {
      const c = e.child!;
      b.setUint16(o, c.flags, true);
      b.setInt16(o + 2, c.randomVel, true);
      b.setInt16(o + 4, c.endScale, true);
      b.setUint16(o + 6, c.life, true);
      b.setUint8(o + 8, c.velRatio);
      b.setUint8(o + 9, c.scaleRatio);
      b.setUint16(o + 10, c.color, true);
      b.setUint32(o + 12, (c.count | (c.delay << 8) | (c.interval << 16) | (c.texture << 24)) >>> 0, true);
      b.setUint32(o + 16, c.tileS | (c.tileT << 2) | (Number(c.flipS) << 4) | (Number(c.flipT) << 5) | (Number(c.faceEmitter) << 6), true);
      return;
    }
    case 'gravity':
      e.gravity!.forEach((v, i) => b.setInt16(o + i * 2, v, true));
      return;
    case 'random':
      e.random!.magnitude.forEach((v, i) => b.setInt16(o + i * 2, v, true));
      b.setUint16(o + 6, e.random!.interval, true);
      return;
    case 'magnet':
      e.magnet!.target.forEach((v, i) => b.setInt32(o + i * 4, v, true));
      b.setInt16(o + 12, e.magnet!.force, true);
      return;
    case 'spin':
      b.setUint16(o, e.spin!.angle, true);
      b.setUint16(o + 2, e.spin!.axis, true);
      return;
    case 'collision':
      b.setInt32(o, e.collision!.y, true);
      b.setInt16(o + 4, e.collision!.elasticity, true);
      b.setUint16(o + 6, e.collision!.type, true);
      return;
    case 'convergence':
      e.convergence!.target.forEach((v, i) => b.setInt32(o + i * 4, v, true));
      b.setInt16(o + 12, e.convergence!.force, true);
      return;
  }
}
