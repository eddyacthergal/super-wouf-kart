/**
 * Géométries de la plage, construites par code et peintes par sommet (même principe que le jardin).
 * Repère de chaque pièce : origine au sol, avant vers +Z. Tailles « géantes » : les pilotes sont
 * de petits chiens.
 */
import * as THREE from 'three';
import { type PaintedPart, paintedGeometry, transform } from './resources';

const SAND = '#e8cf9a';
const SAND_DARK = '#d4b57c';
const WOOD = '#9a6b43';
const WHITE = '#fbfbf5';

/** Tronc de palmier de hauteur 1 : anneaux légèrement décalés, courbé vers +Z en montant. */
export function palmTrunkGeometry(): THREE.BufferGeometry {
  const parts: PaintedPart[] = [];
  const rings = 9;
  for (let k = 0; k < rings; k++) {
    const t = k / rings;
    const bend = t * t * 0.18;
    const radius = 0.05 - t * 0.018;
    parts.push({
      geometry: new THREE.CylinderGeometry(radius * 0.92, radius, 1 / rings + 0.01, 10),
      color: k % 2 === 0 ? '#8a6443' : '#9c7550',
      matrix: transform(0, (k + 0.5) / rings, bend, -t * 0.35),
    });
  }
  return paintedGeometry(parts);
}

/** Couronne de palmes (rayon ~1, sommet à l'origine) avec trois noix de coco. */
export function palmCrownGeometry(): THREE.BufferGeometry {
  const parts: PaintedPart[] = [];
  const fronds = 8;
  for (let k = 0; k < fronds; k++) {
    const angle = (k / fronds) * Math.PI * 2;
    const droop = 0.55 + (k % 2) * 0.2;
    // Palme : deux segments aplatis qui retombent.
    for (let segment = 0; segment < 2; segment++) {
      const reach = 0.28 + segment * 0.5;
      const drop = segment === 0 ? 0.02 : -0.2;
      parts.push({
        geometry: new THREE.SphereGeometry(1, 10, 6),
        color: segment === 0 ? '#3f9d3a' : '#4fb046',
        matrix: new THREE.Matrix4().compose(
          new THREE.Vector3(Math.sin(angle) * reach, drop, Math.cos(angle) * reach),
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(droop * (segment + 0.6), angle, 0, 'YXZ'),
          ),
          new THREE.Vector3(0.16, 0.03, 0.34),
        ),
      });
    }
  }
  for (let k = 0; k < 3; k++) {
    const angle = (k / 3) * Math.PI * 2 + 0.4;
    parts.push({
      geometry: new THREE.SphereGeometry(0.09, 10, 8),
      color: '#6b4a2b',
      matrix: transform(Math.sin(angle) * 0.1, -0.1, Math.cos(angle) * 0.1),
    });
  }
  return paintedGeometry(parts);
}

/** Parasol ouvert (≈ 7 m) à bandes, planté dans le sable, avec une serviette dessous. */
export function parasolGeometry(stripe: string): THREE.BufferGeometry {
  const parts: PaintedPart[] = [
    {
      geometry: new THREE.CylinderGeometry(0.12, 0.12, 6.4, 8),
      color: WHITE,
      matrix: transform(0, 3.2, 0, 0.08),
    },
    {
      geometry: new THREE.BoxGeometry(3.2, 0.06, 5.4),
      color: stripe,
      matrix: transform(1.6, 0.04, 1.2, 0, 0.3),
    },
    {
      geometry: new THREE.BoxGeometry(3.2, 0.07, 1.2),
      color: WHITE,
      matrix: transform(1.6, 0.05, 1.2, 0, 0.3),
    },
  ];
  const sectors = 10;
  for (let k = 0; k < sectors; k++) {
    parts.push({
      geometry: new THREE.ConeGeometry(
        4.2,
        1.5,
        3,
        1,
        true,
        (k / sectors) * Math.PI * 2,
        (Math.PI * 2) / sectors,
      ),
      color: k % 2 === 0 ? stripe : WHITE,
      matrix: transform(0, 6.4, 0.5, 0.08),
    });
  }
  return paintedGeometry(parts);
}

