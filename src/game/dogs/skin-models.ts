/**
 * Accessoires three.js. Chaque accessoire est construit dans le repère de son point d'attache :
 * - tête : bord posé en y = 0, pour une tête de rayon 1 (mis à l'échelle ensuite) ;
 * - cou : anneau de rayon 1 autour de l'axe Y (le long du cou), +Z vers l'avant ;
 * - corps : axe Y le long du torse (vers le poitrail), +Z vers le ventre, -Z vers le dos.
 */
import * as THREE from 'three';
import { ParametricGeometry } from 'three/examples/jsm/geometries/ParametricGeometry.js';
import { clamp } from '../core/vec2';
import {
  dim,
  mergeParts,
  mesh,
  type PartTransform,
  paintFaces,
  type ResourceScope,
  unitSphere,
} from './model-resources';

/** Dimensions du chien utiles pour ajuster les accessoires. */
export interface SkinFit {
  headRadius: number;
  /** Rayon du collier (cou + bas de la tête). */
  neckRadius: number;
  torsoRadius: number;
  torsoLength: number;
  /** Inclinaison du torse au-dessus de l'horizontale (rad). */
  torsoPitch: number;
}

export interface SkinInstance {
  object: THREE.Object3D;
  /** Animation propre à l'accessoire (cape), `dt` en secondes ; `speedFactor` ≈ 0 à l'arrêt, 1 à pleine vitesse. */
  animate?(dt: number, speedFactor: number): void;
}

const COLORS = {
  capRed: '#e2342f',
  white: '#fbfbf7',
  gold: '#f4c13b',
  jewel: '#e0245e',
  beanie: '#f07f2a',
  cream: '#fff1d6',
  party: '#e8479b',
  partyDots: '#ffd23f',
  bandana: '#d9312b',
  bowtie: '#7c3fc4',
  collar: '#d8262e',
  sweaterA: '#2d6fdc',
  sweaterB: '#f7f3e8',
  cape: '#d92b2b',
} as const;

const Z_AXIS = new THREE.Vector3(0, 0, 1);

const quaternionX = (angle: number): THREE.Quaternion =>
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);

interface Spot {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  radius: number;
}

/** Petites pastilles aplaties posées sur une surface (points, pompons, bijoux). */
function dots(spots: readonly Spot[], flatness: number): THREE.BufferGeometry {
  return mergeParts(
    spots.map(({ position, normal, radius }) => {
      const transform: PartTransform = {
        position,
        quaternion: new THREE.Quaternion().setFromUnitVectors(Z_AXIS, normal.clone().normalize()),
        scale: new THREE.Vector3(radius, radius, radius * flatness),
      };
      return [new THREE.SphereGeometry(1, 10, 8), transform] as const;
    }),
  );
}

export function buildSkin(scope: ResourceScope, id: string, fit: SkinFit): SkinInstance | null {
  switch (id) {
    case 'cap':
      return scaled(buildCap(scope), fit.headRadius);
    case 'crown':
      return scaled(buildCrown(scope), fit.headRadius);
    case 'beanie':
      return scaled(buildBeanie(scope), fit.headRadius);
    case 'party-hat':
      return scaled(buildPartyHat(scope), fit.headRadius);
    case 'bandana':
      return scaled(buildBandana(scope), fit.neckRadius);
    case 'bowtie':
      return scaled(buildBowtie(scope), fit.neckRadius);
    case 'bell-collar':
      return scaled(buildBellCollar(scope), fit.neckRadius);
    case 'sweater':
      return { object: buildSweater(scope, fit) };
    case 'cape':
      return buildCape(scope, fit);
    default:
      return null;
  }
}

function scaled(object: THREE.Object3D, size: number): SkinInstance {
  object.scale.setScalar(size);
  return { object };
}

function group(name: string, ...children: THREE.Object3D[]): THREE.Group {
  const result = new THREE.Group();
  result.name = name;
  result.add(...children);
  return result;
}

// ---------------------------------------------------------------------------
// Tête
// ---------------------------------------------------------------------------

