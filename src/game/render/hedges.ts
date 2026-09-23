/**
 * Haies (murs du circuit) : touffes de feuillage instanciées le long des deux bords, sans trou.
 * Les touffes sont réparties par tronçons pour que chaque tronçon soit éliminé hors du champ
 * de la caméra (et de la caméra d'ombre).
 */
import * as THREE from 'three';
import { createRng } from '../core/rng';
import type { TrackQuery } from '../core/types';
import { PALETTE } from './palette';
import type { DisposalBag } from './resources';
import { distanceToSamples, offsetRing, resampleRing } from './track-geometry';

/**
 * Centre des touffes au-delà de la ligne de haie (m), proche de leur rayon (1 à 1,2 m) :
 * leur face intérieure affleure la limite (±0,15 m) au lieu d'empiéter sur le couloir.
 */
export const HEDGE_CENTER_OFFSET = 1.05;
/** Espacement des touffes (m) : nettement inférieur à leur largeur, pour une haie continue. */
const HEDGE_SPACING = 1;
/** Une touffe dont la face intérieure entre de plus de cela dans le couloir (d'une autre portion) est omise. */
const CROSSING_TOLERANCE = 0.2;
/** Longueur de circuit (fraction) regroupée dans un même InstancedMesh. */
const CHUNK_COUNT = 10;
const HEDGE_SEED = 0x4ed6e;

export interface HedgeSet {
  group: THREE.Group;
  /** Nombre total de touffes. */
  count: number;
}

export function buildHedges(track: TrackQuery, bag: DisposalBag): HedgeSet {
  const rng = createRng(HEDGE_SEED);
  const offset = track.wallHalfWidth + HEDGE_CENTER_OFFSET;
  const chunks: THREE.Matrix4[][] = Array.from({ length: CHUNK_COUNT }, () => []);
  const colors: THREE.Color[][] = Array.from({ length: CHUNK_COUNT }, () => []);
  const palette = PALETTE.hedges.map((hex) => new THREE.Color(hex));
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();

  for (const side of [1, -1]) {
    for (const point of resampleRing(offsetRing(track, side * offset), HEDGE_SPACING)) {
      const width = rng.range(1.0, 1.2);
      // Côté intérieur d'un virage très serré ou deux portions voisines : pas de touffe
      // qui déborde dans le couloir d'une autre portion du circuit.
      const clearance = distanceToSamples(track, point.x, point.z) - width;
      if (clearance < track.wallHalfWidth - CROSSING_TOLERANCE) continue;
      const chunk = Math.min(CHUNK_COUNT - 1, Math.floor(point.fraction * CHUNK_COUNT));
      position.set(point.x, rng.range(0.42, 0.55), point.z);
      quaternion.setFromEuler(euler.set(0, rng.range(0, Math.PI * 2), 0));
      scale.set(width, rng.range(0.72, 0.86), width);
      chunks[chunk].push(new THREE.Matrix4().compose(position, quaternion, scale));
      colors[chunk].push(rng.pick(palette));
    }
  }

  const geometry = bag.add(new THREE.IcosahedronGeometry(1, 1));
  const material = bag.add(new THREE.MeshStandardMaterial({ roughness: 0.9 }));
  const group = new THREE.Group();
  group.name = 'hedges';
  let count = 0;
  chunks.forEach((matrices, chunk) => {
    if (matrices.length === 0) return;
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
    mesh.name = 'hedge-chunk';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    matrices.forEach((matrix, i) => {
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, colors[chunk][i]);
    });
    mesh.computeBoundingSphere();
    group.add(mesh);
    count += matrices.length;
  });
  return { group, count };
}