/** Ballon de plage géant (rayon 1) à six quartiers. */
export function beachBallGeometry(): THREE.BufferGeometry {
  const colors = ['#e63946', WHITE, '#2f7fd7', '#ffd23f', WHITE, '#2fa866'];
  const parts: PaintedPart[] = colors.map((color, k) => ({
    geometry: new THREE.SphereGeometry(1, 16, 12, (k / 6) * Math.PI * 2, Math.PI / 3),
    color,
  }));
  parts.push({
    geometry: new THREE.SphereGeometry(0.2, 10, 8),
    color: WHITE,
    matrix: transform(0, 0.93, 0),
  });
  return paintedGeometry(parts);
}

/** Château de sable géant (≈ 12 m de large) : donjon, quatre tours, remparts et drapeau. */
export function sandcastleGeometry(): THREE.BufferGeometry {
  const parts: PaintedPart[] = [
    {
      geometry: new THREE.CylinderGeometry(6.4, 7, 1.2, 32),
      color: SAND_DARK,
      matrix: transform(0, 0.6, 0),
    },
    { geometry: new THREE.BoxGeometry(8, 3.4, 8), color: SAND, matrix: transform(0, 2.9, 0) },
    {
      geometry: new THREE.CylinderGeometry(2.2, 2.6, 5, 20),
      color: SAND,
      matrix: transform(0, 6, 0),
    },
    {
      geometry: new THREE.ConeGeometry(2.6, 2.6, 20),
      color: SAND_DARK,
      matrix: transform(0, 9.8, 0),
    },
    {
      geometry: new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6),
      color: WOOD,
      matrix: transform(0, 12.2, 0),
    },
    {
      geometry: new THREE.BoxGeometry(1.4, 0.8, 0.05),
      color: '#e63946',
      matrix: transform(0.7, 12.9, 0),
    },
    // Porte.
    {
      geometry: new THREE.BoxGeometry(1.8, 2.2, 0.2),
      color: '#b8955f',
      matrix: transform(0, 2.3, 4.02),
    },
  ];
  for (const [x, z] of [
    [-4, -4],
    [4, -4],
    [-4, 4],
    [4, 4],
  ]) {
    parts.push(
      {
        geometry: new THREE.CylinderGeometry(1.4, 1.6, 5.4, 16),
        color: SAND,
        matrix: transform(x, 2.7, z),
      },
      {
        geometry: new THREE.ConeGeometry(1.7, 2, 16),
        color: SAND_DARK,
        matrix: transform(x, 6.4, z),
      },
    );
  }
  // Créneaux sur les remparts.
  for (let k = 0; k < 4; k++) {
    for (const side of [-1, 1]) {
      parts.push({
        geometry: new THREE.BoxGeometry(0.8, 0.8, 0.8),
        color: SAND,
        matrix: transform(-2.4 + k * 1.6, 5, side * 3.8),
      });
    }
  }
  return paintedGeometry(parts);
}

