/**
 * Textures procédurales. Les motifs (pelouse, gravier, paillis, damier) sont calculés dans des
 * DataTexture : ils fonctionnent aussi sans DOM (tests en Node). Les textes (bannière, étiquettes)
 * demandent un canvas 2D et ne sont créés que si le navigateur en fournit un.
 */
import * as THREE from 'three';
import { createRng } from '../core/rng';
import { PALETTE } from './palette';

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Hachage entier → [0, 1[ (bruit déterministe). */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 144665);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Bruit de valeur lissé et raccordable (période `cells` sur [0, 1[). */
export function tileNoise(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const wrap = (i: number): number => ((i % cells) + cells) % cells;
  const a = hash2(wrap(x0), wrap(y0), seed);
  const b = hash2(wrap(x0 + 1), wrap(y0), seed);
  const c = hash2(wrap(x0), wrap(y0 + 1), seed);
  const d = hash2(wrap(x0 + 1), wrap(y0 + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Image RGBA en mémoire, raccordable sur ses bords (motifs répétés). */
export class PixelCanvas {
  readonly data: Uint8Array;

  constructor(readonly size: number) {
    this.data = new Uint8Array(size * size * 4);
  }

  set(x: number, y: number, r: number, g: number, b: number): void {
    const size = this.size;
    const px = ((x % size) + size) % size;
    const py = ((y % size) + size) % size;
    const i = (py * size + px) * 4;
    this.data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    this.data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    this.data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    this.data[i + 3] = 255;
  }

  /** Multiplie la couleur d'un pixel (ombrage des cailloux). */
  shade(x: number, y: number, factor: number): void {
    const size = this.size;
    const px = ((x % size) + size) % size;
    const py = ((y % size) + size) % size;
    const i = (py * size + px) * 4;
    for (let c = 0; c < 3; c++) this.data[i + c] = Math.min(255, this.data[i + c] * factor);
  }

  fill(paint: (u: number, v: number) => Rgb): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const [r, g, b] = paint(x / this.size, y / this.size);
        this.set(x, y, r, g, b);
      }
    }
  }

  /** Disque plein (raccordé sur les bords), avec ombre en bas à droite et reflet en haut à gauche. */
  pebble(cx: number, cy: number, radius: number, color: Rgb): void {
    const r2 = radius * radius;
    const reach = Math.ceil(radius) + 1;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const d2 = dx * dx + dy * dy;
        const x = Math.round(cx + dx);
        const y = Math.round(cy + dy);
        if (d2 <= r2) {
          const light = 1 + 0.12 * (-(dx + dy) / (radius * 2));
          this.set(x, y, color[0] * light, color[1] * light, color[2] * light);
        } else if (d2 <= (radius + 1.2) ** 2 && dx + dy > 0) {
          this.shade(x, y, 0.82);
        }
      }
    }
  }

  /** Copeau allongé orienté (paillis). */
  chip(cx: number, cy: number, length: number, width: number, angle: number, color: Rgb): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const reach = Math.ceil(length / 2) + 1;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const along = dx * cos + dy * sin;
        const across = -dx * sin + dy * cos;
        if (Math.abs(along) <= length / 2 && Math.abs(across) <= width / 2) {
          const light = 1 + 0.15 * (across / width);
          this.set(
            Math.round(cx + dx),
            Math.round(cy + dy),
            color[0] * light,
            color[1] * light,
            color[2] * light,
          );
        }
      }
    }
  }
}

