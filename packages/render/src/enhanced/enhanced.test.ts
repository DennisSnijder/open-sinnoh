import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Zone } from '@opensinnoh/contracts';
import { cameraAllowed, ENHANCED_PRESETS, enhancedVisuals, parseEnhanced, setEnhancedVisuals, visualStyleConfig } from './config.ts';
import { lampPoints } from './lamp-points.ts';
import { goldenAt, gradeAt, nightAt, sunDirection } from './time.ts';

describe('enhanced visuals config', () => {
  it('is off unless asked for', () => {
    expect(enhancedVisuals()).toBeNull();
    expect(parseEnhanced(null)).toBeNull();
    expect(parseEnhanced('')).toBeNull();
  });

  it('parses presets and switches, and rejects unknown ones', () => {
    expect(parseEnhanced('cinematic')).toEqual(ENHANCED_PRESETS.cinematic);
    expect(parseEnhanced('follow,dof')).toMatchObject({ camera: 'follow', dof: true, bloom: false });
    expect(() => parseEnhanced('dof,lensdirt')).toThrow(/lensdirt/);
  });

  it('keeps a config with nothing on as off', () => {
    setEnhancedVisuals({ ...ENHANCED_PRESETS.subtle, particles: false, bloom: false, grade: false, lamps: false });
    expect(enhancedVisuals()).toBeNull();
    setEnhancedVisuals(ENHANCED_PRESETS.subtle);
    expect(enhancedVisuals()).toEqual(ENHANCED_PRESETS.subtle);
    setEnhancedVisuals(null);
    expect(enhancedVisuals()).toBeNull();
  });
});

describe('the Options visual style', () => {
  it('maps DS, Subtle, Cinematic and the angled camera to configs', () => {
    expect(visualStyleConfig('ds', false, false)).toBeNull();
    expect(visualStyleConfig('ds', true, false)).toMatchObject({ camera: 'follow', bloom: false });
    expect(visualStyleConfig('subtle', false, true)).toMatchObject({ camera: 'off', bloom: true, dof: false, lowPower: true });
    expect(visualStyleConfig('cinematic', false, false)).toMatchObject({ camera: 'off', dof: true, sun: true });
  });

  it('keeps the DS camera in caves, buildings and fog', () => {
    const zone = (mapType: Zone['mapType']) => ({ mapType }) as Zone;
    expect(cameraAllowed(zone('route'), false)).toBe(true);
    expect(cameraAllowed(zone('town'), false)).toBe(true);
    expect(cameraAllowed(zone('route'), true)).toBe(false);
    expect(cameraAllowed(zone('cave'), false)).toBe(false);
    expect(cameraAllowed(zone('indoors'), false)).toBe(false);
  });
});

describe('enhanced visuals by the hour', () => {
  it('runs night and golden hour across midnight without jumps', () => {
    expect(nightAt(23.9)).toBe(1);
    expect(nightAt(0)).toBe(1);
    expect(nightAt(12)).toBe(0);
    expect(goldenAt(18)).toBe(1);
    expect(goldenAt(12)).toBe(0);
    for (let h = 0; h < 24; h += 0.25) expect(Math.abs(nightAt(h + 0.25) - nightAt(h))).toBeLessThan(0.15);
  });

  it('puts the sun east in the morning, west in the evening, under the horizon at night', () => {
    expect(sunDirection(6.5).x).toBeGreaterThan(0.9);
    expect(sunDirection(17.5).x).toBeLessThan(-0.9);
    expect(sunDirection(12).y).toBeGreaterThan(0.8);
    expect(sunDirection(23).y).toBeLessThan(0);
  });

  it('grades neutrally when grading and the sun are off', () => {
    expect(gradeAt(18, false, false)).toMatchObject({ gain: [1, 1, 1], saturation: 1, vignette: 0, sunsetAmount: 0 });
    expect(gradeAt(22, true, false).gain[2]).toBeGreaterThan(1);
  });
});

describe('lamp points', () => {
  it('clusters a lamp material per 16 units, at its top', () => {
    const quad = (x: number, z: number) => [x, 0, z, x + 2, 0, z, x, 20, z];
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([...quad(2, 2), ...quad(50, 2)], 3));
    const points = lampPoints('c1_lamp01_lm1', geometry);
    expect(points.map((p) => [p.kind, p.at.x, p.at.y])).toEqual([
      ['lamp', 3, 18],
      ['lamp', 51, 18],
    ]);
    expect(lampPoints('h_mado', geometry)[0]!.kind).toBe('window');
    expect(lampPoints('c1_b01_1', geometry)).toEqual([]);
    // Other "light" materials are not lamps: a PC, the Pokémon Center floor, the caves' fittings.
    for (const name of ['light', 'light_a', 'dun_light_lm1', 'bf_light_lm5', 'window01_mat']) expect(lampPoints(name, geometry)).toEqual([]);
    expect(lampPoints('c5_light_lm1', geometry)[0]!.kind).toBe('lamp');
  });
});