/** Poste de maître-nageur sur pilotis (≈ 9 m), cabine blanche à toit rouge, drapeau. */
export function lifeguardTowerGeometry(): THREE.BufferGeometry {
  const parts: PaintedPart[] = [];
  for (const [x, z] of [
    [-1.8, -1.8],
    [1.8, -1.8],
    [-1.8, 1.8],
    [1.8, 1.8],
  ]) {
    parts.push({
      geometry: new THREE.BoxGeometry(0.3, 5, 0.3),
      color: WHITE,
      matrix: transform(x, 2.5, z),
    });
  }
  parts.push(
    { geometry: new THREE.BoxGeometry(4.6, 0.3, 4.6), color: WOOD, matrix: transform(0, 5.1, 0) },
    { geometry: new THREE.BoxGeometry(4, 2.6, 4), color: WHITE, matrix: transform(0, 6.5, -0.2) },
    {
      geometry: new THREE.BoxGeometry(3, 1.2, 0.1),
      color: '#8fd3ff',
      matrix: transform(0, 6.9, 1.82),
    },
    {
      geometry: new THREE.BoxGeometry(2.4, 0.5, 0.12),
      color: '#e63946',
      matrix: transform(0, 5.8, 1.84),
    },
    {
      geometry: new THREE.ConeGeometry(3.6, 1.8, 4),
      color: '#e63946',
      matrix: transform(0, 8.7, -0.2, 0, Math.PI / 4),
    },
    {
      geometry: new THREE.CylinderGeometry(0.07, 0.07, 3, 6),
      color: WHITE,
      matrix: transform(1.9, 10.4, -0.2),
    },
    {
      geometry: new THREE.BoxGeometry(1.4, 0.9, 0.05),
      color: '#ffd23f',
      matrix: transform(2.6, 11.4, -0.2),
    },
  );
  // Échelle vers l'avant.
  for (let k = 0; k < 6; k++) {
    parts.push({
      geometry: new THREE.BoxGeometry(1.4, 0.12, 0.2),
      color: WOOD,
      matrix: transform(0, 0.6 + k * 0.8, 2.6 + k * 0.28),
    });
  }
  for (const side of [-1, 1]) {
    parts.push({
      geometry: new THREE.BoxGeometry(0.14, 5.4, 0.14),
      color: WOOD,
      matrix: transform(side * 0.7, 2.7, 3.3, -0.33),
    });
  }
  return paintedGeometry(parts);
}

/** Rangée de trois cabines de plage à rayures (≈ 12 m de large), portes vers +Z. */
export function beachHutsGeometry(): THREE.BufferGeometry {
  const stripes = ['#2f7fd7', '#e63946', '#2fa866'];
  const parts: PaintedPart[] = [];
  stripes.forEach((stripe, k) => {
    const x = (k - 1) * 4.2;
    for (let band = 0; band < 6; band++) {
      parts.push({
        geometry: new THREE.BoxGeometry(0.62, 4.4, 3.6),
        color: band % 2 === 0 ? stripe : WHITE,
        matrix: transform(x - 1.55 + band * 0.62, 2.2, 0),
      });
    }
    const roof = new THREE.Shape();
    roof.moveTo(-2, 0);
    roof.lineTo(2, 0);
    roof.lineTo(0, 1.5);
    roof.closePath();
    parts.push(
      {
        geometry: new THREE.ExtrudeGeometry(roof, { depth: 4, bevelEnabled: false }),
        color: stripe,
        matrix: transform(x, 4.4, -2),
      },
      {
        geometry: new THREE.BoxGeometry(1.4, 2.8, 0.1),
        color: WHITE,
        matrix: transform(x, 1.6, 1.83),
      },
    );
  });
  parts.push({
    geometry: new THREE.BoxGeometry(13.6, 0.3, 5),
    color: WOOD,
    matrix: transform(0, 0.15, 0.4),
  });
  return paintedGeometry(parts);
}

/** Crabe (≈ 2 m) : carapace, yeux pédonculés et pattes ; les pinces sont animées à part. */
export function crabBodyGeometry(): THREE.BufferGeometry {
  const shell = '#e2553a';
  const parts: PaintedPart[] = [
    {
      geometry: new THREE.SphereGeometry(1, 20, 12),
      color: shell,
      matrix: transform(0, 0.55, 0, 0, 0, 0, 1, 0.45, 0.75),
    },
  ];
  for (const side of [-1, 1]) {
    parts.push(
      {
        geometry: new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6),
        color: shell,
        matrix: transform(side * 0.3, 1.05, 0.45),
      },
      {
        geometry: new THREE.SphereGeometry(0.13, 10, 8),
        color: WHITE,
        matrix: transform(side * 0.3, 1.33, 0.48),
      },
      {
        geometry: new THREE.SphereGeometry(0.07, 8, 6),
        color: '#1b1b1b',
        matrix: transform(side * 0.3, 1.36, 0.58),
      },
    );
    for (let leg = 0; leg < 3; leg++) {
      parts.push({
        geometry: new THREE.CylinderGeometry(0.06, 0.05, 1, 6),
        color: '#c9442c',
        matrix: transform(side * 1.1, 0.32, -0.35 + leg * 0.35, 0, 0, side * 1.0),
      });
    }
  }
  return paintedGeometry(parts);
}

