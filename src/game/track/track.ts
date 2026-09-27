/**
 * Circuit : ligne médiane exacte (droites et arcs), rééchantillonnée à abscisse uniforme (~1 m).
 * s = 0 au point de départ ; la course suit les indices croissants.
 * Aucune dépendance à three.js : utilisable par la simulation et les tests en Node.
 */
import { ROAD_HALF_WIDTH, WALL_HALF_WIDTH } from '../core/constants';
import type {
  GridSlot,
  TrackProjection,
  TrackQuery,
  TrackSample,
  TrackSurface,
} from '../core/types';
import {
  addScaled,
  clamp,
  distanceSq,
  headingOf,
  normalize,
  wrapAngle,
  type Vec2,
} from '../core/vec2';
import type { Centerline } from './centerline';
import { buildCenterline } from './centerline';
import { findTrack, DEFAULT_TRACK_ID } from './catalog';
import { buildProfile, FLAT_PROFILE, type Profile } from './profile';
import { surfaceOf } from './surface';
import type { TrackDefinition } from './track-definition';

/** Demi-fenêtre (en échantillons) du lissage de la courbure. */
const CURVATURE_SMOOTHING = 3;
/** Demi-fenêtre (en échantillons) de la recherche locale de project() avec indice. */
const PROJECT_WINDOW = 40;
/** Nombre maximal de segments parcourus pendant l'affinage de project(). */
const PROJECT_REFINE_STEPS = 6;

/** Grille de départ : distance de la pole à la ligne, écart entre rangées, recul de la colonne de droite, décalage latéral. */
const GRID_FIRST_OFFSET = 12;
const GRID_ROW_SPACING = 7;
const GRID_STAGGER = 3.5;
const GRID_COLUMN_LATERAL = 3.5;

/** Rangées de boîtes à objets : positions visées (fractions du tour) et recherche d'une portion droite. */
const ITEM_ROW_FRACTIONS = [0.18, 0.5, 0.8] as const;
const ITEM_ROW_SEARCH = 40;
const ITEM_ROW_MAX_CURVATURE = 1 / 60;
/** Demi-longueur (m) de la portion qui doit rester quasi droite autour d'une rangée. */
const ITEM_ROW_CLEARANCE = 5;

export class Track implements TrackQuery {
  readonly length: number;
  readonly wallHalfWidth: number = WALL_HALF_WIDTH;
  readonly samples: readonly TrackSample[];
  readonly itemBoxRows: readonly number[];
  /** Pas exact entre deux échantillons (m). */
  private readonly step: number;

  constructor(centerline: Centerline, profile: Profile = FLAT_PROFILE) {
    const { points, cumulative, length } = centerline;
    if (!(Number.isFinite(length) && length > 0) || points.length < 4)
      throw new Error('Circuit dégénéré : longueur nulle ou non finie');
    this.length = length;
    const count = Math.max(8, Math.round(this.length));
    this.step = this.length / count;
    this.samples = buildSamples([...points, points[0]], cumulative, count, this.step, profile);
    this.itemBoxRows = ITEM_ROW_FRACTIONS.map((fraction) =>
      this.findStraightNear(fraction * this.length),
    ).sort((a, b) => a - b);
  }

  sampleAt(s: number): TrackSample {
    const wrapped = this.wrapS(s);
    const count = this.samples.length;
    const position = wrapped / this.step;
    const index = Math.min(Math.floor(position), count - 1);
    return interpolateSample(
      this.samples[index],
      this.samples[(index + 1) % count],
      position - index,
      wrapped,
    );
  }

  surfaceAt(s: number, lateral: number): TrackSurface {
    return surfaceOf(this.sampleAt(s), lateral);
  }

