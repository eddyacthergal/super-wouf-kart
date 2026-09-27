import { describe, expect, it } from 'vitest';
import { buildCenterline } from './centerline';
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
});
