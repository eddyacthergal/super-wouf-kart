/**
 * Surface du circuit : allée de gravier (route), bas-côtés en paillis, bordures rouges et blanches,
 * ligne de départ en damier, marques de grille et arche de départ.
 */
import * as THREE from 'three';
import { RACER_COUNT } from '../core/constants';
import type { TrackQuery } from '../core/types';
import { headingOf } from '../core/vec2';
import { PALETTE } from './palette';
import { type DisposalBag, paintedGeometry, paintedMaterial, transform } from './resources';
import { resampleRing } from './track-geometry';
import {
  createBannerTexture,
  createCheckerTexture,
  createGravelTexture,
  createMulchTexture,
} from './textures';

/** Hauteurs des couches au sol (m) : légèrement au-dessus de la pelouse (y = 0). */
const ROAD_Y = 0.02;
const SHOULDER_Y = 0.012;
const MARKING_Y = 0.028;
/** Longueur (m) couverte par une répétition des textures de gravier et de paillis. */
const GRAVEL_TILE = 7;
const MULCH_TILE = 4;
/** Le paillis passe sous la haie pour qu'aucune herbe n'apparaisse entre les deux. */
const SHOULDER_OVERLAP = 1.4;
/** Bordures : longueur d'un segment coloré, largeur, hauteur, décalage au-delà du bord de route. */
const CURB_LENGTH = 2;
const CURB_WIDTH = 0.7;
const CURB_HEIGHT = 0.1;
const CURB_OFFSET = 0.25;
/** Arche de départ : hauteur des poteaux (os) et de la bannière. */
const ARCH_HEIGHT = 7.6;
const BANNER_HEIGHT = 2.2;
/** Axe des poteaux au-delà de la haie : leurs boules (0,5 + 0,72 m) restent hors du couloir. */
const ARCH_POST_OFFSET = 1.3;

/** Ruban le long du circuit entre deux décalages latéraux (fonctions de l'échantillon). */
function ribbonGeometry(
  track: TrackQuery,
  from: (halfWidth: number) => number,
  to: (halfWidth: number) => number,
  y: number,
  tile: number,
): THREE.BufferGeometry {
  const samples = track.samples;
  const rows = samples.length + 1;
  const positions = new Float32Array(rows * 2 * 3);
  const normals = new Float32Array(rows * 2 * 3);
  const uvs = new Float32Array(rows * 2 * 2);
  for (let row = 0; row < rows; row++) {
    const sample = samples[row % samples.length];
    const s = row === samples.length ? track.length : sample.s;
    const a = from(sample.halfWidth);
    const b = to(sample.halfWidth);
    const width = Math.abs(b - a);
    for (let side = 0; side < 2; side++) {
      const lateral = side === 0 ? a : b;
      const v = row * 2 + side;
      positions[v * 3] = sample.position.x + sample.left.x * lateral;
      positions[v * 3 + 1] = y;
      positions[v * 3 + 2] = sample.position.z + sample.left.z * lateral;
      normals[v * 3 + 1] = 1;
      uvs[v * 2] = side === 0 ? 0 : width / tile;
      uvs[v * 2 + 1] = s / tile;
    }
  }
  const indices: number[] = [];
  for (let row = 0; row < rows - 1; row++) {
    const a = row * 2;
    // Sens direct vu du dessus (normale +Y) quand `from` est à droite de `to`.
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function groundMaterial(map: THREE.Texture, offset: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map,
    roughness: 0.95,
    polygonOffset: true,
    polygonOffsetFactor: offset,
    polygonOffsetUnits: offset,
  });
}

function buildRoad(track: TrackQuery, bag: DisposalBag): THREE.Mesh {
  const geometry = bag.add(
    ribbonGeometry(
      track,
      (hw) => -hw,
      (hw) => hw,
      ROAD_Y,
      GRAVEL_TILE,
    ),
  );
  const material = bag.add(groundMaterial(bag.add(createGravelTexture()), -2));
  const road = new THREE.Mesh(geometry, material);
  road.name = 'road';
  road.receiveShadow = true;
  return road;
}

function buildShoulders(track: TrackQuery, bag: DisposalBag): THREE.Mesh[] {
  const material = bag.add(groundMaterial(bag.add(createMulchTexture()), -1));
  const outer = track.wallHalfWidth + SHOULDER_OVERLAP;
  const sides = [
    ribbonGeometry(
      track,
      (hw) => hw,
      () => outer,
      SHOULDER_Y,
      MULCH_TILE,
    ),
    ribbonGeometry(
      track,
      () => -outer,
      (hw) => -hw,
      SHOULDER_Y,
      MULCH_TILE,
    ),
  ];
  return sides.map((geometry, index) => {
    const mesh = new THREE.Mesh(bag.add(geometry), material);
    mesh.name = index === 0 ? 'shoulder-left' : 'shoulder-right';
    mesh.receiveShadow = true;
    return mesh;
  });
}

