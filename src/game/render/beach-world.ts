/**
 * Thème « plage au couchant » : le monde en plein air du jardin, version bord de mer. Sable, allée
 * de sable damé, dunes herbues pour bordures, palmiers qui se balancent, parasols, ballons,
 * château de sable, poste de maître-nageur, cabines de plage, mer animée et écume, animaux
 * (mouettes, crabes, dauphins), sous un ciel de soleil couchant.
 */
import * as THREE from 'three';
import { createRng } from '../core/rng';
import { buildCrabs, buildDolphins, buildGulls } from './beach-animals';
import {
  beachBallGeometry,
  beachHutsGeometry,
  lifeguardTowerGeometry,
  palmCrownGeometry,
  palmTrunkGeometry,
  parasolGeometry,
  sandcastleGeometry,
} from './beach-models';
import type { DecorKind, DecorPlacement, DecorRecipe } from './decor-plan';
import {
  buildGardenWorld,
  type OutdoorStyle,
  type WorldContext,
  type WorldPart,
} from './garden-world';
import { type DisposalBag, paintedMaterial } from './resources';
import type { SceneTheme } from './scene-theme';
import { createGravelTexture, createMulchTexture } from './textures';

/** La mer commence à cette distance (m) au-delà de la clôture, côté +Z. */
const SHORE_GAP = 10;
const SEA_SIZE = 2400;
const SEA_DEPTH = 1100;
const SEA_Y = 0.3;
const PARASOL_STRIPES = ['#e63946', '#2f7fd7', '#ffb400', '#2fa866', '#c77dff'];

const BEACH_RECIPE: DecorRecipe = {
  scatter: [
    {
      kind: 'palm',
      count: 22,
      size: [11, 17],
      radius: (h) => h * 0.22,
      band: [2, 34],
      variants: 3,
      facesTrack: false,
    },
    {
      kind: 'parasol',
      count: 14,
      size: [1, 1],
      radius: () => 4.4,
      band: [2, 26],
      variants: PARASOL_STRIPES.length,
      facesTrack: true,
    },
    {
      kind: 'crab',
      count: 12,
      size: [0.9, 1.3],
      radius: () => 4,
      band: [0, 10],
      variants: 1,
      facesTrack: true,
    },
    {
      kind: 'beach-ball',
      count: 8,
      size: [1.6, 2.6],
      radius: (r) => r,
      band: [3, 30],
      variants: 1,
      facesTrack: false,
    },
    {
      kind: 'bush',
      count: 24,
      size: [1.4, 2.6],
      radius: (r) => r * 1.25,
      band: [1, 30],
      variants: 2,
      facesTrack: false,
    },
  ],
  outer: { kind: 'palm', count: 50, size: [14, 22], inner: 8, outer: 80, variants: 3 },
};

function byKind(placements: readonly DecorPlacement[], kind: DecorKind): DecorPlacement[] {
  return placements.filter((placement) => placement.kind === kind);
}

/** Palmiers : troncs courbés fixes, couronnes qui se balancent au vent. */
function buildPalms(palms: readonly DecorPlacement[], bag: DisposalBag): WorldPart {
  const material = bag.add(paintedMaterial(0.8));
  const trunkGeometry = bag.add(palmTrunkGeometry());
  const crownGeometry = bag.add(palmCrownGeometry());
  const group = new THREE.Group();
  group.name = 'palms';
  const trunks = new THREE.InstancedMesh(trunkGeometry, material, palms.length);
  trunks.name = 'palm-trunks';
  trunks.castShadow = true;
  const crowns = new THREE.InstancedMesh(crownGeometry, material, palms.length);
  crowns.name = 'palm-crowns';
  crowns.castShadow = true;
  crowns.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const tops: THREE.Vector3[] = [];
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const scale = new THREE.Vector3();
  palms.forEach((palm, i) => {
    const h = palm.size;
    quaternion.setFromEuler(euler.set(0, palm.rotation, 0));
    trunks.setMatrixAt(
      i,
      matrix.compose(new THREE.Vector3(palm.x, 0, palm.z), quaternion, scale.setScalar(h)),
    );
    // Sommet du tronc courbé (voir palmTrunkGeometry : décalage de 0,18 h vers l'avant).
    tops.push(
      new THREE.Vector3(
        palm.x + Math.sin(palm.rotation) * h * 0.18,
        h,
        palm.z + Math.cos(palm.rotation) * h * 0.18,
      ),
    );
  });
  trunks.computeBoundingSphere();
  const update = (time: number): void => {
    palms.forEach((palm, i) => {
      const t = time * 0.9 + palm.x * 0.05;
      quaternion.setFromEuler(
        euler.set(Math.sin(t) * 0.06, palm.rotation + Math.sin(t * 0.7) * 0.08, Math.cos(t) * 0.05),
      );
      crowns.setMatrixAt(i, matrix.compose(tops[i], quaternion, scale.setScalar(palm.size * 0.42)));
    });
    crowns.instanceMatrix.needsUpdate = true;
  };
  update(0);
  crowns.computeBoundingSphere();
  group.add(trunks, crowns);
  return { object: group, update };
}

