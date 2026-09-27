/**
 * Relief du sol autour de la piste (rendu : sol, décor, haies, caméra, effets). Entre les haies : la
 * surface de la route (légèrement dessous pour le maillage du sol). Au-delà : un mélange des portions
 * de piste proches, pondéré par la distance, qui redescend au niveau 0 sur TERRAIN_FADE m.
 * Sans relief (circuit plat), tout vaut 0 et rien n'est calculé.
 */
import type { TrackQuery, TrackSample } from '../core/types';
import { clamp } from '../core/vec2';

export interface Terrain {
  /** Vrai si le circuit a de l'altitude ou du dévers. */
  readonly hilly: boolean;
  /** Hauteur du maillage du sol (sous la route entre les haies). */
  heightAt(x: number, z: number): number;
  /** Hauteur où poser un objet : surface de la route entre les haies, relief au-delà. */
  groundAt(x: number, z: number): number;
}

export const FLAT_TERRAIN: Terrain = { hilly: false, heightAt: () => 0, groundAt: () => 0 };

/** Distance (m) au-delà des haies sur laquelle le relief redescend au niveau 0. */
export const TERRAIN_FADE = 40;
/**
 * Le maillage du sol reste sous la route de cet écart (m) : assez pour rester sous la route même au
 * milieu d'un triangle de 4 m sur une route courbe et relevée (le maillage est plan par triangle).
 */
const UNDER_ROAD = 0.15;
/** Taille des cellules de recherche des échantillons (m). */
const CELL = 12;

export function createTerrain(track: TrackQuery): Terrain {
  const hilly = track.samples.some((sample) => sample.height !== 0 || sample.bank !== 0);
  if (!hilly) return FLAT_TERRAIN;
  const wall = track.wallHalfWidth;
  const reach = wall + TERRAIN_FADE;
  const cells = new Map<string, TrackSample[]>();
  const key = (cx: number, cz: number) => `${cx},${cz}`;
  for (const sample of track.samples) {
    const k = key(Math.floor(sample.position.x / CELL), Math.floor(sample.position.z / CELL));
    const list = cells.get(k);
    if (list) list.push(sample);
    else cells.set(k, [sample]);
  }
  let hint = 0;

  /** Hauteur hors de la route : mélange des plans des échantillons proches, fondu vers 0. */
  const around = (x: number, z: number): { height: number; nearest: number } => {
    const span = Math.ceil(reach / CELL);
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    let weights = 0;
    let sum = 0;
    let nearest = Infinity;
    for (let i = cx - span; i <= cx + span; i++) {
      for (let j = cz - span; j <= cz + span; j++) {
        for (const sample of cells.get(key(i, j)) ?? []) {
          const dx = x - sample.position.x;
          const dz = z - sample.position.z;
          const d = Math.hypot(dx, dz);
          if (d > reach) continue;
          nearest = Math.min(nearest, d);
          const lateral = clamp(dx * sample.left.x + dz * sample.left.z, -wall, wall);
          const along = dx * sample.tangent.x + dz * sample.tangent.z;
          const h = sample.height + sample.grade * along - lateral * Math.tan(sample.bank);
          const w = 1 / (d * d * d * d + 1e-3);
          weights += w;
          sum += w * h;
        }
      }
    }
    if (weights === 0) return { height: 0, nearest };
    const t = clamp(1 - (nearest - wall) / TERRAIN_FADE, 0, 1);
    const fade = t * t * (3 - 2 * t);
    return { height: (sum / weights) * fade, nearest };
  };

  const surface = (x: number, z: number): number | null => {
    const projection = track.project({ x, z }, hint);
    hint = projection.index;
    if (Math.abs(projection.lateral) > wall) return null;
    return track.surfaceAt(projection.s, projection.lateral).height;
  };

  const groundAt = (x: number, z: number): number => {
    const { height, nearest } = around(x, z);
    if (nearest > wall + 1) return height;
    return surface(x, z) ?? height;
  };
  return {
    hilly,
    groundAt,
    heightAt(x, z) {
      const { height, nearest } = around(x, z);
      if (nearest > wall + 1) return height;
      const road = surface(x, z);
      return road === null ? height : road - UNDER_ROAD;
    },
  };
}
