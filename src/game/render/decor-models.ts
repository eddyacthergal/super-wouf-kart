/**
 * Géométries du décor géant, construites par code et peintes par sommet.
 * Repère de chaque pièce : origine au sol (ou à la base), avant vers +Z.
 */
import * as THREE from 'three';
import { createRng } from '../core/rng';
import { PALETTE } from './palette';
import { type PaintedPart, paintedGeometry, transform } from './resources';

const GREEN_BACK = '#3f8f35';

/** Matrice d'une pièce tournée d'abord en tangage (X) puis en lacet (Y) : ordre YXZ. */
function yawPitch(
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
  sx: number,
  sy: number,
  sz: number,
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')),
    new THREE.Vector3(sx, sy, sz),
  );
}

/** Pétales disposés en couronne dans le plan XY (fleur tournée vers +Z). */
function petalRing(
  count: number,
  distance: number,
  size: readonly [number, number, number],
  color: string,
  z = 0,
  phase = 0,
): PaintedPart[] {
  const parts: PaintedPart[] = [];
  for (let k = 0; k < count; k++) {
    const angle = phase + (k / count) * Math.PI * 2;
    parts.push({
      geometry: new THREE.SphereGeometry(1, 10, 6),
      color,
      matrix: transform(
        -Math.sin(angle) * distance,
        Math.cos(angle) * distance,
        z,
        0,
        0,
        angle,
        size[0],
        size[1],
        size[2],
      ),
    });
  }
  return parts;
}

/** Tige : cylindre de rayon 1 et de hauteur 1, base à l'origine. */
export function stemGeometry(): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(0.8, 1, 1, 8, 1).translate(0, 0.5, 0);
}

/** Feuille : ellipsoïde fin allongé de l'origine vers +Z (longueur 2). */
export function leafGeometry(): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, 10, 6).scale(0.32, 0.05, 1).translate(0, 0, 1);
}

/** Marguerite (rayon 1) : cœur jaune, 14 pétales blancs. */
export function daisyHeadGeometry(): THREE.BufferGeometry {
  return paintedGeometry([
    {
      geometry: new THREE.SphereGeometry(0.3, 16, 10),
      color: '#ffd21f',
      matrix: transform(0, 0, 0.05, 0, 0, 0, 1, 1, 0.55),
    },
    {
      geometry: new THREE.SphereGeometry(0.3, 12, 8),
      color: GREEN_BACK,
      matrix: transform(0, 0, -0.08, 0, 0, 0, 1, 1, 0.4),
    },
    ...petalRing(14, 0.62, [0.14, 0.44, 0.05], '#fbfbf4'),
  ]);
}

/** Tournesol (rayon 1) : grand cœur brun, deux couronnes de pétales jaunes. */
export function sunflowerHeadGeometry(): THREE.BufferGeometry {
  return paintedGeometry([
    {
      geometry: new THREE.SphereGeometry(0.44, 20, 12),
      color: '#5b3417',
      matrix: transform(0, 0, 0.06, 0, 0, 0, 1, 1, 0.38),
    },
    {
      geometry: new THREE.SphereGeometry(0.46, 12, 8),
      color: GREEN_BACK,
      matrix: transform(0, 0, -0.06, 0, 0, 0, 1, 1, 0.3),
    },
    ...petalRing(18, 0.7, [0.15, 0.34, 0.05], '#ffc518'),
    ...petalRing(18, 0.64, [0.14, 0.32, 0.05], '#ffa90a', -0.04, Math.PI / 18),
  ]);
}

/** Corolle de tulipe (blanche, teintée par instance), base à l'origine, hauteur ~1,3. */
export function tulipCupGeometry(): THREE.BufferGeometry {
  const parts: PaintedPart[] = [];
  for (let k = 0; k < 6; k++) {
    const yaw = (k / 6) * Math.PI * 2;
    const inner = k % 2 === 1;
    const distance = inner ? 0.14 : 0.22;
    parts.push({
      geometry: new THREE.SphereGeometry(1, 12, 8),
      color: '#ffffff',
      matrix: yawPitch(
        Math.sin(yaw) * distance,
        0.62,
        Math.cos(yaw) * distance,
        yaw,
        inner ? 0.12 : 0.24,
        0.36,
        0.7,
        0.22,
      ),
    });
  }
  return paintedGeometry(parts);
}