function buildCap(scope: ResourceScope): THREE.Group {
  const shell = scope.geometry('skin:cap', () =>
    mergeParts([
      [
        new THREE.SphereGeometry(0.64, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        { scale: new THREE.Vector3(1, 0.8, 1) },
      ],
      // Visière : demi-disque vers +Z, légèrement inclinée vers le bas.
      [
        new THREE.CylinderGeometry(0.5, 0.5, 0.05, 22, 1, false, -Math.PI / 2, Math.PI),
        {
          position: new THREE.Vector3(0, 0.03, 0.34),
          quaternion: quaternionX(0.14),
          scale: new THREE.Vector3(1, 1, 1.2),
        },
      ],
    ]),
  );
  const button = mesh(unitSphere(scope), scope.material(COLORS.white), 'skin-cap-button');
  button.position.y = 0.64 * 0.8;
  button.scale.setScalar(0.08);
  return group(
    'skin-cap',
    mesh(shell, scope.material(COLORS.capRed, { roughness: 0.6 }), 'skin-cap-shell'),
    button,
  );
}

function buildCrown(scope: ResourceScope): THREE.Group {
  const spikes = 5;
  const topRadius = 0.58;
  const height = 0.26;
  const spike = 0.2;
  const band = scope.geometry('skin:crown', () => {
    const geometry = new THREE.CylinderGeometry(topRadius, 0.5, height, spikes * 2, 1, true);
    // Les sommets pairs de l'anneau supérieur forment les pointes.
    const positions = geometry.getAttribute('position');
    for (let i = 0; i <= spikes * 2; i += 2) positions.setY(i, positions.getY(i) + spike);
    geometry.translate(0, height / 2 - 0.04, 0);
    geometry.computeVertexNormals();
    return geometry;
  });
  const jewels = scope.geometry('skin:crown-jewels', () => {
    const tipY = height - 0.04 + spike;
    const spots: Spot[] = [];
    for (let i = 0; i < spikes; i++) {
      const angle = (i / spikes) * Math.PI * 2;
      const position = new THREE.Vector3(
        topRadius * Math.sin(angle),
        tipY,
        topRadius * Math.cos(angle),
      );
      spots.push({ position, normal: new THREE.Vector3(0, 0, 1), radius: 0.065 });
    }
    spots.push({
      position: new THREE.Vector3(0, 0.1, 0.56),
      normal: new THREE.Vector3(0, 0, 1),
      radius: 0.09,
    });
    return dots(spots, 1);
  });
  return group(
    'skin-crown',
    mesh(
      band,
      scope.material(COLORS.gold, { roughness: 0.35, metalness: 0.25, doubleSided: true }),
      'skin-crown-band',
    ),
    mesh(jewels, scope.material(COLORS.jewel, { roughness: 0.2 }), 'skin-crown-jewels'),
  );
}

function buildBeanie(scope: ResourceScope): THREE.Group {
  const radius = 0.66;
  const stripes = 6;
  const orange = new THREE.Color(COLORS.beanie);
  const cream = new THREE.Color(COLORS.cream);
  const dome = scope.geometry('skin:beanie', () =>
    paintFaces(
      new THREE.SphereGeometry(radius, 24, stripes * 2, 0, Math.PI * 2, 0, Math.PI / 2),
      (center) => {
        const polar = Math.acos(clamp(center.y / center.length(), -1, 1));
        return Math.floor((polar / (Math.PI / 2)) * stripes) % 2 === 0 ? cream : orange;
      },
    ),
  );
  const trim = scope.geometry('skin:beanie-trim', () =>
    mergeParts([
      [
        new THREE.TorusGeometry(radius, 0.085, 8, 26),
        { position: new THREE.Vector3(0, 0.03, 0), quaternion: quaternionX(Math.PI / 2) },
      ],
      [
        new THREE.SphereGeometry(0.2, 9, 7),
        { position: new THREE.Vector3(0, radius * 1.1 + 0.12, 0) },
      ],
    ]),
  );
  const domeMesh = mesh(
    dome,
    scope.material('#ffffff', { roughness: 0.85, vertexColors: true }),
    'skin-beanie-dome',
  );
  domeMesh.scale.set(1, 1.1, 1);
  return group(
    'skin-beanie',
    domeMesh,
    mesh(
      trim,
      scope.material(COLORS.cream, { roughness: 0.9, flatShading: true }),
      'skin-beanie-trim',
    ),
  );
}

function buildPartyHat(scope: ResourceScope): THREE.Group {
  const radius = 0.4;
  const height = 1;
  const cone = scope.geometry('skin:party-hat', () =>
    new THREE.ConeGeometry(radius, height, 26).translate(0, height / 2, 0),
  );
  const decorations = scope.geometry('skin:party-hat-dots', () => {
    const spots: Spot[] = [];
    const rows = [
      { h: 0.14, count: 7 },
      { h: 0.38, count: 5 },
      { h: 0.6, count: 4 },
    ];
    for (const [rowIndex, row] of rows.entries()) {
      const ring = radius * (1 - row.h / height);
      for (let i = 0; i < row.count; i++) {
        const angle = ((i + rowIndex * 0.5) / row.count) * Math.PI * 2;
        const normal = new THREE.Vector3(Math.sin(angle), radius / height, Math.cos(angle));
        spots.push({
          position: new THREE.Vector3(ring * Math.sin(angle), row.h, ring * Math.cos(angle)),
          normal,
          radius: 0.06,
        });
      }
    }
    // Pompon au sommet.
    spots.push({
      position: new THREE.Vector3(0, height + 0.06, 0),
      normal: new THREE.Vector3(0, 1, 0),
      radius: 0.12,
    });
    return dots(spots, 0.45);
  });
  const hat = group(
    'skin-party-hat',
    mesh(cone, scope.material(COLORS.party, { roughness: 0.55 }), 'skin-party-hat-cone'),
    mesh(decorations, scope.material(COLORS.partyDots, { roughness: 0.5 }), 'skin-party-hat-dots'),
  );
  hat.rotation.z = -0.14;
  hat.position.y = 0.05;
  return group('skin-party-hat-mount', hat);
}

// ---------------------------------------------------------------------------
// Cou
// ---------------------------------------------------------------------------

/** Anneau de rayon 1 couché autour de l'axe Y. */
const ringPart = (tube: number): readonly [THREE.BufferGeometry, PartTransform] => [
  new THREE.TorusGeometry(1, tube, 8, 30),
  { quaternion: quaternionX(Math.PI / 2) },
];

function buildBandana(scope: ResourceScope): THREE.Group {
  const span = 1.25;
  // Triangle de tissu (u : largeur, v : du cou vers la pointe) qui s'écarte sur le poitrail.
  const surface = (u: number, v: number, target: THREE.Vector3): THREE.Vector3 => {
    const angle = (u - 0.5) * 2 * span * (1 - v);
    const radius = 1.06 + 0.35 * v;
    return target.set(radius * Math.sin(angle), -v * 1.35, radius * Math.cos(angle));
  };
  const cloth = scope.geometry('skin:bandana', () =>
    mergeParts([ringPart(0.09), [new ParametricGeometry(surface, 10, 8), {}]]),
  );
  const pattern = scope.geometry('skin:bandana-dots', () => {
    const spots = [
      [0.3, 0.15],
      [0.7, 0.15],
      [0.5, 0.35],
      [0.38, 0.55],
      [0.62, 0.55],
      [0.5, 0.76],
    ].map(([u, v]) => {
      const position = surface(u, v, new THREE.Vector3());
      const normal = new THREE.Vector3(position.x, 0.3, position.z);
      position.addScaledVector(normal.clone().normalize(), 0.02);
      return { position, normal, radius: 0.1 };
    });
    return dots(spots, 0.25);
  });
  return group(
    'skin-bandana',
    mesh(
      cloth,
      scope.material(COLORS.bandana, { roughness: 0.8, doubleSided: true }),
      'skin-bandana-cloth',
    ),
    mesh(pattern, scope.material(COLORS.white, { roughness: 0.8 }), 'skin-bandana-dots'),
  );
}

function buildBowtie(scope: ResourceScope): THREE.Group {
  const geometry = scope.geometry('skin:bowtie', () => {
    // Deux ailes coniques pointant vers le nœud central, aplaties en z.
    const wing = (side: number): PartTransform => ({
      position: new THREE.Vector3(0.26 * side, 0, 0),
      quaternion: new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(-side, 0, 0),
      ),
      scale: new THREE.Vector3(1, 1, 0.45),
    });
    return mergeParts([
      [new THREE.ConeGeometry(0.3, 0.5, 14), wing(1)],
      [new THREE.ConeGeometry(0.3, 0.5, 14), wing(-1)],
      [new THREE.SphereGeometry(0.13, 12, 10), { scale: new THREE.Vector3(1, 1.1, 0.8) }],
    ]);
  });
  const tie = mesh(geometry, scope.material(COLORS.bowtie, { roughness: 0.55 }), 'skin-bowtie');
  tie.position.set(0, -0.12, 1.08);
  return group('skin-bowtie', tie);
}

