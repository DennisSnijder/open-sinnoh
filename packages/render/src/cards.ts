import * as THREE from 'three';

/**
 * Texture cards: a map prop drawn as one flat quad leaning toward the camera (a parked bicycle, a pot, a
 * telescope), its art cut out by the texture's alpha. On the DS the camera only ever sees a card from about
 * where its artist did, so the art's lowest opaque row may float above the ground and still look grounded:
 * the DS camera's ray through that row meets the ground where the art seems to stand. The wider view, and the
 * camera following the player across it, look at a card from further aside, and the floating row slides over
 * the ground (parallax). `restCards` moves each card along the DS view direction until that row rests on the
 * map geometry: from the DS camera's direction it looks the same, and from any other the art stays put.
 */

/** Lean range of a card: neither a floor decal nor an upright wall plane (posters, doors, windows). */
const MIN_LEAN = Math.sin(10 * THREE.MathUtils.DEG2RAD);
const MAX_LEAN = Math.cos(10 * THREE.MathUtils.DEG2RAD);

const feet = new WeakMap<THREE.Texture, number>();

/** The texture V (glTF: 0 at the top of the image) just below its lowest opaque row. */
function footV(map: THREE.Texture): number {
  let foot = feet.get(map);
  if (foot !== undefined) return foot;
  const image = map.image as ImageBitmap;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let bottom = -1;
  for (let y = canvas.height - 1; y >= 0 && bottom < 0; y--) {
    for (let x = 0; x < canvas.width; x++) {
      if (pixels[(y * canvas.width + x) * 4 + 3]! >= 128) {
        bottom = y;
        break;
      }
    }
  }
  if (bottom < 0) throw new Error(`render: texture card ${map.name} has no opaque pixels`);
  // Use the pixel row's lower edge, not its centre.
  foot = (bottom + 1) / canvas.height;
  feet.set(map, foot);
  return foot;
}

/**
 * The point where a card's art meets what it stands on (the middle of its lowest opaque row), or null when
 * the geometry is not a texture card: one planar quad, leaning, textured, its texture V running down the
 * card within one copy of the image.
 */
export function cardFoot(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Vector3 | null {
  const map = (material as THREE.MeshBasicMaterial).map;
  if (!map || geometry.index) return null;
  const pos = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  if (!uv || pos.count !== 6) return null;
  const a = new THREE.Vector3().fromBufferAttribute(pos, 0);
  const normal = new THREE.Vector3().fromBufferAttribute(pos, 1).sub(a).cross(new THREE.Vector3().fromBufferAttribute(pos, 2).sub(a)).normalize();
  for (let i = 3; i < 6; i += 3) {
    const b = new THREE.Vector3().fromBufferAttribute(pos, i);
    const n = new THREE.Vector3().fromBufferAttribute(pos, i + 1).sub(b).cross(new THREE.Vector3().fromBufferAttribute(pos, i + 2).sub(b)).normalize();
    if (Math.abs(n.dot(normal)) < 0.999 || Math.abs(b.sub(a).dot(normal)) > 1e-3) return null;
  }
  if (Math.abs(normal.y) < MIN_LEAN || Math.abs(normal.y) > MAX_LEAN) return null;
  let vTop = Infinity, vBottom = -Infinity;
  for (let i = 0; i < 6; i++) {
    vTop = Math.min(vTop, uv.getY(i));
    vBottom = Math.max(vBottom, uv.getY(i));
  }
  if (vTop < 0 || vBottom > 1) return null;
  // The middles of the card's top and bottom edges: the corners at the least and greatest V.
  const topEdge = new THREE.Box3(), bottomEdge = new THREE.Box3();
  for (let i = 0; i < 6; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(pos, i);
    if (uv.getY(i) === vTop) topEdge.expandByPoint(p);
    else if (uv.getY(i) === vBottom) bottomEdge.expandByPoint(p);
  }
  if (topEdge.isEmpty() || bottomEdge.isEmpty()) return null;
  const top = topEdge.getCenter(new THREE.Vector3()), bottom = bottomEdge.getCenter(new THREE.Vector3());
  // V must run down the card, or its lowest row is not the art's base.
  if (bottom.y >= top.y) return null;
  return top.lerp(bottom, (footV(map) - vTop) / (vBottom - vTop));
}

/**
 * Moves each card along `direction` (the DS camera's view direction) until its foot meets the nearest of
 * `ground`'s triangles, and returns the feet where they now rest. A card whose foot meets nothing keeps its
 * placement and is returned in `unrested`.
 */
export function restCards(cards: readonly { geometry: THREE.BufferGeometry; foot: THREE.Vector3 }[], ground: readonly THREE.BufferGeometry[], direction: THREE.Vector3): { rested: THREE.Vector3[]; unrested: THREE.Vector3[] } {
  const rested: THREE.Vector3[] = [], unrested: THREE.Vector3[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), hit = new THREE.Vector3();
  for (const card of cards) {
    const ray = new THREE.Ray(card.foot, direction);
    let nearest = Infinity;
    for (const geometry of ground) {
      const pos = geometry.getAttribute('position');
      const count = geometry.index?.count ?? pos.count;
      for (let i = 0; i < count; i += 3) {
        const at = (n: number) => geometry.index?.getX(n) ?? n;
        a.fromBufferAttribute(pos, at(i));
        b.fromBufferAttribute(pos, at(i + 1));
        c.fromBufferAttribute(pos, at(i + 2));
        if (ray.intersectTriangle(a, b, c, false, hit)) nearest = Math.min(nearest, hit.distanceTo(card.foot));
      }
    }
    if (nearest === Infinity) {
      unrested.push(card.foot.clone());
      continue;
    }
    const move = direction.clone().multiplyScalar(nearest);
    card.geometry.translate(move.x, move.y, move.z);
    rested.push(card.foot.clone().add(move));
  }
  return { rested, unrested };
}