/** Courbe de la couture d'une balle de tennis sur la sphère unité. */
function tennisSeam(radius: number): THREE.CatmullRomCurve3 {
  const a = 0.66;
  const b = 1 - a;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < 128; i++) {
    const t = (i / 128) * Math.PI * 2;
    points.push(
      new THREE.Vector3(
        a * Math.cos(t) + b * Math.cos(3 * t),
        a * Math.sin(t) - b * Math.sin(3 * t),
        2 * Math.sqrt(a * b) * Math.sin(2 * t),
      ).multiplyScalar(radius),
    );
  }
  return new THREE.CatmullRomCurve3(points, true);
}

/** Balle de tennis de rayon 1 (jaune-vert, couture blanche). */
export function tennisBallGeometry(): THREE.BufferGeometry {
  return paintedGeometry([
    { geometry: new THREE.SphereGeometry(1, 28, 18), color: '#cfe63a' },
    { geometry: new THREE.TubeGeometry(tennisSeam(1), 200, 0.04, 6, true), color: '#f8f8ef' },
  ]);
}

/** Niche à chien (7 × 7 m), porte vers +Z. */
export function doghouseGeometry(): THREE.BufferGeometry {
  const gable = new THREE.Shape();
  gable.moveTo(-3.5, 0);
  gable.lineTo(3.5, 0);
  gable.lineTo(0, 2.9);
  gable.closePath();
  const slope = Math.atan2(3.05, 3.8);
  const panel = Math.hypot(3.8, 3.05) + 0.4;
  return paintedGeometry([
    {
      geometry: new THREE.BoxGeometry(7.8, 0.3, 7.8),
      color: '#8b6a4f',
      matrix: transform(0, 0.15, 0),
    },
    { geometry: new THREE.BoxGeometry(7, 5, 7), color: '#d9483b', matrix: transform(0, 2.8, 0) },
    {
      geometry: new THREE.ExtrudeGeometry(gable, { depth: 7, bevelEnabled: false }),
      color: '#d9483b',
      matrix: transform(0, 5.3, -3.5),
    },
    ...[-1, 1].map((side) => ({
      geometry: new THREE.BoxGeometry(panel, 0.35, 8.2),
      color: '#3566c9',
      matrix: transform(side * 1.85, 6.85, 0, 0, 0, -side * slope),
    })),
    {
      geometry: new THREE.BoxGeometry(0.5, 0.5, 8.4),
      color: '#2a4f9e',
      matrix: transform(0, 8.35, 0),
    },
    {
      geometry: new THREE.BoxGeometry(2.8, 3, 0.1),
      color: '#2f1e14',
      matrix: transform(0, 1.8, 3.52),
    },
    {
      geometry: new THREE.CylinderGeometry(1.4, 1.4, 0.1, 24),
      color: '#2f1e14',
      matrix: transform(0, 3.3, 3.52, Math.PI / 2),
    },
    {
      geometry: new THREE.BoxGeometry(3.2, 0.8, 0.14),
      color: '#ffd23f',
      matrix: transform(0, 5.0, 3.56),
    },
    ...[-1, 1].map((side) => ({
      geometry: new THREE.BoxGeometry(0.35, 5, 0.35),
      color: '#fbfbf5',
      matrix: transform(side * 3.5, 2.8, 3.5),
    })),
  ]);
}

