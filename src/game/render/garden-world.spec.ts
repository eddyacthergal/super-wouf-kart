import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TrackQuery } from '../core/types';
import { createCircleTrack } from '../testing/fake-track';
import { createGardenTrack } from '../track/track';
import { DECOR_CORRIDOR_MARGIN, planDecor } from './decor-plan';
import { buildGardenWorld, type GardenWorld } from './garden-world';
import { buildHedges, HEDGE_CENTER_OFFSET } from './hedges';
import { DisposalBag } from './resources';

/** Distance à la ligne médiane, calculée indépendamment du code testé (segments entre échantillons). */
function centerlineDistance(track: TrackQuery, x: number, z: number): number {
  let best = Infinity;
  const samples = track.samples;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i].position;
    const b = samples[(i + 1) % samples.length].position;
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const t = Math.max(
      0,
      Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz)),
    );
    best = Math.min(best, Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)));
  }
  return best;
}

interface Footprint {
  name: string;
  x: number;
  z: number;
  /** Portée horizontale maximale des sommets autour de (x, z). */
  reach: number;
}

/** Portée horizontale des sommets de `geometry` transformés par `matrix`, autour de l'origine transformée. */
function horizontalReach(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): Footprint {
  const origin = new THREE.Vector3().setFromMatrixPosition(matrix);
  const vertex = new THREE.Vector3();
  const positions = geometry.getAttribute('position');
  let reach = 0;
  for (let i = 0; i < positions.count; i++) {
    vertex.fromBufferAttribute(positions, i).applyMatrix4(matrix);
    reach = Math.max(reach, Math.hypot(vertex.x - origin.x, vertex.z - origin.z));
  }
  return { name: '', x: origin.x, z: origin.z, reach };
}

/** Emprise au sol réelle (sommets compris) de chaque maillage ou instance sous `root`. */
function footprints(root: THREE.Object3D, skip: readonly string[] = []): Footprint[] {
  root.updateMatrixWorld(true);
  const result: Footprint[] = [];
  const instance = new THREE.Matrix4();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || skip.includes(object.name)) return;
    if (object instanceof THREE.InstancedMesh) {
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, instance);
        const footprint = horizontalReach(
          object.geometry,
          instance.premultiply(object.matrixWorld),
        );
        result.push({ ...footprint, name: object.name });
      }
    } else {
      result.push({ ...horizontalReach(object.geometry, object.matrixWorld), name: object.name });
    }
  });
  return result;
}

function instancePositions(root: THREE.Object3D): { name: string; x: number; z: number }[] {
  root.updateMatrixWorld(true);
  const result: { name: string; x: number; z: number }[] = [];
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  root.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) {
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, matrix);
        position.setFromMatrixPosition(matrix.premultiply(object.matrixWorld));
        result.push({ name: object.name, x: position.x, z: position.z });
      }
    } else if (object instanceof THREE.Mesh) {
      object.getWorldPosition(position);
      result.push({ name: object.name, x: position.x, z: position.z });
    }
  });
  return result;
}

describe('planDecor', () => {
  const track = createGardenTrack();
  const plan = planDecor(track);

  it('place les pièces demandées, de façon déterministe', () => {
    const kinds = new Set(plan.placements.map((p) => p.kind));
    for (const kind of [
      'daisy',
      'tulip',
      'sunflower',
      'tennis-ball',
      'doghouse',
      'watering-can',
      'kibble-bowl',
      'giant-bone',
      'gnome',
      'sprinkler',
      'tree',
      'bush',
      'stepping-stone',
    ] as const) {
      expect(kinds.has(kind), kind).toBe(true);
    }
    expect(planDecor(track)).toEqual(plan);
  });

  it('remplit le jardin (quantités minimales par type)', () => {
    const count = (kind: string): number => plan.placements.filter((p) => p.kind === kind).length;
    expect(count('daisy')).toBeGreaterThanOrEqual(20);
    expect(count('tulip')).toBeGreaterThanOrEqual(16);
    expect(count('sunflower')).toBeGreaterThanOrEqual(8);
    expect(count('tennis-ball')).toBeGreaterThanOrEqual(8);
    expect(count('bush')).toBeGreaterThanOrEqual(25);
    expect(count('tree')).toBeGreaterThanOrEqual(50);
    expect(count('stepping-stone')).toBeGreaterThanOrEqual(40);
    expect(count('gnome')).toBe(2);
  });

  it('ne place aucun objet dans le couloir (haie + rayon + 2 m)', () => {
    for (const placement of plan.placements) {
      const distance = centerlineDistance(track, placement.x, placement.z);
      expect(distance, placement.kind).toBeGreaterThan(
        track.wallHalfWidth + placement.radius + DECOR_CORRIDOR_MARGIN - 0.01,
      );
      const projected = Math.abs(track.project({ x: placement.x, z: placement.z }).lateral);
      expect(projected, placement.kind).toBeGreaterThan(track.wallHalfWidth + placement.radius);
    }
  });

  it('ne superpose pas deux objets (hors pierres de gué voisines)', () => {
    const solid = plan.placements.filter((p) => p.kind !== 'stepping-stone');
    for (let i = 0; i < solid.length; i++) {
      for (let j = i + 1; j < solid.length; j++) {
        const a = solid[i];
        const b = solid[j];
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(a.radius + b.radius);
      }
    }
  });

  it('pose la niche près de la ligne de départ', () => {
    const doghouse = plan.placements.find((p) => p.kind === 'doghouse');
    const start = track.sampleAt(0).position;
    expect(doghouse).toBeDefined();
    expect(Math.hypot(doghouse!.x - start.x, doghouse!.z - start.z)).toBeLessThan(45);
  });

  it('reste valide sur un autre circuit (cercle)', () => {
    const circle = createCircleTrack(60, 'right');
    for (const placement of planDecor(circle).placements) {
      expect(centerlineDistance(circle, placement.x, placement.z)).toBeGreaterThan(
        circle.wallHalfWidth + placement.radius,
      );
    }
  });
});