/** Parasols (une géométrie par couleur), ballons et pièces uniques de la plage. */
function buildBeachProps(placements: readonly DecorPlacement[], bag: DisposalBag): WorldPart {
  const material = bag.add(paintedMaterial(0.7));
  const group = new THREE.Group();
  group.name = 'beach-props';
  const rng = createRng(0xbea5);
  const cache = new Map<string, THREE.BufferGeometry>();
  const geometry = (key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry => {
    let value = cache.get(key);
    if (!value) {
      value = bag.add(build());
      cache.set(key, value);
    }
    return value;
  };
  const add = (
    mesh: THREE.Mesh,
    placement: DecorPlacement,
    y = 0,
    yaw = placement.rotation,
  ): void => {
    mesh.position.set(placement.x, y, placement.z);
    mesh.rotation.y = yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  for (const placement of placements) {
    switch (placement.kind) {
      case 'parasol': {
        const stripe = PARASOL_STRIPES[placement.variant % PARASOL_STRIPES.length];
        const mesh = new THREE.Mesh(
          geometry(`parasol-${stripe}`, () => parasolGeometry(stripe)),
          material,
        );
        mesh.name = 'parasol';
        add(mesh, placement);
        break;
      }
      case 'beach-ball': {
        const mesh = new THREE.Mesh(geometry('beach-ball', beachBallGeometry), material);
        mesh.name = 'beach-ball';
        mesh.scale.setScalar(placement.size);
        mesh.rotation.set(rng.range(-0.5, 0.5), 0, rng.range(-0.5, 0.5));
        add(mesh, placement, placement.size * 0.95, rng.range(0, Math.PI * 2));
        break;
      }
      case 'sandcastle':
      case 'lifeguard-tower':
      case 'beach-huts': {
        const build =
          placement.kind === 'sandcastle'
            ? sandcastleGeometry
            : placement.kind === 'lifeguard-tower'
              ? lifeguardTowerGeometry
              : beachHutsGeometry;
        const mesh = new THREE.Mesh(geometry(placement.kind, build), material);
        mesh.name = placement.kind;
        add(mesh, placement);
        break;
      }
    }
  }
  return { object: group };
}

/** Mer : grand plan ondulé (vagues calculées à chaque image), sable mouillé et écume au rivage. */
function buildSea(shoreZ: number, centerX: number, bag: DisposalBag): WorldPart {
  const group = new THREE.Group();
  group.name = 'sea';
  const geometry = bag.add(
    new THREE.PlaneGeometry(SEA_SIZE, SEA_DEPTH, 110, 60).rotateX(-Math.PI / 2),
  );
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  positions.setUsage(THREE.DynamicDrawUsage);
  const base = Float32Array.from(positions.array as Float32Array);
  const water = new THREE.Mesh(
    geometry,
    bag.add(
      new THREE.MeshStandardMaterial({
        color: '#2f7fb4',
        roughness: 0.25,
        metalness: 0.15,
        flatShading: true,
      }),
    ),
  );
  water.name = 'sea-water';
  water.position.set(centerX, SEA_Y, shoreZ + SEA_DEPTH / 2);
  water.receiveShadow = true;

  const wetSand = new THREE.Mesh(
    bag.add(new THREE.PlaneGeometry(SEA_SIZE, 9).rotateX(-Math.PI / 2)),
    bag.add(new THREE.MeshStandardMaterial({ color: '#c7a36c', roughness: 0.6 })),
  );
  wetSand.name = 'wet-sand';
  wetSand.position.set(centerX, 0.03, shoreZ - 3);
  wetSand.receiveShadow = true;

  const foamMaterial = bag.add(
    new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.9,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    }),
  );
  const foam = new THREE.Mesh(
    bag.add(new THREE.PlaneGeometry(SEA_SIZE, 3.2).rotateX(-Math.PI / 2)),
    foamMaterial,
  );
  foam.name = 'sea-foam';
  group.add(water, wetSand, foam);

  const update = (time: number): void => {
    const array = positions.array as Float32Array;
    for (let i = 0; i < array.length; i += 3) {
      const x = base[i];
      const z = base[i + 2];
      array[i + 1] =
        Math.sin(x * 0.045 + time * 1.1) * 0.35 +
        Math.sin(z * 0.08 - time * 1.6) * 0.3 +
        Math.sin((x + z) * 0.02 + time * 0.7) * 0.25;
    }
    positions.needsUpdate = true;
    // Vague qui monte sur le sable puis se retire, l'écume s'estompe en redescendant.
    const wave = Math.sin(time * 0.6);
    foam.position.set(centerX, SEA_Y + 0.05, shoreZ - 1 - wave * 2.6);
    foamMaterial.opacity = 0.45 + 0.4 * Math.max(0, wave);
  };
  update(0);
  return { object: group, update };
}

