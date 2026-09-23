/**
 * Géométrie 2D du circuit utile au rendu : distance à la ligne médiane, courbes décalées,
 * rééchantillonnage régulier d'une boucle. Aucune dépendance à three.js.
 */
import type { TrackQuery } from '../core/types';
import type { Vec2 } from '../core/vec2';

/** Marge (m) retirée aux mesures de distance pour couvrir l'écart entre échantillons (~1 m). */
const SAMPLE_TOLERANCE = 0.5;

/** Distance (m) à l'échantillon de ligne médiane le plus proche (recherche exhaustive). */
export function distanceToSamples(track: TrackQuery, x: number, z: number): number {
  let best = Infinity;
  for (const sample of track.samples) {
    const dx = sample.position.x - x;
    const dz = sample.position.z - z;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/**
 * Borne basse prudente de la distance d'un point à la ligne médiane :
 * minimum de |lateral| (track.project) et de la distance au plus proche échantillon, moins une tolérance.
 */
export function corridorClearance(track: TrackQuery, x: number, z: number): number {
  const projected = Math.abs(track.project({ x, z }).lateral);
  return Math.min(projected, distanceToSamples(track, x, z)) - SAMPLE_TOLERANCE;
}

/** Courbe fermée parallèle à la ligne médiane, à `lateral` m (+ = gauche). */
export function offsetRing(track: TrackQuery, lateral: number): Vec2[] {
  return track.samples.map((sample) => ({
    x: sample.position.x + sample.left.x * lateral,
    z: sample.position.z + sample.left.z * lateral,
  }));
}

export interface RingPoint {
  x: number;
  z: number;
  /** Direction unitaire de la boucle en ce point. */
  dx: number;
  dz: number;
  /** Fraction du parcours de la boucle, dans [0, 1[. */
  fraction: number;
}

/**
 * Points régulièrement espacés (≈ `spacing` m) le long d'une boucle fermée.
 * `even` force un nombre pair de points (motifs alternés qui se referment proprement).
 */
export function resampleRing(ring: readonly Vec2[], spacing: number, even = false): RingPoint[] {
  const n = ring.length;
  if (n < 2) return [];
  const cumulative = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    cumulative[i + 1] = cumulative[i] + Math.hypot(b.x - a.x, b.z - a.z);
  }
  const total = cumulative[n];
  // Boucle dégénérée (points confondus, NaN) ou pas invalide : rien à répartir (évite 0/0).
  if (!(total > 0 && Number.isFinite(total) && spacing > 0)) return [];
  let count = Math.max(3, Math.round(total / spacing));
  if (even && count % 2 === 1) count++;
  const step = total / count;
  const points: RingPoint[] = [];
  let segment = 0;
  for (let k = 0; k < count; k++) {
    const target = k * step;
    while (segment < n - 1 && cumulative[segment + 1] <= target) segment++;
    const a = ring[segment];
    const b = ring[(segment + 1) % n];
    const span = cumulative[segment + 1] - cumulative[segment];
    const t = span > 0 ? (target - cumulative[segment]) / span : 0;
    const len = span > 0 ? span : 1;
    points.push({
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      dx: (b.x - a.x) / len,
      dz: (b.z - a.z) / len,
      fraction: target / total,
    });
  }
  return points;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Rectangle englobant la ligne médiane, élargi de `margin` m. */
export function trackBounds(track: TrackQuery, margin: number): Bounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const { position } of track.samples) {
    minX = Math.min(minX, position.x);
    maxX = Math.max(maxX, position.x);
    minZ = Math.min(minZ, position.z);
    maxZ = Math.max(maxZ, position.z);
  }
  return { minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin };
}
