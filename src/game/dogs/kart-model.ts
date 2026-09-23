/**
 * Kart three.js : châssis arrondi, pare-chocs, siège, volant, 4 roues et 2 pots d'échappement.
 * Repère du kart : origine au sol au centre, +Z vers l'avant, +X à gauche du pilote.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  alignBetween,
  capsule,
  dim,
  mesh,
  type ResourceScope,
  unitCylinder,
} from './model-resources';

/** Siège : hauteur du dessus de l'assise et position de son centre. */
export const SEAT = { top: 0.52, z: -0.3 } as const;

export const FRONT_WHEEL = { radius: 0.26, width: 0.2, x: 0.58, z: 0.62 } as const;
export const REAR_WHEEL = { radius: 0.31, width: 0.26, x: 0.57, z: -0.6 } as const;

/** Angle de braquage visuel des roues avant à plein braquage (rad). */
export const MAX_WHEEL_STEER = 0.42;

/** Inclinaison du volant vers le pilote (rad) et rayon de la jante. */
const STEERING_TILT = 0.64;
const STEERING_RADIUS = 0.17;
/** Angle des mains depuis le haut du volant (« 10 h 10 »). */
const GRIP_ANGLE = 0.95;
/** Pied de la colonne de direction, sur le tableau de bord. */
const COLUMN_BASE = new THREE.Vector3(0, 0.42, 0.62);

const COLORS = {
  trim: '#2b2d38',
  seat: '#343746',
  metal: '#3d404c',
  tire: '#1d1d22',
  rim: '#e9e9ef',
  exhaust: '#a4aab3',
  stripe: '#fbfbf7',
} as const;

export interface KartOptions {
  color: string;
  /** Centre du volant, ajusté à la taille du pilote. */
  steeringCenter: THREE.Vector3;
  /** Dossier du siège (retiré pour un chien dont le corps dépasse vers l'arrière). */
  seatBack: boolean;
}

export interface KartRig {
  /** Groupe soulevé par le saut (tout le modèle sauf `root`). */
  lift: THREE.Group;
  /** Carrosserie et pilote, inclinés pendant le dérapage. */
  chassis: THREE.Group;
  frontPivots: THREE.Object3D[];
  /** Groupes qui tournent avec la vitesse : avant gauche, avant droite, arrière gauche, arrière droite. */
  wheelSpins: THREE.Object3D[];
  rearWheels: THREE.Object3D[];
  exhausts: THREE.Object3D[];
  /** Tourne autour de son axe Z avec le braquage. */
  steeringSpinner: THREE.Object3D;
}

/** Points où le pilote tient le volant (coordonnées du kart) : gauche puis droite. */
export function steeringGrips(center: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const up = new THREE.Vector3(0, Math.cos(STEERING_TILT), Math.sin(STEERING_TILT));
  const grip = (side: number): THREE.Vector3 =>
    center
      .clone()
      .addScaledVector(up, STEERING_RADIUS * Math.cos(GRIP_ANGLE))
      .add(new THREE.Vector3(side * STEERING_RADIUS * Math.sin(GRIP_ANGLE), 0, 0));
  return [grip(1), grip(-1)];
}

function roundedBox(
  scope: ResourceScope,
  w: number,
  h: number,
  d: number,
  radius: number,
): THREE.BufferGeometry {
  return scope.geometry(
    `rbox:${dim(w)}:${dim(h)}:${dim(d)}:${dim(radius)}`,
    () => new RoundedBoxGeometry(w, h, d, 3, radius),
  );
}

/** Pneu au profil arrondi (tour creux), axe de rotation X. */
function tireGeometry(scope: ResourceScope, radius: number, width: number): THREE.BufferGeometry {
  return scope.geometry(`tire:${dim(radius)}:${dim(width)}`, () => {
    const inner = radius * 0.6;
    const half = width / 2;
    const corner = Math.min((radius - inner) * 0.45, half * 0.6);
    const points: THREE.Vector2[] = [new THREE.Vector2(inner, -half)];
    const arc = (cx: number, cy: number, from: number): void => {
      for (let i = 0; i <= 4; i++) {
        const a = from + (i / 4) * (Math.PI / 2);
        points.push(new THREE.Vector2(cx + corner * Math.cos(a), cy + corner * Math.sin(a)));
      }
    };
    arc(radius - corner, -half + corner, -Math.PI / 2);
    arc(radius - corner, half - corner, 0);
    points.push(new THREE.Vector2(inner, half));
    const geometry = new THREE.LatheGeometry(points, 24);
    geometry.rotateZ(Math.PI / 2);
    return geometry;
  });
}

