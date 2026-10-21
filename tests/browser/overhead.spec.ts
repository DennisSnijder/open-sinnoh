import { expect, test } from '@playwright/test';

test('an original billboard stays under an overhead deck, and shows while standing on it', async ({ page }) => {
  await page.goto('/?packs=fixture&replay');
  const results = await page.evaluate(async () => {
    const THREE = await new Function('return import("/__test/three.js")')();
    const { billboardMaterial } = await new Function('return import("/__test/billboard.js")')();
    const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(128, 128);
    const scene = new THREE.Scene();
    const bytes = new Uint8Array(32 * 32 * 4);
    for (let i = 0; i < bytes.length; i += 4) { bytes[i] = 255; bytes[i + 3] = 255; }
    const texture = new THREE.DataTexture(bytes, 32, 32);
    texture.needsUpdate = true;
    const { material, anchorZ, ceilingY, ceilingMin, ceilingMax } = billboardMaterial(texture);
    anchorZ.value = 6;
    const actor = new THREE.Sprite(material);
    actor.center.set(0.5, 0);
    actor.position.set(0, 0, 6);
    actor.scale.set(32, 32, 1);
    scene.add(actor);
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(512, 512), new THREE.MeshBasicMaterial({ color: 0x00ff00, side: THREE.DoubleSide }));
    deck.rotation.x = -Math.PI / 2;
    deck.position.y = 16;
    scene.add(deck);
    const cameras = [new THREE.PerspectiveCamera(40, 1, 1, 500), new THREE.OrthographicCamera(-40, 40, 40, -40, 1, 500)];
    const out = [];
    for (const camera of cameras) {
      camera.position.set(0, 50, 80);
      camera.lookAt(0, 8, 0);
      const red = () => {
        renderer.render(scene, camera);
        const gl = renderer.getContext();
        const px = new Uint8Array(128 * 128 * 4);
        gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let count = 0;
        for (let i = 0; i < px.length; i += 4) if (px[i]! > 200 && px[i + 1]! < 80 && px[i + 2]! < 80) count++;
        return count;
      };
      deck.visible = true;
      ceilingMin.value.setScalar(-1e9);
      ceilingMax.value.setScalar(1e9);
      actor.position.y = 0;
      ceilingY.value = 1e9;
      const protruding = red();
      ceilingY.value = 12;
      const underneath = red();
      actor.position.y = 16;
      ceilingY.value = 1e9;
      const onTop = red();
      // A low object beside the actor must not push its head behind an unrelated wall.
      deck.visible = false;
      actor.position.y = 0;
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(128, 128), deck.material);
      wall.position.set(0, 16, -24);
      scene.add(wall);
      const full = red();
      ceilingY.value = 12;
      const falseCap = red();
      ceilingMin.value.set(40, 16, -32);
      ceilingMax.value.set(48, 32, 32);
      const bounded = red();
      scene.remove(wall);
      wall.geometry.dispose();
      out.push({ protruding, underneath, onTop, full, falseCap, bounded });
    }
    renderer.dispose();
    texture.dispose();
    material.dispose();
    deck.geometry.dispose();
    deck.material.dispose();
    return out;
  });
  for (const result of results) {
    expect(result.protruding, 'the original repro exposes head pixels through the deck').toBeGreaterThan(0);
    expect(result.underneath, 'a deck must cover the sprite beneath it').toBe(0);
    expect(result.onTop, 'an actor standing on the deck stays visible').toBeGreaterThan(0);
    expect(result.falseCap, 'a global cap reproduces clipping against the rear wall').toBeLessThan(result.full);
    expect(result.bounded, 'an overhead object beside the sprite leaves it intact').toBe(result.full);
  }
});
