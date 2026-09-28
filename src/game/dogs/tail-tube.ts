/**
 * Queue en tube courbe et effilé : axe en arc de cercle, rayon décroissant de la racine au bout,
 * bout arrondi en demi-sphère. Repère de la queue : racine au pivot (origine), départ vers +Y,
 * enroulement vers +Z ; la racine s'enfonce un peu sous le pivot, dans le bassin.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface TailTubeSpec {
  /** Longueur de l'axe, du pivot au bout (m). */
  length: number;
  /** Rayon à la racine (m). */
  baseRadius: number;
  /** Rayon du bout arrondi (m). */
  tipRadius: number;
  /** Enroulement : angle entre la direction de départ et celle du bout (rad), vers +Z. */
  curl: number;
  /** Racine prolongée tout droit sous le pivot (m) : aucun jour quand la queue remue. */
  sink: number;
}

/**
 * Anneaux du tube : réguliers le long du corps, puis resserrés en quart de cercle sur le bout pour
 * l'arrondir ; côtés de chaque anneau. Assez pour un arc et un bout lisses, sans alourdir.
 */
const BODY_SEGMENTS = 20;
const TIP_SEGMENTS = 5;
const RADIAL_SEGMENTS = 12;
const SEGMENTS = BODY_SEGMENTS + TIP_SEGMENTS;
/** Part du paramètre t consacrée au corps ; le reste arrondit le bout. */
const BODY_SHARE = BODY_SEGMENTS / SEGMENTS;

/** Position le long de l'axe et rayon du tube. */
interface Station {
  /** Abscisse le long de l'axe depuis le pivot (m), négative dans le bassin. */
  s: number;
  radius: number;
}

/**
 * Axe de la queue. Son paramètre t place directement les anneaux de TubeGeometry, qui échantillonne
 * `getPointAt` : pas de reparamétrage par la longueur, pour garder les anneaux serrés du bout.
 */
class TailCurve extends THREE.Curve<THREE.Vector3> {
  constructor(private readonly spec: TailTubeSpec) {
    super();
  }

  station(t: number): Station {
    const { length, baseRadius, tipRadius, sink } = this.spec;
    const bodyEnd = length - tipRadius;
    if (t <= BODY_SHARE) {
      // Corps : de la racine enfoncée jusqu'au début du bout, rayon décroissant régulièrement.
      const f = t / BODY_SHARE;
      return {
        s: -sink + f * (bodyEnd + sink),
        radius: THREE.MathUtils.lerp(baseRadius, tipRadius, f),
      };
    }
    // Bout : demi-sphère parcourue en quart de cercle, du corps (0) jusqu'à la pointe (π/2).
    const angle = ((t - BODY_SHARE) / (1 - BODY_SHARE)) * (Math.PI / 2);
    return { s: bodyEnd + tipRadius * Math.sin(angle), radius: tipRadius * Math.cos(angle) };
  }

  /** Angle de la direction de l'axe à l'abscisse s (tout droit dans le bassin). */
  private angleAt(s: number): number {
    return (this.spec.curl * Math.max(s, 0)) / this.spec.length;
  }

  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const { s } = this.station(t);
    const { curl, length } = this.spec;
    if (s <= 0 || curl === 0) return target.set(0, s, 0);
    // Arc de cercle de rayon length / curl, tangent à +Y au pivot.
    const bendRadius = length / curl;
    const angle = this.angleAt(s);
    return target.set(0, bendRadius * Math.sin(angle), bendRadius * (1 - Math.cos(angle)));
  }

  override getTangent(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const angle = this.angleAt(this.station(t).s);
    return target.set(0, Math.cos(angle), Math.sin(angle));
  }

  override getUtoTmapping(u: number): number {
    return u;
  }
}

/**
 * Géométrie indexée et soudée (une normale par position : ombrage lisse), fermée au bout,
 * ouverte seulement à la racine (cachée dans le bassin), déterministe.
 */
export function tailTubeGeometry(spec: TailTubeSpec): THREE.BufferGeometry {
  const curve = new TailCurve(spec);
  // Tube de rayon 1 : chaque sommet est le centre de son anneau plus la normale (unitaire).
  const tube = new THREE.TubeGeometry(curve, SEGMENTS, 1, RADIAL_SEGMENTS, false);
  const positions = tube.getAttribute('position');
  const normals = tube.getAttribute('normal');
  const center = new THREE.Vector3();
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    const { radius } = curve.station(t);
    curve.getPoint(t, center);
    for (let j = 0; j <= RADIAL_SEGMENTS; j++) {
      const k = i * (RADIAL_SEGMENTS + 1) + j;
      positions.setXYZ(
        k,
        center.x + radius * normals.getX(k),
        center.y + radius * normals.getY(k),
        center.z + radius * normals.getZ(k),
      );
    }
  }
  // Seules les positions comptent : la couture et la pointe sont soudées, puis les normales
  // recalculées (elles suivent l'effilement et l'arrondi du bout).
  tube.deleteAttribute('normal');
  tube.deleteAttribute('uv');
  const tail = mergeVertices(tube);
  tube.dispose();
  // La pointe soudée aplatit un triangle sur deux du dernier anneau : ils sont retirés.
  const index = tail.getIndex();
  if (!index) throw new Error('tailTubeGeometry : géométrie non indexée');
  const kept: number[] = [];
  for (let k = 0; k < index.count; k += 3) {
    const a = index.getX(k);
    const b = index.getX(k + 1);
    const c = index.getX(k + 2);
    if (a !== b && b !== c && c !== a) kept.push(a, b, c);
  }
  tail.setIndex(kept);
  tail.computeVertexNormals();
  return tail;
}
