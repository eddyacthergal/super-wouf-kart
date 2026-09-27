/**
 * Règles communes à tous les circuits, vérifiées sur le tracé échantillonné (comme une validation
 * métier) : chaque circuit du catalogue doit les respecter, sinon les tests échouent. Les règles
 * propres à un circuit (épingle du jardin…) restent dans ses propres tests.
 */
import { WALL_HALF_WIDTH } from '../core/constants';
import type { TrackQuery } from '../core/types';
import { distance, headingOf, wrapAngle } from '../core/vec2';

export const TRACK_RULES = {
  /** Longueur d'un tour (m) : ni course éclair, ni tour interminable. */
  minLength: 500,
  maxLength: 1400,
  /** Rayon de virage minimal (m) : en dessous, karts et IA ne suivent plus. */
  minRadius: 16,
  /** Ligne droite autour du départ (m) : la grille recule de ~40 m, l'arche et la ligne sont droites. */
  straightBefore: 60,
  straightAfter: 40,
  straightMaxCurvature: 1 / 200,
  straightMaxHeadingDrift: 0.01,
  /** Deux portions éloignées de plus de `corridorSpan` m sur le tracé restent à `corridorGap` m. */
  corridorSpan: 60,
  corridorGap: 2 * WALL_HALF_WIDTH + 6,
  /** Le circuit (murs compris) tient dans [-maxExtent, maxExtent]² : sol, décor et brouillard. */
  maxExtent: 230,
  /** Rangées de boîtes d'objets : au moins ce nombre, espacées d'au moins `itemRowGap` m. */
  itemRows: 3,
  itemRowGap: 100,
  /** Pente maximale (0,2 = 20 %) : au-delà, la côte bloque et la descente jette dans les haies. */
  maxGrade: 0.2,
  /** Dévers maximal (degrés). */
  maxBank: 20,
  /** Altitude de la ligne médiane (m) : le sol de base est à 0, le brouillard cache au-delà de 25 m. */
  minHeight: 0,
  maxHeight: 25,
  /** Pente maximale autour du départ (sur straightBefore / straightAfter) : la grille est à plat. */
  startMaxGrade: 0.02,
  /** Rayon vertical minimal (m) d'un sommet de côte : pas de décollage tant que les sauts n'existent pas. */
  minCrestRadius: 40,
} as const;

export interface TrackIssue {
  rule: keyof typeof TRACK_RULES | 'loop';
  message: string;
}