/** Bordures alternées rouge/blanc tous les 2 m, de part et d'autre de la route. */
function buildCurbs(track: TrackQuery, bag: DisposalBag): THREE.InstancedMesh {
  const rings = [1, -1].map((side) =>
    resampleRing(
      track.samples.map((sample) => {
        const lateral = side * (sample.halfWidth + CURB_OFFSET);
        return {
          x: sample.position.x + sample.left.x * lateral,
          z: sample.position.z + sample.left.z * lateral,
        };
      }),
      CURB_LENGTH,
      true,
    ),
  );
  const count = rings[0].length + rings[1].length;
  const geometry = bag.add(new THREE.BoxGeometry(1, 1, 1));
  const material = bag.add(new THREE.MeshStandardMaterial({ roughness: 0.6 }));
  const curbs = new THREE.InstancedMesh(geometry, material, count);
  curbs.name = 'curbs';
  curbs.receiveShadow = true;
  const red = new THREE.Color(PALETTE.curbRed);
  const white = new THREE.Color(PALETTE.curbWhite);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let index = 0;
  for (const ring of rings) {
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % ring.length];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      position.set((a.x + b.x) / 2, ROAD_Y + CURB_HEIGHT / 2, (a.z + b.z) / 2);
      quaternion.setFromAxisAngle(up, Math.atan2(dx, dz));
      scale.set(CURB_WIDTH, CURB_HEIGHT, Math.hypot(dx, dz) + 0.02);
      curbs.setMatrixAt(index, matrix.compose(position, quaternion, scale));
      curbs.setColorAt(index, k % 2 === 0 ? red : white);
      index++;
    }
  }
  curbs.computeBoundingSphere();
  return curbs;
}

/** Repère local à l'abscisse s : X = gauche du pilote, Z = sens de la course. */
function placeAcross(object: THREE.Object3D, track: TrackQuery, s: number): void {
  const sample = track.sampleAt(s);
  object.position.set(sample.position.x, 0, sample.position.z);
  object.rotation.y = headingOf(sample.tangent);
}

function buildStartLine(track: TrackQuery, bag: DisposalBag): THREE.Mesh {
  const halfWidth = track.sampleAt(0).halfWidth;
  const texture = bag.add(createCheckerTexture());
  texture.repeat.set(halfWidth, 1);
  const geometry = bag.add(new THREE.PlaneGeometry(halfWidth * 2, 2).rotateX(-Math.PI / 2));
  const material = bag.add(groundMaterial(texture, -4));
  const line = new THREE.Mesh(geometry, material);
  line.name = 'start-line';
  line.receiveShadow = true;
  placeAcross(line, track, 0);
  line.position.y = MARKING_Y;
  return line;
}

/** Traits blancs devant chaque place de la grille. */
function buildGridMarks(track: TrackQuery, bag: DisposalBag): THREE.InstancedMesh {
  const geometry = bag.add(new THREE.PlaneGeometry(2.6, 0.3).rotateX(-Math.PI / 2));
  const material = bag.add(
    new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.8,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    }),
  );
  const marks = new THREE.InstancedMesh(geometry, material, RACER_COUNT);
  marks.name = 'grid-marks';
  marks.receiveShadow = true;
  const holder = new THREE.Object3D();
  for (let i = 0; i < RACER_COUNT; i++) {
    const slot = track.gridSlot(i);
    holder.position.set(
      slot.position.x + Math.sin(slot.heading) * 1.4,
      MARKING_Y,
      slot.position.z + Math.cos(slot.heading) * 1.4,
    );
    holder.rotation.y = slot.heading;
    holder.updateMatrix();
    marks.setMatrixAt(i, holder.matrix);
  }
  marks.computeBoundingSphere();
  return marks;
}

/** Arche de départ : deux poteaux en forme d'os et une bannière « WOUF KART ». */
function buildStartArch(track: TrackQuery, bag: DisposalBag): THREE.Group {
  const arch = new THREE.Group();
  arch.name = 'start-arch';
  placeAcross(arch, track, 0);
  const span = track.wallHalfWidth + ARCH_POST_OFFSET;

  const postGeometry = bag.add(
    paintedGeometry([
      {
        geometry: new THREE.CylinderGeometry(0.5, 0.5, ARCH_HEIGHT, 16),
        color: PALETTE.bone,
        matrix: transform(0, ARCH_HEIGHT / 2, 0),
      },
      ...[-1, 1].flatMap((side) => [
        {
          geometry: new THREE.SphereGeometry(0.72, 18, 12),
          color: PALETTE.bone,
          matrix: transform(side * 0.5, ARCH_HEIGHT + 0.2, 0),
        },
        {
          geometry: new THREE.SphereGeometry(0.72, 18, 12),
          color: PALETTE.bone,
          matrix: transform(side * 0.5, 0.35, 0),
        },
      ]),
    ]),
  );
  const postMaterial = bag.add(paintedMaterial(0.55));
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(postGeometry, postMaterial);
    post.name = 'arch-post';
    post.position.x = side * span;
    post.castShadow = true;
    post.receiveShadow = true;
    arch.add(post);
  }

  const bannerTexture = createBannerTexture();
  const plain = bag.add(
    new THREE.MeshStandardMaterial({ color: PALETTE.bannerRed, roughness: 0.6 }),
  );
  const face = bannerTexture
    ? bag.add(new THREE.MeshStandardMaterial({ map: bag.add(bannerTexture), roughness: 0.6 }))
    : plain;
  const banner = new THREE.Mesh(bag.add(new THREE.BoxGeometry(span * 2, BANNER_HEIGHT, 0.35)), [
    plain,
    plain,
    plain,
    plain,
    face,
    face,
  ]);
  banner.name = 'arch-banner';
  banner.position.y = ARCH_HEIGHT - BANNER_HEIGHT / 2 - 0.1;
  banner.castShadow = true;
  arch.add(banner);
  return arch;
}

/** Tous les éléments au sol du circuit, plus l'arche de départ. */
export function buildTrackSurface(track: TrackQuery, bag: DisposalBag): THREE.Group {
  const group = new THREE.Group();
  group.name = 'track-surface';
  group.add(
    buildRoad(track, bag),
    ...buildShoulders(track, bag),
    buildCurbs(track, bag),
    buildStartLine(track, bag),
    buildGridMarks(track, bag),
    buildStartArch(track, bag),
  );
  return group;
}
