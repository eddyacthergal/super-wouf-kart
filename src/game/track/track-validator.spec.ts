import { describe, expect, it } from 'vitest';
import { buildCenterline, type TrackCorner } from './centerline';
import { buildProfile } from './profile';
import { Track, createGardenTrack } from './track';
import { TRACK_RULES, validateTrack } from './track-validator';

/** Stade : deux droites de `straight` m, chaque bout est un demi-cercle de rayon `radius` (2 coins). */
function stadium(straight: number, radius: number): Track {
  const half = straight / 2;
  return new Track(
    buildCenterline({ x: 0, z: -radius }, [
      { x: half + radius, z: -radius, radius },
      { x: half + radius, z: radius, radius },
      { x: -half - radius, z: radius, radius },
      { x: -half - radius, z: -radius, radius },
    ]),
  );
}

/** Stade 300 × 45 avec relief : `extra[i]` complète le coin i. */
function hillyStadium(extra: Partial<TrackCorner>[]): Track {
  const corners: TrackCorner[] = [
    { x: 195, z: -45, radius: 45 },
    { x: 195, z: 45, radius: 45 },
    { x: -195, z: 45, radius: 45 },
    { x: -195, z: -45, radius: 45 },
  ].map((corner, i) => ({ ...corner, ...extra[i] }));
  const line = buildCenterline({ x: 0, z: -45 }, corners);
  return new Track(line, buildProfile(line, corners));
}

const rules = (track: Track): string[] => validateTrack(track).map((issue) => issue.rule);

describe('validateTrack', () => {
  it('accepte le Grand Jardin', () => {
    expect(validateTrack(createGardenTrack())).toEqual([]);
  });

  it('accepte un stade bien proportionné', () => {
    expect(validateTrack(stadium(240, 45))).toEqual([]);
  });

  it('refuse un tour trop court ou trop long', () => {
    expect(rules(stadium(60, 40))).toContain('minLength');
    expect(rules(stadium(300, 200))).toContain('minLength');
  });

  it('refuse un virage trop serré', () => {
    expect(rules(stadium(300, 10))).toContain('minRadius');
  });

  it('refuse deux portions du tracé trop proches', () => {
    // Stade très étroit : les deux lignes droites sont à 2 × 12 m, moins que deux murs + 6 m.
    expect(rules(stadium(360, 12))).toContain('corridorGap');
  });

  it('refuse un circuit qui dépasse la zone de jeu', () => {
    expect(rules(stadium(420, 40))).toContain('maxExtent');
  });

  it('refuse une boucle en 8', () => {
    const eight = new Track(
      buildCenterline({ x: 0, z: 0 }, [
        { x: -150, z: -60, radius: 40 },
        { x: -150, z: 60, radius: 40 },
        { x: 150, z: -60, radius: 40 },
        { x: 150, z: 60, radius: 40 },
      ]),
    );
    expect(rules(eight)).toContain('loop');
  });

  it('refuse un départ en virage', () => {
    const rounded = new Track(
      buildCenterline({ x: 0, z: -50 }, [
        { x: 50, z: -50, radius: 45 },
        { x: 50, z: 50, radius: 45 },
        { x: -50, z: 50, radius: 45 },
        { x: -50, z: -50, radius: 45 },
      ]),
    );
    expect(rules(rounded)).toContain('straightBefore');
  });

  it('expose ses seuils (rayon minimal 16 m, murs compris dans ±230 m)', () => {
    expect(TRACK_RULES.minRadius).toBe(16);
    expect(TRACK_RULES.maxExtent).toBe(230);
  });

  it('accepte un relief raisonnable (montée de 6 m, dévers de 12°)', () => {
    expect(
      validateTrack(hillyStadium([{ y: 0 }, { y: 6, bank: 12 }, { y: 6, bank: 12 }, { y: 0 }])),
    ).toEqual([]);
  });

  it('refuse une pente trop forte', () => {
    expect(rules(hillyStadium([{ y: 0 }, { y: 24 }, { y: 24 }, { y: 0 }]))).toContain('maxGrade');
  });

  it('refuse un dévers trop fort', () => {
    expect(rules(hillyStadium([{ y: 0 }, { y: 0, bank: 30 }]))).toContain('maxBank');
  });

  it('refuse une altitude hors de [0, 25] m', () => {
    expect(rules(hillyStadium([{ y: -2 }]))).toContain('minHeight');
    expect(rules(hillyStadium([{ y: 30 }]))).toContain('maxHeight');
  });

  it('refuse un départ en pente', () => {
    // Deux repères seulement (10 m et 0 m) : la ligne droite du départ est en pente d'environ 4 %.
    expect(rules(hillyStadium([{ y: 10 }, {}, {}, { y: 0 }]))).toContain('startMaxGrade');
  });

  it('affiche une décimale (pas un arrondi à l’entier) dans les messages de pente et de dévers', () => {
    const steep = hillyStadium([{ y: 0 }, { y: 24 }, { y: 24 }, { y: 0 }]);
    const grade = validateTrack(steep).find((issue) => issue.rule === 'maxGrade');
    expect(grade?.message).toMatch(/^Pente trop forte : \d+\.\d % > 20 %\.$/);

    const banked = hillyStadium([{ y: 0 }, { y: 0, bank: 30 }]);
    const bank = validateTrack(banked).find((issue) => issue.rule === 'maxBank');
    expect(bank?.message).toMatch(/^Dévers trop fort : \d+\.\d° > 20°\.$/);
  });

  it('affiche la limite (et une décimale) dans le message de pente au départ', () => {
    const steepStart = hillyStadium([{ y: 10 }, {}, {}, { y: 0 }]);
    const issue = validateTrack(steepStart).find((candidate) => candidate.rule === 'startMaxGrade');
    expect(issue?.message).toMatch(/^Départ en pente : \d+\.\d % > 2 % à -?\d+ m de la ligne\.$/);
  });

  it('refuse un sommet de côte trop vif', () => {
    // Repères serrés : 0 → 3 m → 0 sur 40 m de ligne droite.
    const corners: TrackCorner[] = [
      { x: 195, z: -45, radius: 45, y: 0 },
      { x: 195, z: 45, radius: 45, y: 0 },
      { x: 20, z: 45, y: 0 },
      { x: 0, z: 45, y: 3 },
      { x: -20, z: 45, y: 0 },
      { x: -195, z: 45, radius: 45, y: 0 },
      { x: -195, z: -45, radius: 45, y: 0 },
    ];
    const line = buildCenterline({ x: 0, z: -45 }, corners);
    expect(rules(new Track(line, buildProfile(line, corners)))).toContain('minCrestRadius');
  });
});