export function buildKart(scope: ResourceScope, options: KartOptions): KartRig {
  const body = scope.material(options.color, { roughness: 0.45, metalness: 0.1 });
  const trim = scope.material(COLORS.trim, { roughness: 0.6 });
  const seatMaterial = scope.material(COLORS.seat, { roughness: 0.8 });
  const metal = scope.material(COLORS.metal, { roughness: 0.5, metalness: 0.4 });
  const tire = scope.material(COLORS.tire, { roughness: 0.9 });
  const rim = scope.material(COLORS.rim, { roughness: 0.45, flatShading: true });
  const exhaust = scope.material(COLORS.exhaust, { roughness: 0.3, metalness: 0.45 });
  const stripe = scope.material(COLORS.stripe, { roughness: 0.5 });

  const lift = new THREE.Group();
  lift.name = 'kart-lift';
  const chassis = new THREE.Group();
  chassis.name = 'kart-chassis';
  lift.add(chassis);

  const add = (part: THREE.Mesh, x: number, y: number, z: number): THREE.Mesh => {
    part.position.set(x, y, z);
    part.receiveShadow = true;
    chassis.add(part);
    return part;
  };

  // Plancher et pontons latéraux.
  add(mesh(roundedBox(scope, 0.95, 0.14, 1.75, 0.05), body, 'kart-floor'), 0, 0.2, -0.02);
  for (const side of [1, -1]) {
    const pod = add(mesh(capsule(scope, 0.11, 1.1), body, 'kart-pod'), side * 0.33, 0.3, 0);
    pod.rotation.x = Math.PI / 2;
  }
  // Nez, capot (avec une bande blanche) et pare-chocs avant.
  const nose = add(mesh(capsule(scope, 0.17, 0.5), body, 'kart-nose'), 0, 0.3, 0.72);
  nose.rotation.z = Math.PI / 2;
  const hood = add(
    mesh(roundedBox(scope, 0.56, 0.16, 0.5, 0.06), body, 'kart-hood'),
    0,
    0.37,
    0.42,
  );
  hood.rotation.x = 0.18;
  const band = add(
    mesh(roundedBox(scope, 0.13, 0.03, 0.52, 0.012), stripe, 'kart-stripe'),
    0,
    0.455,
    0.42,
  );
  band.rotation.x = 0.18;
  const bumper = add(mesh(capsule(scope, 0.07, 1.0), trim, 'kart-bumper'), 0, 0.2, 0.98);
  bumper.rotation.z = Math.PI / 2;
  // Bloc moteur arrière.
  add(mesh(roundedBox(scope, 0.7, 0.26, 0.34, 0.06), metal, 'kart-engine'), 0, 0.36, -0.82);

  // Siège.
  add(
    mesh(roundedBox(scope, 0.64, 0.12, 0.56, 0.05), seatMaterial, 'kart-seat'),
    0,
    SEAT.top - 0.06,
    SEAT.z,
  );
  if (options.seatBack) {
    const back = add(
      mesh(roundedBox(scope, 0.64, 0.3, 0.1, 0.04), seatMaterial, 'kart-seat-back'),
      0,
      0.61,
      -0.62,
    );
    back.rotation.x = -0.15;
  }

  // Colonne de direction et volant.
  const column = mesh(unitCylinder(scope, 8), trim, 'kart-column');
  alignBetween(column, COLUMN_BASE, options.steeringCenter);
  column.scale.set(0.028, COLUMN_BASE.distanceTo(options.steeringCenter), 0.028);
  chassis.add(column);
  const steering = new THREE.Group();
  steering.position.copy(options.steeringCenter);
  steering.rotation.x = STEERING_TILT;
  chassis.add(steering);
  const steeringSpinner = new THREE.Group();
  steeringSpinner.name = 'kart-steering';
  steering.add(steeringSpinner);
  const wheelRing = scope.geometry(
    `torus:${dim(STEERING_RADIUS)}`,
    () => new THREE.TorusGeometry(STEERING_RADIUS, 0.035, 8, 24),
  );
  steeringSpinner.add(mesh(wheelRing, trim, 'kart-steering-ring'));
  const spoke = mesh(
    roundedBox(scope, STEERING_RADIUS * 2, 0.04, 0.03, 0.012),
    trim,
    'kart-steering-spoke',
  );
  steeringSpinner.add(spoke);

  // Pots d'échappement : l'origine du groupe est à la sortie, le gaz part vers -Z.
  const exhausts: THREE.Object3D[] = [];
  const pipeGeometry = scope.geometry(
    'exhaust-pipe',
    () => new THREE.CylinderGeometry(0.075, 0.055, 0.3, 12),
  );
  for (const side of [1, -1]) {
    const outlet = new THREE.Group();
    outlet.name = 'exhaust';
    outlet.position.set(side * 0.2, 0.44, -1.0);
    const pipe = mesh(pipeGeometry, exhaust, 'exhaust-pipe');
    pipe.rotation.x = -Math.PI / 2;
    pipe.position.z = 0.13;
    outlet.add(pipe);
    chassis.add(outlet);
    exhausts.push(outlet);
  }

  // Roues : support fixe → pivot de braquage (avant) → rotation.
  const frontPivots: THREE.Object3D[] = [];
  const wheelSpins: THREE.Object3D[] = [];
  const rearWheels: THREE.Object3D[] = [];
  const rimGeometry = unitCylinder(scope, 6);
  const buildWheel = (
    spec: typeof FRONT_WHEEL | typeof REAR_WHEEL,
    side: number,
    front: boolean,
  ): THREE.Group => {
    const mount = new THREE.Group();
    mount.name = front ? 'wheel-front' : 'wheel-rear';
    mount.position.set(side * spec.x, spec.radius, spec.z);
    const spin = new THREE.Group();
    spin.name = 'wheel-spin';
    const tireMesh = mesh(tireGeometry(scope, spec.radius, spec.width), tire, 'tire');
    const rimMesh = mesh(rimGeometry, rim, 'rim');
    rimMesh.rotation.z = Math.PI / 2;
    rimMesh.scale.set(spec.radius * 0.62, spec.width * 0.96, spec.radius * 0.62);
    spin.add(tireMesh, rimMesh);
    if (front) {
      const pivot = new THREE.Group();
      pivot.add(spin);
      mount.add(pivot);
      frontPivots.push(pivot);
    } else {
      mount.add(spin);
      rearWheels.push(mount);
    }
    wheelSpins.push(spin);
    lift.add(mount);
    return mount;
  };
  buildWheel(FRONT_WHEEL, 1, true);
  buildWheel(FRONT_WHEEL, -1, true);
  buildWheel(REAR_WHEEL, 1, false);
  buildWheel(REAR_WHEEL, -1, false);

  return { lift, chassis, frontPivots, wheelSpins, rearWheels, exhausts, steeringSpinner };
}
