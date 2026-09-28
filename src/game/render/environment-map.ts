/**
 * Image d'environnement des reflets des pilotes (coque vernie, chromes, truffe et yeux), générée
 * par code : ciel du thème en dégradé, soleil HDR, quelques masses sombres sur l'horizon et un sol
 * sombre. Image équirectangulaire HDR (demi-flottants, espace linéaire) : grâce à sa projection,
 * three la prépare lui-même pour les reflets flous (PMREM). Constructible sans WebGL (tests Node).
 * Elle n'est posée que sur les matériaux qui la demandent, jamais en `scene.environment` : le décor
 * et la fourrure n'en paient pas le coût et gardent leur aspect.
 */
import * as THREE from 'three';
import type { LightStyle, SkyStyle } from './scene-theme';

/** Couleurs (CSS) et soleil de l'image d'environnement. */
export interface EnvironmentStyle {
  /** Ciel au zénith et à l'horizon. */
  top: string;
  horizon: string;
  sun: string;
  /** Sol, assombri dans l'image ; les masses de l'horizon en sont tirées. */
  ground: string;
  /** Direction du sol vers le soleil (normalisée ici). */
  sunDirection: readonly [number, number, number];
}

/** Masse sombre sur l'horizon (haie, arbres, dune). */
interface HorizonMass {
  /** Azimut du centre (rad), de +X vers +Z. */
  azimuth: number;
  /** Demi-largeur angulaire (rad). */
  halfWidth: number;
  /** Hauteur, en fraction de `massHeight`. */
  height: number;
}

/** Réglages de l'image. Luminances linéaires : ~0,8 pour le ciel clair, le soleil va bien au-delà. */
export const ENVIRONMENT_MAP = {
  /**
   * Taille (texels). three en tire des faces de cube de largeur / 4, soit 64 px : en 128×64
   * (faces de 32 px), le soleil serait trop flou.
   */
  width: 256,
  height: 128,
  /** Luminance du disque solaire : nettement au-dessus de 1, pour un reflet franc même flouté. */
  sunRadiance: 12,
  /** Rayon angulaire du disque (rad) : environ 4 texels de diamètre, pour survivre au flou. */
  sunRadius: 0.05,
  /** Bord adouci : fraction du rayon à partir de laquelle le disque est à pleine luminance. */
  sunCore: 0.4,
  /** Halo autour du soleil : luminance près du disque et concentration (exposant du cosinus). */
  haloRadiance: 0.6,
  haloSharpness: 64,
  /**
   * Sol : couleur du sol du thème, en partie désaturée (sinon les chromes, qui reflètent surtout
   * le sol, virent au vert), puis assombrie par ce facteur (reflet sombre sous l'horizon).
   */
  groundSaturation: 0.4,
  groundShade: 0.4,
  /** Masses : même teinte, assombrie, puis voilée par la couleur de l'horizon (lointain). */
  massShade: 0.45,
  massHaze: 0.3,
  /** Hauteur angulaire maximale des masses (rad, ~8°). */
  massHeight: 0.14,
  /** Placées à la main, sans tirage aléatoire : la même image à chaque course. */
  masses: [
    { azimuth: 0.35, halfWidth: 0.34, height: 0.85 },
    { azimuth: 1.25, halfWidth: 0.2, height: 0.5 },
    { azimuth: 2.15, halfWidth: 0.42, height: 0.7 },
    { azimuth: 3.3, halfWidth: 0.26, height: 1 },
    { azimuth: 4.3, halfWidth: 0.38, height: 0.6 },
    { azimuth: 5.35, halfWidth: 0.28, height: 0.8 },
  ] satisfies readonly HorizonMass[],
} as const;

/** Style d'environnement d'un thème : son ciel, son soleil et le sol de sa lumière ciel/sol. */
export function environmentStyleOf(sky: SkyStyle, light: LightStyle): EnvironmentStyle {
  return {
    top: sky.top,
    horizon: sky.horizon,
    sun: sky.sun,
    ground: light.hemisphereGround,
    sunDirection: sky.sunDirection,
  };
}

/** Rapproche `color` du gris de même luminance : `saturation` = 1 la garde, 0 donne ce gris. */
function desaturated(color: THREE.Color, saturation: number): THREE.Color {
  const grey = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  return color.lerp(new THREE.Color(grey, grey, grey), 1 - saturation);
}