/**
 * Face intérieure des touffes (centre - rayon) sur la ligne de haie : les karts, retenus
 * à wallHalfWidth - KART_RADIUS, ne s'enfoncent pas dans le feuillage. Hauteur ~1,2 m.
 */
function expectHedgeOutsideCorridor(track: TrackQuery, group: THREE.Object3D): void {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  group.updateMatrixWorld(true);
  group.traverse((object) => {
    if (!(object instanceof THREE.InstancedMesh)) return;
    for (let i = 0; i < object.count; i++) {
      object.getMatrixAt(i, matrix);
      matrix.decompose(position, quaternion, scale);
      const inner = centerlineDistance(track, position.x, position.z) - scale.x;
      expect(inner).toBeGreaterThan(track.wallHalfWidth - 0.25);
      expect(position.y + scale.y).toBeGreaterThan(1);
      expect(position.y + scale.y).toBeLessThan(1.5);
    }
  });
}

describe('buildHedges', () => {
  it('borde les deux côtés sans trou, sans empiéter sur le couloir', () => {
    const track = createGardenTrack();
    const bag = new DisposalBag();
    const { group, count } = buildHedges(track, bag);
    const positions = instancePositions(group);
    expect(positions.length).toBe(count);
    // Environ une touffe par mètre de chaque côté.
    expect(count).toBeGreaterThan(track.length * 1.8);
    expectHedgeOutsideCorridor(track, group);
    // Continuité : chaque point de la ligne de haie a une touffe à moins de 0,8 m, des deux côtés.
    for (const sample of track.samples.filter((_, i) => i % 3 === 0)) {
      for (const side of [1, -1]) {
        const lateral = side * (track.wallHalfWidth + HEDGE_CENTER_OFFSET);
        const x = sample.position.x + sample.left.x * lateral;
        const z = sample.position.z + sample.left.z * lateral;
        const nearest = Math.min(...positions.map((p) => Math.hypot(p.x - x, p.z - z)));
        expect(nearest).toBeLessThan(0.8);
      }
    }
    bag.dispose();
  });

  it('omet les touffes du côté intérieur qui déborderaient dans un virage très serré', () => {
    for (const radius of [9, 11.4, 14]) {
      const track = createCircleTrack(radius, 'left');
      const bag = new DisposalBag();
      const { group, count } = buildHedges(track, bag);
      expectHedgeOutsideCorridor(track, group);
      // Le côté extérieur reste bordé (~1 touffe par mètre de haie).
      const outerLength = 2 * Math.PI * (radius + track.wallHalfWidth + HEDGE_CENTER_OFFSET);
      expect(count).toBeGreaterThan(outerLength * 0.9);
      bag.dispose();
    }
  });
});

