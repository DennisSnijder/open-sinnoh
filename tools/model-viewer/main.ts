/**
 * Dev viewer: imports the v0.1 slice assets from a user-supplied ROM in the browser and shows one land
 * chunk (plus its props) with the area texture sets, bound by name the way the renderer will.
 * Run: pnpm viewer. Nothing leaves the tab.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { NitroFs, Reader, readNarc } from '@opensinnoh/nds';
import { importAssets, readAreaData, SLICE_AREAS, type ImportAssetsResult } from '../../packages/importer/src/assets/index.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $('status');
const chunkSelect = $<HTMLSelectElement>('chunk');
const propsBox = $<HTMLInputElement>('props');
const view = $('view');

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(window.devicePixelRatio);
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7aa6d8);
const camera = new THREE.PerspectiveCamera(30, 1, 8, 8000);
camera.position.set(0, 520, 620);
const controls = new OrbitControls(camera, renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(-0.4, 1, 0.6);
scene.add(sun);
const root = new THREE.Group();
scene.add(root);

function resize() {
  renderer.setSize(view.clientWidth, view.clientHeight);
  camera.aspect = view.clientWidth / view.clientHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

interface Loaded {
  fs: NitroFs;
  result: ImportAssetsResult;
  areas: { propSet: number; mapTex: number }[];
}
let loaded: Loaded | null = null;
const textureCache = new Map<string, THREE.Texture>();

function texture(path: string, wrapS: number, wrapT: number): THREE.Texture {
  const key = `${path}|${wrapS}|${wrapT}`;
  let t = textureCache.get(key);
  if (!t) {
    const bytes = loaded?.result.assets.get(path);
    if (!bytes) throw new Error(`texture ${path} missing from the import`);
    t = new THREE.TextureLoader().load(URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' })));
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.wrapS = wrapS as THREE.Wrapping;
    t.wrapT = wrapT as THREE.Wrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false;
    textureCache.set(key, t);
  }
  return t;
}

interface OpenSinnohExtras {
  alpha: number;
  cull: 'back' | 'front' | 'none';
  lit: boolean;
  texture?: string;
  palette?: string;
  wrapS?: number;
  wrapT?: number;
}

/** Loads a converted glTF and rebinds its materials by name from a texture set directory. */
async function loadModel(path: string, texDir: string): Promise<THREE.Object3D> {
  const bytes = loaded?.result.assets.get(path);
  if (!bytes) throw new Error(`${path} missing from the import`);
  const gltf = await new GLTFLoader().parseAsync(new TextDecoder().decode(bytes), '');
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material as THREE.MeshStandardMaterial;
    const x = src.userData.lantern as OpenSinnohExtras;
    const params: THREE.MeshLambertMaterialParameters = {
      vertexColors: true,
      side: x.cull === 'none' ? THREE.DoubleSide : x.cull === 'front' ? THREE.BackSide : THREE.FrontSide,
      transparent: x.alpha < 31 || src.transparent,
      opacity: x.alpha / 31,
      alphaTest: src.alphaTest,
    };
    if (x.texture) params.map = texture(`${texDir}/${x.texture}__${x.palette}.png`, x.wrapS ?? 10497, x.wrapT ?? 10497);
    mesh.material = x.lit ? new THREE.MeshLambertMaterial(params) : new THREE.MeshBasicMaterial(params);
  });
  return gltf.scene;
}

async function show(chunk: number) {
  if (!loaded) return;
  root.clear();
  const area = Number(Object.entries(SLICE_AREAS).find(([, c]) => c.includes(chunk))?.[0]);
  const a = loaded.areas[area];
  if (!a) throw new Error(`no area for chunk ${chunk}`);
  root.add(await loadModel(`models/land/${chunk}.gltf`, `textures/map/${a.mapTex}`));
  let props = 0;
  if (propsBox.checked) {
    const land = readNarc(loaded.fs.file('/fielddata/land_data/land_data.narc'))[chunk] as Uint8Array;
    const r = new Reader(land);
    const base = 16 + r.u32(0);
    for (let o = base; o < base + r.u32(4); o += 48) {
      const obj = await loadModel(`models/build/${r.i32(o)}.gltf`, `textures/build/${a.propSet}`);
      obj.position.set(r.i32(o + 4) / 4096, r.i32(o + 8) / 4096, r.i32(o + 12) / 4096);
      obj.scale.set(r.i32(o + 28) / 4096, r.i32(o + 32) / 4096, r.i32(o + 36) / 4096);
      root.add(obj);
      props++;
    }
  }
  // Frame the drawn geometry (interiors only fill a corner of their chunk).
  const box = new THREE.Box3().setFromObject(root);
  const centre = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  controls.target.copy(centre);
  camera.position.copy(centre).add(new THREE.Vector3(0, 0.75, 0.9).multiplyScalar(radius / Math.tan((camera.fov * Math.PI) / 360) / 1.7));
  status.textContent = `chunk ${chunk} (area ${area}, map set ${a.mapTex}, prop set ${a.propSet}): ${props} props`;
  document.body.dataset.ready = String(chunk);
}

$<HTMLInputElement>('rom').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  status.textContent = 'Importing…';
  try {
    const fs = new NitroFs(new Uint8Array(await file.arrayBuffer()));
    const t0 = performance.now();
    const result = importAssets(fs, { slice: true });
    loaded = { fs, result, areas: readAreaData(fs) };
    status.textContent = `imported in ${(performance.now() - t0).toFixed(0)} ms`;
    chunkSelect.replaceChildren(...Object.values(SLICE_AREAS).flat().map((c) => new Option(`land ${c}`, String(c))));
    chunkSelect.disabled = false;
    const first = new URLSearchParams(location.search).get('chunk') ?? '0';
    chunkSelect.value = first;
    await show(Number(first));
  } catch (err) {
    status.textContent = String(err);
    document.body.dataset.error = String(err);
    throw err;
  }
});
chunkSelect.addEventListener('change', () => void show(Number(chunkSelect.value)));
propsBox.addEventListener('change', () => void show(Number(chunkSelect.value)));
