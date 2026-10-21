import { expect, test } from '@playwright/test';

test('an original padded texture card rests its art on the ground along the view direction', async ({ page }) => {
  await page.goto('/?packs=fixture&replay');
  const result = await page.evaluate(async () => {
    const THREE = await new Function('return import("/__test/three.js")')() as typeof import('three');
    const { cardFoot, restCards } = await new Function('return import("/__test/cards.js")')() as typeof import('../../packages/render/src/cards.ts');
    // An 8×8 image, opaque in rows 1–5: the art's base is 6/8 down, with transparent padding below it.
    const pixels = new Uint8ClampedArray(8 * 8 * 4);
    for (let y = 1; y <= 5; y++) for (let x = 2; x <= 6; x++) pixels[(y * 8 + x) * 4 + 3] = 255;
    const image = await createImageBitmap(new ImageData(pixels, 8, 8));
    const material = new THREE.MeshBasicMaterial({ map: new THREE.Texture(image) });
    const quad = (corners: number[][]) => {
      const [a, b, c, d] = corners;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([...a!, ...b!, ...c!, ...a!, ...c!, ...d!], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0], 2));
      return g;
    };
    // A card leaning back toward the camera, its bottom edge 4 above the ground.
    const card = quad([[-8, 4, 2], [8, 4, 2], [8, 20, -10], [-8, 20, -10]]);
    const ground = new THREE.PlaneGeometry(256, 256).rotateX(-Math.PI / 2);
    const uv = JSON.stringify(Array.from(card.getAttribute('uv').array));
    const foot = cardFoot(card, material)!;
    const before = foot.toArray();
    const direction = new THREE.Vector3(0, -0.8, -0.6);
    const { rested, unrested } = restCards([{ geometry: card, foot }], [ground], direction);
    const after = cardFoot(card, material)!.toArray();
    // Not cards: an upright plane, a floor decal, a quad without a texture, a box.
    const upright = cardFoot(quad([[-8, 0, 0], [8, 0, 0], [8, 16, 0], [-8, 16, 0]]), material);
    const decal = cardFoot(quad([[-8, 1, 8], [8, 1, 8], [8, 1, -8], [-8, 1, -8]]), material);
    const plain = cardFoot(quad([[-8, 4, 2], [8, 4, 2], [8, 20, -10], [-8, 20, -10]]), new THREE.MeshBasicMaterial());
    const box = cardFoot(new THREE.BoxGeometry(8, 8, 8).toNonIndexed(), material);
    // Nothing beyond the card: it keeps its placement.
    const lone = quad([[-8, 4, 2], [8, 4, 2], [8, 20, -10], [-8, 20, -10]]);
    const away = restCards([{ geometry: lone, foot: cardFoot(lone, material)! }], [], direction);
    const result = { before, after, rested: rested.map((v) => v.toArray()), unrested: unrested.length, uvKept: uv === JSON.stringify(Array.from(card.getAttribute('uv').array)), upright, decal, plain, box, away: away.unrested.length, loneY: lone.getAttribute('position').getY(0) };
    image.close();
    return result;
  });
  // The middle of the lowest opaque row: three quarters of the way down the card.
  expect(result.before[0]).toBeCloseTo(0, 6);
  expect(result.before[1]).toBeCloseTo(8, 6);
  expect(result.before[2]).toBeCloseTo(-1, 6);
  // Moved 10 along the view direction (8 down, 6 back): from that direction the art has not moved.
  for (const foot of [result.after, result.rested[0]!]) {
    expect(foot[0]).toBeCloseTo(0, 5);
    expect(foot[1]).toBeCloseTo(0, 5);
    expect(foot[2]).toBeCloseTo(-7, 5);
  }
  expect(result.unrested).toBe(0);
  expect(result.uvKept).toBe(true);
  expect([result.upright, result.decal, result.plain, result.box]).toEqual([null, null, null, null]);
  expect(result.away).toBe(1);
  expect(result.loneY).toBe(4);
});