describe('buildGardenWorld', () => {
  let world: GardenWorld;
  const track = createGardenTrack();

  beforeAll(() => {
    world = buildGardenWorld(track);
  });

  afterAll(() => world.dispose());

  it('contient pelouse, route, bas-côtés, bordures, départ, haies et décor', () => {
    for (const name of [
      'lawn',
      'road',
      'shoulder-left',
      'shoulder-right',
      'curbs',
      'start-line',
      'start-arch',
      'arch-banner',
      'hedges',
      'garden-decor',
      'doghouse',
      'fence-pickets',
      'clouds',
    ]) {
      expect(world.root.getObjectByName(name), name).toBeDefined();
    }
  });

  it('pose la route à y = 0,02 avec deux sommets par échantillon', () => {
    const road = world.root.getObjectByName('road') as THREE.Mesh;
    const positions = road.geometry.getAttribute('position');
    expect(positions.count).toBe((track.samples.length + 1) * 2);
    for (let i = 0; i < positions.count; i++) expect(positions.getY(i)).toBeCloseTo(0.02);
    // Deux sommets d'une rangée : à ±halfWidth de la ligne médiane.
    const sample = track.samples[10];
    const left = { x: positions.getX(21), z: positions.getZ(21) };
    expect(
      (left.x - sample.position.x) * sample.left.x + (left.z - sample.position.z) * sample.left.z,
    ).toBeCloseTo(sample.halfWidth);
  });

  it('étend une pelouse tondue d’au moins 800 × 800 m sous tout le circuit', () => {
    const lawn = world.root.getObjectByName('lawn') as THREE.Mesh;
    lawn.geometry.computeBoundingBox();
    const size = lawn.geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThanOrEqual(800);
    expect(size.z).toBeGreaterThanOrEqual(800);
    expect(size.y).toBeCloseTo(0);
    expect((lawn.material as THREE.MeshStandardMaterial).map).toBeInstanceOf(THREE.Texture);
    for (const { position } of track.samples) {
      expect(Math.abs(position.x - lawn.position.x)).toBeLessThan(size.x / 2 - 100);
      expect(Math.abs(position.z - lawn.position.z)).toBeLessThan(size.z / 2 - 100);
    }
  });

  it('étire la texture de la route le long de s (UV) et sa rangée droite à -halfWidth', () => {
    const road = world.root.getObjectByName('road') as THREE.Mesh;
    const positions = road.geometry.getAttribute('position');
    const uvs = road.geometry.getAttribute('uv');
    const sample = track.samples[10];
    const right = { x: positions.getX(20), z: positions.getZ(20) };
    expect(
      (right.x - sample.position.x) * sample.left.x + (right.z - sample.position.z) * sample.left.z,
    ).toBeCloseTo(-sample.halfWidth);
    // v croît avec s et reboucle sans couture (dernière rangée à s = length).
    for (let row = 1; row <= track.samples.length; row++) {
      expect(uvs.getY(row * 2)).toBeGreaterThan(uvs.getY((row - 1) * 2));
    }
    const last = track.samples.length * 2;
    expect(uvs.getY(last) / uvs.getY(2)).toBeCloseTo(track.length / track.samples[1].s, 3);
    // Face tournée vers le ciel.
    road.geometry.computeVertexNormals();
    expect(road.geometry.getAttribute('normal').getY(0)).toBeGreaterThan(0.99);
  });

  it('pose des bas-côtés en paillis de la route à la haie, sous la route', () => {
    const road = world.root.getObjectByName('road') as THREE.Mesh;
    const roadMap = (road.material as THREE.MeshStandardMaterial).map;
    for (const [name, side] of [
      ['shoulder-left', 1],
      ['shoulder-right', -1],
    ] as const) {
      const shoulder = world.root.getObjectByName(name) as THREE.Mesh;
      const material = shoulder.material as THREE.MeshStandardMaterial;
      expect(material.map).toBeInstanceOf(THREE.Texture);
      expect(material.map).not.toBe(roadMap);
      const positions = shoulder.geometry.getAttribute('position');
      for (const index of [0, 200, 400]) {
        const sample = track.samples[index];
        const lateral = (vertex: number): number =>
          (positions.getX(vertex) - sample.position.x) * sample.left.x +
          (positions.getZ(vertex) - sample.position.z) * sample.left.z;
        const [a, b] = [lateral(index * 2), lateral(index * 2 + 1)];
        const inner = side > 0 ? a : b;
        const outer = side > 0 ? b : a;
        expect(inner).toBeCloseTo(side * sample.halfWidth);
        expect(Math.abs(outer)).toBeGreaterThanOrEqual(track.wallHalfWidth);
        expect(positions.getY(index * 2)).toBeLessThan(0.02);
        expect(positions.getY(index * 2)).toBeGreaterThan(0);
      }
    }
  });

  it('alterne les bordures rouges et blanches tous les 2 m, au bord de la route', () => {
    const curbs = world.root.getObjectByName('curbs') as THREE.InstancedMesh;
    const a = new THREE.Color();
    const b = new THREE.Color();
    curbs.getColorAt(0, a);
    curbs.getColorAt(1, b);
    expect(a.equals(b)).toBe(false);
    expect(curbs.count % 2).toBe(0);
    // Environ une bordure tous les 2 m de chaque côté.
    expect(curbs.count).toBeGreaterThan(track.length * 0.85);
    expect(curbs.count).toBeLessThan(track.length * 1.15);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const previous = new THREE.Vector3();
    // Deux anneaux (gauche puis droite) : un seul saut, au passage de l'un à l'autre.
    let jumps = 0;
    for (let i = 0; i < curbs.count; i++) {
      curbs.getMatrixAt(i, matrix);
      position.setFromMatrixPosition(matrix);
      const lateral = Math.abs(track.project({ x: position.x, z: position.z }).lateral);
      expect(lateral).toBeGreaterThan(6.8);
      expect(lateral).toBeLessThan(7.8);
      if (i > 0) {
        const gap = position.distanceTo(previous);
        if (gap > 2.8) jumps++;
        else expect(gap).toBeGreaterThan(1.2);
      }
      previous.copy(position);
    }
    expect(jumps).toBe(1);
  });

  it('pose la ligne de départ en damier à s = 0, en travers de la route', () => {
    const line = world.root.getObjectByName('start-line') as THREE.Mesh;
    const start = track.sampleAt(0);
    expect(line.position.x).toBeCloseTo(start.position.x);
    expect(line.position.z).toBeCloseTo(start.position.z);
    expect(line.position.y).toBeGreaterThan(0.02);
    expect(line.rotation.y).toBeCloseTo(Math.atan2(start.tangent.x, start.tangent.z));
    const map = (line.material as THREE.MeshStandardMaterial).map!;
    expect(map.magFilter).toBe(THREE.NearestFilter);
  });

  it('ne pose aucun élément de décor dans le couloir', () => {
    const decor = world.root.getObjectByName('garden-decor')!;
    const positions = instancePositions(decor);
    expect(positions.length).toBeGreaterThan(500);
    for (const { name, x, z } of positions) {
      expect(centerlineDistance(track, x, z), name).toBeGreaterThan(track.wallHalfWidth);
    }
  });

  it('garde toute l’emprise du décor (sommets, jets d’eau compris) hors du couloir', () => {
    const decor = world.root.getObjectByName('garden-decor')!;
    // Les lisses de la clôture longent le pourtour : leurs planches, vérifiées ici, suffisent.
    const all = footprints(decor, ['fence-rails']);
    expect(all.length).toBeGreaterThan(500);
    expect(all.some((footprint) => footprint.name === 'sprinkler-jet')).toBe(true);
    for (const { name, x, z, reach } of all) {
      expect(centerlineDistance(track, x, z) - reach, name).toBeGreaterThan(track.wallHalfWidth);
    }
  });

  it('garde l’emprise du décor hors du couloir sur un autre circuit (placement au plus près)', () => {
    const circle = createCircleTrack(60, 'right');
    const other = buildGardenWorld(circle);
    try {
      const decor = other.root.getObjectByName('garden-decor')!;
      const all = footprints(decor, ['fence-rails']);
      expect(all.some((footprint) => footprint.name === 'sprinkler-jet')).toBe(true);
      for (const { name, x, z, reach } of all) {
        expect(centerlineDistance(circle, x, z) - reach, name).toBeGreaterThan(
          circle.wallHalfWidth,
        );
      }
    } finally {
      other.dispose();
    }
  });

  it('garde les poteaux de l’arche de départ hors du couloir', () => {
    const arch = world.root.getObjectByName('start-arch')!;
    const posts = footprints(arch).filter((footprint) => footprint.name === 'arch-post');
    expect(posts.length).toBe(2);
    for (const { x, z, reach } of posts) {
      expect(centerlineDistance(track, x, z) - reach).toBeGreaterThan(track.wallHalfWidth);
    }
  });

  it('anime fleurs et arroseur sans erreur', () => {
    const stems = world.root.getObjectByName('flower-stems') as THREE.InstancedMesh;
    const before = new THREE.Matrix4();
    const after = new THREE.Matrix4();
    stems.getMatrixAt(0, before);
    const arm = world.root.getObjectByName('sprinkler-arm')!;
    const armBefore = arm.rotation.y;
    world.update(1.3);
    stems.getMatrixAt(0, after);
    expect(after.equals(before)).toBe(false);
    expect(arm.rotation.y).not.toBeCloseTo(armBefore);
    // Balancement léger : la tige reste quasi verticale.
    const up = new THREE.Vector3(0, 1, 0).applyMatrix4(after.clone().setPosition(0, 0, 0));
    expect(up.normalize().y).toBeGreaterThan(0.99);
  });

  it('libère toutes ses géométries et matériaux', () => {
    const local = buildGardenWorld(track);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    local.root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        geometries.add(object.geometry);
        for (const material of [object.material].flat()) materials.add(material);
      }
    });
    const spies = [...geometries, ...materials].map((resource) => vi.spyOn(resource, 'dispose'));
    local.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
    expect(local.root.parent).toBeNull();
  });
});
