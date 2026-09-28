/**
 * Chien three.js construit par code (sphères, capsules, cônes, tubes, feuilles extrudées), assis
 * dans le kart, pattes avant sur le volant. Toutes les positions sont exprimées dans le repère du
 * kart.
 */
import * as THREE from 'three';
import type { SkinSlot } from '../core/types';
import { clamp } from '../core/vec2';
import type { BreedDefinition, DogLook, EarStyle, TailStyle } from './breeds';
import { type EarCup, earLeafGeometry, type EarLeafSpec } from './ear-leaf';
import { SEAT } from './kart-model';
import {
  alignBetween,
  basisQuaternion,
  capsule,
  mergeParts,
  mesh,
  mirroredPair,
  type PartTransform,
  type ResourceScope,
  unitCone,
  unitSphere,
} from './model-resources';
import type { SkinFit } from './skin-models';
import { tailTubeGeometry } from './tail-tube';

const NOSE_COLOR = '#1b1514';
const PUPIL_COLOR = '#16110f';
const TONGUE_COLOR = '#f2798c';
/** Plis du front du carlin : un peu plus foncés que le pelage. */
const WRINKLE_COLOR = '#c49a66';
const EYE_WHITE_COLOR = '#ffffff';
/** Reflet des yeux : non éclairé, il reste blanc à l'ombre. */
const EYE_SHINE_COLOR = '#ffffff';

/**
 * Truffe et yeux brillants, comme mouillés : ils reflètent l'image d'environnement (ciel, soleil).
 * Le blanc de l'œil en reçoit moins, pour ne pas se teinter de ciel. La fourrure n'en reçoit pas :
 * elle s'éclaircirait sans gagner de reflet.
 */
const GLOSS = {
  nose: { roughness: 0.25, envMapIntensity: 0.8 },
  eyeWhite: { roughness: 0.25, envMapIntensity: 0.4 },
  pupil: { roughness: 0.15, envMapIntensity: 1 },
} as const;

/** Direction des bras vers le volant (vers l'avant, légèrement vers le bas). */
const ARM_DIRECTION = new THREE.Vector3(0, -0.28, 1).normalize();
/** Limites du centre du volant dans le kart. */
const STEERING_LIMITS = { minY: 0.75, maxY: 1.05, minZ: 0.1, maxZ: 0.45 } as const;

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

export interface DogLayout {
  hips: THREE.Vector3;
  chest: THREE.Vector3;
  head: THREE.Vector3;
  /** Axe unitaire du torse, du bassin vers le poitrail. */
  torsoAxis: THREE.Vector3;
  /** Normale unitaire du ventre (avant/bas), perpendiculaire à l'axe du torse. */
  bellyNormal: THREE.Vector3;
  steeringCenter: THREE.Vector3;
}

export function computeDogLayout(look: DogLook): DogLayout {
  const hips = new THREE.Vector3(0, SEAT.top + look.hipLift, SEAT.z + look.hipZ);
  const torsoAxis = new THREE.Vector3(0, Math.sin(look.torsoPitch), Math.cos(look.torsoPitch));
  const bellyNormal = new THREE.Vector3(0, -Math.cos(look.torsoPitch), Math.sin(look.torsoPitch));
  const chest = hips.clone().addScaledVector(torsoAxis, look.torsoLength);
  const head = chest.clone().add(new THREE.Vector3(0, look.neckLift, look.neckForward));
  const steeringCenter = chest.clone().addScaledVector(ARM_DIRECTION, look.armReach);
  steeringCenter.y = clamp(steeringCenter.y, STEERING_LIMITS.minY, STEERING_LIMITS.maxY);
  steeringCenter.z = clamp(steeringCenter.z, STEERING_LIMITS.minZ, STEERING_LIMITS.maxZ);
  return { hips, chest, head, torsoAxis, bellyNormal, steeringCenter };
}