function buildBellCollar(scope: ResourceScope): THREE.Group {
  const collar = scope.geometry('skin:collar', () => mergeParts([ringPart(0.11)]));
  const bell = scope.geometry('skin:bell', () =>
    mergeParts([
      [new THREE.SphereGeometry(0.24, 16, 12), { position: new THREE.Vector3(0, -0.24, 1.14) }],
      [new THREE.TorusGeometry(0.07, 0.025, 6, 12), { position: new THREE.Vector3(0, -0.02, 1.1) }],
    ]),
  );
  return group(
    'skin-bell-collar',
    mesh(collar, scope.material(COLORS.collar, { roughness: 0.6 }), 'skin-collar'),
    mesh(bell, scope.material(COLORS.gold, { roughness: 0.35, metalness: 0.25 }), 'skin-bell'),
  );
}

// ---------------------------------------------------------------------------
// Corps
// ---------------------------------------------------------------------------

/** Pull rayé : capsule un peu plus large que le torse, rayures perpendiculaires à l'axe. */
function buildSweater(scope: ResourceScope, fit: SkinFit): THREE.Mesh {
  const radius = fit.torsoRadius * 1.12;
  const length = fit.torsoLength * 0.85;
  const stripes = Math.max(4, Math.round(length / 0.07));
  const colorA = new THREE.Color(COLORS.sweaterA);
  const colorB = new THREE.Color(COLORS.sweaterB);
  const geometry = scope.geometry(`skin:sweater:${dim(radius)}:${dim(length)}`, () =>
    paintFaces(new THREE.CapsuleGeometry(radius, length, 6, 18, stripes), (center) => {
      if (Math.abs(center.y) > length / 2) return colorA;
      return Math.floor(((center.y + length / 2) / length) * stripes) % 2 === 0 ? colorA : colorB;
    }),
  );
  return mesh(
    geometry,
    scope.material('#ffffff', { roughness: 0.85, vertexColors: true }),
    'skin-sweater',
  );
}

