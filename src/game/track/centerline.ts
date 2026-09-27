/**
 * Ligne médiane d'un circuit décrit par ses coins : polygone fermé, parcouru dans l'ordre des coins,
 * dont chaque coin muni d'un rayon devient un arc tangent aux deux droites voisines. Un coin sans
 * rayon est un simple repère (d'altitude) sur une droite. Aucune dépendance au rendu.
 */
import {
  distance,
  headingOf,
  leftOfDirection,
  normalize,
  wrapAngle,
  type Vec2,
} from '../core/vec2';
import { CircuitError } from './circuit-error';

/** Coin du polygone : position (m), rayon de l'arc (m), altitude au sommet (m), dévers (°). */
export interface TrackCorner {
  x: number;
  z: number;
  radius?: number;
  y?: number;
  bank?: number;
}

export interface CenterlineArc {
  /** Abscisses de début et de fin de l'arc (m). */
  start: number;
  end: number;
  /** +1 = virage à gauche, -1 = virage à droite. */
  turn: 1 | -1;
}

export interface Centerline {
  /** Polyligne fermée, pas ≤ 0,25 m ; points[0] = départ, non répété à la fin. */
  points: Vec2[];
  /** Abscisse de chaque point ; cumulative[points.length] = length (retour au départ). */
  cumulative: number[];
  length: number;
  /** Abscisse de référence de chaque coin : milieu de l'arc, ou le repère lui-même. */
  cornerS: number[];
  /** Arc de chaque coin (null : repère sans rayon, ou coin sans déviation). */
  arcs: (CenterlineArc | null)[];
}

/** Pas maximal de la polyligne (m). */
const STEP = 0.25;
const DEG = Math.PI / 180;
const MAX_DEFLECTION = 150 * DEG;
const WAYPOINT_TOLERANCE = 1 * DEG;
/** Écart toléré (m) entre le point de départ et la droite qui arrive au premier coin. */
const START_TOLERANCE = 0.5;
const EPSILON = 1e-6;

interface CornerGeometry {
  /** Direction d'arrivée et de départ (unitaires). */
  dirIn: Vec2;
  dirOut: Vec2;
  /** Déviation signée (rad, > 0 = gauche). */
  deflection: number;
  /** Distance du coin aux points de tangence (0 sans arc). */
  tangent: number;
  radius: number;
}