export function toTexture(canvas: PixelCanvas, nearest = false): THREE.DataTexture {
  const texture = new THREE.DataTexture(canvas.data, canvas.size, canvas.size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/** Pelouse tondue : deux bandes (claire puis foncée) par répétition, brins et touffes. */
export function createLawnTexture(
  lightColor: string = PALETTE.lawnLight,
  darkColor: string = PALETTE.lawnDark,
): THREE.DataTexture {
  const canvas = new PixelCanvas(256);
  const light = hexToRgb(lightColor);
  const dark = hexToRgb(darkColor);
  canvas.fill((u, v) => {
    // Transition douce entre bandes (u = 0,5 et u = 0 ≡ 1).
    const edge = Math.min(Math.abs(u - 0.5), u, 1 - u);
    const t = u < 0.5 ? 0 : 1;
    const blend = edge < 0.015 ? 0.5 + (t === 0 ? -1 : 1) * (edge / 0.015) * 0.5 : t;
    const clump = tileNoise(u, v, 16, 3) - 0.5;
    const blades = tileNoise(u, v * 0.25, 128, 7) - 0.5;
    const grain = hash2(Math.floor(u * 256), Math.floor(v * 256), 11) - 0.5;
    const k = 1 + clump * 0.14 + blades * 0.1 + grain * 0.08;
    return [
      (light[0] + (dark[0] - light[0]) * blend) * k,
      (light[1] + (dark[1] - light[1]) * blend) * k,
      (light[2] + (dark[2] - light[2]) * blend) * k,
    ];
  });
  return toTexture(canvas);
}

const GRAVEL_PEBBLES = [
  '#f3e6c7',
  '#dcc596',
  '#cfbb93',
  '#efe0bd',
  '#c2b18e',
  '#e9d6ae',
  '#d6c4a4',
];

/** Allée de gravier (beige par défaut) : fond uni et milliers de petits cailloux. */
export function createGravelTexture(
  baseColor: string = PALETTE.gravel,
  pebbleColors: readonly string[] = GRAVEL_PEBBLES,
): THREE.DataTexture {
  const canvas = new PixelCanvas(512);
  const base = hexToRgb(baseColor);
  canvas.fill((u, v) => {
    const k =
      1 +
      (tileNoise(u, v, 8, 21) - 0.5) * 0.08 +
      (hash2(Math.floor(u * 512), Math.floor(v * 512), 5) - 0.5) * 0.08;
    return [base[0] * k, base[1] * k, base[2] * k];
  });
  const rng = createRng(0x9a7e1);
  const colors = pebbleColors.map(hexToRgb);
  for (let i = 0; i < 2600; i++) {
    canvas.pebble(rng.range(0, 512), rng.range(0, 512), rng.range(2.2, 6.5), rng.pick(colors));
  }
  return toTexture(canvas);
}

const MULCH_CHIPS = ['#5c341e', '#94592f', '#a86c3d', '#6d3f24', '#b57a47', '#4e2c19'];

/** Bas-côté en paillis (brun par défaut) : copeaux de bois orientés au hasard. */
export function createMulchTexture(
  baseColor: string = PALETTE.mulch,
  chipColors: readonly string[] = MULCH_CHIPS,
): THREE.DataTexture {
  const canvas = new PixelCanvas(256);
  const base = hexToRgb(baseColor);
  canvas.fill((u, v) => {
    const k = 0.9 + tileNoise(u, v, 6, 31) * 0.2;
    return [base[0] * k, base[1] * k, base[2] * k];
  });
  const rng = createRng(0x3c1f);
  const colors = chipColors.map(hexToRgb);
  for (let i = 0; i < 1100; i++) {
    canvas.chip(
      rng.range(0, 256),
      rng.range(0, 256),
      rng.range(5, 13),
      rng.range(1.8, 3.6),
      rng.range(0, Math.PI),
      rng.pick(colors),
    );
  }
  return toTexture(canvas);
}

/** Damier noir et blanc 2 × 2 (à répéter), rendu net au plus près. */
export function createCheckerTexture(): THREE.DataTexture {
  const canvas = new PixelCanvas(2);
  canvas.set(0, 0, 250, 250, 250);
  canvas.set(1, 1, 250, 250, 250);
  canvas.set(1, 0, 24, 24, 30);
  canvas.set(0, 1, 24, 24, 30);
  return toTexture(canvas, true);
}

// ---------------------------------------------------------------------------
// Textes (canvas 2D, navigateur uniquement)
// ---------------------------------------------------------------------------

let canvasSupport: boolean | undefined;

/** Vrai si un canvas 2D est disponible (faux en Node et sous jsdom, qui ne l'implémente pas). */
export function canvasAvailable(): boolean {
  if (canvasSupport !== undefined) return canvasSupport;
  canvasSupport = false;
  if (typeof document === 'undefined') return false;
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return false;
  try {
    canvasSupport = document.createElement('canvas').getContext('2d') !== null;
  } catch {
    canvasSupport = false;
  }
  return canvasSupport;
}

function createContext(width: number, height: number): CanvasRenderingContext2D | null {
  if (!canvasAvailable()) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext('2d');
}

function canvasTexture(context: CanvasRenderingContext2D): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(context.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

/** Bannière « WOUF KART » de l'arche de départ (null sans canvas). */
export function createBannerTexture(): THREE.CanvasTexture | null {
  const context = createContext(1024, 128);
  if (!context) return null;
  const { width, height } = context.canvas;
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#f0483e');
  gradient.addColorStop(1, PALETTE.bannerRed);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  // Bandes en damier en haut et en bas.
  const cell = 16;
  for (let x = 0; x < width; x += cell) {
    for (const [row, y] of [
      [0, 0],
      [1, height - cell],
    ]) {
      context.fillStyle = (x / cell + row) % 2 === 0 ? '#ffffff' : '#1c1c24';
      context.fillRect(x, y, cell, cell);
    }
  }
  context.font = '900 76px "Arial Black", "Trebuchet MS", system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.lineWidth = 12;
  context.strokeStyle = '#5a1410';
  context.strokeText('WOUF KART', width / 2, height / 2 + 3);
  context.fillStyle = PALETTE.bannerYellow;
  context.fillText('WOUF KART', width / 2, height / 2 + 3);
  return canvasTexture(context);
}

/** Étiquette de nom d'un pilote : texte blanc sur pastille sombre (null sans canvas). */
export function createNameTagTexture(name: string, accent: string): THREE.CanvasTexture | null {
  const context = createContext(256, 64);
  if (!context) return null;
  const { width, height } = context.canvas;
  context.clearRect(0, 0, width, height);
  roundedRect(context, 4, 6, width - 8, height - 12, 24);
  context.fillStyle = 'rgba(18, 22, 40, 0.72)';
  context.fill();
  context.lineWidth = 4;
  context.strokeStyle = accent;
  context.stroke();
  context.font = '700 30px system-ui, "Segoe UI", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#ffffff';
  const label = name.length > 14 ? `${name.slice(0, 13)}…` : name;
  context.fillText(label, width / 2, height / 2 + 1, width - 28);
  return canvasTexture(context);
}