/** Longueur maximale de la cape (m) et angle de soulèvement à pleine vitesse (rad). */
const CAPE_MAX_LENGTH = 0.8;
const CAPE_MAX_LIFT = 0.9;
/** Pulsation de l'ondulation (rad/s) à l'arrêt, et en plus à pleine vitesse. */
const CAPE_RIPPLE_BASE = 5;
const CAPE_RIPPLE_PER_SPEED = 9;

/** Cape : nappe incurvée derrière le dos, animée sommet par sommet (géométrie propre au modèle). */
function buildCape(scope: ResourceScope, fit: SkinFit): SkinInstance {
  const columns = 8;
  const rows = 8;
  const halfAngle = 1.35;
  const radius = fit.torsoRadius * 1.16;
  const length = Math.min(fit.torsoLength + fit.torsoRadius * 1.5, CAPE_MAX_LENGTH);
  const top = fit.torsoLength / 2 + fit.torsoRadius * 0.3;
  // Chien assis : la cape se soulève vers l'arrière ; chien allongé : elle ondule sur le dos.
  const maxLift = CAPE_MAX_LIFT * Math.sin(fit.torsoPitch);

  const geometry = scope.own(new THREE.BufferGeometry());
  const positions = new Float32Array((columns + 1) * (rows + 1) * 3);
  const attribute = new THREE.BufferAttribute(positions, 3);
  geometry.setAttribute('position', attribute);
  const indices: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const a = r * (columns + 1) + c;
      const b = a + columns + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  geometry.setIndex(indices);

  const layout = (phase: number, speedFactor: number): void => {
    const lift = clamp(speedFactor, 0, 1.3) * maxLift;
    const ripple = 0.025 + 0.05 * clamp(speedFactor, 0, 1.3);
    let i = 0;
    for (let r = 0; r <= rows; r++) {
      const v = r / rows;
      const along = v * length;
      // La cape se soulève vers l'arrière autour de son bord supérieur.
      const angle = lift * Math.pow(v, 0.7);
      const flare = radius * (1 + 0.3 * v);
      for (let c = 0; c <= columns; c++) {
        const u = (c / columns) * 2 - 1;
        const phi = u * halfAngle;
        const wave = Math.sin(phase - v * 5 + u * 1.3) * ripple * v;
        positions[i++] = flare * Math.sin(phi);
        positions[i++] = top - along * Math.cos(angle);
        positions[i++] = -flare * Math.cos(phi) - along * Math.sin(angle) - wave;
      }
    }
    attribute.needsUpdate = true;
    geometry.computeVertexNormals();
  };
  layout(0, 0);

  const cape = mesh(
    geometry,
    scope.material(COLORS.cape, { roughness: 0.7, doubleSided: true }),
    'skin-cape',
  );
  // La géométrie bouge à chaque image : pas d'élimination par boîte englobante périmée.
  cape.frustumCulled = false;
  // Phase intégrée pas à pas (la fréquence dépend de la vitesse, voir racer-model.ts).
  let phase = 0;
  const animate = (dt: number, speedFactor: number): void => {
    phase = (phase + (CAPE_RIPPLE_BASE + CAPE_RIPPLE_PER_SPEED * speedFactor) * dt) % (Math.PI * 2);
    layout(phase, speedFactor);
  };
  return { object: group('skin-cape-mount', cape), animate };
}
