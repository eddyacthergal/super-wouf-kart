/**
 * Thème « parc enneigé » : le monde en plein air du jardin, sous la neige. Sol blanc bleuté,
 * allée déneigée, haies coiffées de neige, sapins enneigés, bonhommes de neige et flocons qui
 * tombent autour de la caméra, sous un ciel d'hiver pâle.
 */
import * as THREE from 'three';
import { createRng } from '../core/rng';
import type { DecorRecipe } from './decor-plan';
import { buildGardenWorld, type OutdoorStyle, type WorldPart } from './garden-world';
import type { DisposalBag } from './resources';
import type { SceneTheme } from './scene-theme';
import { createGravelTexture, createMulchTexture } from './textures';

/** Nombre de flocons et volume (m) qui suit la caméra : largeur, hauteur. */
const SNOWFLAKES = 2600;
const SNOW_BOX = 110;
const SNOW_HEIGHT = 36;
/** Vitesse de chute (m/s) et amplitude du balancement (m). */
const FALL_SPEED: readonly [number, number] = [1.2, 2.4];
const SWAY = 0.9;

const SNOW_RECIPE: DecorRecipe = {
  scatter: [
    {
      kind: 'fir',
      count: 34,
      size: [12, 22],
      radius: (h) => h * 0.3,
      band: [2, 40],
      variants: 3,
      facesTrack: false,
    },
    {
      kind: 'bush',
      count: 26,
      size: [1.6, 3.2],
      radius: (r) => r * 1.25,
      band: [1, 30],
      variants: 2,
      facesTrack: false,
    },
  ],
  outer: { kind: 'fir', count: 60, size: [18, 32], inner: 8, outer: 80, variants: 3 },
};

/** Flocons : un nuage de points qui tombe, se balance et se replie autour de la caméra. */
function buildSnowfall(bag: DisposalBag): WorldPart {
  const rng = createRng(0x5e0f1a);
  const base = new Float32Array(SNOWFLAKES * 3);
  const speed = new Float32Array(SNOWFLAKES);
  const phase = new Float32Array(SNOWFLAKES);
  for (let i = 0; i < SNOWFLAKES; i++) {
    base[i * 3] = rng.range(0, SNOW_BOX);
    base[i * 3 + 1] = rng.range(0, SNOW_HEIGHT);
    base[i * 3 + 2] = rng.range(0, SNOW_BOX);
    speed[i] = rng.range(FALL_SPEED[0], FALL_SPEED[1]);
    phase[i] = rng.range(0, Math.PI * 2);
  }
  const positions = new Float32Array(SNOWFLAKES * 3);
  const geometry = bag.add(new THREE.BufferGeometry());
  const attribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', attribute);
  const material = bag.add(
    new THREE.PointsMaterial({
      color: '#ffffff',
      map: bag.add(createFlakeTexture()),
      size: 0.32,
      transparent: true,
      depthWrite: false,
    }),
  );
  const points = new THREE.Points(geometry, material);
  points.name = 'snowfall';
  points.frustumCulled = false;
  const wrap = (value: number, size: number): number => ((value % size) + size) % size;
  const half = SNOW_BOX / 2;
  const update = (time: number, focus: THREE.Vector3): void => {
    for (let i = 0; i < SNOWFLAKES; i++) {
      const sway = Math.sin(time * 0.8 + phase[i]) * SWAY;
      // Position dans la boîte, raccordée autour de la caméra : aucun flocon ne « saute » à l'écran.
      positions[i * 3] = focus.x - half + wrap(base[i * 3] + sway - focus.x + half, SNOW_BOX);
      positions[i * 3 + 1] = wrap(base[i * 3 + 1] - time * speed[i], SNOW_HEIGHT);
      positions[i * 3 + 2] =
        focus.z - half + wrap(base[i * 3 + 2] + sway * 0.6 - focus.z + half, SNOW_BOX);
    }
    attribute.needsUpdate = true;
  };
  update(0, new THREE.Vector3());
  return { object: points, update };
}

/** Flocon rond et flou (32 × 32, alpha dégradé). */
function createFlakeTexture(): THREE.DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(255 * Math.max(0, 1 - d * d));
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

export const SNOW_STYLE: OutdoorStyle = {
  name: 'snow-world',
  ground: ['#f4f8fd', '#e7eff8'],
  surface: {
    // Allée déneigée : gravier gris bleuté, bien lisible sur la neige.
    road: () =>
      createGravelTexture('#a9b3bf', ['#c3ccd6', '#8f99a6', '#b5bec9', '#9ca6b2', '#d0d7df']),
    roadTile: 7,
    shoulder: () => createMulchTexture('#5a4a40', ['#4a3b31', '#6d5a4c', '#7b6656', '#3e3129']),
    shoulderTile: 4,
    curbColors: ['#d7322e', '#fbfbf7'],
  },
  hedges: { palette: ['#2f6b3a', '#2a6034', '#377545', '#2c663c'], cap: '#f6faff' },
  decor: {
    foliage: ['#f2f7fc', '#e3edf7', '#3a7a44', '#eef4fa', '#2f6b3a'],
    trunk: '#6b4a34',
    fence: '#8a5f3e',
    stones: ['#9aa6b4', '#8894a2', '#b0bac6', '#7f8a97'],
    firs: ['#1f5a36', '#256a3e', '#1b4f31'],
    firSnow: '#f6faff',
  },
  recipe: SNOW_RECIPE,
  clouds: { color: '#f4f7fb', emissive: '#dfe7f2' },
  extras: ({ bag }) => [buildSnowfall(bag)],
};

/** Parc enneigé : ciel d'hiver pâle, soleil bas et froid, brume blanche. */
export const SNOW_THEME: SceneTheme = {
  sky: {
    top: '#6f9fd8',
    horizon: '#e6eef8',
    sun: '#fff6e8',
    sunDirection: [0.5, 0.55, -0.45],
    sunGlow: 1.4,
  },
  fog: { color: '#e6eef8', near: 130, far: 620 },
  light: {
    hemisphereSky: '#e4eefa',
    hemisphereGround: '#b9c8d8',
    hemisphereIntensity: 1.45,
    sun: '#fff3e2',
    sunIntensity: 2.2,
  },
  clouds: SNOW_STYLE.clouds,
  buildWorld: (track, decor) => buildGardenWorld(track, decor, SNOW_STYLE),
};