/** Oreille animée : rotations X et Z du pivot = vent × wind + battement × flap. */
export interface EarRig {
  pivot: THREE.Object3D;
  windX: number;
  windZ: number;
  flapX: number;
  flapZ: number;
  phase: number;
}

export interface DogRig {
  root: THREE.Group;
  head: THREE.Group;
  ears: EarRig[];
  /** Pivot de la queue : elle remue en tournant autour de son axe Z local. */
  tail: THREE.Object3D;
  attach: Record<SkinSlot, THREE.Group>;
  fit: SkinFit;
}

export interface DogOptions {
  /** Points de préhension du volant (gauche, droite). */
  grips: readonly [THREE.Vector3, THREE.Vector3];
  /** Tache claire du poitrail (masquée sous un pull). */
  showBelly: boolean;
  /** Image d'environnement des reflets de la truffe et des yeux (null : aucun reflet). */
  environment: THREE.Texture | null;
}

/** Pose d'une oreille gauche (+X) ; la droite est symétrique. */
interface EarPose {
  /** Base sur la tête, en rayons de tête (avant étirement). */
  base: THREE.Vector3;
  /** Direction base → pointe. */
  direction: THREE.Vector3;
  /** Direction approximative de la face de l'oreille (axe mince). */
  face: THREE.Vector3;
  windX: number;
  windZ: number;
  flapX: number;
  flapZ: number;
}

/** Point de la surface d'une sphère unité : angle depuis le sommet vers +X, puis décalage en z. */
const onHead = (polar: number, z: number): THREE.Vector3 =>
  new THREE.Vector3(Math.sin(polar), Math.cos(polar), z).normalize().multiplyScalar(0.93);

const EAR_POSES: Record<EarStyle, EarPose> = {
  // Oreilles de chauve-souris : écartées d'environ 35°, creux vers l'avant et un peu sur le côté.
  erect: {
    base: onHead(0.78, -0.1),
    direction: new THREE.Vector3(0.7, 1, -0.1),
    face: new THREE.Vector3(0.4, 0, 1),
    windX: -0.55,
    windZ: 0,
    flapX: 0.1,
    flapZ: 0.08,
  },
  folded: {
    base: onHead(0.9, 0.02),
    direction: new THREE.Vector3(0.7, -0.35, 0.62),
    face: new THREE.Vector3(0.55, 0.8, 0.1),
    windX: 0.25,
    windZ: 0,
    flapX: 0.12,
    flapZ: 0,
  },
  floppy: {
    base: onHead(1.0, -0.12),
    direction: new THREE.Vector3(0.2, -1, -0.12),
    face: new THREE.Vector3(1, 0.1, 0),
    windX: 0.55,
    windZ: 0.6,
    flapX: 0.2,
    flapZ: 0.1,
  },
  'semi-floppy': {
    base: onHead(0.72, 0),
    direction: new THREE.Vector3(0.4, -0.3, 0.87),
    face: new THREE.Vector3(0.4, 0.9, 0),
    windX: 0.4,
    windZ: 0,
    flapX: 0.15,
    flapZ: 0.05,
  },
};

/**
 * Forme des oreilles dressées : larges feuilles épaisses aux bords ronds, au bout arrondi,
 * creusées en cuillère. Longueurs en mètres ; largeur et longueur viennent de la race.
 */
const ERECT_EAR = {
  /** Rayon du bout, en fraction de la largeur de la base. */
  tipRadius: 0.2,
  /** Flancs légèrement bombés, en fraction de la demi-largeur. */
  bulge: 0.08,
  /** Base enfoncée dans le crâne : aucun jour sous l'oreille. */
  sink: 0.05,
  thickness: 0.034,
  /** Arrondi des bords. */
  bevel: 0.013,
  /**
   * Creux : avance des bords à la base, part perdue au bout, et rétrécissement de la largeur de
   * référence (comme le contour) pour que l'oreille reste creuse jusqu'au bout.
   */
  cupDepth: 0.05,
  cupTipFade: 0.5,
  cupNarrowing: 0.6,
  /** Intérieur rose : feuille plus fine posée dans le creux, en retrait des bords de l'oreille. */
  inner: {
    /** Largeur et longueur, en fraction de celles de l'oreille. */
    width: 0.62,
    length: 0.8,
    /** Rayon du bout, en fraction de sa largeur. */
    tipRadius: 0.2,
    thickness: 0.012,
    bevel: 0.005,
    /** Saillie devant la face creuse de l'oreille. */
    rise: 0.004,
  },
} as const;

