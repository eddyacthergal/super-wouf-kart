/**
 * Animaux de la plage, animés à chaque image à partir du temps (déterministe) : mouettes qui
 * tournent dans le ciel en battant des ailes, crabes qui marchent en crabe et claquent des pinces,
 * dauphins qui sautent au large.
 */
import * as THREE from 'three';
import { createRng } from '../core/rng';
import {
  crabBodyGeometry,
  crabClawGeometry,
  dolphinGeometry,
  gullBodyGeometry,
  gullWingGeometry,
} from './beach-models';
import type { DecorPlacement } from './decor-plan';
import type { WorldPart } from './garden-world';
import { type DisposalBag, paintedMaterial } from './resources';

const GULLS = 10;
const DOLPHINS = 3;
/** Durée (s) d'un cycle de dauphin et d'un saut. */
const DOLPHIN_CYCLE = 7;
const DOLPHIN_JUMP = 1.7;

interface Gull {
  node: THREE.Group;
  wings: [THREE.Object3D, THREE.Object3D];
  cx: number;
  cz: number;
  radius: number;
  height: number;
  speed: number;
  phase: number;
  flap: number;
}

/** Mouettes : cercles lents au-dessus du circuit et de la mer, battements d'ailes et vols planés. */
export function buildGulls(
  center: { x: number; z: number },
  reach: number,
  bag: DisposalBag,
): WorldPart {
  const rng = createRng(0x9011);
  const material = bag.add(paintedMaterial(0.8));
  const body = bag.add(gullBodyGeometry());
  const wing = bag.add(gullWingGeometry());
  const group = new THREE.Group();
  group.name = 'gulls';
  const gulls: Gull[] = [];
  for (let k = 0; k < GULLS; k++) {
    const node = new THREE.Group();
    node.name = 'gull';
    node.scale.setScalar(rng.range(1.1, 1.5));
    node.add(new THREE.Mesh(body, material));
    const left = new THREE.Mesh(wing, material);
    const right = new THREE.Mesh(wing, material);
    right.scale.x = -1;
    node.add(left, right);
    group.add(node);
    gulls.push({
      node,
      wings: [left, right],
      cx: center.x + rng.range(-reach, reach) * 0.4,
      cz: center.z + rng.range(-reach, reach) * 0.4,
      radius: rng.range(35, reach),
      height: rng.range(16, 34),
      speed: rng.range(0.12, 0.22) * (rng.next() < 0.5 ? -1 : 1),
      phase: rng.range(0, Math.PI * 2),
      flap: rng.range(7, 9),
    });
  }
  const update = (time: number): void => {
    for (const gull of gulls) {
      const angle = gull.phase + time * gull.speed;
      const x = gull.cx + Math.cos(angle) * gull.radius;
      const z = gull.cz + Math.sin(angle) * gull.radius;
      const y = gull.height + Math.sin(time * 0.5 + gull.phase) * 2;
      gull.node.position.set(x, y, z);
      // Cap tangent au cercle, légère inclinaison dans le virage.
      const direction = Math.sign(gull.speed);
      gull.node.rotation.set(
        0,
        Math.atan2(-Math.sin(angle) * direction, Math.cos(angle) * direction),
        -0.25 * direction,
        'YXZ',
      );
      // Battements par salves, puis vol plané ailes tendues.
      const gliding = Math.sin(time * 0.35 + gull.phase) > 0.2;
      const flap = gliding ? 0.08 : Math.sin(time * gull.flap + gull.phase) * 0.6;
      gull.wings[0].rotation.z = flap;
      gull.wings[1].rotation.z = -flap;
    }
  };
  update(0);
  return { object: group, update };
}

interface Crab {
  node: THREE.Group;
  claws: [THREE.Object3D, THREE.Object3D];
  x: number;
  z: number;
  yaw: number;
  phase: number;
  stride: number;
}

