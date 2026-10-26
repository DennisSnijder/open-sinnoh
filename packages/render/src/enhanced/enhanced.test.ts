import { describe, expect, it } from 'vitest';
import type { Zone } from '@opensinnoh/contracts';
import { cameraAllowed, ENHANCED_PRESETS, enhancedVisuals, parseEnhanced, setEnhancedVisuals, visualStyleConfig } from './config.ts';
import { glowKind } from './light-sources.ts';
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
    expect(parseEnhanced('cinematic,follow')).toEqual({ ...ENHANCED_PRESETS.cinematic, camera: 'follow' });
    expect(parseEnhanced('follow,subtle')).toEqual({ ...ENHANCED_PRESETS.subtle, camera: 'follow' });
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

  it('keeps the DS camera in caves and buildings', () => {
    const zone = (mapType: Zone['mapType']) => ({ mapType }) as Zone;
    expect(cameraAllowed(zone('route'))).toBe(true);
    expect(cameraAllowed(zone('town'))).toBe(true);
    expect(cameraAllowed(zone('cave'))).toBe(false);
    expect(cameraAllowed(zone('indoors'))).toBe(false);
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

describe('light sources', () => {
  it('finds lamps, signs and windows by their material names', () => {
    for (const name of ['light', 'light_a', 'light2', 'Light', 'c1_lamp01_lm1', 'lamp03', 'c2_light_a_lm4', 'bf_light_lm5']) expect(glowKind(name), name).toBe('lamp');
    for (const name of ['h_mado', 'h_mado_lm5', 'gingamado', 'window01_mat', 'c4_mado']) expect(glowKind(name), name).toBe('window');
    for (const name of ['c1_b01_1', 'pc_door', 'pc_1', 'h_kage_lm3', 'tshadow_lm5', 'allpeak_lm34']) expect(glowKind(name), name).toBeNull();
  });
});
