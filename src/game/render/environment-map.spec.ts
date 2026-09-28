import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createEnvironmentMap,
  ENVIRONMENT_MAP,
  type EnvironmentStyle,
  environmentStyleOf,
} from './environment-map';
import { PALETTE } from './palette';
import { GARDEN_THEME, SCENE_THEMES } from './themes';

const GARDEN = environmentStyleOf(GARDEN_THEME.sky, GARDEN_THEME.light);

/** Radiance (linéaire) du texel que three lit dans la direction `direction` (voir equirectUv). */
function radianceAt(texture: THREE.DataTexture, direction: THREE.Vector3): THREE.Color {
  const { width, height } = texture.image;
  const dir = direction.clone().normalize();
  const u = Math.atan2(dir.z, dir.x) / (Math.PI * 2) + 0.5;
  const v = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)) / Math.PI + 0.5;
  const i = Math.min(width - 1, Math.floor(u * width));
  const j = Math.min(height - 1, Math.floor(v * height));
  return texel(texture, i, j);
}

function texel(texture: THREE.DataTexture, i: number, j: number): THREE.Color {
  const data = texture.image.data as Uint16Array;
  const k = (j * texture.image.width + i) * 4;
  const half = THREE.DataUtils.fromHalfFloat;
  return new THREE.Color(half(data[k]), half(data[k + 1]), half(data[k + 2]));
}

