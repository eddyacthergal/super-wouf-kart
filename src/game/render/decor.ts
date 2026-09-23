/**
 * Maillages du décor géant à partir du plan de placement : tout ce qui se répète est instancié.
 * Animations légères : fleurs qui se balancent, arroseur qui tourne.
 */
import * as THREE from 'three';
import { createRng } from '../core/rng';
import {
  blobGeometry,
  daisyHeadGeometry,
  doghouseGeometry,
  giantBoneGeometry,
  gnomeGeometry,
  kibbleBowlGeometry,
  leafGeometry,
  picketGeometry,
  sprinklerArmGeometry,
  sprinklerBaseGeometry,
  stemGeometry,
  stoneGeometry,
  sunflowerHeadGeometry,
  trunkGeometry,
  tulipCupGeometry,
  tennisBallGeometry,
  waterJetGeometry,
  wateringCanGeometry,
} from './decor-models';
import type { DecorKind, DecorPlacement, DecorPlan } from './decor-plan';
import { PALETTE } from './palette';
import { type DisposalBag, paintedMaterial } from './resources';

export interface Decor {
  group: THREE.Group;
  update(time: number): void;
}

const TULIP_COLORS = ['#ff4f6d', '#ffd23f', '#c77dff', '#ff8a3d', '#ff6fb5'] as const;
const BLOSSOM_COLORS = ['#ff8fc7', '#ffffff', '#ffd6ec'] as const;
/** Amplitude (rad) et fréquence (rad/s) du balancement des fleurs. */
const SWAY_AMPLITUDE = 0.035;
const SWAY_SPEED = 1.1;
/** Vitesse de rotation de l'arroseur (rad/s). */
const SPRINKLER_SPEED = 1.6;
const PICKET_SPACING = 1.1;

type HeadKind = 'daisy' | 'sunflower' | 'tulip';

interface Flower {
  x: number;
  z: number;
  height: number;
  stemRadius: number;
  head: HeadKind;
  headIndex: number;
  headScale: number;
  headYaw: number;
  /** Tangage de la tête (négatif : tournée vers le ciel). */
  headPitch: number;
  phase: number;
  speed: number;
}

interface InstancedOptions {
  cast?: boolean;
  receive?: boolean;
}

function instanced(
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  matrices: readonly THREE.Matrix4[],
  colors: readonly THREE.Color[] | null,
  { cast = true, receive = true }: InstancedOptions = {},
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  mesh.name = name;
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
  if (colors) colors.forEach((color, i) => mesh.setColorAt(i, color));
  mesh.computeBoundingSphere();
  return mesh;
}

const byKind = (plan: DecorPlan, ...kinds: DecorKind[]): DecorPlacement[] =>
  plan.placements.filter((placement) => kinds.includes(placement.kind));

function matrixOf(
  x: number,
  y: number,
  z: number,
  yaw: number,
  sx: number,
  sy = sx,
  sz = sx,
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(sx, sy, sz),
  );
}