/** Oreille dressée et son intérieur, dans le repère du pivot (base en y = 0, creux vers +Z). */
function erectEarSpecs(look: DogLook): { flap: EarLeafSpec; inner: EarLeafSpec } {
  const shape = ERECT_EAR;
  // Même creux pour les deux feuilles : l'intérieur épouse l'oreille.
  const cup: EarCup = {
    depth: shape.cupDepth,
    halfWidth: look.earWidth / 2,
    length: look.earLength,
    narrowing: shape.cupNarrowing,
    tipFade: shape.cupTipFade,
  };
  const flap: EarLeafSpec = {
    width: look.earWidth,
    length: look.earLength,
    tipRadius: look.earWidth * shape.tipRadius,
    bulge: shape.bulge,
    sink: shape.sink,
    thickness: shape.thickness,
    bevel: shape.bevel,
    offsetZ: 0,
    cup,
  };
  const innerWidth = look.earWidth * shape.inner.width;
  const inner: EarLeafSpec = {
    ...flap,
    width: innerWidth,
    length: look.earLength * shape.inner.length,
    tipRadius: innerWidth * shape.inner.tipRadius,
    thickness: shape.inner.thickness,
    bevel: shape.inner.bevel,
    // Dos enfoncé dans l'oreille, face avant en saillie de `rise`.
    offsetZ: shape.thickness / 2 + shape.inner.rise - shape.inner.thickness / 2,
  };
  return { flap, inner };
}

/** Direction de départ de la queue (plan YZ) selon son style. */
const TAIL_DIRECTIONS: Record<TailStyle, THREE.Vector3> = {
  // Assez en arrière pour que l'arc de la faucille se détache du dos.
  thin: new THREE.Vector3(0, 0.55, -0.83).normalize(),
  corkscrew: new THREE.Vector3(0, 0.55, -0.8).normalize(),
  long: new THREE.Vector3(0, 0.3, -1).normalize(),
  short: new THREE.Vector3(0, 1, -0.35).normalize(),
};

/** Queues en tube courbe et effilé : fine et relevée, longue dans l'axe du corps. */
type TubeTailStyle = Extract<TailStyle, 'thin' | 'long'>;

/** Forme d'une queue en tube. */
interface TailTubeShape {
  /** Rayon de la racine, en rayons de patte. */
  baseRadius: number;
  /** Rayon du bout arrondi, en fraction de celui de la racine. */
  tipRadius: number;
  /**
   * Enroulement de la racine au bout (rad), vers +Z local : vers l'avant pour une queue dressée,
   * vers le haut pour une queue portée en arrière.
   */
  curl: number;
}

const TAIL_TUBES: Record<TubeTailStyle, TailTubeShape> = {
  // Faucille du chihuahua : part vers l'arrière, puis remonte en arc au-dessus du dos.
  thin: { baseRadius: 0.8, tipRadius: 0.35, curl: 1.7 },
  // Queue du teckel : longue, dans l'axe du corps, légèrement relevée.
  long: { baseRadius: 1.1, tipRadius: 0.3, curl: 0.5 },
};
/** Racine des queues en tube enfoncée dans le bassin (m) : aucun jour quand elles remuent. */
const TAIL_TUBE_SINK = 0.02;

