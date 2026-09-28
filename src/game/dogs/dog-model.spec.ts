import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BreedId } from '../core/types';
import { BREED_LIST, BREEDS } from './breeds';
import { buildDog, computeDogLayout, type DogRig } from './dog-model';
import { steeringGrips } from './kart-model';
import { ResourceScope, sharedGeometries } from './model-resources';

const scopes: ResourceScope[] = [];

/** Chien seul, au repos : son repère est celui du monde (racine sans transformation). */
function buildRig(breed: BreedId, scope = new ResourceScope()): DogRig {
  scopes.push(scope);
  const definition = BREEDS[breed];
  const layout = computeDogLayout(definition.look);
  const rig = buildDog(scope, definition, layout, {
    grips: steeringGrips(layout.steeringCenter),
    showBelly: true,
    environment: null,
  });
  rig.root.updateMatrixWorld(true);
  return rig;
}

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.dispose();
});

function part(pivot: THREE.Object3D, name: string): THREE.Mesh {
  const object = pivot.getObjectByName(name);
  if (!(object instanceof THREE.Mesh)) throw new Error(`${name} doit être un mesh`);
  return object;
}

/** Sommets d'un maillage dans le repère de son parent (le pivot de l'oreille). */
function pivotVertices(mesh: THREE.Mesh): THREE.Vector3[] {
  mesh.updateMatrix();
  const positions = mesh.geometry.getAttribute('position');
  return Array.from({ length: positions.count }, (_, i) =>
    new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrix),
  );
}

function worldVertices(mesh: THREE.Mesh): THREE.Vector3[] {
  mesh.updateWorldMatrix(true, false);
  const positions = mesh.geometry.getAttribute('position');
  return Array.from({ length: positions.count }, (_, i) =>
    new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld),
  );
}

/** Sommet le plus éloigné de `from`. */
function farthest(points: readonly THREE.Vector3[], from: THREE.Vector3): THREE.Vector3 {
  return points.reduce((far, point) =>
    point.distanceTo(from) > far.distanceTo(from) ? point : far,
  );
}

function meshCount(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) count++;
  });
  return count;
}

const span = (values: readonly number[]): number => Math.max(...values) - Math.min(...values);

const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const degrees = (radians: number): number => THREE.MathUtils.radToDeg(radians);