/** Arrosoir géant (vert), bec vers +Z. */
export function wateringCanGeometry(): THREE.BufferGeometry {
  const spoutTilt = Math.atan2(2.9, 3.1);
  return paintedGeometry([
    {
      geometry: new THREE.CylinderGeometry(2.2, 2.4, 4.2, 28),
      color: '#2fa866',
      matrix: transform(0, 2.1, 0),
    },
    {
      geometry: new THREE.TorusGeometry(2.2, 0.16, 8, 32),
      color: '#27915a',
      matrix: transform(0, 4.2, 0, Math.PI / 2),
    },
    {
      geometry: new THREE.CylinderGeometry(2.05, 2.05, 0.1, 28),
      color: '#1d6e43',
      matrix: transform(0, 4.05, 0),
    },
    {
      geometry: new THREE.TorusGeometry(1.5, 0.28, 10, 24, Math.PI),
      color: '#27915a',
      matrix: transform(0, 4.2, -0.6, 0, Math.PI / 2, 0),
    },
    {
      geometry: new THREE.CylinderGeometry(0.28, 0.45, 4.3, 14),
      color: '#2fa866',
      matrix: transform(0, 3.05, 3.55, spoutTilt),
    },
    {
      geometry: new THREE.CylinderGeometry(0.85, 0.35, 0.6, 18),
      color: '#e2b53a',
      matrix: transform(0, 4.75, 5.25, spoutTilt),
    },
  ]);
}

/** Gamelle géante remplie de croquettes. */
export function kibbleBowlGeometry(): THREE.BufferGeometry {
  const profile = [
    new THREE.Vector2(0.01, 0.1),
    new THREE.Vector2(3.0, 0.0),
    new THREE.Vector2(3.4, 0.2),
    new THREE.Vector2(4.0, 1.7),
    new THREE.Vector2(4.1, 1.95),
    new THREE.Vector2(3.8, 1.95),
    new THREE.Vector2(3.35, 0.7),
    new THREE.Vector2(0.01, 0.6),
  ];
  const parts: PaintedPart[] = [
    { geometry: new THREE.LatheGeometry(profile, 40), color: '#e2403a' },
    {
      geometry: new THREE.TorusGeometry(3.7, 0.12, 8, 40),
      color: '#ffffff',
      matrix: transform(0, 1.35, 0, Math.PI / 2, 0, 0, 1.05, 1.05, 1),
    },
  ];
  const rng = createRng(0xb0e1);
  const kibbles = ['#8b5a2b', '#a86b35', '#74461f', '#b97a3e'];
  for (let i = 0; i < 70; i++) {
    const r = Math.sqrt(rng.next()) * 3.2;
    const a = rng.range(0, Math.PI * 2);
    const height = 0.85 + 1.1 * (1 - (r * r) / 11) + rng.range(-0.1, 0.1);
    const size = rng.range(0.3, 0.45);
    parts.push({
      geometry: new THREE.DodecahedronGeometry(size, 0),
      color: rng.pick(kibbles),
      matrix: transform(
        Math.cos(a) * r,
        height,
        Math.sin(a) * r,
        rng.range(0, 3),
        rng.range(0, 3),
        rng.range(0, 3),
        1,
        0.7,
        1,
      ),
    });
  }
  return paintedGeometry(parts);
}

/** Os géant couché sur la pelouse (le long de X). */
export function giantBoneGeometry(): THREE.BufferGeometry {
  const parts: PaintedPart[] = [
    {
      geometry: new THREE.CylinderGeometry(0.9, 0.9, 8, 20),
      color: PALETTE.bone,
      matrix: transform(0, 1.15, 0, 0, 0, Math.PI / 2),
    },
  ];
  for (const x of [-4.2, 4.2]) {
    for (const z of [-0.85, 0.85]) {
      parts.push({
        geometry: new THREE.SphereGeometry(1.35, 20, 14),
        color: PALETTE.bone,
        matrix: transform(x, 1.3, z),
      });
    }
  }
  return paintedGeometry(parts);
}