/** Pince de crabe (origine à l'articulation, ouverte vers +Z). */
export function crabClawGeometry(): THREE.BufferGeometry {
  return paintedGeometry([
    {
      geometry: new THREE.CylinderGeometry(0.08, 0.1, 0.6, 6),
      color: '#c9442c',
      matrix: transform(0, 0, 0.3, Math.PI / 2),
    },
    {
      geometry: new THREE.SphereGeometry(0.28, 12, 8),
      color: '#e2553a',
      matrix: transform(0, 0.05, 0.75, 0, 0, 0, 1, 0.8, 1.2),
    },
    {
      geometry: new THREE.ConeGeometry(0.1, 0.45, 6),
      color: '#e2553a',
      matrix: transform(0.08, 0.1, 1.15, Math.PI / 2),
    },
  ]);
}

/** Mouette : corps, tête et bec ; les ailes sont animées à part. Avant vers +Z. */
export function gullBodyGeometry(): THREE.BufferGeometry {
  return paintedGeometry([
    {
      geometry: new THREE.SphereGeometry(1, 14, 10),
      color: WHITE,
      matrix: transform(0, 0, 0, 0, 0, 0, 0.32, 0.3, 0.9),
    },
    {
      geometry: new THREE.SphereGeometry(0.24, 12, 8),
      color: WHITE,
      matrix: transform(0, 0.16, 0.8),
    },
    {
      geometry: new THREE.ConeGeometry(0.07, 0.34, 6),
      color: '#f2a92e',
      matrix: transform(0, 0.12, 1.12, Math.PI / 2),
    },
    {
      geometry: new THREE.ConeGeometry(0.2, 0.5, 4),
      color: '#9aa4ad',
      matrix: transform(0, 0.02, -0.95, -Math.PI / 2, 0, 0, 1, 1, 0.4),
    },
  ]);
}

/** Aile de mouette (origine à l'épaule, déployée vers +X), bout gris foncé. */
export function gullWingGeometry(): THREE.BufferGeometry {
  return paintedGeometry([
    {
      geometry: new THREE.BoxGeometry(1.1, 0.05, 0.5),
      color: '#dfe5ea',
      matrix: transform(0.55, 0, 0),
    },
    {
      geometry: new THREE.BoxGeometry(0.7, 0.04, 0.36),
      color: '#5c646c',
      matrix: transform(1.4, 0, -0.04),
    },
  ]);
}

/** Dauphin (≈ 4 m) : corps effilé, rostre, nageoires. Avant vers +Z. */
export function dolphinGeometry(): THREE.BufferGeometry {
  const back = '#5f7f9e';
  const belly = '#cfdbe6';
  return paintedGeometry([
    {
      geometry: new THREE.SphereGeometry(1, 20, 12),
      color: back,
      matrix: transform(0, 0, 0, 0, 0, 0, 0.55, 0.6, 2),
    },
    {
      geometry: new THREE.SphereGeometry(1, 16, 10),
      color: belly,
      matrix: transform(0, -0.18, 0.2, 0, 0, 0, 0.45, 0.4, 1.6),
    },
    {
      geometry: new THREE.ConeGeometry(0.16, 0.7, 10),
      color: back,
      matrix: transform(0, -0.1, 2.2, Math.PI / 2),
    },
    {
      geometry: new THREE.ConeGeometry(0.35, 0.9, 4),
      color: back,
      matrix: transform(0, 0.75, -0.1, -0.5, 0, 0, 0.3, 1, 1),
    },
    {
      geometry: new THREE.BoxGeometry(1.8, 0.08, 0.5),
      color: back,
      matrix: transform(0, 0, -2.05),
    },
    ...[-1, 1].map((side) => ({
      geometry: new THREE.BoxGeometry(0.7, 0.06, 0.35),
      color: back,
      matrix: transform(side * 0.6, -0.3, 0.6, 0, 0, side * -0.5),
    })),
  ]);
}
