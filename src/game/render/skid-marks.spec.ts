import type * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { DisposalBag } from './resources';
import { SKID_MARK_LIFE, SkidMarks } from './skid-marks';

const bags: DisposalBag[] = [];

afterEach(() => {
  for (const bag of bags.splice(0)) bag.dispose();
});

function create(capacity = 8): SkidMarks {
  const bag = new DisposalBag();
  bags.push(bag);
  return new SkidMarks(capacity, '#2b2622', bag);
}

function attribute(marks: SkidMarks, name: string): THREE.BufferAttribute {
  return marks.mesh.geometry.getAttribute(name) as THREE.BufferAttribute;
}

/** Sommets (x, y, z) du tronçon `index`. */
function segment(marks: SkidMarks, index: number): { x: number; y: number; z: number }[] {
  const position = attribute(marks, 'position');
  return Array.from({ length: 6 }, (_, k) => ({
    x: position.getX(index * 6 + k),
    y: position.getY(index * 6 + k),
    z: position.getZ(index * 6 + k),
  }));
}

describe('SkidMarks', () => {
  it('pose un tronçon plat, juste au-dessus de la route, entre les deux points', () => {
    const marks = create();
    marks.add(0, 0, 0, 2);
    expect(marks.activeCount).toBe(1);
    const vertices = segment(marks, 0);
    for (const { y } of vertices) {
      expect(y).toBeGreaterThan(0.028);
      expect(y).toBeLessThan(0.05);
    }
    // Tronçon le long de +Z : largeur en X, de part et d'autre de l'axe, longueur 2 m.
    const xs = vertices.map(({ x }) => x);
    const zs = vertices.map(({ z }) => z);
    expect(Math.min(...xs)).toBeCloseTo(-Math.max(...xs), 9);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.1);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.3);
    expect(Math.min(...zs)).toBeCloseTo(0, 9);
    expect(Math.max(...zs)).toBeCloseTo(2, 9);
    expect(attribute(marks, 'alpha').getX(0)).toBeGreaterThan(0.3);
  });

  it('ignore les tronçons de longueur nulle ou invalides', () => {
    const marks = create();
    marks.add(1, 1, 1, 1);
    marks.add(0, 0, Number.NaN, 2);
    marks.add(0, 0, Number.POSITIVE_INFINITY, 0);
    expect(marks.activeCount).toBe(0);
  });

  it('reste visible, s’estompe en fin de vie puis libère la place', () => {
    const marks = create();
    marks.add(0, 0, 0, 1);
    const alpha = attribute(marks, 'alpha');
    const fresh = alpha.getX(0);
    marks.update(0.5);
    expect(alpha.getX(0)).toBe(fresh);
    marks.update(SKID_MARK_LIFE - 0.5 - 0.3);
    expect(alpha.getX(0)).toBeGreaterThan(0);
    expect(alpha.getX(0)).toBeLessThan(fresh * 0.5);
    expect(marks.activeCount).toBe(1);
    marks.update(0.4);
    expect(marks.activeCount).toBe(0);
    expect(alpha.getX(0)).toBe(0);
    // Tronçon replié sur un point : plus rien à dessiner.
    const vertices = segment(marks, 0);
    for (const vertex of vertices) expect(vertex).toEqual(vertices[0]);
  });

  it('réserve pleine : le tronçon le plus ancien laisse sa place', () => {
    const marks = create(3);
    for (let i = 0; i < 4; i++) marks.add(i * 10, 0, i * 10, 1);
    expect(marks.activeCount).toBe(3);
    // Le quatrième tronçon (x = 30) a remplacé le premier (x = 0).
    const first = segment(marks, 0);
    for (const { x } of first) expect(Math.abs(x - 30)).toBeLessThan(0.3);
  });

  it('pas de temps nul ou invalide : rien ne vieillit', () => {
    const marks = create();
    marks.add(0, 0, 0, 1);
    const alpha = attribute(marks, 'alpha');
    const fresh = alpha.getX(0);
    marks.update(0);
    marks.update(Number.NaN);
    marks.update(-1);
    expect(alpha.getX(0)).toBe(fresh);
    expect(marks.activeCount).toBe(1);
  });
});
