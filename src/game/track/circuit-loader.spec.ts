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

  it('refuse un dévers au-delà de 20° et une altitude hors de [0, 25] m (alignés sur le validateur)', () => {
    const json = structuredClone(VALID);
    (json.corners[0] as Record<string, unknown>)['bank'] = 21;
    (json.corners[1] as Record<string, unknown>)['bank'] = 20;
    (json.corners[2] as Record<string, unknown>)['y'] = -1;
    (json.corners[3] as Record<string, unknown>)['y'] = 26;
    const issues = issuesOf(json);
    expect(issues).toContainEqual(expect.stringMatching(/Coin 1 .*dévers/));
    expect(issues).toContainEqual(expect.stringMatching(/Coin 3 .*altitude/i));
    expect(issues).toContainEqual(expect.stringMatching(/Coin 4 .*altitude/i));
    // Bornes acceptées : bank = 20 (coin 2, valide) et y = 0 / 25.
    expect(issues.some((issue) => /^Coin 2 /.test(issue))).toBe(false);
  });

  it('refuse une clé inconnue dans « start », un landmark et decor.path (en nommant le champ)', () => {
    const json = structuredClone(VALID) as Record<string, unknown>;
    json['start'] = { x: 0, z: -50, y: 5 };
    json['decor'] = {
      landmarks: [{ kind: 'gnome', x: 0, z: 0, radius: 2.8, taille: 3 }],
      path: { from: { x: 0, z: 0, y: 1 }, to: { x: 10, z: 10 }, width: 2 },
    };
    const issues = issuesOf(json);
    expect(issues).toContainEqual(expect.stringMatching(/^start .*« y »/));
    expect(issues).toContainEqual(expect.stringMatching(/Décor 1 .*« taille »/));
    expect(issues).toContainEqual(expect.stringMatching(/decor\.path\.from .*« y »/));
    expect(issues).toContainEqual(expect.stringMatching(/decor\.path .*« width »/));
  });

  it('signale un dévers sur un coin sans virage (arc nul dans la ligne médiane)', () => {
    const json = {
      ...VALID,
      start: { x: -25, z: 40 },
      corners: [
        { x: -50, z: 0, radius: 1 },
        { x: 0, z: 0, radius: 20, bank: 10 },
        { x: 50, z: 0, radius: 1 },
        { x: 0, z: 80, radius: 1 },
      ],
    };
    expect(issuesOf(json)).toContainEqual(expect.stringMatching(/Coin 2 .*dévers.*sans virage/));
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