/** Problèmes du tracé (liste vide : circuit valide). */
export function validateTrack(track: TrackQuery): TrackIssue[] {
  const issues: TrackIssue[] = [];
  const { samples, length } = track;
  const n = samples.length;
  const step = length / n;
  const R = TRACK_RULES;

  if (length < R.minLength || length > R.maxLength) {
    issues.push({
      rule: 'minLength',
      message: `Longueur ${Math.round(length)} m hors de [${R.minLength}, ${R.maxLength}] m.`,
    });
  }

  // Une seule boucle, dans un sens ou dans l'autre : le cap tourne de ±360° exactement.
  let turning = 0;
  for (let i = 0; i < n; i++) {
    turning += wrapAngle(headingOf(samples[(i + 1) % n].tangent) - headingOf(samples[i].tangent));
  }
  if (Math.abs(Math.abs(turning) - 2 * Math.PI) > 0.05) {
    issues.push({
      rule: 'loop',
      message: `Le tracé tourne de ${Math.round((turning * 180) / Math.PI)}° au lieu de ±360° (boucle en 8 ou repliée).`,
    });
  }

  const tightest = samples.reduce((max, sample) => Math.max(max, Math.abs(sample.curvature)), 0);
  if (tightest > 1 / R.minRadius) {
    issues.push({
      rule: 'minRadius',
      message: `Virage trop serré : rayon ${(1 / tightest).toFixed(1)} m < ${R.minRadius} m.`,
    });
  }

  const startHeading = headingOf(samples[0].tangent);
  for (let s = -R.straightBefore; s <= R.straightAfter; s += 1) {
    const sample = track.sampleAt(s);
    const drift = Math.abs(wrapAngle(headingOf(sample.tangent) - startHeading));
    if (
      Math.abs(sample.curvature) >= R.straightMaxCurvature ||
      drift >= R.straightMaxHeadingDrift
    ) {
      issues.push({
        rule: 'straightBefore',
        message: `Pas de ligne droite au départ (courbe à ${s} m de la ligne).`,
      });
      break;
    }
  }

  let closest = Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const gap = Math.abs(i - j) * step;
      if (Math.min(gap, length - gap) <= R.corridorSpan) continue;
      closest = Math.min(closest, distance(samples[i].position, samples[j].position));
    }
  }
  if (closest < R.corridorGap) {
    issues.push({
      rule: 'corridorGap',
      message: `Deux portions du tracé se frôlent : ${closest.toFixed(1)} m < ${R.corridorGap} m.`,
    });
  }

  const extent = samples.reduce(
    (max, { position }) => Math.max(max, Math.abs(position.x), Math.abs(position.z)),
    0,
  );
  if (extent + track.wallHalfWidth > R.maxExtent) {
    issues.push({
      rule: 'maxExtent',
      message: `Le circuit dépasse la zone de jeu : ${Math.round(extent + track.wallHalfWidth)} m > ${R.maxExtent} m.`,
    });
  }

  const steepest = samples.reduce((max, sample) => Math.max(max, Math.abs(sample.grade)), 0);
  if (steepest > R.maxGrade)
    issues.push({
      rule: 'maxGrade',
      message: `Pente trop forte : ${Math.round(steepest * 100)} % > ${R.maxGrade * 100} %.`,
    });

  const bankiest = samples.reduce((max, sample) => Math.max(max, Math.abs(sample.bank)), 0);
  if (bankiest > (R.maxBank * Math.PI) / 180 + 1e-9)
    issues.push({
      rule: 'maxBank',
      message: `Dévers trop fort : ${Math.round((bankiest * 180) / Math.PI)}° > ${R.maxBank}°.`,
    });

  const lowest = Math.min(...samples.map((sample) => sample.height));
  const highest = Math.max(...samples.map((sample) => sample.height));
  if (lowest < R.minHeight - 1e-9)
    issues.push({
      rule: 'minHeight',
      message: `Altitude trop basse : ${lowest.toFixed(1)} m < ${R.minHeight} m.`,
    });
  if (highest > R.maxHeight + 1e-9)
    issues.push({
      rule: 'maxHeight',
      message: `Altitude trop haute : ${highest.toFixed(1)} m > ${R.maxHeight} m.`,
    });

  for (let s = -R.straightBefore; s <= R.straightAfter; s += 1) {
    const grade = track.sampleAt(s).grade;
    if (Math.abs(grade) > R.startMaxGrade) {
      issues.push({
        rule: 'startMaxGrade',
        message: `Départ en pente (${Math.round(grade * 100)} % à ${s} m de la ligne).`,
      });
      break;
    }
  }

  // Sommet de côte : la pente diminue ; rayon vertical = 1 / |dpente/ds|.
  let sharpestCrest = 0;
  for (let i = 0; i < n; i++) {
    const change = (samples[(i + 1) % n].grade - samples[(i - 1 + n) % n].grade) / (2 * step);
    if (change < 0) sharpestCrest = Math.max(sharpestCrest, -change);
  }
  if (sharpestCrest > 1 / R.minCrestRadius)
    issues.push({
      rule: 'minCrestRadius',
      message: `Sommet de côte trop vif : rayon ${(1 / sharpestCrest).toFixed(0)} m < ${R.minCrestRadius} m.`,
    });

  const rows = [...track.itemBoxRows].sort((a, b) => a - b);
  const rowGaps = rows.map((row, k) => {
    const next = k + 1 < rows.length ? rows[k + 1] : rows[0] + length;
    return next - row;
  });
  if (rows.length < R.itemRows || rowGaps.some((gap) => gap < R.itemRowGap)) {
    issues.push({
      rule: 'itemRows',
      message: `Rangées de boîtes d'objets insuffisantes ou trop rapprochées (${rows.length}).`,
    });
  }

  return issues;
}
