/**
 * Outils communs du rendu : suivi des ressources à libérer et géométries peintes
 * (plusieurs pièces colorées fusionnées en un seul maillage à couleurs par sommet).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface Disposable {
  dispose(): void;
}

/** Ressources three.js créées par le rendu, libérées ensemble (une seule fois chacune). */
export class DisposalBag {
  private readonly items = new Set<Disposable>();

  add<T extends Disposable>(item: T): T {
    this.items.add(item);
    return item;
  }

  dispose(): void {
    for (const item of this.items) item.dispose();
    this.items.clear();
  }
}

export interface PaintedPart {
  geometry: THREE.BufferGeometry;
  color: THREE.ColorRepresentation;
  matrix?: THREE.Matrix4;
}

const tmpPosition = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpScale = new THREE.Vector3();

/** Matrice de transformation (position, rotation d'Euler XYZ, échelle). */
export function transform(
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = sx,
  sz = sx,
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    tmpPosition.set(x, y, z),
    tmpQuaternion.setFromEuler(tmpEuler.set(rx, ry, rz)),
    tmpScale.set(sx, sy, sz),
  );
}

/**
 * Fusionne des pièces colorées en une géométrie (attributs position, normal, color).
 * Les géométries des pièces sont libérées : le résultat est la seule ressource à suivre.
 */
export function paintedGeometry(parts: readonly PaintedPart[]): THREE.BufferGeometry {
  const color = new THREE.Color();
  const prepared = parts.map((part) => {
    const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
    part.geometry.dispose();
    if (part.matrix) geometry.applyMatrix4(part.matrix);
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
    }
    geometry.clearGroups();
    color.set(part.color);
    const count = geometry.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geometry;
  });
  const merged = mergeGeometries(prepared, false);
  for (const geometry of prepared) geometry.dispose();
  if (!merged) throw new Error('Fusion des pièces de décor impossible');
  merged.computeBoundingSphere();
  return merged;
}

/** Matériau standard à couleurs par sommet (géométries peintes). */
export function paintedMaterial(roughness = 0.75, metalness = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness });
}

/** Déplacement exponentiel vers une cible, indépendant de la fréquence d'images. */
export function smoothTowards(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}
