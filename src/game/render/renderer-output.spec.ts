import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyRendererOutput, TONE_MAPPING_EXPOSURE } from './renderer-output';

describe('applyRendererOutput', () => {
  it('règle la sortie commune à la course et au garage : sRGB, ACES, exposition, ombres PCF', () => {
    const renderer = {
      outputColorSpace: THREE.LinearSRGBColorSpace as string,
      toneMapping: THREE.NoToneMapping as THREE.ToneMapping,
      toneMappingExposure: 0,
      shadowMap: { enabled: false, type: THREE.BasicShadowMap as THREE.ShadowMapType },
    };

    applyRendererOutput(renderer, THREE);

    expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.toneMappingExposure).toBe(TONE_MAPPING_EXPOSURE);
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(renderer.shadowMap.type).toBe(THREE.PCFShadowMap);
  });
});
