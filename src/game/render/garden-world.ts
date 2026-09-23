/**
 * Le jardin géant : pelouse tondue, circuit (allée, bas-côtés, bordures, départ), haies,
 * décor géant et nuages. Construit sans WebGL (testable en Node).
 */
import * as THREE from 'three';
import type { TrackQuery } from '../core/types';
import { buildDecor } from './decor';
import { planDecor } from './decor-plan';
import { buildHedges } from './hedges';
import { DisposalBag } from './resources';
import { buildClouds } from './sky';
import { trackBounds } from './track-geometry';
import { buildTrackSurface } from './track-surface';
import { createLawnTexture } from './textures';

/** Côté de la pelouse (m) : ses bords se perdent dans le brouillard. */
const LAWN_SIZE = 2400;
/** Largeur (m) couverte par une répétition de la texture de pelouse (deux bandes de tonte). */
const LAWN_TILE = 20;

export interface GardenWorld {
  root: THREE.Group;
  update(time: number): void;
  dispose(): void;
}

function buildLawn(centerX: number, centerZ: number, bag: DisposalBag): THREE.Mesh {
  const texture = bag.add(createLawnTexture());
  texture.repeat.set(LAWN_SIZE / LAWN_TILE, LAWN_SIZE / LAWN_TILE);
  const lawn = new THREE.Mesh(
    bag.add(new THREE.PlaneGeometry(LAWN_SIZE, LAWN_SIZE).rotateX(-Math.PI / 2)),
    bag.add(new THREE.MeshStandardMaterial({ map: texture, roughness: 1 })),
  );
  lawn.name = 'lawn';
  lawn.position.set(centerX, 0, centerZ);
  lawn.receiveShadow = true;
  return lawn;
}

export function buildGardenWorld(track: TrackQuery): GardenWorld {
  const bag = new DisposalBag();
  const bounds = trackBounds(track, 0);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;

  const root = new THREE.Group();
  root.name = 'garden-world';
  const decor = buildDecor(planDecor(track), bag);
  const clouds = buildClouds(bag, centerX, centerZ);
  root.add(
    buildLawn(centerX, centerZ, bag),
    buildTrackSurface(track, bag),
    buildHedges(track, bag).group,
    decor.group,
    clouds.group,
  );

  let disposed = false;
  return {
    root,
    update(time: number): void {
      if (disposed) return;
      decor.update(time);
      clouds.update(time);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      bag.dispose();
    },
  };
}
