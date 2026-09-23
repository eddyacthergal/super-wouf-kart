/**
 * Ressources three.js des modèles de pilotes : cache partagé à compte de références,
 * portée par modèle (libération sûre) et petits utilitaires de géométrie.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

interface Disposable {
  dispose(): void;
}

/** Ressources partagées entre modèles, libérées quand plus aucun modèle ne les utilise. */
export class RefCountedCache<T extends Disposable> {
  private readonly entries = new Map<string, { value: T; refs: number }>();

  acquire(key: string, create: () => T): T {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { value: create(), refs: 0 };
      this.entries.set(key, entry);
    }
    entry.refs++;
    return entry.value;
  }

  release(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.refs--;
    if (entry.refs <= 0) {
      entry.value.dispose();
      this.entries.delete(key);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

export const sharedGeometries = new RefCountedCache<THREE.BufferGeometry>();
export const sharedMaterials = new RefCountedCache<THREE.MeshStandardMaterial>();

export interface MaterialOptions {
  roughness?: number;
  metalness?: number;
  emissive?: string;
  /** Couleurs peintes sur les sommets (motifs) ; la couleur de base est alors multipliée. */
  vertexColors?: boolean;
  doubleSided?: boolean;
  flatShading?: boolean;
}

/**
 * Ressources acquises par un modèle. `dispose()` rend les ressources partagées au cache
 * (libérées seulement quand plus personne ne les utilise) et libère celles qui lui sont propres.
 */
export class ResourceScope {
  private readonly geometryKeys: string[] = [];
  private readonly materialKeys: string[] = [];
  private readonly owned: Disposable[] = [];
  private disposed = false;

  geometry(key: string, create: () => THREE.BufferGeometry): THREE.BufferGeometry {
    this.geometryKeys.push(key);
    return sharedGeometries.acquire(key, create);
  }

  material(color: string, options: MaterialOptions = {}): THREE.MeshStandardMaterial {
    const {
      roughness = 0.65,
      metalness = 0,
      emissive = '#000000',
      vertexColors = false,
      doubleSided = false,
      flatShading = false,
    } = options;
    const hex = new THREE.Color(color).getHexString();
    const key = [hex, roughness, metalness, emissive, vertexColors, doubleSided, flatShading].join(
      '|',
    );
    this.materialKeys.push(key);
    return sharedMaterials.acquire(
      key,
      () =>
        new THREE.MeshStandardMaterial({
          color,
          roughness,
          metalness,
          emissive,
          vertexColors,
          flatShading,
          side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
        }),
    );
  }

  /** Ressource propre au modèle (non partagée), libérée avec lui. */
  own<T extends Disposable>(resource: T): T {
    this.owned.push(resource);
    return resource;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const key of this.geometryKeys) sharedGeometries.release(key);
    for (const key of this.materialKeys) sharedMaterials.release(key);
    for (const resource of this.owned) resource.dispose();
    this.geometryKeys.length = 0;
    this.materialKeys.length = 0;
    this.owned.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Géométries
// ---------------------------------------------------------------------------

/** Arrondi des dimensions dans les clés du cache (au millimètre). */
export const dim = (value: number): string => value.toFixed(3);

/** Sphère de rayon 1, à mettre à l'échelle via `mesh.scale`. */
export const unitSphere = (scope: ResourceScope): THREE.BufferGeometry =>
  scope.geometry('sphere', () => new THREE.SphereGeometry(1, 20, 14));

/** Cylindre de rayon 1 et de hauteur 1 (axe Y). */
export const unitCylinder = (scope: ResourceScope, radialSegments = 16): THREE.BufferGeometry =>
  scope.geometry(
    `cylinder:${radialSegments}`,
    () => new THREE.CylinderGeometry(1, 1, 1, radialSegments),
  );

/** Cône de rayon 1 et de hauteur 1 (pointe vers +Y), centré sur l'origine. */
export const unitCone = (scope: ResourceScope): THREE.BufferGeometry =>
  scope.geometry('cone', () => new THREE.ConeGeometry(1, 1, 16));

export const capsule = (
  scope: ResourceScope,
  radius: number,
  length: number,
): THREE.BufferGeometry =>
  scope.geometry(
    `capsule:${dim(radius)}:${dim(length)}`,
    () => new THREE.CapsuleGeometry(radius, length, 6, 14),
  );

export function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name = '',
): THREE.Mesh {
  const result = new THREE.Mesh(geometry, material);
  result.name = name;
  result.castShadow = true;
  return result;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Place `object` au milieu de [a, b] avec son axe +Y local orienté de a vers b. */
export function alignBetween(object: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3): void {
  object.position.copy(a).add(b).multiplyScalar(0.5);
  object.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
}

/**
 * Orientation dont l'axe +Y local suit `yAxis` et l'axe +Z local est au plus près de `zHint`
 * (utile pour les pièces plates : oreilles, bandana).
 */
export function basisQuaternion(yAxis: THREE.Vector3, zHint: THREE.Vector3): THREE.Quaternion {
  const y = yAxis.clone().normalize();
  const x = new THREE.Vector3().crossVectors(y, zHint).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

export interface PartTransform {
  position?: THREE.Vector3;
  quaternion?: THREE.Quaternion;
  scale?: THREE.Vector3;
}

export function partMatrix({ position, quaternion, scale }: PartTransform): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    position ?? new THREE.Vector3(),
    quaternion ?? new THREE.Quaternion(),
    scale ?? new THREE.Vector3(1, 1, 1),
  );
}

/** Symétrique d'une transformation par rapport au plan x = 0 (sans inverser les faces). */
export function mirrorTransform({ position, quaternion, scale }: PartTransform): PartTransform {
  const q = quaternion ?? new THREE.Quaternion();
  return {
    position: position ? new THREE.Vector3(-position.x, position.y, position.z) : undefined,
    quaternion: new THREE.Quaternion(q.x, -q.y, -q.z, q.w),
    scale,
  };
}

/**
 * Fusionne des pièces (géométrie + transformation) en une seule géométrie, pour limiter
 * le nombre de meshes. Les géométries sources sont consommées (libérées).
 */
export function mergeParts(
  parts: ReadonlyArray<readonly [THREE.BufferGeometry, PartTransform]>,
): THREE.BufferGeometry {
  const baked = parts.map(([geometry, transform]) =>
    geometry.clone().applyMatrix4(partMatrix(transform)),
  );
  const merged = mergeGeometries(baked);
  for (const geometry of baked) geometry.dispose();
  for (const [geometry] of parts) geometry.dispose();
  if (!merged) throw new Error('mergeParts : géométries incompatibles');
  return merged;
}

/** Une pièce et sa symétrique (x → -x), fusionnées. */
export function mirroredPair(
  geometry: THREE.BufferGeometry,
  transform: PartTransform,
): THREE.BufferGeometry {
  return mergeParts([
    [geometry, transform],
    [geometry, mirrorTransform(transform)],
  ]);
}

/**
 * Peint chaque face d'une couleur choisie selon son centre (motifs sans texture).
 * Renvoie une géométrie non indexée avec un attribut `color` ; la source est libérée.
 */
export function paintFaces(
  geometry: THREE.BufferGeometry,
  colorAt: (center: THREE.Vector3) => THREE.Color,
): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  const positions = flat.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  const center = new THREE.Vector3();
  for (let i = 0; i + 2 < positions.count; i += 3) {
    center.set(
      (positions.getX(i) + positions.getX(i + 1) + positions.getX(i + 2)) / 3,
      (positions.getY(i) + positions.getY(i + 1) + positions.getY(i + 2)) / 3,
      (positions.getZ(i) + positions.getZ(i + 1) + positions.getZ(i + 2)) / 3,
    );
    const color = colorAt(center);
    for (let k = i; k < i + 3; k++) {
      colors[k * 3] = color.r;
      colors[k * 3 + 1] = color.g;
      colors[k * 3 + 2] = color.b;
    }
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return flat;
}

/** Rapproche `current` de `target` de façon exponentielle (indépendant du pas de temps). */
export function smoothTowards(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}