/** Direction (vers l'extérieur) du centre du texel (i, j), convention équirectangulaire de three. */
function directionOf(texture: THREE.DataTexture, i: number, j: number): THREE.Vector3 {
  const azimuth = ((i + 0.5) / texture.image.width - 0.5) * Math.PI * 2;
  const elevation = ((j + 0.5) / texture.image.height - 0.5) * Math.PI;
  return new THREE.Vector3(
    Math.cos(elevation) * Math.cos(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.sin(azimuth),
  );
}

const luminance = (color: THREE.Color): number =>
  0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;

/** Texels de l'image, avec leur direction et leur luminance. */
function texels(texture: THREE.DataTexture): Array<{ direction: THREE.Vector3; value: number }> {
  const result: Array<{ direction: THREE.Vector3; value: number }> = [];
  for (let j = 0; j < texture.image.height; j++) {
    for (let i = 0; i < texture.image.width; i++) {
      result.push({ direction: directionOf(texture, i, j), value: luminance(texel(texture, i, j)) });
    }
  }
  return result;
}

/** Luminances d'un tour d'horizon à la hauteur angulaire `elevation` (rad). */
function horizonRing(texture: THREE.DataTexture, elevation: number, steps = 720): number[] {
  const values: number[] = [];
  for (let s = 0; s < steps; s++) {
    const azimuth = (s / steps) * Math.PI * 2;
    const direction = new THREE.Vector3(
      Math.cos(elevation) * Math.cos(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.sin(azimuth),
    );
    values.push(luminance(radianceAt(texture, direction)));
  }
  return values;
}

function withMap(style: EnvironmentStyle, test: (texture: THREE.DataTexture) => void): void {
  const texture = createEnvironmentMap(style);
  try {
    test(texture);
  } finally {
    texture.dispose();
  }
}

describe('createEnvironmentMap', () => {
  it('produit une image HDR équirectangulaire, linéaire, prête à envoyer au GPU', () => {
    withMap(GARDEN, (texture) => {
      expect(texture).toBeInstanceOf(THREE.DataTexture);
      // three en tire des faces de cube de largeur / 4 : 128×64 au moins.
      expect(texture.image.width).toBeGreaterThanOrEqual(128);
      expect(texture.image.height).toBeGreaterThanOrEqual(64);
      expect(texture.image.width).toBe(texture.image.height * 2);
      expect(texture.type).toBe(THREE.HalfFloatType);
      expect(texture.format).toBe(THREE.RGBAFormat);
      expect(texture.image.data).toBeInstanceOf(Uint16Array);
      expect(texture.image.data?.length).toBe(texture.image.width * texture.image.height * 4);
      // Seule cette projection déclenche la préparation des reflets flous (PMREM) par three.
      expect(texture.mapping).toBe(THREE.EquirectangularReflectionMapping);
      expect(texture.colorSpace).toBe(THREE.LinearSRGBColorSpace);
      expect(texture.magFilter).toBe(THREE.LinearFilter);
      expect(texture.wrapS).toBe(THREE.RepeatWrapping);
      // needsUpdate : la version est incrémentée, three enverra les données.
      expect(texture.version).toBeGreaterThan(0);
    });
  });

  it('place un soleil nettement au-dessus de 1, étalé sur quelques texels, dans la direction du soleil', () => {
    for (const sunDirection of [GARDEN.sunDirection, [-0.6, 0.5, 0.62] as const]) {
      withMap({ ...GARDEN, sunDirection }, (texture) => {
        const sun = new THREE.Vector3(...sunDirection).normalize();
        const all = texels(texture);
        const brightest = all.reduce((best, entry) => (entry.value > best.value ? entry : best));
        expect(brightest.value).toBeGreaterThan(4);
        // À moins de deux texels (2π / largeur) de la direction du soleil.
        const texelAngle = (Math.PI * 2) / texture.image.width;
        expect(brightest.direction.angleTo(sun)).toBeLessThan(texelAngle * 2);
        // Ni un seul texel (il disparaîtrait au flou des reflets), ni une grosse tache.
        const hot = all.filter((entry) => entry.value > 1);
        expect(hot.length).toBeGreaterThanOrEqual(4);
        expect(hot.length).toBeLessThan(120);
        for (const entry of hot) expect(entry.direction.angleTo(sun)).toBeLessThan(0.15);
      });
    }
  });

  it('tire le ciel du thème et assombrit le sol', () => {
    withMap(GARDEN, (texture) => {
      const top = new THREE.Color(PALETTE.skyTop);
      const zenith = radianceAt(texture, new THREE.Vector3(0, 1, 0));
      expect(zenith.r).toBeCloseTo(top.r, 1);
      expect(zenith.g).toBeCloseTo(top.g, 1);
      expect(zenith.b).toBeCloseTo(top.b, 1);

      // Juste au-dessus de l'horizon, là où aucune masse ne le cache : la couleur de l'horizon.
      const horizon = luminance(new THREE.Color(PALETTE.skyHorizon));
      const ring = horizonRing(texture, 0.02);
      expect(Math.max(...ring)).toBeGreaterThan(horizon * 0.9);

      // Sol sombre, bien plus sombre que la pelouse de la lumière ciel/sol.
      const lawn = new THREE.Color(PALETTE.hemisphereGround);
      const ground = radianceAt(texture, new THREE.Vector3(0.3, -1, 0.2));
      expect(luminance(ground)).toBeLessThan(luminance(lawn) * 0.5);
      expect(luminance(ground)).toBeLessThan(horizon * 0.2);
      // Et plus neutre : les chromes, qui reflètent surtout le sol, ne virent pas au vert.
      const saturation = (color: THREE.Color): number => {
        const max = Math.max(color.r, color.g, color.b);
        return (max - Math.min(color.r, color.g, color.b)) / max;
      };
      expect(saturation(ground)).toBeLessThan(saturation(lawn) * 0.6);
    });
  });

  it('dresse quelques masses sombres sur l’horizon', () => {
    withMap(GARDEN, (texture) => {
      const ring = horizonRing(texture, 0.03);
      const sky = Math.max(...ring);
      const isMass = ring.map((value) => value < sky * 0.7);
      // Nombre de masses : passages ciel → masse sur le tour complet.
      let masses = 0;
      for (let s = 0; s < isMass.length; s++) {
        if (isMass[s] && !isMass[(s + isMass.length - 1) % isMass.length]) masses++;
      }
      expect(masses).toBeGreaterThanOrEqual(3);
      expect(masses).toBeLessThanOrEqual(10);
      // Plus haut, le ciel est dégagé partout.
      const high = horizonRing(texture, ENVIRONMENT_MAP.massHeight + 0.05);
      expect(Math.min(...high)).toBeGreaterThan(sky * 0.7);
    });
  });

  it('donne la même image pour le même style', () => {
    const a = createEnvironmentMap(GARDEN);
    const b = createEnvironmentMap(GARDEN);
    expect(a).not.toBe(b);
    expect(a.image.data).toEqual(b.image.data);
    a.dispose();
    b.dispose();
  });
});

describe('environmentStyleOf', () => {
  it('reprend le ciel, le soleil et le sol du thème', () => {
    expect(GARDEN).toEqual({
      top: GARDEN_THEME.sky.top,
      horizon: GARDEN_THEME.sky.horizon,
      sun: GARDEN_THEME.sky.sun,
      sunDirection: GARDEN_THEME.sky.sunDirection,
      ground: GARDEN_THEME.light.hemisphereGround,
    });
  });

  it('donne à chaque thème un soleil HDR et un sol plus sombre que son ciel', () => {
    for (const [id, theme] of Object.entries(SCENE_THEMES)) {
      withMap(environmentStyleOf(theme.sky, theme.light), (texture) => {
        const sun = radianceAt(texture, new THREE.Vector3(...theme.sky.sunDirection));
        expect(luminance(sun), id).toBeGreaterThan(4);
        const ground = luminance(radianceAt(texture, new THREE.Vector3(0, -1, 0)));
        const zenith = luminance(radianceAt(texture, new THREE.Vector3(0, 1, 0)));
        const horizon = Math.max(...horizonRing(texture, 0.02));
        expect(ground, id).toBeLessThan(Math.max(zenith, horizon) * 0.5);
      });
    }
  });
});
