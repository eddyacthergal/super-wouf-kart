import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  canvasAvailable,
  createBannerTexture,
  createCheckerTexture,
  createGravelTexture,
  createLawnTexture,
  createMulchTexture,
  createNameTagTexture,
} from './textures';

/** Couleur moyenne (0–255) d'une texture de données. */
function average(texture: THREE.DataTexture): [number, number, number] {
  const data = texture.image.data as Uint8Array;
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += data[i + c];
  const n = data.length / 4;
  return [sum[0] / n, sum[1] / n, sum[2] / n];
}

describe('textures procédurales', () => {
  it('fonctionnent sans DOM, en sRGB, répétables et mipmappées', () => {
    for (const texture of [createLawnTexture(), createGravelTexture(), createMulchTexture()]) {
      expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(texture.wrapS).toBe(THREE.RepeatWrapping);
      expect(texture.generateMipmaps).toBe(true);
      expect(texture.image.width).toBeGreaterThanOrEqual(256);
      texture.dispose();
    }
  });

  it('distinguent clairement pelouse verte, allée beige et paillis brun', () => {
    const [lr, lg, lb] = average(createLawnTexture());
    expect(lg).toBeGreaterThan(lr + 40);
    expect(lg).toBeGreaterThan(lb + 60);
    const [gr, gg, gb] = average(createGravelTexture());
    expect(gr).toBeGreaterThan(190);
    expect(gr).toBeGreaterThan(gb + 25);
    expect(gg).toBeGreaterThan(gb);
    const [mr, mg, mb] = average(createMulchTexture());
    expect(mr).toBeLessThan(160);
    expect(mr).toBeGreaterThan(mg);
    expect(mg).toBeGreaterThan(mb);
    // Le paillis est nettement plus sombre que l'allée : on voit qu'on sort de la route.
    expect(gr + gg + gb - (mr + mg + mb)).toBeGreaterThan(250);
  });

  it('alternent deux bandes de tonte', () => {
    const texture = createLawnTexture();
    const data = texture.image.data as Uint8Array;
    const green = (x: number): number => data[(10 * 256 + x) * 4 + 1];
    let left = 0;
    let right = 0;
    for (let x = 16; x < 112; x++) left += green(x);
    for (let x = 144; x < 240; x++) right += green(x);
    expect(Math.abs(left - right) / 96).toBeGreaterThan(8);
  });

  it('dessinent un damier noir et blanc net', () => {
    const texture = createCheckerTexture();
    const data = texture.image.data as Uint8Array;
    expect(data[0]).toBeGreaterThan(200);
    expect(data[4]).toBeLessThan(50);
    expect(texture.magFilter).toBe(THREE.NearestFilter);
  });

  it('renoncent aux textes sans canvas 2D (Node)', () => {
    expect(canvasAvailable()).toBe(false);
    expect(createBannerTexture()).toBeNull();
    expect(createNameTagTexture('Rex', '#ff0000')).toBeNull();
  });
});