export function buildDecor(plan: DecorPlan, bag: DisposalBag): Decor {
  const group = new THREE.Group();
  group.name = 'garden-decor';
  const rng = createRng(0xdec0);
  const painted = bag.add(paintedMaterial(0.7));

  // --- Fleurs ---------------------------------------------------------------
  const flowers: Flower[] = [];
  const headCounts: Record<HeadKind, number> = { daisy: 0, sunflower: 0, tulip: 0 };
  const tulipColors: THREE.Color[] = [];
  for (const placement of byKind(plan, 'daisy', 'sunflower', 'tulip')) {
    const head = placement.kind as HeadKind;
    const height = placement.size;
    flowers.push({
      x: placement.x,
      z: placement.z,
      height,
      stemRadius: 0.1 + height * 0.02,
      head,
      headIndex: headCounts[head]++,
      headScale: head === 'tulip' ? height * 0.14 : height * (head === 'sunflower' ? 0.15 : 0.16),
      headYaw: placement.rotation,
      headPitch: head === 'tulip' ? 0 : -rng.range(0.25, 0.55),
      phase: rng.range(0, Math.PI * 2),
      speed: SWAY_SPEED * rng.range(0.8, 1.25),
    });
    if (head === 'tulip')
      tulipColors.push(new THREE.Color(TULIP_COLORS[placement.variant % TULIP_COLORS.length]));
  }
  const stemMaterial = bag.add(
    new THREE.MeshStandardMaterial({ color: '#4caf3c', roughness: 0.8 }),
  );
  const leafMaterial = bag.add(
    new THREE.MeshStandardMaterial({ color: '#3f9f36', roughness: 0.75, side: THREE.DoubleSide }),
  );
  const identity = new THREE.Matrix4();
  const stems = instanced(
    'flower-stems',
    bag.add(stemGeometry()),
    stemMaterial,
    flowers.map(() => identity),
    null,
  );
  const heads: Record<HeadKind, THREE.InstancedMesh> = {
    daisy: instanced(
      'daisy-heads',
      bag.add(daisyHeadGeometry()),
      painted,
      flowers.filter((f) => f.head === 'daisy').map(() => identity),
      null,
    ),
    sunflower: instanced(
      'sunflower-heads',
      bag.add(sunflowerHeadGeometry()),
      painted,
      flowers.filter((f) => f.head === 'sunflower').map(() => identity),
      null,
    ),
    tulip: instanced(
      'tulip-heads',
      bag.add(tulipCupGeometry()),
      painted,
      flowers.filter((f) => f.head === 'tulip').map(() => identity),
      tulipColors,
    ),
  };
  const leaves = instanced(
    'flower-leaves',
    bag.add(leafGeometry()),
    leafMaterial,
    flowers.flatMap((flower) =>
      [0, 1].map((k) => {
        const yaw = flower.headYaw + (k === 0 ? 1.2 : -1.9) + rng.range(-0.3, 0.3);
        return new THREE.Matrix4().compose(
          new THREE.Vector3(flower.x, flower.height * (k === 0 ? 0.16 : 0.28), flower.z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.75, yaw, 0, 'YXZ')),
          new THREE.Vector3(1, 1, 1).multiplyScalar(flower.height * 0.11),
        );
      }),
    ),
    null,
  );
  group.add(stems, leaves, heads.daisy, heads.sunflower, heads.tulip);

  const swayQuaternion = new THREE.Quaternion();
  const headQuaternion = new THREE.Quaternion();
  const swayEuler = new THREE.Euler();
  const headEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const position = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const matrix = new THREE.Matrix4();

  const placeFlowers = (time: number): void => {
    for (let i = 0; i < flowers.length; i++) {
      const flower = flowers[i];
      const t = time * flower.speed + flower.phase;
      swayQuaternion.setFromEuler(
        swayEuler.set(
          Math.sin(t) * SWAY_AMPLITUDE,
          0,
          Math.sin(t * 0.77 + 1.3) * SWAY_AMPLITUDE * 0.7,
        ),
      );
      position.set(flower.x, 0, flower.z);
      scale.set(flower.stemRadius, flower.height, flower.stemRadius);
      stems.setMatrixAt(i, matrix.compose(position, swayQuaternion, scale));
      offset.set(0, flower.height, 0).applyQuaternion(swayQuaternion);
      position.add(offset);
      headQuaternion
        .setFromEuler(headEuler.set(flower.headPitch, flower.headYaw, 0))
        .premultiply(swayQuaternion);
      scale.setScalar(flower.headScale);
      heads[flower.head].setMatrixAt(
        flower.headIndex,
        matrix.compose(position, headQuaternion, scale),
      );
    }
    stems.instanceMatrix.needsUpdate = true;
    heads.daisy.instanceMatrix.needsUpdate = true;
    heads.sunflower.instanceMatrix.needsUpdate = true;
    heads.tulip.instanceMatrix.needsUpdate = true;
  };
  placeFlowers(0);
  for (const mesh of [stems, heads.daisy, heads.sunflower, heads.tulip]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.computeBoundingSphere();
  }

  // --- Balles de tennis ------------------------------------------------------
  const balls = byKind(plan, 'tennis-ball');
  group.add(
    instanced(
      'tennis-balls',
      bag.add(tennisBallGeometry()),
      painted,
      balls.map((ball) =>
        new THREE.Matrix4().compose(
          new THREE.Vector3(ball.x, ball.size * 0.93, ball.z),
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(rng.range(0, 6.3), rng.range(0, 6.3), rng.range(0, 6.3)),
          ),
          new THREE.Vector3(ball.size, ball.size, ball.size),
        ),
      ),
      null,
    ),
  );

  // --- Pièces uniques --------------------------------------------------------
  const unique: Partial<Record<DecorKind, { geometry: () => THREE.BufferGeometry; yaw: number }>> =
    {
      doghouse: { geometry: doghouseGeometry, yaw: 0 },
      'kibble-bowl': { geometry: kibbleBowlGeometry, yaw: 0 },
      'watering-can': { geometry: wateringCanGeometry, yaw: Math.PI / 2 },
      // Os couché le long de X : parallèle au circuit quand l'avant de la pièce regarde la piste.
      'giant-bone': { geometry: giantBoneGeometry, yaw: 0 },
      gnome: { geometry: gnomeGeometry, yaw: 0 },
    };
  const geometries = new Map<DecorKind, THREE.BufferGeometry>();
  for (const placement of plan.placements) {
    const spec = unique[placement.kind];
    if (!spec) continue;
    let geometry = geometries.get(placement.kind);
    if (!geometry) {
      geometry = bag.add(spec.geometry());
      geometries.set(placement.kind, geometry);
    }
    const mesh = new THREE.Mesh(geometry, painted);
    mesh.name = placement.kind;
    mesh.position.set(placement.x, 0, placement.z);
    mesh.rotation.y = placement.rotation + spec.yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // --- Arroseur --------------------------------------------------------------
  const arms: THREE.Object3D[] = [];
  const sprinklers = byKind(plan, 'sprinkler');
  if (sprinklers.length > 0) {
    const baseGeometry = bag.add(sprinklerBaseGeometry());
    const armGeometry = bag.add(sprinklerArmGeometry());
    const jets = [-1, 1].map((side) => bag.add(waterJetGeometry(side)));
    const water = bag.add(
      new THREE.MeshStandardMaterial({
        color: '#a8e0ff',
        roughness: 0.1,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    for (const placement of sprinklers) {
      const sprinkler = new THREE.Group();
      sprinkler.name = 'sprinkler';
      sprinkler.position.set(placement.x, 0, placement.z);
      const base = new THREE.Mesh(baseGeometry, painted);
      base.name = 'sprinkler-base';
      base.castShadow = true;
      const arm = new THREE.Group();
      arm.name = 'sprinkler-arm';
      arm.position.y = 1.95;
      const armMesh = new THREE.Mesh(armGeometry, painted);
      armMesh.name = 'sprinkler-head';
      armMesh.castShadow = true;
      arm.add(armMesh);
      for (const jet of jets) {
        const mesh = new THREE.Mesh(jet, water);
        mesh.name = 'sprinkler-jet';
        arm.add(mesh);
      }
      sprinkler.add(base, arm);
      arms.push(arm);
      group.add(sprinkler);
    }
  }

  // --- Arbres ----------------------------------------------------------------
  const trees = byKind(plan, 'tree');
  const foliage = PALETTE.foliage.map((hex) => new THREE.Color(hex));
  const blob = bag.add(blobGeometry());
  const foliageMaterial = bag.add(new THREE.MeshStandardMaterial({ roughness: 0.85 }));
  const trunkMaterial = bag.add(
    new THREE.MeshStandardMaterial({ color: PALETTE.trunk, roughness: 0.9 }),
  );
  const treeBlobs: THREE.Matrix4[] = [];
  const treeColors: THREE.Color[] = [];
  for (const tree of trees) {
    const h = tree.size;
    const tint = foliage[(tree.variant * 2 + 1) % foliage.length];
    treeBlobs.push(matrixOf(tree.x, h * 0.68, tree.z, tree.rotation, h * 0.24, h * 0.22, h * 0.24));
    treeColors.push(tint);
    treeBlobs.push(matrixOf(tree.x, h * 0.86, tree.z, tree.rotation, h * 0.16));
    treeColors.push(foliage[(tree.variant * 2 + 2) % foliage.length]);
    for (let k = 0; k < 3; k++) {
      const angle = tree.rotation + (k / 3) * Math.PI * 2;
      treeBlobs.push(
        matrixOf(
          tree.x + Math.sin(angle) * h * 0.14,
          h * 0.55,
          tree.z + Math.cos(angle) * h * 0.14,
          angle,
          h * 0.16,
        ),
      );
      treeColors.push(foliage[(tree.variant + k) % foliage.length]);
    }
  }
  group.add(
    instanced(
      'tree-trunks',
      bag.add(trunkGeometry()),
      trunkMaterial,
      trees.map((tree) =>
        matrixOf(
          tree.x,
          0,
          tree.z,
          tree.rotation,
          tree.size * 0.045,
          tree.size * 0.62,
          tree.size * 0.045,
        ),
      ),
      null,
    ),
    instanced('tree-foliage', blob, foliageMaterial, treeBlobs, treeColors),
  );

  // --- Buissons ---------------------------------------------------------------
  const bushBlobs: THREE.Matrix4[] = [];
  const bushColors: THREE.Color[] = [];
  const blossoms: THREE.Matrix4[] = [];
  const blossomColors: THREE.Color[] = [];
  for (const bush of byKind(plan, 'bush')) {
    const r = bush.size;
    bushBlobs.push(matrixOf(bush.x, r * 0.5, bush.z, bush.rotation, r, r * 0.78, r));
    bushColors.push(foliage[(bush.variant + 1) % foliage.length]);
    for (const k of [0, 1]) {
      const angle = bush.rotation + k * Math.PI + rng.range(-0.4, 0.4);
      bushBlobs.push(
        matrixOf(
          bush.x + Math.sin(angle) * r * 0.6,
          r * 0.34,
          bush.z + Math.cos(angle) * r * 0.6,
          angle,
          r * 0.64,
        ),
      );
      bushColors.push(foliage[(bush.variant + 2 + k) % foliage.length]);
    }
    if (bush.variant === 2) {
      for (let k = 0; k < 8; k++) {
        const angle = rng.range(0, Math.PI * 2);
        const lift = rng.range(0.25, 1.2);
        blossoms.push(
          matrixOf(
            bush.x + Math.sin(angle) * Math.cos(lift) * r * 0.98,
            r * 0.5 + Math.sin(lift) * r * 0.76,
            bush.z + Math.cos(angle) * Math.cos(lift) * r * 0.98,
            angle,
            r * 0.13,
          ),
        );
        blossomColors.push(new THREE.Color(rng.pick(BLOSSOM_COLORS)));
      }
    }
  }
  group.add(instanced('bushes', blob, foliageMaterial, bushBlobs, bushColors));
  if (blossoms.length > 0) {
    group.add(
      instanced('bush-blossoms', blob, foliageMaterial, blossoms, blossomColors, { cast: false }),
    );
  }

  // --- Pierres de gué ----------------------------------------------------------
  const stones = byKind(plan, 'stepping-stone');
  const stonePalette = PALETTE.stone.map((hex) => new THREE.Color(hex));
  group.add(
    instanced(
      'stepping-stones',
      bag.add(stoneGeometry()),
      bag.add(new THREE.MeshStandardMaterial({ roughness: 0.95 })),
      stones.map((stone) =>
        matrixOf(stone.x, 0.03, stone.z, stone.rotation, stone.size, 1, stone.size),
      ),
      stones.map((stone) => stonePalette[stone.variant % stonePalette.length]),
      { cast: false },
    ),
  );

  // --- Clôture -----------------------------------------------------------------
  group.add(...buildFence(plan, bag));

  return {
    group,
    update(time: number): void {
      placeFlowers(time);
      for (const arm of arms) arm.rotation.y = time * SPRINKLER_SPEED;
    },
  };
}

/** Clôture en bois blanche sur le pourtour du jardin : planches et deux lisses par côté. */
function buildFence(plan: DecorPlan, bag: DisposalBag): THREE.InstancedMesh[] {
  const { minX, maxX, minZ, maxZ } = plan.fence;
  const pickets: THREE.Matrix4[] = [];
  const rails: THREE.Matrix4[] = [];
  const sides = [
    { from: [minX, minZ], to: [maxX, minZ], outward: [0, -1] },
    { from: [minX, maxZ], to: [maxX, maxZ], outward: [0, 1] },
    { from: [minX, minZ], to: [minX, maxZ], outward: [-1, 0] },
    { from: [maxX, minZ], to: [maxX, maxZ], outward: [1, 0] },
  ] as const;
  for (const { from, to, outward } of sides) {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const yaw = outward[0] === 0 ? 0 : Math.PI / 2;
    const count = Math.round(length / PICKET_SPACING);
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      pickets.push(
        matrixOf(from[0] + (to[0] - from[0]) * t, 0, from[1] + (to[1] - from[1]) * t, yaw, 1),
      );
    }
    const cx = (from[0] + to[0]) / 2 + outward[0] * 0.14;
    const cz = (from[1] + to[1]) / 2 + outward[1] * 0.14;
    for (const y of [0.9, 2.3]) {
      rails.push(matrixOf(cx, y, cz, yaw, length, 0.3, 0.14));
    }
  }
  const material = bag.add(
    new THREE.MeshStandardMaterial({ color: PALETTE.fence, roughness: 0.7 }),
  );
  return [
    instanced('fence-pickets', bag.add(picketGeometry()), material, pickets, null, { cast: false }),
    instanced('fence-rails', bag.add(new THREE.BoxGeometry(1, 1, 1)), material, rails, null, {
      cast: false,
    }),
  ];
}