  /** L'indice ne fait qu'accélérer la recherche : entre les haies, le résultat est celui de la recherche globale. */
  project(point: Vec2, hintIndex?: number): TrackProjection {
    const count = this.samples.length;
    let index = -1;
    if (hintIndex !== undefined && Number.isFinite(hintIndex)) {
      const span = Math.min(count, 2 * PROJECT_WINDOW + 1);
      const start = Math.round(hintIndex) - PROJECT_WINDOW;
      const rank = this.nearestInRange(point, start, span);
      const candidate = this.wrapIndex(start + rank);
      const limit = 2 * this.wallHalfWidth;
      // Minimum au bord de la fenêtre : le vrai minimum peut être au-delà (indice périmé).
      const atEdge = span < count && (rank === 0 || rank === span - 1);
      if (!atEdge && distanceSq(point, this.samples[candidate].position) <= limit * limit)
        index = candidate;
    }
    if (index < 0) index = this.nearestInRange(point, 0, count);

    // Affinage : on cherche sur les segments voisins le point dont la normale interpolée passe par `point`,
    // ce qui fait de project() l'inverse exact de sampleAt(s).position + left × lateral.
    // On part du segment [index, index+1] et on glisse vers le voisin tant que la solution en sort
    // (arrêt si le sens s'inverse : la solution est alors pile sur un échantillon).
    let segment = index;
    let u = 0;
    let direction = 0;
    for (let i = 0; i < PROJECT_REFINE_STEPS; i++) {
      u = this.solveOnSegment(point, segment);
      const next = u < 0 ? -1 : u > 1 ? 1 : 0;
      if (next === 0 || next === -direction) break;
      direction = next;
      segment = (segment + next + count) % count;
    }
    const sample = this.sampleAt((segment + clamp(u, 0, 1)) * this.step);
    const lateral =
      (point.x - sample.position.x) * sample.left.x + (point.z - sample.position.z) * sample.left.z;
    return { s: sample.s, lateral, index: Math.round(sample.s / this.step) % count, sample };
  }

  gridSlot(index: number): GridSlot {
    const progress = -(
      GRID_FIRST_OFFSET +
      Math.floor(index / 2) * GRID_ROW_SPACING +
      (index % 2) * GRID_STAGGER
    );
    const sample = this.sampleAt(progress);
    const lateral = index % 2 === 0 ? GRID_COLUMN_LATERAL : -GRID_COLUMN_LATERAL;
    return {
      position: addScaled(sample.position, sample.left, lateral),
      heading: headingOf(sample.tangent),
      progress,
    };
  }

  /** Ramène s dans [0, length[ ; une abscisse non finie (NaN, ±∞) donne 0 au lieu de faire planter l'appelant. */
  private wrapS(s: number): number {
    if (!Number.isFinite(s)) return 0;
    const wrapped = ((s % this.length) + this.length) % this.length;
    return wrapped < this.length ? wrapped : 0;
  }

  private wrapIndex(i: number): number {
    const count = this.samples.length;
    return ((i % count) + count) % count;
  }

  /** Rang (0 à span - 1) de l'échantillon le plus proche parmi `span` échantillons consécutifs dès `start` (bouclé). */
  private nearestInRange(point: Vec2, start: number, span: number): number {
    let best = 0;
    let bestDistance = Infinity;
    for (let k = 0; k < span; k++) {
      const d = distanceSq(point, this.samples[this.wrapIndex(start + k)].position);
      if (d < bestDistance) {
        bestDistance = d;
        best = k;
      }
    }
    return best;
  }

  /**
   * Paramètre u du segment [i, i+1] où (point - P(u)) est orthogonal à la tangente interpolée T(u),
   * avec P et T linéaires en u : racine d'un polynôme de degré 2 (la plus proche de la solution linéaire).
   */
  private solveOnSegment(point: Vec2, i: number): number {
    const a = this.samples[i];
    const b = this.samples[(i + 1) % this.samples.length];
    const rx = point.x - a.position.x;
    const rz = point.z - a.position.z;
    const dx = b.position.x - a.position.x;
    const dz = b.position.z - a.position.z;
    const ex = b.tangent.x - a.tangent.x;
    const ez = b.tangent.z - a.tangent.z;
    // f(u) = (r - u·d)·(t_a + u·e) = c + b1·u + a2·u²
    const a2 = -(dx * ex + dz * ez);
    const b1 = rx * ex + rz * ez - (dx * a.tangent.x + dz * a.tangent.z);
    const c = rx * a.tangent.x + rz * a.tangent.z;
    if (b1 === 0) return 0;
    const discriminant = b1 * b1 - 4 * a2 * c;
    // Point au-delà du centre de courbure : on se contente de la solution linéaire.
    if (discriminant < 0) return -c / b1;
    return (-2 * c) / (b1 + Math.sign(b1) * Math.sqrt(discriminant));
  }

  /**
   * Abscisse la plus proche de `target` (±ITEM_ROW_SEARCH m) sur une portion quasi droite ;
   * à défaut, la moins courbe de la zone de recherche.
   */
  private findStraightNear(target: number): number {
    let best = this.wrapS(target);
    let bestCurvature = Infinity;
    for (let offset = 0; offset <= ITEM_ROW_SEARCH; offset++) {
      for (const s of offset === 0 ? [target] : [target + offset, target - offset]) {
        const curvature = this.maxCurvatureAround(s);
        if (curvature < ITEM_ROW_MAX_CURVATURE) return this.wrapS(s);
        if (curvature < bestCurvature) {
          bestCurvature = curvature;
          best = this.wrapS(s);
        }
      }
    }
    return best;
  }

