import { describe, expect, it } from 'vitest';
import { buildCenterline, type TrackCorner } from './centerline';
import { BANK_RAMP, FLAT_PROFILE, buildProfile } from './profile';

const START = { x: 0, z: -50 };
const corners = (extra: Partial<TrackCorner>[]): TrackCorner[] =>
  [
    { x: -100, z: -50, radius: 20 },
    { x: -100, z: 50, radius: 20 },
    { x: 100, z: 50, radius: 20 },
    { x: 100, z: -50, radius: 20 },
  ].map((corner, i) => ({ ...corner, ...extra[i] }));

function profileOf(extra: Partial<TrackCorner>[]) {
  const list = corners(extra);
  const line = buildCenterline(START, list);
  return { line, profile: buildProfile(line, list) };
}

describe('buildProfile — altitude', () => {
  it('circuit plat sans aucun y ; altitude constante avec un seul y', () => {
    expect(profileOf([]).profile.heightAt(123)).toBe(0);
    const { profile } = profileOf([{}, { y: 4 }]);
    expect(profile.heightAt(0)).toBe(4);
    expect(profile.gradeAt(300)).toBe(0);
  });

  it('passe par chaque repère, sans jamais dépasser les valeurs données', () => {
    const { line, profile } = profileOf([{ y: 0 }, { y: 6 }, { y: 6 }, { y: 2 }]);
    line.cornerS.forEach((s, i) => expect(profile.heightAt(s)).toBeCloseTo([0, 6, 6, 2][i], 9));
    for (let s = 0; s < line.length; s += 0.5) {
      expect(profile.heightAt(s)).toBeGreaterThanOrEqual(-1e-9);
      expect(profile.heightAt(s)).toBeLessThanOrEqual(6 + 1e-9);
    }
  });

  it('reste parfaitement plat entre deux repères de même altitude (faux plat sans bosse)', () => {
    const { line, profile } = profileOf([{ y: 0 }, { y: 6 }, { y: 6 }, { y: 2 }]);
    for (let s = line.cornerS[1]; s <= line.cornerS[2]; s += 1)
      expect(profile.heightAt(s)).toBeCloseTo(6, 9);
  });

  it("monte sans palier au repère intermédiaire d'une montée continue", () => {
    const { line, profile } = profileOf([{ y: 0 }, { y: 4 }, { y: 8 }, { y: 4 }]);
    expect(profile.gradeAt(line.cornerS[1])).toBeGreaterThan(0.01);
  });

  it("boucle sans cassure au départ et donne la pente dérivée de l'altitude", () => {
    const { line, profile } = profileOf([{ y: 2 }, { y: 6 }, {}, { y: 4 }]);
    expect(profile.heightAt(line.length - 1e-6)).toBeCloseTo(profile.heightAt(0), 5);
    for (const s of [10, 200, 480]) {
      const numeric = (profile.heightAt(s + 0.01) - profile.heightAt(s - 0.01)) / 0.02;
      expect(profile.gradeAt(s)).toBeCloseTo(numeric, 4);
    }
    expect(profile.heightAt(-5)).toBeCloseTo(profile.heightAt(line.length - 5), 9);
  });
});

describe('buildProfile — dévers', () => {
  it("pleine valeur sur l'arc, vers l'intérieur (gauche > 0), rampe de 15 m de part et d'autre", () => {
    const { line, profile } = profileOf([{ bank: 12 }]);
    const arc = line.arcs[0]!;
    const full = (12 * Math.PI) / 180;
    expect(profile.bankAt((arc.start + arc.end) / 2)).toBeCloseTo(full, 9);
    expect(profile.bankAt(arc.start - BANK_RAMP / 2)).toBeCloseTo(full / 2, 6);
    expect(profile.bankAt(arc.end + BANK_RAMP / 2)).toBeCloseTo(full / 2, 6);
    expect(profile.bankAt(arc.start - BANK_RAMP - 1)).toBe(0);
  });

  it('penche vers la droite (valeur négative) dans un virage à droite', () => {
    const list = corners([{ bank: 10 }]).reverse();
    const line = buildCenterline(START, list);
    const profile = buildProfile(line, list);
    const arc = line.arcs[3]!;
    expect(profile.bankAt((arc.start + arc.end) / 2)).toBeLessThan(0);
  });

  it('normalise le dévers à la jonction de deux arcs relevés qui se touchent (pas de double comptage)', () => {
    // Deux coins contigus (comme un virage de plus de 150° écrit en deux coins) : l'arc du coin 0
    // se termine exactement où commence l'arc du coin 1 (aucune droite entre les deux).
    const start = { x: -50, z: 0 };
    const list: TrackCorner[] = [
      { x: 0, z: 0, radius: 20, bank: 12 },
      { x: 0, z: 40, radius: 20, bank: 12 },
      { x: -100, z: 40, radius: 5 },
      { x: -100, z: 0, radius: 5 },
    ];
    const line = buildCenterline(start, list);
    const profile = buildProfile(line, list);
    const arc0 = line.arcs[0]!;
    const arc1 = line.arcs[1]!;
    expect(arc0.end).toBeCloseTo(arc1.start, 9);
    const full = (12 * Math.PI) / 180;
    expect(Math.abs(profile.bankAt(arc0.end))).toBeCloseTo(full, 6);
    for (let s = 0; s < line.length; s += 0.5) {
      expect(Math.abs(profile.bankAt(s))).toBeLessThanOrEqual(full + 1e-9);
    }
  });

  it('le profil plat vaut 0 partout', () => {
    expect([FLAT_PROFILE.heightAt(3), FLAT_PROFILE.gradeAt(3), FLAT_PROFILE.bankAt(3)]).toEqual([
      0, 0, 0,
    ]);
  });
});