/** Éléments propres à la plage, posés d'après le plan de décor. */
function beachExtras({ plan, bounds, bag }: WorldContext): WorldPart[] {
  const shoreZ = plan.fence.maxZ + SHORE_GAP;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const reach = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) * 0.6;
  // Aucun palmier ni objet dans l'eau.
  const dry = plan.placements.filter((placement) => placement.z + placement.radius < shoreZ - 4);
  return [
    buildSea(shoreZ, centerX, bag),
    buildPalms(byKind(dry, 'palm'), bag),
    buildBeachProps(dry, bag),
    buildCrabs(byKind(dry, 'crab'), bag),
    buildGulls({ x: centerX, z: centerZ + 40 }, reach, bag),
    buildDolphins(shoreZ, centerX, bag),
  ];
}

export const BEACH_STYLE: OutdoorStyle = {
  name: 'beach-world',
  ground: ['#efd9a8', '#e8cf99'],
  surface: {
    // Allée de sable damé, plus foncée que la plage, semée de coquillages.
    road: () =>
      createGravelTexture('#cfae7c', ['#e9d3a8', '#b8966a', '#f4e6c8', '#a98a60', '#f7ede0']),
    roadTile: 7,
    shoulder: () => createMulchTexture('#dcc08a', ['#d0b27a', '#e8d2a2', '#c9a56d', '#b99a64']),
    shoulderTile: 4,
    curbColors: ['#2f7fd7', '#fbfbf7'],
  },
  // Dunes herbues : bosses de sable coiffées d'oyats.
  hedges: { palette: ['#e3c68e', '#d9b97f', '#ead3a0', '#dcbf86'], cap: '#9cae55' },
  decor: {
    foliage: ['#8fae4c', '#a3bf5a', '#7d9c42', '#b3c96b', '#6f8f3a'],
    trunk: '#8a6443',
    fence: null,
    stones: ['#d8cbb5', '#c9baa0', '#e6dccb', '#bfae93'],
    firs: ['#2f6b3a'],
    firSnow: null,
  },
  recipe: BEACH_RECIPE,
  clouds: { color: '#ffd9c7', emissive: '#ff9f80' },
  extras: beachExtras,
};

/** Plage au couchant : soleil bas au-dessus de la mer, ciel orangé qui vire au violet. */
export const BEACH_THEME: SceneTheme = {
  sky: {
    top: '#5a5fb8',
    horizon: '#ffb277',
    sun: '#fff0c2',
    sunDirection: [0.2, 0.28, 0.94],
    sunGlow: 3,
  },
  fog: { color: '#f8bd8e', near: 150, far: 700 },
  light: {
    hemisphereSky: '#ffd6b0',
    hemisphereGround: '#c9a070',
    hemisphereIntensity: 1.35,
    sun: '#ffbf7a',
    sunIntensity: 2.6,
  },
  clouds: BEACH_STYLE.clouds,
  buildWorld: (track, decor) => buildGardenWorld(track, decor, BEACH_STYLE),
};