export function buildCenterline(start: Vec2, corners: readonly TrackCorner[]): Centerline {
  const n = corners.length;
  if (n < 3) throw new CircuitError(['Il faut au moins 3 coins.']);
  const issues: string[] = [];
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    if (distance(corners[i], corners[next]) < EPSILON)
      issues.push(`Coins ${i + 1} et ${next + 1} confondus.`);
  }
  if (issues.length > 0) throw new CircuitError(issues);

  const geometry = corners.map((corner, i) => {
    const prev = corners[(i - 1 + n) % n];
    const next = corners[(i + 1) % n];
    const dirIn = normalize({ x: corner.x - prev.x, z: corner.z - prev.z });
    const dirOut = normalize({ x: next.x - corner.x, z: next.z - corner.z });
    const deflection = wrapAngle(headingOf(dirOut) - headingOf(dirIn));
    const radius = corner.radius ?? 0;
    if (radius > 0 && Math.abs(deflection) > MAX_DEFLECTION)
      issues.push(
        `Coin ${i + 1} : virage de ${Math.round(Math.abs(deflection) / DEG)}°, au-delà de 150° il faut deux coins.`,
      );
    if (radius <= 0 && Math.abs(deflection) > WAYPOINT_TOLERANCE)
      issues.push(
        `Coin ${i + 1} : la ligne tourne de ${Math.round(Math.abs(deflection) / DEG)}° ici, il faut un rayon.`,
      );
    const tangent = radius > 0 ? radius * Math.tan(Math.abs(deflection) / 2) : 0;
    return { dirIn, dirOut, deflection, tangent, radius } satisfies CornerGeometry;
  });

  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    const edge = distance(corners[i], corners[next]);
    const needed = geometry[i].tangent + geometry[next].tangent;
    if (needed > edge + EPSILON)
      issues.push(
        `Coins ${i + 1} et ${next + 1} : rayons trop grands, il faudrait ${needed.toFixed(1)} m entre eux, il y en a ${edge.toFixed(1)}.`,
      );
  }

  // Départ : sur la droite qui va du dernier coin (après son arc) au premier (avant son arc).
  const last = n - 1;
  const lineStart = tangentOut(corners[last], geometry[last]);
  const lineEnd = tangentIn(corners[0], geometry[0]);
  const dir = geometry[0].dirIn;
  const along = (start.x - lineStart.x) * dir.x + (start.z - lineStart.z) * dir.z;
  const left = leftOfDirection(dir);
  const across = (start.x - lineStart.x) * left.x + (start.z - lineStart.z) * left.z;
  const span = distance(lineStart, lineEnd);
  if (Math.abs(across) > START_TOLERANCE || along < -EPSILON || along > span + EPSILON)
    issues.push(
      `Le départ (${start.x}, ${start.z}) doit être sur la ligne droite qui va du coin ${n} au coin 1.`,
    );
  if (issues.length > 0) throw new CircuitError(issues);

  const origin = { x: lineStart.x + dir.x * along, z: lineStart.z + dir.z * along };
  const points: Vec2[] = [];
  const marks: {
    cornerIndex: number[];
    arcs: ({ from: number; to: number; turn: 1 | -1 } | null)[];
  } = { cornerIndex: [], arcs: [] };

  pushLine(points, origin, lineEnd);
  for (let i = 0; i < n; i++) {
    const g = geometry[i];
    const hasArc = g.tangent > EPSILON;
    if (hasArc) {
      const from = points.length;
      const mid = pushArc(points, corners[i], g);
      marks.cornerIndex.push(mid);
      marks.arcs.push({ from, to: points.length, turn: g.deflection > 0 ? 1 : -1 });
    } else {
      marks.cornerIndex.push(points.length);
      marks.arcs.push(null);
    }
    const nextIn = i === last ? origin : tangentIn(corners[i + 1], geometry[i + 1]);
    pushLine(points, tangentOut(corners[i], g), nextIn);
  }

  const cumulative = [0];
  for (let i = 1; i <= points.length; i++) {
    cumulative.push(cumulative[i - 1] + distance(points[i - 1], points[i % points.length]));
  }
  const length = cumulative[points.length];
  return {
    points,
    cumulative,
    length,
    cornerS: marks.cornerIndex.map((index) => cumulative[index]),
    arcs: marks.arcs.map((arc) =>
      arc ? { start: cumulative[arc.from], end: cumulative[arc.to], turn: arc.turn } : null,
    ),
  };
}

function tangentIn(corner: TrackCorner, g: CornerGeometry): Vec2 {
  return { x: corner.x - g.dirIn.x * g.tangent, z: corner.z - g.dirIn.z * g.tangent };
}

function tangentOut(corner: TrackCorner, g: CornerGeometry): Vec2 {
  return { x: corner.x + g.dirOut.x * g.tangent, z: corner.z + g.dirOut.z * g.tangent };
}

/** Ajoute les points de [from, to[ (to exclu : c'est le premier point du morceau suivant). */
function pushLine(points: Vec2[], from: Vec2, to: Vec2): void {
  const length = distance(from, to);
  if (length < EPSILON) return;
  const count = Math.ceil(length / STEP);
  for (let k = 0; k < count; k++) {
    const t = k / count;
    points.push({ x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t });
  }
}

/** Ajoute les points de l'arc du coin (fin exclue) ; renvoie l'indice du point du milieu. */
function pushArc(points: Vec2[], corner: TrackCorner, g: CornerGeometry): number {
  const turn = g.deflection > 0 ? 1 : -1;
  const entry = tangentIn(corner, g);
  const left = leftOfDirection(g.dirIn);
  // Centre : du côté intérieur du virage (à gauche pour un virage à gauche).
  const center = { x: entry.x + left.x * g.radius * turn, z: entry.z + left.z * g.radius * turn };
  const arcLength = g.radius * Math.abs(g.deflection);
  const count = Math.max(1, Math.ceil(arcLength / STEP));
  const heading0 = headingOf(g.dirIn);
  const first = points.length;
  for (let k = 0; k < count; k++) {
    const heading = heading0 + (turn * (arcLength * k)) / count / g.radius;
    // P(θ) = C − turn · R · gauche(θ), avec gauche(θ) = (cos θ, −sin θ).
    points.push({
      x: center.x - turn * g.radius * Math.cos(heading),
      z: center.z + turn * g.radius * Math.sin(heading),
    });
  }
  return first + Math.floor(count / 2);
}