/** Hélice partant de l'origine et montant le long de +Y (queue en tire-bouchon). */
class CorkscrewCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    private readonly radius: number,
    private readonly height: number,
    private readonly turns: number,
  ) {
    super();
  }

  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const angle = t * this.turns * Math.PI * 2;
    return target.set(
      this.radius * (1 - Math.cos(angle)),
      this.height * t,
      this.radius * Math.sin(angle),
    );
  }
}

export function buildDog(
  scope: ResourceScope,
  breed: BreedDefinition,
  layout: DogLayout,
  options: DogOptions,
): DogRig {
  const look = breed.look;
  const key = (part: string): string => `dog:${breed.id}:${part}`;
  const sphere = unitSphere(scope);

  const fur = scope.material(look.furColor, { roughness: 0.8 });
  const bellyMaterial = scope.material(look.bellyColor, { roughness: 0.8 });
  const muzzleMaterial = scope.material(look.muzzleColor, { roughness: 0.75 });
  const earMaterial = scope.material(look.earColor, { roughness: 0.8 });
  const envMap = options.environment;
  const noseMaterial = scope.material(NOSE_COLOR, { ...GLOSS.nose, envMap });

  const root = new THREE.Group();
  root.name = 'dog';
  const { hips, chest, torsoAxis, bellyNormal } = layout;
  const hipR = look.hipRadius;
  const torsoR = look.torsoRadius;

  // Bassin, torse, poitrail et cou.
  const hipsMesh = mesh(sphere, fur, 'dog-hips');
  hipsMesh.position.copy(hips);
  hipsMesh.scale.set(hipR, hipR * 0.92, hipR * 1.05);
  root.add(hipsMesh);

  const torso = mesh(capsule(scope, torsoR, look.torsoLength), fur, 'dog-torso');
  alignBetween(torso, hips, chest);
  root.add(torso);

  if (options.showBelly && look.bellyColor !== look.furColor) {
    const chestPatch = mesh(sphere, bellyMaterial, 'dog-chest');
    chestPatch.position
      .copy(chest)
      .addScaledVector(bellyNormal, torsoR * 0.42)
      .addScaledVector(torsoAxis, -torsoR * 0.35);
    chestPatch.quaternion.setFromUnitVectors(Y_AXIS, torsoAxis);
    chestPatch.scale.set(torsoR * 0.72, torsoR * 1.05, torsoR * 0.66);
    root.add(chestPatch);
  }

  const neckR = torsoR * 0.72;
  const neck = mesh(capsule(scope, neckR, chest.distanceTo(layout.head)), fur, 'dog-neck');
  alignBetween(neck, chest, layout.head);
  root.add(neck);

  // Tête.
  const head = new THREE.Group();
  head.name = 'dog-head';
  head.position.copy(layout.head);
  root.add(head);
  const headR = look.headRadius;
  const hs = look.headScale;
  const skull = mesh(sphere, fur, 'dog-skull');
  skull.scale.set(headR * hs.x, headR * hs.y, headR * hs.z);
  head.add(skull);

  // Museau (écrasé si sa longueur est nulle), truffe et langue.
  const muzzleR = look.muzzleRadius;
  const flatten = look.muzzleLength < 0.01 ? 0.62 : 1;
  const muzzleY = -headR * hs.y * 0.28;
  const muzzleCenterZ = headR * hs.z * 0.72 + look.muzzleLength / 2;
  const muzzleTipZ = muzzleCenterZ + (look.muzzleLength / 2 + muzzleR) * flatten;
  const muzzle = mesh(capsule(scope, muzzleR, look.muzzleLength), muzzleMaterial, 'dog-muzzle');
  muzzle.rotation.x = Math.PI / 2;
  muzzle.scale.set(1.15, flatten, 0.95);
  muzzle.position.set(0, muzzleY, muzzleCenterZ);
  head.add(muzzle);

  const nose = mesh(sphere, noseMaterial, 'dog-nose');
  nose.position.set(0, muzzleY + muzzleR * 0.45, muzzleTipZ - look.noseRadius * 0.45);
  nose.scale.set(look.noseRadius * 1.3, look.noseRadius * 0.95, look.noseRadius);
  head.add(nose);

  if (look.tongue) {
    const tongue = mesh(sphere, scope.material(TONGUE_COLOR, { roughness: 0.5 }), 'dog-tongue');
    tongue.position.set(0, muzzleY - muzzleR * 0.78, muzzleTipZ - muzzleR * 0.6);
    tongue.rotation.x = 0.35;
    tongue.scale.set(muzzleR * 0.5, muzzleR * 0.14, muzzleR * 0.6);
    head.add(tongue);
  }

  // Yeux : blanc, pupille et reflet, fusionnés par paires.
  const eyeR = look.eyeRadius;
  const eyeDir = new THREE.Vector3(
    Math.sin(look.eyeSpread) * Math.cos(look.eyeElevation),
    Math.sin(look.eyeElevation),
    Math.cos(look.eyeSpread) * Math.cos(look.eyeElevation),
  );
  const eyeFrame: PartTransform = {
    position: new THREE.Vector3(eyeDir.x * hs.x, eyeDir.y * hs.y, eyeDir.z * hs.z).multiplyScalar(
      headR * 0.9,
    ),
    quaternion: new THREE.Quaternion().setFromUnitVectors(
      Z_AXIS,
      eyeDir
        .clone()
        .add(new THREE.Vector3(0, 0, 0.6))
        .normalize(),
    ),
  };
  const eyePart = (
    name: string,
    radius: number,
    offset: THREE.Vector3,
    scale: THREE.Vector3,
  ): THREE.BufferGeometry =>
    scope.geometry(key(name), () => {
      const part = new THREE.SphereGeometry(1, 16, 12).applyMatrix4(
        new THREE.Matrix4().compose(offset, new THREE.Quaternion(), scale.multiplyScalar(radius)),
      );
      return mirroredPair(part, eyeFrame);
    });
  if (look.eyeMaskColor) {
    // Masque sombre autour des yeux.
    const mask = eyePart(
      'eye-mask',
      eyeR,
      new THREE.Vector3(0, 0, -0.6 * eyeR),
      new THREE.Vector3(1.4, 1.4, 1.4),
    );
    head.add(mesh(mask, scope.material(look.eyeMaskColor, { roughness: 0.75 }), 'dog-eye-mask'));
  }
  const whites = eyePart('eye-white', eyeR, new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
  const pupils = eyePart(
    'eye-pupil',
    eyeR,
    new THREE.Vector3(0, 0, 0.72 * eyeR),
    new THREE.Vector3(0.6, 0.66, 0.35),
  );
  const shines = eyePart(
    'eye-shine',
    eyeR,
    new THREE.Vector3(0.2 * eyeR, 0.28 * eyeR, 0.98 * eyeR),
    new THREE.Vector3(0.2, 0.2, 0.12),
  );
  head.add(
    mesh(whites, scope.material(EYE_WHITE_COLOR, { ...GLOSS.eyeWhite, envMap }), 'dog-eye-whites'),
    mesh(pupils, scope.material(PUPIL_COLOR, { ...GLOSS.pupil, envMap }), 'dog-pupils'),
    mesh(shines, scope.unlitMaterial(EYE_SHINE_COLOR), 'dog-eye-shines'),
  );

  // Taches : calottes sur les côtés de la tête (liseré blanc au milieu) et une tache sur le dos.
  if (look.patchColor) {
    const patchMaterial = scope.material(look.patchColor, { roughness: 0.8 });
    const headScale = new THREE.Vector3(headR * hs.x, headR * hs.y, headR * hs.z);
    const headPatches = scope.geometry(key('head-patches'), () =>
      mergeParts([
        [
          new THREE.SphereGeometry(1.015, 18, 12, Math.PI / 2 + 0.32, Math.PI - 0.5, 0.22, 1.75),
          { scale: headScale },
        ],
        [
          new THREE.SphereGeometry(1.015, 18, 12, -Math.PI / 2 + 0.18, Math.PI - 0.5, 0.22, 1.75),
          { scale: headScale },
        ],
      ]),
    );
    head.add(mesh(headPatches, patchMaterial, 'dog-head-patches'));
    const backPatch = scope.geometry(
      key('back-patch'),
      () => new THREE.SphereGeometry(1.02, 12, 8, Math.PI * 0.95, 0.9, 0.45, 0.95),
    );
    const spot = mesh(backPatch, patchMaterial, 'dog-back-patch');
    spot.position.copy(hipsMesh.position);
    spot.scale.copy(hipsMesh.scale);
    root.add(spot);
  }

  // Plis du front (carlin) : trois arcs de latitude sur le haut de la tête.
  if (look.wrinkles) {
    const arc = 1.1;
    const wrinkles = scope.geometry(key('wrinkles'), () =>
      mergeParts(
        [0.42, 0.6, 0.78].map((polar) => {
          const ring = headR * Math.sin(polar);
          const geometry = new THREE.TorusGeometry(ring, headR * 0.055, 6, 14, arc);
          const transform: PartTransform = {
            position: new THREE.Vector3(0, headR * hs.y * Math.cos(polar), 0),
            quaternion: new THREE.Quaternion().setFromEuler(
              new THREE.Euler(Math.PI / 2, -(Math.PI / 2 - arc / 2), 0, 'YXZ'),
            ),
            scale: new THREE.Vector3(hs.x, 1, hs.z),
          };
          return [geometry, transform] as const;
        }),
      ),
    );
    head.add(mesh(wrinkles, scope.material(WRINKLE_COLOR, { roughness: 0.8 }), 'dog-wrinkles'));
  }

  // Oreilles.
  const ears = buildEars(scope, look, head, earMaterial, key);

  // Pattes avant : de l'épaule au volant.
  const legR = look.legRadius;
  const shoulder = chest
    .clone()
    .add(new THREE.Vector3(torsoR * 0.62, -torsoR * 0.1, 0))
    .addScaledVector(bellyNormal, torsoR * 0.35);
  const grip = options.grips[0];
  const pawR = legR * 1.3;
  const frontLegs = scope.geometry(key('front-legs'), () => {
    const probe = new THREE.Object3D();
    alignBetween(probe, shoulder, grip);
    return mirroredPair(new THREE.CapsuleGeometry(legR, shoulder.distanceTo(grip), 4, 10), {
      position: probe.position,
      quaternion: probe.quaternion,
    });
  });
  root.add(mesh(frontLegs, fur, 'dog-front-legs'));
  const pawCenter = grip
    .clone()
    .addScaledVector(shoulder.clone().sub(grip).normalize(), legR * 0.3);
  const frontPaws = scope.geometry(key('front-paws'), () =>
    mirroredPair(new THREE.SphereGeometry(pawR, 12, 10), {
      position: pawCenter,
      scale: new THREE.Vector3(1, 0.85, 1.1),
    }),
  );
  root.add(mesh(frontPaws, bellyMaterial, 'dog-front-paws'));

  // Pattes arrière : cuisse, patte, pied (posé sur le siège si le chien est assis).
  const thigh = hips
    .clone()
    .add(new THREE.Vector3(hipR * 0.6, 0, 0))
    .addScaledVector(bellyNormal, hipR * 0.3);
  const footR = legR * 1.3;
  const foot = thigh
    .clone()
    .add(
      new THREE.Vector3(
        0,
        -Math.cos(look.hindLegAngle),
        Math.sin(look.hindLegAngle),
      ).multiplyScalar(look.hindLegLength),
    );
  if (look.hindLegAngle > 0) foot.y = SEAT.top + footR * 0.75;
  const thighs = scope.geometry(key('thighs'), () =>
    mirroredPair(new THREE.SphereGeometry(1, 14, 10), {
      position: thigh,
      scale: new THREE.Vector3(0.5, 0.62, 0.75).multiplyScalar(hipR),
    }),
  );
  const hindLegs = scope.geometry(key('hind-legs'), () => {
    const probe = new THREE.Object3D();
    alignBetween(probe, thigh, foot);
    return mirroredPair(new THREE.CapsuleGeometry(legR * 1.1, thigh.distanceTo(foot), 4, 10), {
      position: probe.position,
      quaternion: probe.quaternion,
    });
  });
  const feet = scope.geometry(key('feet'), () =>
    mirroredPair(new THREE.SphereGeometry(footR, 12, 10), {
      position: foot,
      scale: new THREE.Vector3(1, 0.75, 1.35),
    }),
  );
  root.add(
    mesh(thighs, fur, 'dog-thighs'),
    mesh(hindLegs, fur, 'dog-hind-legs'),
    mesh(feet, bellyMaterial, 'dog-feet'),
  );

  // Queue : à l'arrière du bassin, remue autour de son axe Z local.
  const tail = buildTail(scope, look, layout, fur, key);
  root.add(tail.mount);

  // Points d'attache des accessoires.
  const attachHead = new THREE.Group();
  attachHead.name = 'attach-head';
  attachHead.position.set(
    0,
    headR * hs.y * 0.8 * Math.cos(0.26),
    headR * hs.z * 0.8 * Math.sin(0.26),
  );
  attachHead.rotation.x = 0.26;
  head.add(attachHead);

  const neckAxis = layout.head.clone().sub(chest).normalize();
  const attachNeck = new THREE.Group();
  attachNeck.name = 'attach-neck';
  attachNeck.position.copy(layout.head).addScaledVector(neckAxis, -headR * hs.y * 0.78);
  attachNeck.quaternion.copy(basisQuaternion(neckAxis, Z_AXIS));
  root.add(attachNeck);

  const attachBody = new THREE.Group();
  attachBody.name = 'attach-body';
  attachBody.position.copy(hips).add(chest).multiplyScalar(0.5);
  attachBody.quaternion.copy(basisQuaternion(torsoAxis, bellyNormal));
  root.add(attachBody);

  const fit: SkinFit = {
    headRadius: (headR * (hs.x + hs.z)) / 2,
    neckRadius: Math.max(headR * Math.min(hs.x, hs.z) * 0.64, neckR) + 0.012,
    torsoRadius: torsoR,
    torsoLength: look.torsoLength,
    torsoPitch: look.torsoPitch,
  };

  return {
    root,
    head,
    ears,
    tail: tail.pivot,
    attach: { head: attachHead, neck: attachNeck, body: attachBody },
    fit,
  };
}

function buildEars(
  scope: ResourceScope,
  look: DogLook,
  head: THREE.Group,
  material: THREE.Material,
  key: (part: string) => string,
): EarRig[] {
  const pose = EAR_POSES[look.earStyle];
  const hs = look.headScale;
  const w = look.earWidth;
  const length = look.earLength;
  const ears: EarRig[] = [];
  const innerMaterial =
    look.innerEarColor !== look.earColor
      ? scope.material(look.innerEarColor, { roughness: 0.7 })
      : null;

  for (const side of [1, -1]) {
    const mount = new THREE.Group();
    mount.position.set(
      pose.base.x * side * look.headRadius * hs.x,
      pose.base.y * look.headRadius * hs.y,
      pose.base.z * look.headRadius * hs.z,
    );
    const mirror = (v: THREE.Vector3): THREE.Vector3 => new THREE.Vector3(v.x * side, v.y, v.z);
    mount.quaternion.copy(basisQuaternion(mirror(pose.direction), mirror(pose.face)));
    const pivot = new THREE.Group();
    pivot.name = 'dog-ear';
    mount.add(pivot);
    head.add(mount);

    if (look.earStyle === 'floppy') {
      // Longue oreille plate qui pend le long de la joue.
      const flap = mesh(unitSphere(scope), material, 'dog-ear-flap');
      flap.position.y = length * 0.45;
      flap.scale.set(w / 2, length / 2, 0.035);
      pivot.add(flap);
    } else if (look.earStyle === 'erect') {
      // Large feuille creusée au bout arrondi (géométries partagées par les deux oreilles).
      const specs = erectEarSpecs(look);
      const flap = scope.geometry(key('ear'), () => earLeafGeometry(specs.flap));
      pivot.add(mesh(flap, material, 'dog-ear-flap'));
      if (innerMaterial) {
        const inner = scope.geometry(key('ear-inner'), () => earLeafGeometry(specs.inner));
        pivot.add(mesh(inner, innerMaterial, 'dog-ear-inner'));
      }
    } else {
      // Triangle épais (cône aplati), base au pivot.
      const flap = mesh(unitCone(scope), material, 'dog-ear-flap');
      flap.position.y = length / 2;
      flap.scale.set(w, length, w * 0.3);
      pivot.add(flap);
      if (innerMaterial) {
        const inner = mesh(unitCone(scope), innerMaterial, 'dog-ear-inner');
        inner.position.set(0, length * 0.435, w * 0.11);
        inner.scale.set(w * 0.62, length * 0.75, w * 0.186);
        pivot.add(inner);
      }
    }
    ears.push({
      pivot,
      windX: pose.windX,
      windZ: pose.windZ * side,
      flapX: pose.flapX,
      flapZ: pose.flapZ * side,
      phase: side > 0 ? 0 : 1.9,
    });
  }
  return ears;
}

function buildTail(
  scope: ResourceScope,
  look: DogLook,
  layout: DogLayout,
  material: THREE.Material,
  key: (part: string) => string,
): { mount: THREE.Group; pivot: THREE.Group } {
  const s = Math.sin(look.torsoPitch);
  // Chien assis : la queue sort du dos ; chien allongé : de l'arrière du corps.
  const out = layout.torsoAxis
    .clone()
    .multiplyScalar(-(1 - s))
    .addScaledVector(layout.bellyNormal, -s)
    .normalize();
  const direction = TAIL_DIRECTIONS[look.tailStyle];
  const mount = new THREE.Group();
  mount.position.copy(layout.hips).addScaledVector(out, look.hipRadius * 0.88);
  // Axe X local = latéral, Y = direction de la queue.
  mount.quaternion.copy(
    basisQuaternion(direction, new THREE.Vector3(0, -direction.z, direction.y)),
  );
  const pivot = new THREE.Group();
  pivot.name = 'dog-tail';
  mount.add(pivot);

  const length = look.tailLength;
  const r = look.legRadius;
  let tailMesh: THREE.Mesh;
  switch (look.tailStyle) {
    case 'corkscrew': {
      const geometry = scope.geometry(
        key('tail'),
        () =>
          new THREE.TubeGeometry(new CorkscrewCurve(0.075, length, 1.4), 44, r * 0.55, 8, false),
      );
      tailMesh = mesh(geometry, material, 'dog-tail-mesh');
      break;
    }
    case 'short':
      tailMesh = mesh(
        capsule(scope, r * 0.85, Math.max(0.01, length - r * 1.7)),
        material,
        'dog-tail-mesh',
      );
      tailMesh.position.y = length / 2;
      break;
    case 'thin':
    case 'long': {
      // Tube courbe et effilé au bout arrondi, racine au pivot (géométrie partagée par la race).
      const tube = TAIL_TUBES[look.tailStyle];
      const baseRadius = r * tube.baseRadius;
      const geometry = scope.geometry(key('tail'), () =>
        tailTubeGeometry({
          length,
          baseRadius,
          tipRadius: baseRadius * tube.tipRadius,
          curl: tube.curl,
          sink: TAIL_TUBE_SINK,
        }),
      );
      tailMesh = mesh(geometry, material, 'dog-tail-mesh');
      break;
    }
  }
  pivot.add(tailMesh);
  return { mount, pivot };
}