/** Crabes du plan de décor : va-et-vient latéral, dandinement, pinces qui claquent. */
export function buildCrabs(placements: readonly DecorPlacement[], bag: DisposalBag): WorldPart {
  const rng = createRng(0xc4ab);
  const material = bag.add(paintedMaterial(0.55));
  const body = bag.add(crabBodyGeometry());
  const claw = bag.add(crabClawGeometry());
  const group = new THREE.Group();
  group.name = 'crabs';
  const crabs: Crab[] = placements.map((placement) => {
    const node = new THREE.Group();
    node.name = 'crab';
    node.scale.setScalar(placement.size);
    const shell = new THREE.Mesh(body, material);
    shell.castShadow = true;
    node.add(shell);
    const makeClaw = (side: number): THREE.Object3D => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.75, 0.55, 0.45);
      pivot.rotation.y = side * -0.5;
      const mesh = new THREE.Mesh(claw, material);
      mesh.castShadow = true;
      pivot.add(mesh);
      node.add(pivot);
      return pivot;
    };
    const claws: [THREE.Object3D, THREE.Object3D] = [makeClaw(-1), makeClaw(1)];
    group.add(node);
    return {
      node,
      claws,
      x: placement.x,
      z: placement.z,
      yaw: placement.rotation,
      phase: rng.range(0, Math.PI * 2),
      stride: rng.range(1.5, 3),
    };
  });
  const update = (time: number): void => {
    for (const crab of crabs) {
      const t = time * 0.7 + crab.phase;
      // Déplacement sur le côté (axe X local), à la façon d'un crabe.
      const offset = Math.sin(t) * crab.stride;
      crab.node.position.set(
        crab.x + Math.cos(crab.yaw) * offset,
        Math.abs(Math.sin(t * 6)) * 0.08,
        crab.z - Math.sin(crab.yaw) * offset,
      );
      crab.node.rotation.set(0, crab.yaw, Math.sin(t * 6) * 0.05);
      const snap = Math.max(0, Math.sin(time * 3 + crab.phase * 2)) * 0.6;
      crab.claws[0].rotation.x = -snap;
      crab.claws[1].rotation.x = -snap;
    }
  };
  update(0);
  return { object: group, update };
}

interface Dolphin {
  node: THREE.Object3D;
  x: number;
  z: number;
  yaw: number;
  offset: number;
  height: number;
  length: number;
}

/** Dauphins : bonds réguliers au large, cachés sous l'eau entre deux sauts. */
export function buildDolphins(shoreZ: number, centerX: number, bag: DisposalBag): WorldPart {
  const rng = createRng(0xd0f1);
  const material = bag.add(paintedMaterial(0.35));
  const geometry = bag.add(dolphinGeometry());
  const group = new THREE.Group();
  group.name = 'dolphins';
  const dolphins: Dolphin[] = [];
  for (let k = 0; k < DOLPHINS; k++) {
    const node = new THREE.Mesh(geometry, material);
    node.name = 'dolphin';
    node.scale.setScalar(rng.range(1.4, 1.9));
    group.add(node);
    dolphins.push({
      node,
      x: centerX + rng.range(-120, 120),
      z: shoreZ + rng.range(45, 110),
      yaw: rng.range(-0.6, 0.6) + (rng.next() < 0.5 ? Math.PI / 2 : -Math.PI / 2),
      offset: (k / DOLPHINS) * DOLPHIN_CYCLE + rng.range(0, 1),
      height: rng.range(5, 8),
      length: rng.range(12, 18),
    });
  }
  const update = (time: number): void => {
    for (const dolphin of dolphins) {
      const cycle = (time + dolphin.offset) % DOLPHIN_CYCLE;
      if (cycle > DOLPHIN_JUMP) {
        dolphin.node.visible = false;
        continue;
      }
      dolphin.node.visible = true;
      const u = cycle / DOLPHIN_JUMP;
      const along = (u - 0.5) * dolphin.length;
      dolphin.node.position.set(
        dolphin.x + Math.sin(dolphin.yaw) * along,
        Math.sin(u * Math.PI) * dolphin.height - 1.2,
        dolphin.z + Math.cos(dolphin.yaw) * along,
      );
      // Tangage selon la pente de la trajectoire : nez en l'air à la montée, vers l'eau à la descente.
      const slope = (Math.cos(u * Math.PI) * Math.PI * dolphin.height) / dolphin.length;
      dolphin.node.rotation.set(-Math.atan(slope), dolphin.yaw, 0, 'YXZ');
    }
  };
  update(0);
  return { object: group, update };
}
