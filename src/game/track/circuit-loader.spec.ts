import { describe, expect, it } from 'vitest';
import schema from './circuit.schema.json';
import { CircuitError } from './circuit-error';
import { parseCircuit } from './circuit-loader';

const VALID = {
  $schema: '../circuit.schema.json',
  id: 'test-ovale',
  name: 'Ovale',
  description: 'Un ovale de test.',
  theme: 'garden',
  start: { x: 0, z: -50 },
  corners: [
    { x: -100, z: -50, radius: 20, y: 0 },
    { x: -100, z: 50, radius: 20, y: 4, bank: 10 },
    { x: 100, z: 50, radius: 20 },
    { x: 100, z: -50, radius: 20, y: 0 },
  ],
  decor: { landmarks: [{ kind: 'gnome', x: 0, z: 0, radius: 2.8 }] },
};

const issuesOf = (json: unknown): string[] => {
  try {
    parseCircuit(json);
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(CircuitError);
    return [...(error as CircuitError).issues];
  }
};

describe('parseCircuit', () => {
  it('accepte un circuit valide et ignore $schema', () => {
    const circuit = parseCircuit(VALID);
    expect(circuit.id).toBe('test-ovale');
    expect(circuit.corners[1]).toEqual({ x: -100, z: 50, radius: 20, y: 4, bank: 10 });
    expect('$schema' in circuit).toBe(false);
  });

  it('refuse un champ inconnu en nommant le champ et le coin (faute de frappe)', () => {
    const json = structuredClone(VALID);
    (json.corners[2] as Record<string, unknown>)['radious'] = 20;
    expect(issuesOf(json)).toContainEqual(expect.stringMatching(/Coin 3 .*« radious »/));
  });

  it('liste tous les problèmes d’un coup', () => {
    const issues = issuesOf({ ...VALID, id: 'Mauvais ID', theme: 'lune', start: { x: 'a', z: 0 } });
    expect(issues.length).toBeGreaterThanOrEqual(3);
  });

  it('refuse un dévers sans rayon, un rayon négatif et des nombres non finis', () => {
    const json = structuredClone(VALID);
    json.corners[0] = { x: -100, z: -50, bank: 10 } as (typeof json.corners)[number];
    (json.corners[1] as Record<string, unknown>)['radius'] = -3;
    (json.corners[2] as Record<string, unknown>)['x'] = Number.NaN;
    const issues = issuesOf(json);
    expect(issues).toContainEqual(expect.stringMatching(/Coin 1 .*dévers/));
    expect(issues).toContainEqual(expect.stringMatching(/Coin 2 .*rayon/));
    expect(issues).toContainEqual(expect.stringMatching(/Coin 3 .*x/));
  });

  it('refuse une géométrie impossible avec le message de la ligne médiane', () => {
    const json = structuredClone(VALID);
    json.corners = json.corners.map((corner) => ({ ...corner, radius: 60 }));
    expect(issuesOf(json).join(' ')).toMatch(/rayons trop grands/);
  });

  it('préfixe le message de l’erreur par l’identifiant du circuit', () => {
    expect(() => parseCircuit({ ...VALID, theme: 'lune' })).toThrow(/test-ovale/);
  });

  it('le schéma de l’éditeur connaît exactement les mêmes champs que le loader', () => {
    expect(Object.keys(schema.properties).sort()).toEqual([
      '$schema',
      'corners',
      'decor',
      'description',
      'id',
      'laps',
      'name',
      'start',
      'theme',
    ]);
    expect(Object.keys(schema.properties.corners.items.properties).sort()).toEqual([
      'bank',
      'radius',
      'x',
      'y',
      'z',
    ]);
  });
});