  /** |courbure| maximale sur [s - ITEM_ROW_CLEARANCE, s + ITEM_ROW_CLEARANCE] (évite le point d'inflexion d'un S). */
  private maxCurvatureAround(s: number): number {
    let max = 0;
    for (let d = -ITEM_ROW_CLEARANCE; d <= ITEM_ROW_CLEARANCE; d++) {
      max = Math.max(max, Math.abs(this.sampleAt(s + d).curvature));
    }
    return max;
  }
}

/** Circuit construit à partir de sa définition : ligne médiane et profil. */
export function createTrack(definition: TrackDefinition): Track {
  const centerline = buildCenterline(definition.start, definition.corners);
  return new Track(centerline, buildProfile(centerline, definition.corners));
}

/** Circuit par défaut du catalogue, le Grand Jardin (raccourci pour les tests). */
export function createGardenTrack(): Track {
  return createTrack(findTrack(DEFAULT_TRACK_ID));
}

/**
 * Ligne médiane sous-échantillonnée pour la mini-carte : un point tous les `step` échantillons (~1 m chacun),
 * puis une copie du premier point pour refermer le tracé. Un pas invalide (< 1 ou NaN) vaut 1.
 */
export function trackOutline(track: TrackQuery, step = 8): Vec2[] {
  if (track.samples.length === 0) return [];
  const stride = Math.max(1, Math.round(step) || 1);
  const outline: Vec2[] = [];
  for (let i = 0; i < track.samples.length; i += stride) {
    const { x, z } = track.samples[i].position;
    outline.push({ x, z });
  }
  outline.push({ ...outline[0] });
  return outline;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/** Rééchantillonne la polyligne à pas constant, puis calcule tangentes, normales, courbure lissée et profil. */
function buildSamples(
  points: readonly Vec2[],
  cumulative: readonly number[],
  count: number,
  step: number,
  profile: Profile,
): TrackSample[] {
  const positions: Vec2[] = [];
  let segment = 0;
  for (let k = 0; k < count; k++) {
    const target = k * step;
    while (segment < points.length - 2 && cumulative[segment + 1] <= target) segment++;
    const span = cumulative[segment + 1] - cumulative[segment];
    const t = span > 0 ? (target - cumulative[segment]) / span : 0;
    const a = points[segment];
    const b = points[segment + 1];
    positions.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  }

  const tangents = positions.map((_, i) => {
    const prev = positions[(i - 1 + count) % count];
    const next = positions[(i + 1) % count];
    return normalize({ x: next.x - prev.x, z: next.z - prev.z });
  });
  const headings = tangents.map(headingOf);
  const rawCurvature = headings.map(
    (_, i) => wrapAngle(headings[(i + 1) % count] - headings[(i - 1 + count) % count]) / (2 * step),
  );

  return positions.map((position, i) => {
    let sum = 0;
    for (let k = -CURVATURE_SMOOTHING; k <= CURVATURE_SMOOTHING; k++)
      sum += rawCurvature[(i + k + count) % count];
    const tangent = tangents[i];
    return {
      s: i * step,
      position,
      tangent,
      left: { x: tangent.z, z: -tangent.x },
      halfWidth: ROAD_HALF_WIDTH,
      curvature: sum / (2 * CURVATURE_SMOOTHING + 1),
      height: profile.heightAt(i * step),
      grade: profile.gradeAt(i * step),
      bank: profile.bankAt(i * step),
    };
  });
}

/** Interpolation linéaire entre deux échantillons voisins (tangente et normale renormalisées). */
function interpolateSample(a: TrackSample, b: TrackSample, t: number, s: number): TrackSample {
  const tangent = normalize({
    x: a.tangent.x + (b.tangent.x - a.tangent.x) * t,
    z: a.tangent.z + (b.tangent.z - a.tangent.z) * t,
  });
  return {
    s,
    position: {
      x: a.position.x + (b.position.x - a.position.x) * t,
      z: a.position.z + (b.position.z - a.position.z) * t,
    },
    tangent,
    left: { x: tangent.z, z: -tangent.x },
    halfWidth: a.halfWidth + (b.halfWidth - a.halfWidth) * t,
    curvature: a.curvature + (b.curvature - a.curvature) * t,
    height: a.height + (b.height - a.height) * t,
    grade: a.grade + (b.grade - a.grade) * t,
    bank: a.bank + (b.bank - a.bank) * t,
  };
}