/** Nain de jardin (~6,5 m), tourné vers +Z. */
export function gnomeGeometry(): THREE.BufferGeometry {
  const skin = '#f3c7a0';
  return paintedGeometry([
    ...[-1, 1].map((side) => ({
      geometry: new THREE.SphereGeometry(1, 14, 10),
      color: '#3a2a22',
      matrix: transform(side * 0.6, 0.35, 0.3, 0, 0, 0, 0.55, 0.4, 0.85),
    })),
    {
      geometry: new THREE.CylinderGeometry(1.05, 1.5, 2.6, 20),
      color: '#2f6fd6',
      matrix: transform(0, 1.7, 0),
    },
    {
      geometry: new THREE.CylinderGeometry(1.24, 1.3, 0.35, 20),
      color: '#5a3a1e',
      matrix: transform(0, 2.3, 0),
    },
    {
      geometry: new THREE.BoxGeometry(0.6, 0.45, 0.2),
      color: '#ffd23f',
      matrix: transform(0, 2.3, 1.25),
    },
    ...[-1, 1].map((side) => ({
      geometry: new THREE.SphereGeometry(0.42, 12, 8),
      color: skin,
      matrix: transform(side * 1.3, 2.0, 0.55),
    })),
    ...[-1, 1].map((side) => ({
      geometry: new THREE.CylinderGeometry(0.34, 0.4, 1.4, 12),
      color: '#2f6fd6',
      matrix: transform(side * 1.2, 2.5, 0.25, 0.6, 0, side * 0.35),
    })),
    { geometry: new THREE.SphereGeometry(1, 20, 14), color: skin, matrix: transform(0, 3.75, 0) },
    {
      geometry: new THREE.SphereGeometry(0.32, 12, 8),
      color: '#f08b7e',
      matrix: transform(0, 3.72, 0.98),
    },
    ...[-1, 1].map((side) => ({
      geometry: new THREE.SphereGeometry(0.12, 8, 6),
      color: '#1d1d24',
      matrix: transform(side * 0.36, 4.0, 0.88),
    })),
    {
      geometry: new THREE.ConeGeometry(1.05, 2.1, 18),
      color: '#fbfbf5',
      matrix: transform(0, 2.95, 0.5, Math.PI + 0.25),
    },
    {
      geometry: new THREE.ConeGeometry(1.15, 3.2, 20),
      color: '#e23b3b',
      matrix: transform(0, 5.85, -0.15, -0.18),
    },
  ]);
}

/** Pied de l'arroseur (partie fixe). */
export function sprinklerBaseGeometry(): THREE.BufferGeometry {
  return paintedGeometry([
    {
      geometry: new THREE.CylinderGeometry(1.3, 1.5, 0.3, 20),
      color: '#6f7480',
      matrix: transform(0, 0.15, 0),
    },
    {
      geometry: new THREE.CylinderGeometry(0.22, 0.28, 1.6, 12),
      color: '#9aa0aa',
      matrix: transform(0, 1.05, 0),
    },
  ]);
}

/** Tête tournante de l'arroseur : bras jaune et buses. */
export function sprinklerArmGeometry(): THREE.BufferGeometry {
  return paintedGeometry([
    { geometry: new THREE.SphereGeometry(0.4, 14, 10), color: '#ffcf33' },
    { geometry: new THREE.BoxGeometry(3.4, 0.22, 0.22), color: '#ffcf33' },
    ...[-1, 1].map((side) => ({
      geometry: new THREE.CylinderGeometry(0.16, 0.2, 0.5, 10),
      color: '#e2403a',
      matrix: transform(side * 1.7, 0.2, 0),
    })),
  ]);
}

/** Jet d'eau : arc de parabole depuis une buse (x = ±1,7) jusqu'au sol. */
export function waterJetGeometry(side: number): THREE.BufferGeometry {
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(side * 1.7, 0.45, 0),
    new THREE.Vector3(side * 4.2, 3.6, side * 0.8),
    new THREE.Vector3(side * 7.2, -1.7, side * 1.6),
  );
  return new THREE.TubeGeometry(curve, 24, 0.14, 6, false);
}

/** Tronc effilé de hauteur 1, base à l'origine. */
export function trunkGeometry(): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(0.6, 1, 1, 10, 1).translate(0, 0.5, 0);
}

/** Boule de feuillage (arbres, buissons, nuages). */
export function blobGeometry(): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(1, 2);
}

/** Pierre plate irrégulière de rayon ~1. */
export function stoneGeometry(): THREE.BufferGeometry {
  return new THREE.DodecahedronGeometry(1, 0).scale(1, 0.16, 1);
}

/** Planche de clôture à bout pointu (0,5 × 3,2 m), base à l'origine. */
export function picketGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.25, 0);
  shape.lineTo(0.25, 0);
  shape.lineTo(0.25, 2.9);
  shape.lineTo(0, 3.25);
  shape.lineTo(-0.25, 2.9);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false }).translate(
    0,
    0,
    -0.06,
  );
}