describe('oreilles dressées (chihuahua)', () => {
  const { earLength, earWidth } = BREEDS.chihuahua.look;

  it('seul le chihuahua a des oreilles dressées', () => {
    expect(
      BREED_LIST.filter((breed) => breed.look.earStyle === 'erect').map((breed) => breed.id),
    ).toEqual(['chihuahua']);
  });

  it('une feuille et un intérieur par oreille, accrochés au pivot animé : aucun maillage en plus', () => {
    const rig = buildRig('chihuahua');
    expect(rig.ears).toHaveLength(2);
    for (const ear of rig.ears) {
      expect(ear.pivot.children.map((child) => child.name)).toEqual([
        'dog-ear-flap',
        'dog-ear-inner',
      ]);
    }
    // Autant de maillages qu'avec les anciens cônes.
    expect(meshCount(rig.root)).toBe(21);
  });

  it('le pivot entraîne toute l’oreille : rabattue par le vent, elle part vers l’arrière', () => {
    const rig = buildRig('chihuahua');
    const [ear] = rig.ears;
    const base = ear.pivot.getWorldPosition(new THREE.Vector3());
    const tips = (): number[] =>
      ['dog-ear-flap', 'dog-ear-inner'].map(
        (name) => farthest(worldVertices(part(ear.pivot, name)), base).z,
      );
    const before = tips();
    ear.pivot.rotation.x = -0.5;
    rig.root.updateMatrixWorld(true);
    tips().forEach((tip, i) => expect(tip).toBeLessThan(before[i] - 0.05));
  });

  it('feuille large à la base, de la largeur réglée pour la race', () => {
    expect(earWidth).toBeGreaterThanOrEqual(0.2);
    expect(earWidth / earLength).toBeGreaterThanOrEqual(0.55);
    const flap = part(buildRig('chihuahua').ears[0].pivot, 'dog-ear-flap');
    const base = pivotVertices(flap).filter((v) => v.y >= 0 && v.y <= earLength * 0.15);
    expect(Math.abs(span(base.map((v) => v.x)) - earWidth)).toBeLessThan(earWidth * 0.1);
  });

  it('bout arrondi, à la longueur réglée : pas de sommet unique pointu', () => {
    const flap = part(buildRig('chihuahua').ears[0].pivot, 'dog-ear-flap');
    const vertices = pivotVertices(flap);
    const top = Math.max(...vertices.map((v) => v.y));
    expect(top).toBeCloseTo(earLength, 2);
    // Juste sous le bout, l'oreille est encore large : un arrondi, pas une pointe.
    const tip = vertices.filter((v) => v.y > top - earLength * 0.05);
    expect(span(tip.map((v) => v.x))).toBeGreaterThan(0.06);
  });

  it('creusée en cuillère : les bords avancent du côté du creux (+Z du pivot)', () => {
    const flap = part(buildRig('chihuahua').ears[0].pivot, 'dog-ear-flap');
    const body = pivotVertices(flap).filter((v) => v.y > earLength * 0.1 && v.y < earLength * 0.6);
    const edges = body.filter((v) => Math.abs(v.x) > earWidth * 0.3);
    const middle = body.filter((v) => Math.abs(v.x) < earWidth * 0.08);
    expect(mean(edges.map((v) => v.z)) - mean(middle.map((v) => v.z))).toBeGreaterThan(0.01);
  });

  it('intérieur rose : feuille plus fine, posée dans le creux, dans le contour de l’oreille', () => {
    const pivot = buildRig('chihuahua').ears[0].pivot;
    const flap = pivotVertices(part(pivot, 'dog-ear-flap'));
    const inner = pivotVertices(part(pivot, 'dog-ear-inner'));
    // Coupe sur l'axe de l'oreille, à mi-hauteur.
    const slice = (vertices: THREE.Vector3[]): number[] =>
      vertices
        .filter(
          (v) => Math.abs(v.x) < earWidth * 0.1 && v.y > earLength * 0.3 && v.y < earLength * 0.5,
        )
        .map((v) => v.z);
    expect(span(slice(inner))).toBeLessThan(span(slice(flap)) * 0.6);
    // Devant la feuille (côté creux), sans ressortir derrière elle.
    expect(Math.max(...slice(inner))).toBeGreaterThan(Math.max(...slice(flap)));
    expect(Math.min(...slice(inner))).toBeGreaterThan(Math.min(...slice(flap)));
    expect(span(inner.map((v) => v.x))).toBeLessThan(span(flap.map((v) => v.x)));
    expect(Math.max(...inner.map((v) => v.y))).toBeLessThan(Math.max(...flap.map((v) => v.y)));
  });

  it('écartées d’environ 35°, creux tourné vers l’avant et un peu vers le côté', () => {
    const rig = buildRig('chihuahua');
    rig.ears.forEach((ear, i) => {
      // Oreille gauche (+X) puis droite.
      const side = i === 0 ? 1 : -1;
      const base = ear.pivot.getWorldPosition(new THREE.Vector3());
      const axis = farthest(worldVertices(part(ear.pivot, 'dog-ear-flap')), base).sub(base);
      const outward = degrees(Math.atan2(axis.x * side, axis.y));
      expect(outward).toBeGreaterThan(30);
      expect(outward).toBeLessThan(40);
      const hollow = new THREE.Vector3(0, 0, 1).transformDirection(ear.pivot.matrixWorld);
      expect(hollow.z).toBeGreaterThan(0.8);
      expect(hollow.x * side).toBeGreaterThan(0.25);
      expect(hollow.x * side).toBeLessThan(0.6);
    });
  });

  it('ombrage lisse : pas de facettes, une seule normale par position', () => {
    const pivot = buildRig('chihuahua').ears[0].pivot;
    for (const name of ['dog-ear-flap', 'dog-ear-inner']) {
      const mesh = part(pivot, name);
      expect((mesh.material as THREE.MeshStandardMaterial).flatShading, name).toBe(false);
      const positions = mesh.geometry.getAttribute('position');
      const normals = mesh.geometry.getAttribute('normal');
      const seen = new Map<string, THREE.Vector3>();
      let creases = 0;
      for (let i = 0; i < positions.count; i++) {
        const key = [positions.getX(i), positions.getY(i), positions.getZ(i)]
          .map((value) => Math.round(value * 1e5))
          .join(':');
        const normal = new THREE.Vector3().fromBufferAttribute(normals, i);
        const other = seen.get(key);
        if (!other) seen.set(key, normal);
        else if (normal.dot(other) < 0.999) creases++;
      }
      expect(creases, name).toBe(0);
    }
  });

  it('feuilles étanches : chaque arête borde deux triangles (ni trou ni fente)', () => {
    const pivot = buildRig('chihuahua').ears[0].pivot;
    for (const name of ['dog-ear-flap', 'dog-ear-inner']) {
      const index = part(pivot, name).geometry.index;
      if (!index) throw new Error(`${name} doit être indexée`);
      const edges = new Map<string, number>();
      for (let k = 0; k < index.count; k += 3) {
        const corners = [index.getX(k), index.getX(k + 1), index.getX(k + 2)];
        corners.forEach((a, i) => {
          const b = corners[(i + 1) % 3];
          if (a === b) return;
          const edge = a < b ? `${a}:${b}` : `${b}:${a}`;
          edges.set(edge, (edges.get(edge) ?? 0) + 1);
        });
      }
      const open = [...edges.values()].filter((count) => count !== 2).length;
      expect(open, name).toBe(0);
    }
  });

  it('maillage léger : moins de 1 500 triangles par feuille', () => {
    const pivot = buildRig('chihuahua').ears[0].pivot;
    for (const name of ['dog-ear-flap', 'dog-ear-inner']) {
      const geometry = part(pivot, name).geometry;
      const triangles = (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
      expect(triangles, name).toBeLessThan(1500);
    }
  });

  it('géométries partagées (entre oreilles et entre modèles), libérées avec le dernier modèle', () => {
    const geometries = sharedGeometries.size;
    const first = new ResourceScope();
    const second = new ResourceScope();
    const a = buildRig('chihuahua', first);
    const b = buildRig('chihuahua', second);
    for (const name of ['dog-ear-flap', 'dog-ear-inner']) {
      const geometry = part(a.ears[0].pivot, name).geometry;
      expect(part(a.ears[1].pivot, name).geometry, name).toBe(geometry);
      expect(part(b.ears[0].pivot, name).geometry, name).toBe(geometry);
    }
    const flap = part(a.ears[0].pivot, 'dog-ear-flap').geometry;
    const onDispose = vi.fn();
    flap.addEventListener('dispose', onDispose);
    first.dispose();
    expect(onDispose).not.toHaveBeenCalled();
    second.dispose();
    expect(onDispose).toHaveBeenCalledTimes(1);
    expect(sharedGeometries.size).toBe(geometries);
  });

  it('déterministe : mêmes sommets d’une construction à l’autre', () => {
    const positions = (): number[] => {
      const scope = new ResourceScope();
      const flap = part(buildRig('chihuahua', scope).ears[0].pivot, 'dog-ear-flap');
      const values = Array.from(flap.geometry.getAttribute('position').array);
      scope.dispose();
      return values;
    };
    expect(positions()).toEqual(positions());
  });

  it('les autres races gardent leurs oreilles', () => {
    const flapOf = (breed: BreedId): THREE.BufferGeometry =>
      part(buildRig(breed).ears[0].pivot, 'dog-ear-flap').geometry;
    expect(flapOf('carlin').type).toBe('ConeGeometry');
    expect(flapOf('jack-russell').type).toBe('ConeGeometry');
    expect(flapOf('teckel').type).toBe('SphereGeometry');
  });
});

const ORIGIN = new THREE.Vector3();

/** Queue d'un chien, accrochée à son pivot. */
const tailOf = (rig: DogRig): THREE.Mesh => part(rig.tail, 'dog-tail-mesh');

/** Nombre de triangles bordés par chaque arête (sommets soudés : géométrie indexée). */
function edgeUses(geometry: THREE.BufferGeometry): Map<string, number> {
  const index = geometry.index;
  if (!index) throw new Error('la géométrie doit être indexée');
  const edges = new Map<string, number>();
  for (let k = 0; k < index.count; k += 3) {
    const corners = [index.getX(k), index.getX(k + 1), index.getX(k + 2)];
    corners.forEach((a, i) => {
      const b = corners[(i + 1) % 3];
      const edge = a < b ? `${a}:${b}` : `${b}:${a}`;
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    });
  }
  return edges;
}

describe('queue en tube courbe et effilé (chihuahua, teckel)', () => {
  const TUBE_TAILS: readonly BreedId[] = ['chihuahua', 'teckel'];

  it('remplace le cône pointu du chihuahua et du teckel ; carlin et jack russell gardent leur queue', () => {
    // Styles qui étaient un cône pointu : fine et relevée, longue dans l'axe du corps.
    const spiky: readonly string[] = ['thin', 'long'];
    const breeds = BREED_LIST.filter((breed) => spiky.includes(breed.look.tailStyle));
    expect(breeds.map((breed) => breed.id)).toEqual(TUBE_TAILS);
    for (const breed of TUBE_TAILS) {
      expect(tailOf(buildRig(breed)).geometry.type, breed).not.toBe('ConeGeometry');
    }
    expect(tailOf(buildRig('carlin')).geometry.type).toBe('TubeGeometry');
    expect(tailOf(buildRig('jack-russell')).geometry.type).toBe('CapsuleGeometry');
  });

  it('une seule pièce, accrochée au pivot qui la fait remuer : aucun maillage en plus', () => {
    for (const [breed, count] of [
      ['chihuahua', 21],
      ['teckel', 18],
    ] as const) {
      const rig = buildRig(breed);
      expect(rig.tail.children.map((child) => child.name), breed).toEqual(['dog-tail-mesh']);
      expect(meshCount(rig.root), breed).toBe(count);
    }
  });

  it.each(TUBE_TAILS)('effilée : épaisse à la racine, fine au bout (%s)', (breed) => {
    const vertices = pivotVertices(tailOf(buildRig(breed)));
    const tip = farthest(vertices, ORIGIN);
    // Demi-largeur (le long de l'axe latéral X du pivot) à moins de `reach` d'un point.
    const halfWidth = (near: THREE.Vector3, reach: number): number =>
      Math.max(...vertices.filter((v) => v.distanceTo(near) < reach).map((v) => Math.abs(v.x)));
    const root = halfWidth(ORIGIN, 0.1);
    expect(root).toBeGreaterThan(BREEDS[breed].look.legRadius * 0.75);
    expect(halfWidth(tip, 0.03)).toBeLessThan(root * 0.5);
  });

  it.each(TUBE_TAILS)('bout arrondi, pas de pointe : encore large à 2 cm du bout (%s)', (breed) => {
    const vertices = pivotVertices(tailOf(buildRig(breed)));
    const tip = farthest(vertices, ORIGIN);
    const end = vertices.filter((v) => v.distanceTo(tip) < 0.02);
    expect(span(end.map((v) => v.x))).toBeGreaterThan(0.015);
  });

  it('courbée : celle du chihuahua remonte en arc, celle du teckel se relève un peu', () => {
    // Angle entre la direction de départ (+Y du pivot) et la corde racine → bout, vers +Z.
    const bend = (breed: BreedId): number => {
      const tip = farthest(pivotVertices(tailOf(buildRig(breed))), ORIGIN);
      expect(Math.abs(tip.x), breed).toBeLessThan(1e-3);
      return degrees(Math.atan2(tip.z, tip.y));
    };
    expect(bend('chihuahua')).toBeGreaterThan(30);
    expect(bend('chihuahua')).toBeLessThan(60);
    expect(bend('teckel')).toBeGreaterThan(8);
    expect(bend('teckel')).toBeLessThan(25);

    // Chihuahua : le bout monte presque à la verticale au-dessus de la racine.
    const rig = buildRig('chihuahua');
    const base = rig.tail.getWorldPosition(new THREE.Vector3());
    const chord = farthest(worldVertices(tailOf(rig)), base).sub(base);
    expect(degrees(Math.atan2(Math.abs(chord.z), chord.y))).toBeLessThan(20);
    // Teckel : le bout reste loin derrière la racine.
    const teckel = buildRig('teckel');
    const root = teckel.tail.getWorldPosition(new THREE.Vector3());
    expect(farthest(worldVertices(tailOf(teckel)), root).z).toBeLessThan(root.z - 0.3);
  });

  it.each(TUBE_TAILS)('le pivot la fait remuer sur le côté, racine fixe (%s)', (breed) => {
    const rig = buildRig(breed);
    const tail = tailOf(rig);
    const base = rig.tail.getWorldPosition(new THREE.Vector3());
    const before = worldVertices(tail);
    const tip = before.indexOf(farthest(before, base));
    rig.tail.rotation.z = 0.5;
    rig.root.updateMatrixWorld(true);
    const after = worldVertices(tail);
    expect(Math.abs(after[tip].x - before[tip].x)).toBeGreaterThan(0.05);
    before.forEach((vertex, i) => {
      if (vertex.distanceTo(base) < 0.03) expect(after[i].distanceTo(vertex)).toBeLessThan(0.02);
    });
  });

  it.each(TUBE_TAILS)('bout fermé, racine cachée dans le bassin même en remuant (%s)', (breed) => {
    const rig = buildRig(breed);
    const tail = tailOf(rig);
    const hips = part(rig.root, 'dog-hips');
    const uses = edgeUses(tail.geometry);
    expect([...uses.values()].every((count) => count === 1 || count === 2)).toBe(true);
    // Sommets des arêtes qui ne bordent qu'un triangle : le bord de la racine, rien d'autre.
    const open = new Set(
      [...uses.entries()]
        .filter(([, count]) => count === 1)
        .flatMap(([edge]) => edge.split(':').map(Number)),
    );
    expect(open.size).toBeGreaterThan(0);
    // Amplitude du remuement de la queue en course (racer-model).
    for (const wag of [-0.55, 0, 0.55]) {
      rig.tail.rotation.z = wag;
      rig.root.updateMatrixWorld(true);
      const world = worldVertices(tail);
      for (const i of open) {
        expect(hips.worldToLocal(world[i].clone()).length(), `${wag}`).toBeLessThan(1);
      }
    }
  });

  it.each(TUBE_TAILS)('ombrage lisse et maillage léger (%s)', (breed) => {
    const tail = tailOf(buildRig(breed));
    expect((tail.material as THREE.MeshStandardMaterial).flatShading).toBe(false);
    const positions = tail.geometry.getAttribute('position');
    const normals = tail.geometry.getAttribute('normal');
    const seen = new Map<string, THREE.Vector3>();
    let creases = 0;
    for (let i = 0; i < positions.count; i++) {
      const key = [positions.getX(i), positions.getY(i), positions.getZ(i)]
        .map((value) => Math.round(value * 1e5))
        .join(':');
      const normal = new THREE.Vector3().fromBufferAttribute(normals, i);
      const other = seen.get(key);
      if (!other) seen.set(key, normal);
      else if (normal.dot(other) < 0.999) creases++;
    }
    expect(creases).toBe(0);
    expect((tail.geometry.index?.count ?? 0) / 3).toBeLessThan(800);
  });

  it('géométrie partagée entre modèles, libérée avec le dernier ; construction déterministe', () => {
    const geometries = sharedGeometries.size;
    const first = new ResourceScope();
    const second = new ResourceScope();
    const geometry = tailOf(buildRig('chihuahua', first)).geometry;
    expect(tailOf(buildRig('chihuahua', second)).geometry).toBe(geometry);
    const positions = Array.from(geometry.getAttribute('position').array);
    const onDispose = vi.fn();
    geometry.addEventListener('dispose', onDispose);
    first.dispose();
    expect(onDispose).not.toHaveBeenCalled();
    second.dispose();
    expect(onDispose).toHaveBeenCalledTimes(1);
    expect(sharedGeometries.size).toBe(geometries);
    // Reconstruite après libération : exactement les mêmes sommets.
    const rebuilt = tailOf(buildRig('chihuahua')).geometry;
    expect(rebuilt).not.toBe(geometry);
    expect(Array.from(rebuilt.getAttribute('position').array)).toEqual(positions);
  });
});
