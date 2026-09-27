/**
 * Profil d'un circuit le long de l'abscisse s : altitude (repères `y` des coins, interpolation cubique
 * monotone et périodique : ni palier à chaque repère, ni bosse entre deux repères égaux) et dévers
 * (valeur pleine sur l'arc, rampe linéaire avant et après). Aucune dépendance au rendu.
 */
import type { Centerline, CenterlineArc, TrackCorner } from './centerline';

export interface Profile {
  /** Altitude de la ligne médiane (m). */
  heightAt(s: number): number;
  /** Pente dh/ds (sans unité, 0,1 = 10 %). */
  gradeAt(s: number): number;
  /** Dévers signé (rad) : > 0 = la piste penche vers la gauche (bord gauche plus bas). */
  bankAt(s: number): number;
}

export const FLAT_PROFILE: Profile = {
  heightAt: () => 0,
  gradeAt: () => 0,
  bankAt: () => 0,
};

/** Longueur (m) de la rampe de dévers avant et après l'arc. */
export const BANK_RAMP = 15;

interface Key {
  s: number;
  y: number;
}

export function buildProfile(centerline: Centerline, corners: readonly TrackCorner[]): Profile {
  const { length } = centerline;
  const keys: Key[] = [];
  corners.forEach((corner, i) => {
    if (corner.y !== undefined) keys.push({ s: centerline.cornerS[i], y: corner.y });
  });
  const height = monotoneCubic(keys, length);
  const banks = corners.flatMap((corner, i) => {
    const arc = centerline.arcs[i];
    return arc && corner.bank ? [{ arc, value: ((corner.bank * Math.PI) / 180) * arc.turn }] : [];
  });
  return {
    heightAt: (s) => height.value(s),
    gradeAt: (s) => height.slope(s),
    bankAt: (s) =>
      banks.reduce((sum, { arc, value }) => sum + value * arcWeight(s, arc, length), 0),
  };
}

function wrap(s: number, length: number): number {
  return ((s % length) + length) % length;
}

/** 1 sur l'arc, décroissance linéaire sur BANK_RAMP m avant et après, 0 au-delà. */
function arcWeight(s: number, arc: CenterlineArc, length: number): number {
  const span = arc.end - arc.start;
  const rel = wrap(s - arc.start, length);
  if (rel <= span) return 1;
  const d = Math.min(rel - span, length - rel);
  return d < BANK_RAMP ? 1 - d / BANK_RAMP : 0;
}

/** Interpolation d'Hermite monotone (Fritsch-Carlson), périodique de période `length`. */
function monotoneCubic(
  keys: readonly Key[],
  length: number,
): { value(s: number): number; slope(s: number): number } {
  const n = keys.length;
  if (n === 0) return { value: () => 0, slope: () => 0 };
  if (n === 1) return { value: () => keys[0].y, slope: () => 0 };
  const h = keys.map((key, i) => (i < n - 1 ? keys[i + 1].s : keys[0].s + length) - key.s);
  const delta = keys.map((key, i) => (keys[(i + 1) % n].y - key.y) / h[i]);
  const m = keys.map((_, i) => {
    const prev = (i - 1 + n) % n;
    if (delta[prev] * delta[i] <= 0) return 0;
    const w1 = 2 * h[i] + h[prev];
    const w2 = h[i] + 2 * h[prev];
    return (w1 + w2) / (w1 / delta[prev] + w2 / delta[i]);
  });
  const locate = (s: number) => {
    const u = keys[0].s + wrap(s - keys[0].s, length);
    let i = n - 1;
    while (i > 0 && keys[i].s > u) i--;
    return { i, t: (u - keys[i].s) / h[i] };
  };
  return {
    value(s) {
      const { i, t } = locate(s);
      const t2 = t * t;
      const t3 = t2 * t;
      return (
        (2 * t3 - 3 * t2 + 1) * keys[i].y +
        (t3 - 2 * t2 + t) * h[i] * m[i] +
        (-2 * t3 + 3 * t2) * keys[(i + 1) % n].y +
        (t3 - t2) * h[i] * m[(i + 1) % n]
      );
    },
    slope(s) {
      const { i, t } = locate(s);
      const t2 = t * t;
      return (
        ((6 * t2 - 6 * t) * keys[i].y + (-6 * t2 + 6 * t) * keys[(i + 1) % n].y) / h[i] +
        (3 * t2 - 4 * t + 1) * m[i] +
        (3 * t2 - 2 * t) * m[(i + 1) % n]
      );
    },
  };
}