/** Hauteur angulaire (rad) des masses de l'horizon dans chaque colonne de l'image. */
function massProfile(width: number): Float32Array {
  const profile = new Float32Array(width);
  for (let i = 0; i < width; i++) {
    const azimuth = ((i + 0.5) / width - 0.5) * Math.PI * 2;
    for (const mass of ENVIRONMENT_MAP.masses) {
      // Écart d'azimut ramené dans [-π, π] : les masses passent la couture de l'image.
      const delta = Math.atan2(
        Math.sin(azimuth - mass.azimuth),
        Math.cos(azimuth - mass.azimuth),
      );
      const t = delta / mass.halfWidth;
      if (Math.abs(t) >= 1) continue;
      // Sommet arrondi (demi-ellipse).
      const height = ENVIRONMENT_MAP.massHeight * mass.height * Math.sqrt(1 - t * t);
      profile[i] = Math.max(profile[i], height);
    }
  }
  return profile;
}

/**
 * Image d'environnement HDR d'un style. La texture appartient à l'appelant, qui la libère : three
 * libère alors aussi sa version préparée pour les reflets.
 */
export function createEnvironmentMap(style: EnvironmentStyle): THREE.DataTexture {
  const { width, height } = ENVIRONMENT_MAP;
  const top = new THREE.Color(style.top);
  const horizon = new THREE.Color(style.horizon);
  const sunColor = new THREE.Color(style.sun);
  const soil = desaturated(new THREE.Color(style.ground), ENVIRONMENT_MAP.groundSaturation);
  const ground = soil.clone().multiplyScalar(ENVIRONMENT_MAP.groundShade);
  const mass = soil
    .clone()
    .multiplyScalar(ENVIRONMENT_MAP.massShade)
    .lerp(horizon, ENVIRONMENT_MAP.massHaze);
  const sun = new THREE.Vector3(...style.sunDirection).normalize();
  const diskOuter = Math.cos(ENVIRONMENT_MAP.sunRadius);
  const diskInner = Math.cos(ENVIRONMENT_MAP.sunRadius * ENVIRONMENT_MAP.sunCore);
  const profile = massProfile(width);

  const data = new Uint16Array(width * height * 4);
  const one = THREE.DataUtils.toHalfFloat(1);
  const color = new THREE.Color();
  const direction = new THREE.Vector3();
  for (let j = 0; j < height; j++) {
    // Convention équirectangulaire de three (equirectUv) : ligne 0 en bas, colonne 0 à l'azimut -π.
    const elevation = ((j + 0.5) / height - 0.5) * Math.PI;
    for (let i = 0; i < width; i++) {
      const azimuth = ((i + 0.5) / width - 0.5) * Math.PI * 2;
      direction.set(
        Math.cos(elevation) * Math.cos(azimuth),
        Math.sin(elevation),
        Math.cos(elevation) * Math.sin(azimuth),
      );
      if (elevation < 0) {
        color.copy(ground);
      } else {
        if (elevation < profile[i]) color.copy(mass);
        // Même dégradé que le dôme du ciel (sky.ts).
        else color.copy(horizon).lerp(top, Math.sqrt(direction.y));
        const facing = direction.dot(sun);
        const disk = THREE.MathUtils.smoothstep(facing, diskOuter, diskInner);
        const halo = facing > 0 ? Math.pow(facing, ENVIRONMENT_MAP.haloSharpness) : 0;
        const glow = disk * ENVIRONMENT_MAP.sunRadiance + halo * ENVIRONMENT_MAP.haloRadiance;
        color.r += sunColor.r * glow;
        color.g += sunColor.g * glow;
        color.b += sunColor.b * glow;
      }
      const k = (j * width + i) * 4;
      data[k] = THREE.DataUtils.toHalfFloat(color.r);
      data[k + 1] = THREE.DataUtils.toHalfFloat(color.g);
      data[k + 2] = THREE.DataUtils.toHalfFloat(color.b);
      data[k + 3] = one;
    }
  }

  const texture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    THREE.HalfFloatType,
  );
  texture.name = 'environment-map';
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  // L'image fait le tour de l'horizon : pas de couture à l'azimut ±π.
  texture.wrapS = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
